from __future__ import annotations

import json

import httpx
import pytest
import respx

from app.config import settings
from app.tools._base import InternalApiClient
from app.tools.audit_tools import LogAiDecisionInput, log_ai_decision
from app.tools.chatwoot_tools import HandoffInput, request_handoff
from app.tools.city_tools import identify_city

_ORG_ID = "576a8121-838a-4904-b6bb-574648d9c32b"
_LEAD_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
_CONV_UUID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
_CW_CONV_ID = "42"
_CORR_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc"


def _url(path: str) -> str:
    raw = str(settings.backend_internal_url)
    base = raw if raw.endswith("/") else f"{raw}/"
    return f"{base}{path.lstrip(chr(47))}"


@pytest.mark.asyncio()
async def test_identify_city_payload_has_organization_id() -> None:
    """organization_id deve aparecer no payload (campo obrigatorio)."""
    url = _url("/internal/cities/identify")
    resp = {
        "city_id": "uuid-pv", "city_name": "Porto Velho",
        "matched": True, "confidence": 0.97,
        "out_of_service": False, "alternatives": [],
    }
    with respx.mock:
        route = respx.post(url).mock(return_value=httpx.Response(200, json=resp))
        await identify_city("porto velho", organization_id=_ORG_ID, lead_id=_LEAD_ID)
    sent = json.loads(route.calls.last.request.content)
    assert sent["organization_id"] == _ORG_ID
    assert sent["city_text"] == "porto velho"
    assert sent["lead_id"] == _LEAD_ID


@pytest.mark.asyncio()
async def test_identify_city_omits_lead_id_when_none() -> None:
    """lead_id None nao deve aparecer no payload."""
    url = _url("/internal/cities/identify")
    resp = {
        "city_id": None, "city_name": None, "matched": False,
        "confidence": 0.3, "out_of_service": False, "alternatives": [],
    }
    with respx.mock:
        route = respx.post(url).mock(return_value=httpx.Response(200, json=resp))
        await identify_city("jaru", organization_id=_ORG_ID)
    sent = json.loads(route.calls.last.request.content)
    assert "organization_id" in sent
    assert "lead_id" not in sent


@pytest.mark.asyncio()
async def test_request_handoff_payload_camelcase() -> None:
    """Payload de /handoffs deve estar em camelCase com conversationId int."""
    url = _url("/internal/handoffs")
    resp = {
        "handoff_id": "hnd-0001",
        "chatwoot_conversation_id": _CW_CONV_ID,
        "assigned_agent_id": None,
        "status": "requested",
    }
    inp = HandoffInput(
        lead_id=_LEAD_ID,
        chatwoot_conversation_id=_CW_CONV_ID,
        organization_id=_ORG_ID,
        reason="cliente_solicitou_atendente",
        summary="Resumo do cliente.",
    )
    with respx.mock:
        route = respx.post(url).mock(return_value=httpx.Response(201, json=resp))
        await request_handoff(inp, client=InternalApiClient())
    sent = json.loads(route.calls.last.request.content)
    assert sent["leadId"] == _LEAD_ID
    assert sent["conversationId"] == int(_CW_CONV_ID)
    assert sent["organizationId"] == _ORG_ID
    assert sent["reason"] == "cliente_solicitou_atendente"
    assert "lead_id" not in sent
    assert "organization_id" not in sent


@pytest.mark.asyncio()
async def test_request_handoff_simulation_id_camelcase() -> None:
    """simulationId deve aparecer em camelCase quando fornecido."""
    url = _url("/internal/handoffs")
    sim_id = "dddddddd-dddd-dddd-dddd-dddddddddddd"
    resp = {
        "handoff_id": "hnd-0002",
        "chatwoot_conversation_id": _CW_CONV_ID,
        "assigned_agent_id": None,
        "status": "requested",
    }
    inp = HandoffInput(
        lead_id=_LEAD_ID,
        chatwoot_conversation_id=_CW_CONV_ID,
        organization_id=_ORG_ID,
        reason="cobranca",
        summary="Cobranca pendente.",
        simulation_id=sim_id,
    )
    with respx.mock:
        route = respx.post(url).mock(return_value=httpx.Response(201, json=resp))
        await request_handoff(inp, client=InternalApiClient())
    sent = json.loads(route.calls.last.request.content)
    assert sent["simulationId"] == sim_id
    assert "simulation_id" not in sent


@pytest.mark.asyncio()
async def test_persist_state_payload_has_phone_and_org() -> None:
    """PUT /state deve conter phone (obrigatorio) e organization_id."""
    from app.graphs.whatsapp_pre_attendance.nodes.persist_state import persist_state

    state = {
        "conversation_id": _CONV_UUID,
        "chatwoot_conversation_id": _CW_CONV_ID,
        "organization_id": _ORG_ID,
        "phone": "5569988880001",
        "lead_id": _LEAD_ID,
        "customer_id": None,
        "customer_name": "Ana Teste",
        "city_id": None,
        "city_name": None,
        "current_intent": None,
        "requested_amount": None,
        "requested_term_months": None,
        "selected_product_id": None,
        "last_simulation_id": None,
        "current_stage": "greeting",
        "handoff_required": False,
        "handoff_reason": None,
        "missing_fields": [],
        "messages": [],
        "tool_results": [],
        "errors": [],
        "actions_emitted": [],
    }
    url = _url(f"/internal/conversations/{_CONV_UUID}/state")
    backend_resp = {
        "id": "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
        "organization_id": _ORG_ID,
        "conversation_id": _CONV_UUID,
        "chatwoot_conversation_id": _CW_CONV_ID,
        "lead_id": _LEAD_ID,
        "customer_id": None,
        "current_node": None,
        "graph_version": None,
        "state": {},
        "last_message_at": None,
        "created_at": "2026-01-01T00:00:00+00:00",
        "updated_at": "2026-01-01T00:00:00+00:00",
        "created": True,
    }
    with respx.mock:
        route = respx.put(url).mock(return_value=httpx.Response(200, json=backend_resp))
        result = await persist_state(state)
    sent = json.loads(route.calls.last.request.content)
    assert "phone" in sent, "phone ausente do payload PUT /state"
    assert sent["phone"] == "5569988880001"
    assert sent["organization_id"] == _ORG_ID
    assert result.get("handoff_required") is not True


@pytest.mark.asyncio()
async def test_log_ai_decision_camelcase_required_fields() -> None:
    """Campos obrigatorios de /ai/decisions devem estar em camelCase."""
    url = _url("/internal/ai/decisions")
    decision_id = "ffffffff-ffff-ffff-ffff-ffffffffffff"
    inp = LogAiDecisionInput(
        organization_id=_ORG_ID,
        conversation_id=_CONV_UUID,
        node_name="classify_intent",
        correlation_id=_CORR_ID,
        decision={"intent": "quer_credito"},
    )
    with respx.mock:
        route = respx.post(url).mock(
            return_value=httpx.Response(200, json={"decision_log_id": decision_id})
        )
        result = await log_ai_decision(inp)
    sent = json.loads(route.calls.last.request.content)
    assert sent["organizationId"] == _ORG_ID
    assert sent["conversationId"] == _CONV_UUID
    assert sent["nodeName"] == "classify_intent"
    assert sent["correlationId"] == _CORR_ID
    assert "organization_id" not in sent
    assert result.decision_log_id == decision_id
