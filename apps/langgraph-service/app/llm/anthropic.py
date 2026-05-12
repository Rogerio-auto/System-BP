"""Provider Anthropic — fallback direto do gateway LLM.

Usado quando ``LLM_PROVIDER=anthropic``. Chama a API da Anthropic diretamente
via ``langchain-anthropic`` (sem OpenRouter como intermediário).

Mantém a mesma interface ``LLMGateway`` para que o código de nó seja
completamente agnóstico ao provider.

Headers e retry: mesma política do OpenRouter provider.
DLP: aplicado antes de toda chamada — LGPD §14.
"""
from __future__ import annotations

import time
from typing import Any

import structlog
import tenacity
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from pydantic import SecretStr
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

_PROVIDER = "anthropic"
_TIMEOUT_S: float = 60.0
_MAX_ATTEMPTS: int = 3


# ---------------------------------------------------------------------------
# Predicado de retry (espelha OpenRouter — transitório = 5xx / timeout / 429)
# ---------------------------------------------------------------------------


def _is_transient(exc: BaseException) -> bool:
    """Retorna True para erros recuperáveis do provider Anthropic."""
    # langchain_anthropic lança anthropic.APIStatusError, mas verificamos pelo
    # padrão da mensagem para evitar dependência de import direto do SDK.
    cls_name = type(exc).__name__
    if "RateLimitError" in cls_name or "InternalServerError" in cls_name:
        return True
    if "Timeout" in cls_name or "Connection" in cls_name:
        return True
    if isinstance(exc, LLMProviderError):
        return exc.status_code is not None and (
            exc.status_code == 429 or exc.status_code >= 500
        )
    return False


# ---------------------------------------------------------------------------
# Conversão messages dict → LangChain BaseMessage
# ---------------------------------------------------------------------------


def _to_langchain_messages(messages: list[dict[str, Any]]) -> list[BaseMessage]:
    """Converte lista de dicts no formato OpenAI para objetos LangChain."""
    lc_messages: list[BaseMessage] = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role == "system":
            lc_messages.append(SystemMessage(content=content))
        elif role == "assistant":
            lc_messages.append(AIMessage(content=content))
        else:
            lc_messages.append(HumanMessage(content=content))
    return lc_messages


# ---------------------------------------------------------------------------
# AnthropicGateway
# ---------------------------------------------------------------------------


class AnthropicGateway:
    """Implementação concreta do LLMGateway para a API da Anthropic.

    Compatível com o Protocol ``LLMGateway``.
    """

    def __init__(self) -> None:
        api_key = settings.anthropic_api_key
        if api_key is None:
            raise RuntimeError(
                "ANTHROPIC_API_KEY não configurada. "
                "Defina a variável de ambiente antes de usar o provider anthropic."
            )
        # Store as SecretStr to match langchain-anthropic stubs requirement
        self._api_key: SecretStr = api_key

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
        """Envia requisição de completion à Anthropic com retry e DLP."""
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
        """Stub: retorna True. Implementação real no slot de billing."""
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
        """Executa a chamada ao LangChain ChatAnthropic."""
        lc_messages = _to_langchain_messages(messages)

        # Mapear nome lógico para nome Anthropic se vier prefixado por "anthropic/"
        anthropic_model = model.removeprefix("anthropic/")

        # model_name / max_tokens_to_sample: nomes usados pelos stubs mypy do langchain-anthropic.
        # O runtime aceita também "model" e "max_tokens" — mas usamos os nomes dos stubs
        # para garantir que `mypy --strict` passe sem type: ignore.
        llm = ChatAnthropic(
            model_name=anthropic_model,
            api_key=self._api_key,
            temperature=temperature,
            max_tokens_to_sample=max_tokens,
            timeout=_TIMEOUT_S,
            stop=None,
        )

        try:
            result = await llm.ainvoke(lc_messages)
        except Exception as exc:
            cls_name = type(exc).__name__
            log.error(
                "llm_provider_error",
                provider=_PROVIDER,
                model=model,
                error=cls_name,
                message=str(exc)[:300],
            )
            # Re-raise para que tenacity avalie se é transitório
            raise

        # Extrair content
        if isinstance(result, AIMessage):
            raw_content = result.content
            content: str = raw_content if isinstance(raw_content, str) else str(raw_content)
        else:
            content = str(result)

        # Extrair usage do response_metadata quando disponível
        response_metadata: dict[str, Any] = (
            result.response_metadata if isinstance(result, AIMessage) else {}
        )
        raw_usage: dict[str, Any] = response_metadata.get("usage", {})
        usage = TokenUsage(
            prompt_tokens=int(raw_usage.get("input_tokens", 0)),
            completion_tokens=int(raw_usage.get("output_tokens", 0)),
            total_tokens=int(raw_usage.get("input_tokens", 0))
            + int(raw_usage.get("output_tokens", 0)),
        )

        stop_reason: str = response_metadata.get("stop_reason", "end_turn") or "end_turn"

        return LLMResponse(
            content=content,
            model=model,
            usage=usage,
            finish_reason=stop_reason,
            raw=response_metadata,
        )


# ---------------------------------------------------------------------------
# Re-export
# ---------------------------------------------------------------------------

__all__ = ["AnthropicGateway"]

# Silence tenacity unused-import warning from static analysers
_ = tenacity
