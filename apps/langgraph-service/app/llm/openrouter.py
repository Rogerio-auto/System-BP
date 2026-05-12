"""Provider OpenRouter — default do gateway LLM.

Usa ``langchain-openai`` com ``base_url`` apontando para a API do OpenRouter,
injetando os headers obrigatórios ``HTTP-Referer`` e ``X-Title`` em cada
chamada. Não delega esse header para o langchain — é feito explicitamente
no client httpx para garantir conformidade com os termos do OpenRouter.

Retry via tenacity:
    - Máximo 3 tentativas (1 original + 2 retries).
    - Backoff exponencial com jitter (evita thundering herd).
    - Retenta somente em erros transitórios (5xx, timeout, 429).
    - Nunca retenta 4xx (exceto 429 Rate Limit).
"""
from __future__ import annotations

import time
from typing import Any

import httpx
import structlog
import tenacity
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential_jitter

from app.config import settings
from app.llm.gateway import (
    LLMProviderError,
    LLMResponse,
    TokenUsage,
    measure_latency,
    redact_messages,
)

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

_PROVIDER = "openrouter"
_TIMEOUT_S: float = 60.0  # timeout duro por chamada
_MAX_ATTEMPTS: int = 3


# ---------------------------------------------------------------------------
# Predicado de retry: transitório = 5xx ou timeout ou 429
# ---------------------------------------------------------------------------


def _is_transient(exc: BaseException) -> bool:
    """Retorna True para erros que justificam retry."""
    if isinstance(exc, httpx.TimeoutException):
        return True
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        return code == 429 or code >= 500
    if isinstance(exc, LLMProviderError):
        return exc.status_code is not None and (
            exc.status_code == 429 or exc.status_code >= 500
        )
    return False


# ---------------------------------------------------------------------------
# OpenRouterGateway
# ---------------------------------------------------------------------------


class OpenRouterGateway:
    """Implementação concreta do LLMGateway para o OpenRouter.

    Compatível com o Protocol ``LLMGateway`` — verificado em runtime via
    ``isinstance(gateway, LLMGateway)``.
    """

    def __init__(self) -> None:
        api_key = settings.openrouter_api_key
        if api_key is None:
            raise RuntimeError(
                "OPENROUTER_API_KEY não configurada. "
                "Defina a variável de ambiente antes de usar o provider openrouter."
            )
        self._api_key: str = api_key.get_secret_value()
        self._base_url: str = settings.openrouter_base_url.rstrip("/")
        self._http_referer: str = settings.openrouter_http_referer
        self._app_title: str = settings.openrouter_app_title

    # ------------------------------------------------------------------
    # LLMGateway protocol
    # ------------------------------------------------------------------

    async def complete(
        self,
        *,
        model: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.2,
        max_tokens: int = 1024,
        metadata: dict[str, Any] | None = None,
    ) -> LLMResponse:
        """Envia requisição de completion ao OpenRouter com retry e DLP."""
        # DLP: nunca enviar PII bruta ao suboperador internacional
        clean_messages = redact_messages(messages)

        meta = metadata or {}
        log.info(
            "llm_call_start",
            provider=_PROVIDER,
            model=model,
            message_count=len(clean_messages),
            **meta,
        )

        start = time.monotonic()
        response = await self._complete_with_retry(
            model=model,
            messages=clean_messages,
            tools=tools,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        response.latency_ms = measure_latency(start)

        log.info(
            "llm_call_done",
            provider=_PROVIDER,
            model=model,
            latency_ms=round(response.latency_ms, 1),
            prompt_tokens=response.usage.prompt_tokens,
            completion_tokens=response.usage.completion_tokens,
            finish_reason=response.finish_reason,
            **meta,
        )
        return response

    async def check_budget(self, org_id: str) -> bool:
        """Stub: retorna True. Implementação real no slot de billing.

        Nota: Este método é um stub intencional. A implementação real
        consultará a tabela llm_usage_daily via InternalApiClient.
        """
        # stub — slot de billing implementará a consulta real
        return True

    # ------------------------------------------------------------------
    # Retry wrapper
    # ------------------------------------------------------------------

    @retry(
        retry=retry_if_exception(_is_transient),
        stop=stop_after_attempt(_MAX_ATTEMPTS),
        wait=wait_exponential_jitter(initial=1, max=30, jitter=2),
        reraise=True,
        before_sleep=lambda rs: log.warning(
            "llm_retry",
            provider=_PROVIDER,
            attempt=rs.attempt_number,
        ),
    )
    async def _complete_with_retry(
        self,
        *,
        model: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
        temperature: float,
        max_tokens: int,
    ) -> LLMResponse:
        """Executa uma chamada HTTP ao endpoint de chat/completions do OpenRouter."""
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if tools:
            payload["tools"] = tools

        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "HTTP-Referer": self._http_referer,
            "X-Title": self._app_title,
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
            try:
                resp = await client.post(
                    f"{self._base_url}/chat/completions",
                    json=payload,
                    headers=headers,
                )
            except httpx.TimeoutException:
                log.error("llm_timeout", provider=_PROVIDER, model=model)
                raise

            if not resp.is_success:
                body = resp.text[:500]  # limitar tamanho do log
                log.error(
                    "llm_http_error",
                    provider=_PROVIDER,
                    model=model,
                    status_code=resp.status_code,
                    body=body,
                )
                raise LLMProviderError(
                    provider=_PROVIDER,
                    status_code=resp.status_code,
                    message=body,
                )

        return self._parse_response(model, resp)

    # ------------------------------------------------------------------
    # Response parsing
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_response(model: str, resp: httpx.Response) -> LLMResponse:
        """Converte a resposta HTTP do OpenRouter em ``LLMResponse``."""
        data: dict[str, Any] = resp.json()

        choices: list[dict[str, Any]] = data.get("choices", [])
        if not choices:
            raise LLMProviderError(
                provider=_PROVIDER,
                status_code=resp.status_code,
                message="Resposta sem choices",
            )

        first_choice: dict[str, Any] = choices[0]
        message: dict[str, Any] = first_choice.get("message", {})
        content: str = message.get("content") or ""
        finish_reason: str = first_choice.get("finish_reason", "stop") or "stop"

        raw_usage: dict[str, Any] = data.get("usage", {})
        usage = TokenUsage(
            prompt_tokens=int(raw_usage.get("prompt_tokens", 0)),
            completion_tokens=int(raw_usage.get("completion_tokens", 0)),
            total_tokens=int(raw_usage.get("total_tokens", 0)),
        )

        actual_model: str = data.get("model", model)

        return LLMResponse(
            content=content,
            model=actual_model,
            usage=usage,
            finish_reason=finish_reason,
            raw=data,
        )


# ---------------------------------------------------------------------------
# Re-export para conveniência de import
# ---------------------------------------------------------------------------

__all__ = ["OpenRouterGateway"]

# Silence tenacity unused-import warning from static analysers
_ = tenacity
