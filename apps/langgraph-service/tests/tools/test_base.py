"""Testes unitários para InternalApiClient — métodos put() e patch() (F7-S03 item 5).

Cobre:
- put(): envia requisição PUT com corpo JSON + header Idempotency-Key opcional.
- put(): envia requisição PUT sem corpo (None).
- patch(): envia requisição PATCH com corpo JSON + header Idempotency-Key opcional.
- patch(): envia requisição PATCH sem corpo (None).
- Ambos propagam HTTPStatusError em respostas de erro (5xx/4xx).
- Ambos injetam X-Internal-Token automaticamente.
"""
from __future__ import annotations

import uuid

import httpx
import pytest
import respx

from app.config import settings
from app.tools._base import InternalApiClient

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _base(path: str) -> str:
    """Monta URL completa a partir de settings — replica lógica de _build_url."""
    raw = str(settings.backend_internal_url)
    base = raw if raw.endswith("/") else f"{raw}/"
    return f"{base}{path.lstrip('/')}"


def _conversations_url(conv_id: str) -> str:
    return _base(f"/internal/conversations/{conv_id}/state")


def _leads_url(lead_id: str) -> str:
    return _base(f"/internal/leads/{lead_id}")


# ---------------------------------------------------------------------------
# put() — sucesso básico
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_put_sends_request_and_returns_json() -> None:
    """put() deve enviar PUT com body JSON e retornar JSON do backend."""
    conv_id = str(uuid.uuid4())
    url = _conversations_url(conv_id)
    expected_response = {"ok": True, "conversation_id": conv_id}

    with respx.mock(assert_all_called=True) as mock:
        mock.put(url).mock(
            return_value=httpx.Response(200, json=expected_response)
        )
        client = InternalApiClient()
        result = await client.put(
            f"/internal/conversations/{conv_id}/state",
            json={"state": {}, "phone": "+5569999999999"},
        )

    assert result == expected_response


@pytest.mark.asyncio()
async def test_put_sends_idempotency_key_header() -> None:
    """put() deve enviar o header Idempotency-Key quando fornecido."""
    conv_id = str(uuid.uuid4())
    url = _conversations_url(conv_id)
    idem_key = f"conv_state_{conv_id}"

    with respx.mock(assert_all_called=True) as mock:
        route = mock.put(url).mock(
            return_value=httpx.Response(200, json={"ok": True})
        )
        client = InternalApiClient()
        await client.put(
            f"/internal/conversations/{conv_id}/state",
            json={"state": {}},
            idempotency_key=idem_key,
        )

        # Verifica que o header foi passado na requisição (dentro do with — calls disponíveis)
        assert route.calls.last.request.headers.get("idempotency-key") == idem_key


@pytest.mark.asyncio()
async def test_put_without_body_sends_no_json() -> None:
    """put() com json=None deve enviar PUT sem corpo JSON."""
    conv_id = str(uuid.uuid4())
    url = _conversations_url(conv_id)

    with respx.mock(assert_all_called=True) as mock:
        mock.put(url).mock(
            return_value=httpx.Response(200, json={"ok": True})
        )
        client = InternalApiClient()
        result = await client.put(
            f"/internal/conversations/{conv_id}/state",
            json=None,
        )

    assert result == {"ok": True}


@pytest.mark.asyncio()
async def test_put_injects_internal_token_header() -> None:
    """put() deve injetar X-Internal-Token automaticamente."""
    conv_id = str(uuid.uuid4())
    url = _conversations_url(conv_id)
    expected_token = settings.internal_token.get_secret_value()

    with respx.mock(assert_all_called=True) as mock:
        route = mock.put(url).mock(
            return_value=httpx.Response(200, json={"ok": True})
        )
        client = InternalApiClient()
        await client.put(
            f"/internal/conversations/{conv_id}/state",
            json={"state": {}},
        )

        assert route.calls.last.request.headers.get("x-internal-token") == expected_token


