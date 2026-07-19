"""Testes unitários para leads_tools.

Cobre get_or_create_lead:
- Sucesso: lead criado (created=True)
- Sucesso: lead encontrado (created=False)
- Erro INVALID_PHONE (400 com código no body)
- Erro LEAD_MERGE_REQUIRED (409 com código no body)
- Erro BACKEND_UNAVAILABLE: 5xx do backend
- Erro BACKEND_UNAVAILABLE: timeout
- Propagação do X-Correlation-Id via contextvars
- Header Idempotency-Key enviado com phone na chave

Cobre get_customer_context:
- Sucesso: ficha de lead (type=lead)
- Sucesso: ficha de customer (type=customer)
- Erro: 404 → CUSTOMER_NOT_FOUND
- Erro: INVALID_INPUT (nem lead_id nem customer_id)
- Erro: BACKEND_UNAVAILABLE (5xx)
- Erro: BACKEND_UNAVAILABLE (timeout)
- Ausência de PII sensível no output (CPF, phone, email)
- Header X-Internal-Token presente

Cobre update_lead_profile:
- Sucesso: atualização parcial (apenas city_id)
- Sucesso: atualização com múltiplos campos
- Erro: 404 → LEAD_NOT_FOUND
- Erro: INVALID_INPUT (nenhum campo fornecido)
- Erro: BACKEND_UNAVAILABLE (5xx)
- Erro: BACKEND_UNAVAILABLE (timeout)
- Header X-Internal-Token presente
- Header Idempotency-Key baseado em lead_id
"""
from __future__ import annotations

import httpx
import pytest
import respx

