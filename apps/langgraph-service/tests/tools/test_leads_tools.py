"""Testes unitários para get_or_create_lead.

Cobre:
- Sucesso: lead criado (created=True)
- Sucesso: lead encontrado (created=False)
- Erro INVALID_PHONE (400 com código no body)
- Erro LEAD_MERGE_REQUIRED (409 com código no body)
- Erro BACKEND_UNAVAILABLE: 5xx do backend
- Erro BACKEND_UNAVAILABLE: timeout
- Propagação do X-Correlation-Id via contextvars
- Header Idempotency-Key enviado com phone na chave
"""
from __future__ import annotations

import httpx
import pytest
import respx

from app.config import settings
from app.tools.leads_tools import (
    GetOrCreateLeadError,
    GetOrCreateLeadSuccess,
    LeadErrorCode,
    get_or_create_lead,
)


def _url() -> str:
    raw = str(settings.backend_internal_url)
    base = raw if raw.endswith("/") else f"{raw}/"
    return f"{base}internal/leads/get-or-create"


_PHONE = "+5569999999999"

_SUCCESS_BODY = {
    "lead_id": "aaaaaaaa-0000-0000-0000-000000000001",
    "customer_id": None,
    "created": True,
    "current_stage": "pre_atendimento",
    "city_id": None,
    "assigned_agent_id": None,
}


# ---------------------------------------------------------------------------
# Sucesso — lead criado
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_success_lead_created() -> None:
    """Tool deve retornar GetOrCreateLeadSuccess com created=True."""
    with respx.mock:
        route = respx.post(_url()).mock(return_value=httpx.Response(201, json=_SUCCESS_BODY))
        result = await get_or_create_lead.ainvoke({"phone": _PHONE, "source": "whatsapp"})

    assert route.called
    assert isinstance(result, GetOrCreateLeadSuccess)
    assert result.ok is True
    assert result.lead_id == _SUCCESS_BODY["lead_id"]
    assert result.created is True
    assert result.current_stage == "pre_atendimento"
    assert result.customer_id is None
    assert result.city_id is None
    assert result.assigned_agent_id is None


# ---------------------------------------------------------------------------
# Sucesso — lead já existia
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_success_lead_found() -> None:
    """Tool deve retornar GetOrCreateLeadSuccess com created=False."""
    body = {**_SUCCESS_BODY, "created": False, "current_stage": "qualificacao"}
    with respx.mock:
        respx.post(_url()).mock(return_value=httpx.Response(200, json=body))
        result = await get_or_create_lead.ainvoke({"phone": _PHONE})

    assert isinstance(result, GetOrCreateLeadSuccess)
    assert result.created is False
    assert result.current_stage == "qualificacao"


# ---------------------------------------------------------------------------
# Sucesso — campos opcionais preenchidos
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_success_with_optional_fields() -> None:
    """Tool deve preencher customer_id, city_id e assigned_agent_id quando presentes."""
    body = {
        **_SUCCESS_BODY,
        "customer_id": "cust-0001",
        "city_id": "city-0001",
        "assigned_agent_id": "agent-0001",
    }
    with respx.mock:
        respx.post(_url()).mock(return_value=httpx.Response(201, json=body))
        result = await get_or_create_lead.ainvoke({"phone": _PHONE})

    assert isinstance(result, GetOrCreateLeadSuccess)
    assert result.customer_id == "cust-0001"
    assert result.city_id == "city-0001"
    assert result.assigned_agent_id == "agent-0001"


# ---------------------------------------------------------------------------
# Erro INVALID_PHONE
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_error_invalid_phone() -> None:
    """Tool deve retornar GetOrCreateLeadError com INVALID_PHONE em 400."""
    error_body = {"code": "INVALID_PHONE", "message": "Telefone inválido para BR."}
    with respx.mock:
        respx.post(_url()).mock(return_value=httpx.Response(400, json=error_body))
        result = await get_or_create_lead.ainvoke({"phone": "0000"})

    assert isinstance(result, GetOrCreateLeadError)
    assert result.ok is False
    assert result.error_code == LeadErrorCode.INVALID_PHONE
    assert "Telefone" in result.message


# ---------------------------------------------------------------------------
# Erro LEAD_MERGE_REQUIRED
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_error_lead_merge_required() -> None:
    """Tool deve retornar GetOrCreateLeadError com LEAD_MERGE_REQUIRED em 409."""
    error_body = {
        "code": "LEAD_MERGE_REQUIRED",
        "message": "Múltiplos leads com mesmo telefone.",
    }
    with respx.mock:
        respx.post(_url()).mock(return_value=httpx.Response(409, json=error_body))
        result = await get_or_create_lead.ainvoke({"phone": _PHONE})

    assert isinstance(result, GetOrCreateLeadError)
    assert result.error_code == LeadErrorCode.LEAD_MERGE_REQUIRED