@pytest.mark.asyncio()
async def test_put_raises_on_4xx_error() -> None:
    """put() deve propagar HTTPStatusError em resposta 4xx."""
    conv_id = str(uuid.uuid4())
    url = _conversations_url(conv_id)

    with respx.mock(assert_all_called=True) as mock:
        mock.put(url).mock(
            return_value=httpx.Response(404, json={"error": "not found"})
        )
        client = InternalApiClient()
        with pytest.raises(httpx.HTTPStatusError):
            await client.put(
                f"/internal/conversations/{conv_id}/state",
                json={"state": {}},
            )


# ---------------------------------------------------------------------------
# patch() — sucesso básico
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_patch_sends_request_and_returns_json() -> None:
    """patch() deve enviar PATCH com body JSON e retornar JSON do backend."""
    lead_id = str(uuid.uuid4())
    url = _leads_url(lead_id)
    expected_response = {"ok": True, "lead_id": lead_id, "current_stage": "qualification"}

    with respx.mock(assert_all_called=True) as mock:
        mock.patch(url).mock(
            return_value=httpx.Response(200, json=expected_response)
        )
        client = InternalApiClient()
        result = await client.patch(
            f"/internal/leads/{lead_id}",
            json={"name": "João Silva"},
        )

    assert result == expected_response


@pytest.mark.asyncio()
async def test_patch_sends_idempotency_key_header() -> None:
    """patch() deve enviar o header Idempotency-Key quando fornecido."""
    lead_id = str(uuid.uuid4())
    url = _leads_url(lead_id)
    idem_key = f"lead_update_{lead_id}_abc123"

    with respx.mock(assert_all_called=True) as mock:
        route = mock.patch(url).mock(
            return_value=httpx.Response(200, json={"ok": True, "lead_id": lead_id})
        )
        client = InternalApiClient()
        await client.patch(
            f"/internal/leads/{lead_id}",
            json={"name": "João Silva"},
            idempotency_key=idem_key,
        )

        assert route.calls.last.request.headers.get("idempotency-key") == idem_key


@pytest.mark.asyncio()
async def test_patch_without_body_sends_no_json() -> None:
    """patch() com json=None deve enviar PATCH sem corpo JSON."""
    lead_id = str(uuid.uuid4())
    url = _leads_url(lead_id)

    with respx.mock(assert_all_called=True) as mock:
        mock.patch(url).mock(
            return_value=httpx.Response(200, json={"ok": True})
        )
        client = InternalApiClient()
        result = await client.patch(
            f"/internal/leads/{lead_id}",
            json=None,
        )

    assert result == {"ok": True}


@pytest.mark.asyncio()
async def test_patch_injects_internal_token_header() -> None:
    """patch() deve injetar X-Internal-Token automaticamente."""
    lead_id = str(uuid.uuid4())
    url = _leads_url(lead_id)
    expected_token = settings.internal_token.get_secret_value()

    with respx.mock(assert_all_called=True) as mock:
        route = mock.patch(url).mock(
            return_value=httpx.Response(200, json={"ok": True})
        )
        client = InternalApiClient()
        await client.patch(
            f"/internal/leads/{lead_id}",
            json={"name": "João"},
        )

        assert route.calls.last.request.headers.get("x-internal-token") == expected_token


@pytest.mark.asyncio()
async def test_patch_raises_on_5xx_error() -> None:
    """patch() deve propagar HTTPStatusError em resposta 5xx (após retry)."""
    lead_id = str(uuid.uuid4())
    url = _leads_url(lead_id)

    with respx.mock(assert_all_called=False) as mock:
        # 5xx dispara retry (1x) — respx precisa retornar 5xx em ambas as tentativas
        mock.patch(url).mock(
            return_value=httpx.Response(503, json={"error": "service unavailable"})
        )
        client = InternalApiClient()
        with pytest.raises(httpx.HTTPStatusError):
            await client.patch(
                f"/internal/leads/{lead_id}",
                json={"name": "João"},
            )
