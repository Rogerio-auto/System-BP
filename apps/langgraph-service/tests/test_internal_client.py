"""Testes unitários para InternalApiClient.

Cobre:
- Header X-Internal-Token enviado em GET e POST
- Header Idempotency-Key enviado em POST quando idempotency_key fornecido
- Propagação de X-Correlation-Id a partir do contexto structlog
- Retry 1x em resposta 5xx, sem retry em 4xx
- Timeout 8 s (configurável)
- Resposta JSON desserializada corretamente
"""
from __future__ import annotations

import httpx
import pytest
import respx
import structlog.contextvars

from app.config import settings
from app.tools._base import InternalApiClient


def _base(path: str) -> str:
    """Monta URL completa a partir de settings — replica lógica de _build_url."""
    raw = str(settings.backend_internal_url)
    base = raw if raw.endswith("/") else f"{raw}/"
    return f"{base}{path.lstrip('/')}"


# ---------------------------------------------------------------------------
# GET — token + resposta OK
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_get_sends_internal_token() -> None:
    """X-Internal-Token deve estar presente em toda chamada GET."""
    url = _base("/internal/ping")
    with respx.mock:
        route = respx.get(url).mock(return_value=httpx.Response(200, json={"pong": True}))
        client = InternalApiClient()
        result = await client.get("/internal/ping")

    assert route.called
    sent_token = route.calls.last.request.headers.get("x-internal-token")
    assert sent_token == settings.internal_token.get_secret_value()
    assert result == {"pong": True}


# ---------------------------------------------------------------------------
# POST — token + body + resposta OK
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_post_sends_internal_token() -> None:
    """X-Internal-Token deve estar presente em toda chamada POST."""
    url = _base("/internal/leads")
    with respx.mock:
        route = respx.post(url).mock(
            return_value=httpx.Response(201, json={"id": "abc", "created": True})
        )
        client = InternalApiClient()
        result = await client.post("/internal/leads", json={"phone": "+5511999999999"})

    assert route.called
    sent_token = route.calls.last.request.headers.get("x-internal-token")
    assert sent_token == settings.internal_token.get_secret_value()
    assert result["created"] is True


# ---------------------------------------------------------------------------
# Idempotency-Key
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_post_sends_idempotency_key_when_provided() -> None:
    """Header Idempotency-Key deve aparecer quando idempotency_key é passado."""
    url = _base("/internal/leads")
    with respx.mock:
        route = respx.post(url).mock(return_value=httpx.Response(201, json={"id": "xyz"}))
        client = InternalApiClient()
        await client.post(
            "/internal/leads",
            json={"phone": "+5511888888888"},
            idempotency_key="unique-key-123",
        )

    key_header = route.calls.last.request.headers.get("idempotency-key")
    assert key_header == "unique-key-123"


@pytest.mark.asyncio()
async def test_post_no_idempotency_key_header_when_not_provided() -> None:
    """Header Idempotency-Key NÃO deve aparecer quando idempotency_key é None."""
    url = _base("/internal/leads")
    with respx.mock:
        route = respx.post(url).mock(return_value=httpx.Response(201, json={"id": "xyz"}))
        client = InternalApiClient()
        await client.post("/internal/leads", json={"phone": "+5511777777777"})

    key_header = route.calls.last.request.headers.get("idempotency-key")
    assert key_header is None


# ---------------------------------------------------------------------------
# X-Correlation-Id propagado do contextvars
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_get_propagates_correlation_id_from_context() -> None:
    """X-Correlation-Id deve ser injetado quando presente no contexto structlog."""
    structlog.contextvars.bind_contextvars(correlation_id="corr-abc-123")
    url = _base("/internal/foo")
    with respx.mock:
        route = respx.get(url).mock(return_value=httpx.Response(200, json={}))
        client = InternalApiClient()
        await client.get("/internal/foo")

    corr_header = route.calls.last.request.headers.get("x-correlation-id")
    assert corr_header == "corr-abc-123"