from app.config import settings
from app.tools.leads_tools import (
    GetCustomerContextError,
    GetCustomerContextSuccess,
    GetOrCreateLeadError,
    GetOrCreateLeadSuccess,
    LeadErrorCode,
    UpdateLeadProfileError,
    UpdateLeadProfileSuccess,
    get_customer_context,
    get_or_create_lead,
    update_lead_profile,
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


# ===========================================================================
# Tests: get_customer_context
# ===========================================================================

_LEAD_ID = "bbbbbbbb-0000-0000-0000-000000000001"
_CUSTOMER_ID = "cccccccc-0000-0000-0000-000000000002"


def _context_url(entity_id: str) -> str:
    raw = str(settings.backend_internal_url)
    base = raw if raw.endswith("/") else f"{raw}/"
    return f"{base}internal/customers/{entity_id}/context"


_CONTEXT_BODY_MINIMAL: dict[str, object] = {
    "lead_id": _LEAD_ID,
    "customer_id": None,
    "name": "Maria Silva",
    "city_name": None,
    "agent_name": None,
    "current_stage": None,
    "lead_status": "new",
    "last_simulation": None,
    "last_analysis": None,
    "messages_last_30_days": 0,
}

_CONTEXT_BODY_FULL: dict[str, object] = {
    "lead_id": _LEAD_ID,
    "customer_id": _CUSTOMER_ID,
    "name": "João Pereira",
    "city_name": "Porto Velho",
    "agent_name": "Ana Lima",
    "current_stage": "qualificacao",
    "lead_status": "qualifying",
    "last_simulation": {
        "simulation_id": "dddddddd-0000-0000-0000-000000000003",
        "amount_requested": "5000.00",
        "term_months": 12,
        "monthly_payment": "450.00",
        "created_at": "2026-01-15T10:00:00.000Z",
        "sent_at": "2026-01-15T10:05:00.000Z",
    },
    "last_analysis": None,
    "messages_last_30_days": 7,
}


# ---------------------------------------------------------------------------
# Sucesso — ficha de lead (type=lead, padrão)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_context_success_lead_minimal() -> None:
    """Tool deve retornar GetCustomerContextSuccess para lead com campos opcionais nulos."""
    with respx.mock:
        route = respx.get(_context_url(_LEAD_ID)).mock(
            return_value=httpx.Response(200, json=_CONTEXT_BODY_MINIMAL)
        )
        result = await get_customer_context.ainvoke({"lead_id": _LEAD_ID})

    assert route.called
    assert isinstance(result, GetCustomerContextSuccess)
    assert result.ok is True
    assert result.lead_id == _LEAD_ID
    assert result.customer_id is None
    assert result.name == "Maria Silva"
    assert result.city_name is None
    assert result.agent_name is None
    assert result.current_stage is None
    assert result.lead_status == "new"
    assert result.last_simulation is None
    assert result.last_analysis is None
    assert result.messages_last_30_days == 0

    # Verifica query param ?type=lead enviado
    assert route.calls.last.request.url.params.get("type") == "lead"


@pytest.mark.asyncio()
async def test_context_success_lead_full() -> None:
    """Tool deve retornar ficha completa (com simulação e campos opcionais) para lead."""
    with respx.mock:
        respx.get(_context_url(_LEAD_ID)).mock(
            return_value=httpx.Response(200, json=_CONTEXT_BODY_FULL)
        )
        result = await get_customer_context.ainvoke({"lead_id": _LEAD_ID})

    assert isinstance(result, GetCustomerContextSuccess)
    assert result.customer_id == _CUSTOMER_ID
    assert result.city_name == "Porto Velho"
    assert result.agent_name == "Ana Lima"
    assert result.current_stage == "qualificacao"
    assert result.lead_status == "qualifying"
    assert result.messages_last_30_days == 7

    sim = result.last_simulation
    assert sim is not None
    assert sim.simulation_id == "dddddddd-0000-0000-0000-000000000003"
    assert sim.amount_requested == "5000.00"
    assert sim.term_months == 12
    assert sim.monthly_payment == "450.00"
    assert sim.sent_at == "2026-01-15T10:05:00.000Z"


# ---------------------------------------------------------------------------
# Sucesso — ficha de customer (type=customer)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_context_success_customer() -> None:
    """Tool deve usar ?type=customer quando apenas customer_id fornecido."""
    body = {**_CONTEXT_BODY_FULL, "customer_id": _CUSTOMER_ID}
    with respx.mock:
        route = respx.get(_context_url(_CUSTOMER_ID)).mock(
            return_value=httpx.Response(200, json=body)
        )
        result = await get_customer_context.ainvoke({"customer_id": _CUSTOMER_ID})

    assert route.called
    assert isinstance(result, GetCustomerContextSuccess)
    assert result.customer_id == _CUSTOMER_ID

    # Verifica query param ?type=customer enviado
    assert route.calls.last.request.url.params.get("type") == "customer"


# ---------------------------------------------------------------------------
# lead_id tem precedência sobre customer_id quando ambos fornecidos
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_context_lead_id_takes_precedence() -> None:
    """Quando lead_id e customer_id fornecidos, deve usar lead_id com type=lead."""
    with respx.mock:
        route = respx.get(_context_url(_LEAD_ID)).mock(
            return_value=httpx.Response(200, json=_CONTEXT_BODY_MINIMAL)
        )
        result = await get_customer_context.ainvoke(
            {"lead_id": _LEAD_ID, "customer_id": _CUSTOMER_ID}
        )

    assert route.called
    assert isinstance(result, GetCustomerContextSuccess)
    assert route.calls.last.request.url.params.get("type") == "lead"


# ---------------------------------------------------------------------------
# Erro: INVALID_INPUT — nenhum identificador fornecido
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_context_error_invalid_input_no_ids() -> None:
    """Tool deve retornar INVALID_INPUT quando nem lead_id nem customer_id fornecidos."""
    result = await get_customer_context.ainvoke({})

    assert isinstance(result, GetCustomerContextError)
    assert result.ok is False
    assert result.error_code == "INVALID_INPUT"
    assert "lead_id" in result.message or "customer_id" in result.message


# ---------------------------------------------------------------------------
# Erro: 404 → CUSTOMER_NOT_FOUND
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_context_error_404_lead() -> None:
    """Tool deve retornar CUSTOMER_NOT_FOUND quando backend retorna 404 para lead."""
    with respx.mock:
        respx.get(_context_url(_LEAD_ID)).mock(
            return_value=httpx.Response(404, json={"message": "Lead não encontrado"})
        )
        result = await get_customer_context.ainvoke({"lead_id": _LEAD_ID})

    assert isinstance(result, GetCustomerContextError)
    assert result.error_code == "CUSTOMER_NOT_FOUND"
    assert _LEAD_ID in result.message


@pytest.mark.asyncio()
async def test_context_error_404_customer() -> None:
    """Tool deve retornar CUSTOMER_NOT_FOUND quando backend retorna 404 para customer."""
    with respx.mock:
        respx.get(_context_url(_CUSTOMER_ID)).mock(
            return_value=httpx.Response(404, json={"message": "Customer não encontrado"})
        )
        result = await get_customer_context.ainvoke({"customer_id": _CUSTOMER_ID})

    assert isinstance(result, GetCustomerContextError)
    assert result.error_code == "CUSTOMER_NOT_FOUND"
    assert _CUSTOMER_ID in result.message


# ---------------------------------------------------------------------------
# Erro: BACKEND_UNAVAILABLE — 5xx
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_context_error_5xx() -> None:
    """Tool deve retornar BACKEND_UNAVAILABLE quando backend retorna 5xx."""
    with respx.mock:
        respx.get(_context_url(_LEAD_ID)).mock(
            return_value=httpx.Response(503, json={"error": "service unavailable"})
        )
        result = await get_customer_context.ainvoke({"lead_id": _LEAD_ID})

    assert isinstance(result, GetCustomerContextError)
    assert result.error_code == "BACKEND_UNAVAILABLE"
    assert "503" in result.message


# ---------------------------------------------------------------------------
# Erro: BACKEND_UNAVAILABLE — timeout
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_context_error_timeout() -> None:
    """Tool deve retornar BACKEND_UNAVAILABLE quando backend ultrapassa timeout."""
    with respx.mock:
        respx.get(_context_url(_LEAD_ID)).mock(
            side_effect=httpx.ReadTimeout("timed out", request=None)  # type: ignore[arg-type]
        )
        result = await get_customer_context.ainvoke({"lead_id": _LEAD_ID})

    assert isinstance(result, GetCustomerContextError)
    assert result.error_code == "BACKEND_UNAVAILABLE"
    assert "Timeout" in result.message


# ---------------------------------------------------------------------------
# LGPD: ausência de PII sensível no output
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_context_output_has_no_sensitive_pii() -> None:
    """Output não deve conter CPF, phone, email, document_number, notes."""
    with respx.mock:
        respx.get(_context_url(_LEAD_ID)).mock(
            return_value=httpx.Response(200, json=_CONTEXT_BODY_FULL)
        )
        result = await get_customer_context.ainvoke({"lead_id": _LEAD_ID})

    assert isinstance(result, GetCustomerContextSuccess)

    # Serializar o modelo e garantir ausência de campos PII sensíveis
    data = result.model_dump()
    pii_fields = {"cpf", "phone", "email", "document_number", "document_hash", "notes", "rg"}
    assert pii_fields.isdisjoint(data.keys()), (
        f"Campos PII sensíveis encontrados no output: {pii_fields & data.keys()}"
    )


# ---------------------------------------------------------------------------
# Headers obrigatórios
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_context_sends_internal_token() -> None:
    """X-Internal-Token deve estar presente em toda chamada."""
    with respx.mock:
        route = respx.get(_context_url(_LEAD_ID)).mock(
            return_value=httpx.Response(200, json=_CONTEXT_BODY_MINIMAL)
        )
        await get_customer_context.ainvoke({"lead_id": _LEAD_ID})

    token = route.calls.last.request.headers.get("x-internal-token")
    assert token == settings.internal_token.get_secret_value()


# ===========================================================================
# Tests: update_lead_profile (F3-S22)
# ===========================================================================

_UPDATE_LEAD_ID = "eeeeeeee-0000-0000-0000-000000000004"


def _update_url(lead_id: str) -> str:
    raw = str(settings.backend_internal_url)
    base = raw if raw.endswith("/") else f"{raw}/"
    return f"{base}internal/leads/{lead_id}"


_UPDATE_SUCCESS_BODY: dict[str, object] = {
    "lead_id": _UPDATE_LEAD_ID,
    "current_stage": "qualificacao",
    "city_id": "city-0099",
    "name": "Carlos Andrade",
}


# ---------------------------------------------------------------------------
# Sucesso — atualização parcial (apenas city_id)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_update_success_partial_city_id() -> None:
    """Tool deve retornar UpdateLeadProfileSuccess ao atualizar apenas city_id."""
    with respx.mock:
        route = respx.patch(_update_url(_UPDATE_LEAD_ID)).mock(
            return_value=httpx.Response(200, json=_UPDATE_SUCCESS_BODY)
        )
        result = await update_lead_profile.ainvoke(
            {"lead_id": _UPDATE_LEAD_ID, "city_id": "city-0099"}
        )

    assert route.called
    assert isinstance(result, UpdateLeadProfileSuccess)
    assert result.ok is True
    assert result.lead_id == _UPDATE_LEAD_ID
    assert result.city_id == "city-0099"
    assert result.current_stage == "qualificacao"


# ---------------------------------------------------------------------------
# Sucesso — atualização com múltiplos campos
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_update_success_multiple_fields() -> None:
    """Tool deve enviar apenas os campos não-nulos no payload."""
    import json as _json

    body = {
        **_UPDATE_SUCCESS_BODY,
        "city_id": "city-0001",
        "current_stage": "pre_atendimento",
    }
    with respx.mock:
        route = respx.patch(_update_url(_UPDATE_LEAD_ID)).mock(
            return_value=httpx.Response(200, json=body)
        )
        result = await update_lead_profile.ainvoke(
            {
                "lead_id": _UPDATE_LEAD_ID,
                "city_id": "city-0001",
                "requested_amount": "8000.00",
                "requested_term_months": 24,
            }
        )

    assert isinstance(result, UpdateLeadProfileSuccess)
    assert result.city_id == "city-0001"

    # Verifica que o payload enviado contém os campos corretos
    sent = _json.loads(route.calls.last.request.content)
    assert sent.get("city_id") == "city-0001"
    # A tool coage requested_amount para number (contrato /internal: schemas.ts z.number());
    # ver fix 6366c346. O payload enviado é 8000.0, não a string original "8000.00".
    assert sent.get("requested_amount") == 8000.0
    assert sent.get("requested_term_months") == 24
    assert "name" not in sent  # não fornecido → não deve aparecer


# ---------------------------------------------------------------------------
# Erro: INVALID_INPUT — nenhum campo de atualização fornecido
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_update_error_no_fields_provided() -> None:
    """Tool deve retornar INVALID_INPUT quando apenas lead_id fornecido."""
    result = await update_lead_profile.ainvoke({"lead_id": _UPDATE_LEAD_ID})

    assert isinstance(result, UpdateLeadProfileError)
    assert result.ok is False
    assert result.error_code == "INVALID_INPUT"
    assert "ao menos um campo" in result.message.lower() or "name" in result.message


# ---------------------------------------------------------------------------
# Erro: 404 → LEAD_NOT_FOUND
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_update_error_404_lead_not_found() -> None:
    """Tool deve retornar LEAD_NOT_FOUND quando backend retorna 404."""
    with respx.mock:
        respx.patch(_update_url(_UPDATE_LEAD_ID)).mock(
            return_value=httpx.Response(404, json={"message": "Lead não encontrado"})
        )
        result = await update_lead_profile.ainvoke(
            {"lead_id": _UPDATE_LEAD_ID, "city_id": "city-0001"}
        )

    assert isinstance(result, UpdateLeadProfileError)
    assert result.error_code == "LEAD_NOT_FOUND"
    assert _UPDATE_LEAD_ID in result.message


# ---------------------------------------------------------------------------
# Erro: BACKEND_UNAVAILABLE — 5xx
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_update_error_5xx() -> None:
    """Tool deve retornar BACKEND_UNAVAILABLE quando backend retorna 5xx."""
    with respx.mock:
        respx.patch(_update_url(_UPDATE_LEAD_ID)).mock(
            return_value=httpx.Response(503, json={"error": "service unavailable"})
        )
        result = await update_lead_profile.ainvoke(
            {"lead_id": _UPDATE_LEAD_ID, "city_id": "city-0001"}
        )

    assert isinstance(result, UpdateLeadProfileError)
    assert result.error_code == "BACKEND_UNAVAILABLE"
    assert "503" in result.message


# ---------------------------------------------------------------------------
# Erro: BACKEND_UNAVAILABLE — timeout
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_update_error_timeout() -> None:
    """Tool deve retornar BACKEND_UNAVAILABLE quando backend ultrapassa timeout."""
    with respx.mock:
        respx.patch(_update_url(_UPDATE_LEAD_ID)).mock(
            side_effect=httpx.ReadTimeout("timed out", request=None)  # type: ignore[arg-type]
        )
        result = await update_lead_profile.ainvoke(
            {"lead_id": _UPDATE_LEAD_ID, "requested_amount": "3000.00"}
        )

    assert isinstance(result, UpdateLeadProfileError)
    assert result.error_code == "BACKEND_UNAVAILABLE"
    assert "Timeout" in result.message


# ---------------------------------------------------------------------------
# Headers obrigatórios: X-Internal-Token
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_update_sends_internal_token() -> None:
    """X-Internal-Token deve estar presente em toda chamada de atualização."""
    with respx.mock:
        route = respx.patch(_update_url(_UPDATE_LEAD_ID)).mock(
            return_value=httpx.Response(200, json=_UPDATE_SUCCESS_BODY)
        )
        await update_lead_profile.ainvoke(
            {"lead_id": _UPDATE_LEAD_ID, "city_id": "city-0001"}
        )

    token = route.calls.last.request.headers.get("x-internal-token")
    assert token == settings.internal_token.get_secret_value()


# ---------------------------------------------------------------------------
# Headers obrigatórios: Idempotency-Key baseado em lead_id
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_update_sends_idempotency_key_based_on_lead_id() -> None:
    """Idempotency-Key deve conter o lead_id para garantir idempotência do PATCH."""
    with respx.mock:
        route = respx.patch(_update_url(_UPDATE_LEAD_ID)).mock(
            return_value=httpx.Response(200, json=_UPDATE_SUCCESS_BODY)
        )
        await update_lead_profile.ainvoke(
            {"lead_id": _UPDATE_LEAD_ID, "city_id": "city-0001"}
        )

    key = route.calls.last.request.headers.get("idempotency-key")
    assert key is not None
    assert _UPDATE_LEAD_ID in key
