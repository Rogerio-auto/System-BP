"""Cliente HTTP base para chamadas ao backend Node via /internal/*.

Todas as ferramentas (tools) dos grafos LangGraph devem usar esta classe —
nunca abrir conexões HTTP avulsas ou acessar o banco de dados diretamente.

Contrato:
    client = InternalApiClient()
    data = await client.get("/internal/leads/123")
    data = await client.post("/internal/leads", json={...}, idempotency_key="...")
"""
from __future__ import annotations

import asyncio
from typing import Any

import httpx
import structlog

from app.config import settings

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

_DEFAULT_TIMEOUT_S: float = 8.0
_MAX_RETRIES: int = 1
_RETRY_BACKOFF_S: float = 0.5
_RETRYABLE_STATUS_CODES: frozenset[int] = frozenset(range(500, 600))


def _build_base_url() -> str:
    """Normalise HttpUrl → str, garantindo trailing slash."""
    raw = str(settings.backend_internal_url)
    return raw if raw.endswith("/") else f"{raw}/"


def _auth_headers() -> dict[str, str]:
    """Headers obrigatórios em toda requisição ao backend."""
    return {"X-Internal-Token": settings.internal_token.get_secret_value()}


def _correlation_headers() -> dict[str, str]:
    """Propaga X-Correlation-Id a partir do contexto de structlog, se presente."""
    ctx = structlog.contextvars.get_contextvars()
    raw = ctx.get("correlation_id")
    correlation_id: str | None = str(raw) if raw is not None else None
    if correlation_id:
        return {"X-Correlation-Id": correlation_id}
    return {}


class InternalApiClient:
    """Cliente HTTP seguro para comunicação com o backend Node.

    Características:
    - Injeta ``X-Internal-Token`` em toda chamada.
    - Propaga ``X-Correlation-Id`` quando presente no contexto structlog.
    - Retry automático (1x) com backoff linear em respostas 5xx.
    - Timeout fixo de 8 s por chamada.
    - Retorna ``dict[str, Any]`` desserializado; lança ``httpx.HTTPStatusError``
      em respostas de erro após esgotar tentativas.
    """

    def __init__(self, timeout: float = _DEFAULT_TIMEOUT_S) -> None:
        self._base_url = _build_base_url()
        self._timeout = timeout

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    async def get(
        self,
        path: str,
        *,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Executa GET em ``path`` relativo ao backend interno.

        Args:
            path: Caminho relativo (ex.: ``"/internal/leads/123"``).
            params: Query string como dicionário, opcional.

        Returns:
            Corpo JSON desserializado como ``dict``.

        Raises:
            httpx.HTTPStatusError: Em resposta de erro após retries.
            httpx.TimeoutException: Se o backend não responder em 8 s.
        """
        return await self._request("GET", path, params=params)

    async def post(
        self,
        path: str,
        json: dict[str, Any],
        *,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """Executa POST em ``path`` com corpo JSON.

        Args:
            path: Caminho relativo (ex.: ``"/internal/leads"``).
            json: Payload a serializar como JSON.
            idempotency_key: Valor para o header ``Idempotency-Key``.
                             Garante que chamadas duplicadas não criem
                             recursos duplicados no backend.

        Returns:
            Corpo JSON desserializado como ``dict``.

        Raises:
            httpx.HTTPStatusError: Em resposta de erro após retries.
            httpx.TimeoutException: Se o backend não responder em 8 s.
        """
        extra_headers: dict[str, str] = {}
        if idempotency_key is not None:
            extra_headers["Idempotency-Key"] = idempotency_key
        return await self._request("POST", path, json=json, extra_headers=extra_headers)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        """Executa a chamada HTTP com retry em 5xx."""
        url = self._build_url(path)
        headers: dict[str, str] = {
            **_auth_headers(),
            **_correlation_headers(),
            **(extra_headers or {}),
        }

        last_exc: Exception | None = None

        for attempt in range(_MAX_RETRIES + 1):
            if attempt > 0:
                await asyncio.sleep(_RETRY_BACKOFF_S * attempt)
                log.warning(
                    "internal_api_retry",
                    method=method,
                    url=url,
                    attempt=attempt,
                )

            try:
                result = await self._execute(method, url, headers=headers, json=json, params=params)
                return result
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code in _RETRYABLE_STATUS_CODES and attempt < _MAX_RETRIES:
                    log.warning(
                        "internal_api_5xx",
                        method=method,
                        url=url,
                        status_code=exc.response.status_code,
                        attempt=attempt,
                    )
                    last_exc = exc
                    continue
                log.error(
                    "internal_api_error",
                    method=method,
                    url=url,
                    status_code=exc.response.status_code,
                )
                raise
            except httpx.TimeoutException as exc:
                log.error("internal_api_timeout", method=method, url=url)
                raise exc from exc

        # Reached only if retries exhausted; last_exc is always set here.
        assert last_exc is not None  # invariant: always set after loop body executes
        raise last_exc

    async def _execute(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str],
        json: dict[str, Any] | None,
        params: dict[str, Any] | None,
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.request(
                method,
                url,
                headers=headers,
                json=json,
                params=params,
            )
            response.raise_for_status()
            result: dict[str, Any] = response.json()
            log.info(
                "internal_api_ok",
                method=method,
                url=url,
                status_code=response.status_code,
            )
            return result

    def _build_url(self, path: str) -> str:
        """Concatena base URL + path, evitando double-slash."""
        stripped = path.lstrip("/")
        return f"{self._base_url}{stripped}"