@pytest.mark.asyncio()
async def test_get_no_correlation_id_when_context_empty() -> None:
    """X-Correlation-Id NÃO deve aparecer quando não há contexto structlog."""
    # autouse fixture já limpou o contexto
    url = _base("/internal/bar")
    with respx.mock:
        route = respx.get(url).mock(return_value=httpx.Response(200, json={}))
        client = InternalApiClient()
        await client.get("/internal/bar")

    corr_header = route.calls.last.request.headers.get("x-correlation-id")
    assert corr_header is None


# ---------------------------------------------------------------------------
# Retry em 5xx
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_get_retries_once_on_5xx_then_succeeds() -> None:
    """GET deve tentar 1 vez após 5xx e ter sucesso na 2ª tentativa."""
    url = _base("/internal/unstable")
    responses = [
        httpx.Response(503, json={"error": "unavailable"}),
        httpx.Response(200, json={"ok": True}),
    ]
    with respx.mock:
        route = respx.get(url).mock(side_effect=responses)
        client = InternalApiClient()
        result = await client.get("/internal/unstable")

    assert route.call_count == 2
    assert result == {"ok": True}


@pytest.mark.asyncio()
async def test_get_raises_after_exhausting_retries_on_5xx() -> None:
    """GET deve levantar HTTPStatusError quando 5xx persiste além dos retries."""
    url = _base("/internal/always-down")
    responses = [
        httpx.Response(500, json={"error": "boom"}),
        httpx.Response(500, json={"error": "boom again"}),
    ]
    with respx.mock:
        route = respx.get(url).mock(side_effect=responses)
        client = InternalApiClient()
        with pytest.raises(httpx.HTTPStatusError) as exc_info:
            await client.get("/internal/always-down")

    assert route.call_count == 2  # tentativa original + 1 retry
    assert exc_info.value.response.status_code == 500


@pytest.mark.asyncio()
async def test_post_retries_once_on_5xx() -> None:
    """POST deve tentar 1 vez após 5xx e ter sucesso na 2ª tentativa."""
    url = _base("/internal/events")
    responses = [
        httpx.Response(502, json={"error": "bad gateway"}),
        httpx.Response(201, json={"queued": True}),
    ]
    with respx.mock:
        route = respx.post(url).mock(side_effect=responses)
        client = InternalApiClient()
        result = await client.post("/internal/events", json={"type": "test"})

    assert route.call_count == 2
    assert result == {"queued": True}


@pytest.mark.asyncio()
async def test_get_does_not_retry_on_4xx() -> None:
    """GET NÃO deve fazer retry em respostas 4xx (não são erros transitórios)."""
    url = _base("/internal/notfound")
    with respx.mock:
        route = respx.get(url).mock(return_value=httpx.Response(404, json={"error": "not found"}))
        client = InternalApiClient()
        with pytest.raises(httpx.HTTPStatusError) as exc_info:
            await client.get("/internal/notfound")

    assert route.call_count == 1  # sem retry
    assert exc_info.value.response.status_code == 404


# ---------------------------------------------------------------------------
# Timeout
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_get_raises_timeout_on_slow_backend() -> None:
    """GET deve levantar TimeoutException quando o backend ultrapassa o timeout."""
    url = _base("/internal/slow")
    with respx.mock:
        respx.get(url).mock(side_effect=httpx.ReadTimeout("timed out", request=None))  # type: ignore[arg-type]
        client = InternalApiClient(timeout=0.001)
        with pytest.raises(httpx.TimeoutException):
            await client.get("/internal/slow")


# ---------------------------------------------------------------------------
# GET com query params
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_get_passes_query_params() -> None:
    """Params devem ser enviados como query string."""
    url = _base("/internal/leads")
    with respx.mock:
        route = respx.get(url).mock(return_value=httpx.Response(200, json={"items": []}))
        client = InternalApiClient()
        result = await client.get("/internal/leads", params={"city_id": "1", "page": "2"})

    assert route.called
    sent_url = str(route.calls.last.request.url)
    assert "city_id=1" in sent_url
    assert "page=2" in sent_url
    assert result == {"items": []}
