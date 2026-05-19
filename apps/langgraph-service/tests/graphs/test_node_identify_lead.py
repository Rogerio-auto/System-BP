"""Testes unitários para os nós identify_or_create_lead e collect_missing_profile_data.

Cobre identify_or_create_lead:
- Lead novo (created=True): lead_id/customer_id/current_stage/city_id gravados no estado.
- Lead existente (created=False): mesmo comportamento; action correta.
- Falha da tool (ok=False): handoff_required=True, erro em errors, lead_id ausente.
- Exceção inesperada na tool: handoff_required=True, erro genérico em errors.
- actions_emitted acumula sobre lista prévia do estado.
- city_id da tool é propagado para o estado.

Cobre collect_missing_profile_data:
- customer_name ausente: missing_fields contém "customer_name" e reply definido.
- customer_name presente: missing_fields vazio, reply não alterado.
- missing_fields pré-existentes preservados (sem duplicata de "customer_name").
- Função pura — sem chamadas externas.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from app.graphs.whatsapp_pre_attendance.nodes.collect_missing_profile_data import (
    collect_missing_profile_data,
)
from app.graphs.whatsapp_pre_attendance.nodes.identify_or_create_lead import (
    identify_or_create_lead,
)
from app.graphs.whatsapp_pre_attendance.state import ConversationState
from app.tools.leads_tools import (
    GetOrCreateLeadError,
    GetOrCreateLeadSuccess,
    LeadErrorCode,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_PHONE = "+5569999999999"
_CONVERSATION_ID = "conv-test-001"
_CHATWOOT_ID = "cw-42"


def _base_state(**overrides: Any) -> ConversationState:
    """Estado mínimo válido para os nós deste slot."""
    base: ConversationState = {
        "conversation_id": _CONVERSATION_ID,
        "chatwoot_conversation_id": _CHATWOOT_ID,
        "phone": _PHONE,
        "handoff_required": False,
        "missing_fields": [],
        "messages": [],
        "tool_results": [],
        "errors": [],
        "actions_emitted": [],
        "lead_id": None,
        "customer_id": None,
        "current_stage": None,
        "city_id": None,
        "customer_name": None,
    }
    base.update(overrides)  # type: ignore[typeddict-item]
    return base


def _make_success(
    lead_id: str = "lead-abc",
    customer_id: str | None = "cust-xyz",
    created: bool = True,
    current_stage: str = "novo",
    city_id: str | None = "city-001",
) -> GetOrCreateLeadSuccess:
    return GetOrCreateLeadSuccess(
        lead_id=lead_id,
        customer_id=customer_id,
        created=created,
        current_stage=current_stage,
        city_id=city_id,
        assigned_agent_id=None,
    )


def _make_error(
    error_code: LeadErrorCode = LeadErrorCode.BACKEND_UNAVAILABLE,
    message: str = "Backend indisponível.",
) -> GetOrCreateLeadError:
    return GetOrCreateLeadError(error_code=error_code, message=message)


# ---------------------------------------------------------------------------
# Testes: identify_or_create_lead — lead novo
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_identify_new_lead_sets_state_fields() -> None:
    """Lead criado pela primeira vez: campos de lead gravados corretamente."""
    success = _make_success(created=True)
    state = _base_state()

    with patch(
        "app.graphs.whatsapp_pre_attendance.nodes.identify_or_create_lead"
        "._call_get_or_create_lead",
        new=AsyncMock(return_value=success),
    ):
        result = await identify_or_create_lead(state)

    assert result["lead_id"] == "lead-abc"
    assert result["customer_id"] == "cust-xyz"
    assert result["current_stage"] == "novo"
    assert result["city_id"] == "city-001"
    assert result.get("handoff_required") is False


@pytest.mark.asyncio
async def test_identify_new_lead_emits_action() -> None:
    """Lead criado: action 'lead_identified' registrada em actions_emitted."""
    success = _make_success(created=True)
    state = _base_state()

    with patch(
        "app.graphs.whatsapp_pre_attendance.nodes.identify_or_create_lead"
        "._call_get_or_create_lead",
        new=AsyncMock(return_value=success),
    ):
        result = await identify_or_create_lead(state)

    actions = result.get("actions_emitted", [])
    assert len(actions) == 1
    assert actions[0]["action"] == "lead_identified"
    assert actions[0]["lead_id"] == "lead-abc"
    assert actions[0]["created"] is True
    assert actions[0]["current_stage"] == "novo"


# ---------------------------------------------------------------------------
# Testes: identify_or_create_lead — lead existente
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_identify_existing_lead() -> None:
    """Lead já existente (created=False): comportamento idêntico ao novo."""
    success = _make_success(created=False, lead_id="lead-existing")
    state = _base_state()

    with patch(
        "app.graphs.whatsapp_pre_attendance.nodes.identify_or_create_lead"
        "._call_get_or_create_lead",
        new=AsyncMock(return_value=success),
    ):
        result = await identify_or_create_lead(state)

    assert result["lead_id"] == "lead-existing"
    actions = result.get("actions_emitted", [])
    assert actions[0]["created"] is False


@pytest.mark.asyncio
async def test_identify_existing_lead_without_city() -> None:
    """Lead existente sem cidade: city_id fica None no estado."""
    success = _make_success(city_id=None, created=False)
    state = _base_state()

    with patch(
        "app.graphs.whatsapp_pre_attendance.nodes.identify_or_create_lead"
        "._call_get_or_create_lead",
        new=AsyncMock(return_value=success),
    ):
        result = await identify_or_create_lead(state)

    assert result["city_id"] is None
    assert result["lead_id"] == "lead-abc"


# ---------------------------------------------------------------------------
# Testes: identify_or_create_lead — acumulação de actions_emitted
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_identify_lead_accumulates_actions() -> None:
    """actions_emitted pré-existentes são preservados; nova ação é adicionada."""
    success = _make_success()
    pre_action = {"action": "message_received", "ts": "2026-01-01"}
    state = _base_state(actions_emitted=[pre_action])

    with patch(
        "app.graphs.whatsapp_pre_attendance.nodes.identify_or_create_lead"
        "._call_get_or_create_lead",
        new=AsyncMock(return_value=success),
    ):
        result = await identify_or_create_lead(state)

    actions = result.get("actions_emitted", [])
    assert len(actions) == 2
    assert actions[0]["action"] == "message_received"
    assert actions[1]["action"] == "lead_identified"


# ---------------------------------------------------------------------------
# Testes: identify_or_create_lead — falha da tool (ok=False)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_identify_lead_tool_error_triggers_handoff() -> None:
    """Falha da tool (ok=False): handoff_required=True e erro em errors."""
    error = _make_error(
        error_code=LeadErrorCode.INVALID_PHONE,
        message="Telefone inválido.",
    )
    state = _base_state()

    with patch(
        "app.graphs.whatsapp_pre_attendance.nodes.identify_or_create_lead"
        "._call_get_or_create_lead",
        new=AsyncMock(return_value=error),
    ):
        result = await identify_or_create_lead(state)

    assert result.get("handoff_required") is True
    assert result.get("lead_id") is None
    errors = result.get("errors", [])
    assert len(errors) == 1
    assert errors[0]["node"] == "identify_or_create_lead"
    assert errors[0]["error_code"] == "INVALID_PHONE"


@pytest.mark.asyncio
async def test_identify_lead_backend_unavailable_triggers_handoff() -> None:
    """Erro BACKEND_UNAVAILABLE: handoff ativado, lead_id não definido."""
    error = _make_error(error_code=LeadErrorCode.BACKEND_UNAVAILABLE)
    state = _base_state()

    with patch(
        "app.graphs.whatsapp_pre_attendance.nodes.identify_or_create_lead"
        "._call_get_or_create_lead",
        new=AsyncMock(return_value=error),
    ):
        result = await identify_or_create_lead(state)

    assert result.get("handoff_required") is True
    assert "lead_id" not in result or result.get("lead_id") is None


@pytest.mark.asyncio
async def test_identify_lead_error_preserves_existing_errors() -> None:
    """Erros pré-existentes são preservados quando a tool falha."""
    error = _make_error()
    pre_error = {"node": "other_node", "error_code": "SOME_ERROR", "message": "prev"}
    state = _base_state(errors=[pre_error])

    with patch(
        "app.graphs.whatsapp_pre_attendance.nodes.identify_or_create_lead"
        "._call_get_or_create_lead",
        new=AsyncMock(return_value=error),
    ):
        result = await identify_or_create_lead(state)

    errors = result.get("errors", [])
    assert len(errors) == 2
    assert errors[0]["node"] == "other_node"
    assert errors[1]["node"] == "identify_or_create_lead"


# ---------------------------------------------------------------------------
# Testes: identify_or_create_lead — exceção inesperada
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_identify_lead_unexpected_exception_triggers_handoff() -> None:
    """Exceção inesperada na tool: handoff e erro genérico registrados."""
    state = _base_state()

    with patch(
        "app.graphs.whatsapp_pre_attendance.nodes.identify_or_create_lead"
        "._call_get_or_create_lead",
        new=AsyncMock(side_effect=RuntimeError("kaboom")),
    ):
        result = await identify_or_create_lead(state)

    assert result.get("handoff_required") is True
    errors = result.get("errors", [])
    assert len(errors) == 1
    assert errors[0]["error_code"] == "UNEXPECTED_ERROR"
    assert "kaboom" in errors[0]["message"]


# ---------------------------------------------------------------------------
# Testes: collect_missing_profile_data — nome ausente
# ---------------------------------------------------------------------------


def test_collect_missing_name_marks_field_and_sets_reply() -> None:
    """customer_name ausente: 'customer_name' em missing_fields e reply definido."""
    state = _base_state(customer_name=None)
    result = collect_missing_profile_data(state)

    assert "customer_name" in result.get("missing_fields", [])
    assert result.get("reply") is not None
    assert len(result.get("reply", "")) > 0


def test_collect_missing_name_reply_asks_for_name() -> None:
    """O reply deve solicitar o nome ao usuário (mensagem em português)."""
    state = _base_state(customer_name=None)
    result = collect_missing_profile_data(state)
    reply = result.get("reply", "")
    # Verifica que contém alguma solicitação de nome (checa termo central)
    assert "nome" in reply.lower() or "name" in reply.lower()


# ---------------------------------------------------------------------------
# Testes: collect_missing_profile_data — nome presente
# ---------------------------------------------------------------------------


def test_collect_no_missing_fields_when_name_present() -> None:
    """customer_name presente: missing_fields permanece vazio, reply não alterado."""
    state = _base_state(customer_name="João Silva")
    result = collect_missing_profile_data(state)

    assert result.get("missing_fields", []) == []
    # reply não deve ser definido pelo nó neste caminho
    assert "reply" not in result or result.get("reply") is None


# ---------------------------------------------------------------------------
# Testes: collect_missing_profile_data — preservação de estado
# ---------------------------------------------------------------------------


def test_collect_preserves_preexisting_missing_fields() -> None:
    """missing_fields já populados por nó anterior são preservados."""
    state = _base_state(customer_name=None, missing_fields=["city_name"])
    result = collect_missing_profile_data(state)

    missing = result.get("missing_fields", [])
    assert "city_name" in missing
    assert "customer_name" in missing


def test_collect_no_duplicate_customer_name_in_missing_fields() -> None:
    """'customer_name' não é duplicado se já estava em missing_fields."""
    state = _base_state(customer_name=None, missing_fields=["customer_name"])
    result = collect_missing_profile_data(state)

    missing = result.get("missing_fields", [])
    assert missing.count("customer_name") == 1


def test_collect_is_pure_function_no_mutation() -> None:
    """O nó não muta o estado original — retorna novo dict."""
    state = _base_state(customer_name=None)
    original_missing = list(state.get("missing_fields", []))
    collect_missing_profile_data(state)
    # Estado original não deve ter sido alterado
    assert list(state.get("missing_fields", [])) == original_missing