# ---------------------------------------------------------------------------
# Erro BACKEND_UNAVAILABLE — 5xx
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_error_backend_unavailable_5xx() -> None:
    """Tool deve retornar BACKEND_UNAVAILABLE quando o backend retorna 5xx."""
    with respx.mock:
        respx.post(_url()).mock(return_value=httpx.Response(503, json={"error": "down"}))
        result = await get_or_create_lead.ainvoke({"phone": _PHONE})

    assert isinstance(result, GetOrCreateLeadError)
    assert result.error_code == LeadErrorCode.BACKEND_UNAVAILABLE
    assert "503" in result.message


# ---------------------------------------------------------------------------
# Erro BACKEND_UNAVAILABLE — timeout
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_error_backend_unavailable_timeout() -> None:
    """Tool deve retornar BACKEND_UNAVAILABLE quando o backend ultrapassa timeout."""
    with respx.mock:
        respx.post(_url()).mock(
            side_effect=httpx.ReadTimeout("timed out", request=None)  # type: ignore[arg-type]
        )
        result = await get_or_create_lead.ainvoke({"phone": _PHONE})

    assert isinstance(result, GetOrCreateLeadError)
    assert result.error_code == LeadErrorCode.BACKEND_UNAVAILABLE
    assert "Timeout" in result.message


# ---------------------------------------------------------------------------
# Headers obrigatórios
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_sends_internal_token() -> None:
    """X-Internal-Token deve estar presente em toda chamada."""
    with respx.mock:
        route = respx.post(_url()).mock(return_value=httpx.Response(201, json=_SUCCESS_BODY))
        await get_or_create_lead.ainvoke({"phone": _PHONE})

    token = route.calls.last.request.headers.get("x-internal-token")
    assert token == settings.internal_token.get_secret_value()


@pytest.mark.asyncio()
async def test_sends_idempotency_key_based_on_phone() -> None:
    """Idempotency-Key deve conter o telefone para garantir unicidade por conversa."""
    with respx.mock:
        route = respx.post(_url()).mock(return_value=httpx.Response(201, json=_SUCCESS_BODY))
        await get_or_create_lead.ainvoke({"phone": _PHONE})

    key = route.calls.last.request.headers.get("idempotency-key")
    assert key is not None
    assert _PHONE in key


@pytest.mark.asyncio()
async def test_propagates_correlation_id_from_input() -> None:
    """X-Correlation-Id deve ser propagado quando correlation_id é fornecido."""
    corr = "test-corr-99"
    with respx.mock:
        route = respx.post(_url()).mock(return_value=httpx.Response(201, json=_SUCCESS_BODY))
        await get_or_create_lead.ainvoke({"phone": _PHONE, "correlation_id": corr})

    corr_header = route.calls.last.request.headers.get("x-correlation-id")
    assert corr_header == corr


# ---------------------------------------------------------------------------
# Payload opcional: name e chatwoot_conversation_id
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_sends_name_when_provided() -> None:
    """Campo 'name' deve estar no payload quando informado."""
    with respx.mock:
        route = respx.post(_url()).mock(return_value=httpx.Response(201, json=_SUCCESS_BODY))
        await get_or_create_lead.ainvoke({"phone": _PHONE, "name": "Maria Silva"})

    import json

    body = json.loads(route.calls.last.request.content)
    assert body.get("name") == "Maria Silva"


@pytest.mark.asyncio()
async def test_omits_name_when_not_provided() -> None:
    """Campo 'name' NÃO deve aparecer no payload quando None."""
    with respx.mock:
        route = respx.post(_url()).mock(return_value=httpx.Response(201, json=_SUCCESS_BODY))
        await get_or_create_lead.ainvoke({"phone": _PHONE})

    import json

    body = json.loads(route.calls.last.request.content)
    assert "name" not in body


@pytest.mark.asyncio()
async def test_sends_chatwoot_conversation_id_when_provided() -> None:
    """Campo 'chatwoot_conversation_id' deve estar no payload quando informado."""
    with respx.mock:
        route = respx.post(_url()).mock(return_value=httpx.Response(201, json=_SUCCESS_BODY))
        await get_or_create_lead.ainvoke(
            {"phone": _PHONE, "chatwoot_conversation_id": "conv-42"}
        )

    import json

    body = json.loads(route.calls.last.request.content)
    assert body.get("chatwoot_conversation_id") == "conv-42"


# ---------------------------------------------------------------------------
# Código de erro desconhecido → BACKEND_UNAVAILABLE
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_unknown_error_code_mapped_to_backend_unavailable() -> None:
    """Código de erro desconhecido deve ser mapeado para BACKEND_UNAVAILABLE."""
    error_body = {"code": "SOME_NEW_CODE", "message": "Novo erro do backend."}
    with respx.mock:
        respx.post(_url()).mock(return_value=httpx.Response(422, json=error_body))
        result = await get_or_create_lead.ainvoke({"phone": _PHONE})

    assert isinstance(result, GetOrCreateLeadError)
    assert result.error_code == LeadErrorCode.BACKEND_UNAVAILABLE
    assert "SOME_NEW_CODE" in result.message
