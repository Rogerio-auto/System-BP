from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from app.graphs.whatsapp_pre_attendance.nodes.identify_or_create_lead import identify_or_create_lead
from app.graphs.whatsapp_pre_attendance.nodes.receive_message import receive_message
from app.graphs.whatsapp_pre_attendance.state import (
    _KNOWN_KEYS,
    ConversationState,
    deserialize_state,
    serialize_state,
)
from app.tools.leads_tools import GetOrCreateLeadSuccess

_PHONE = "+5569999999999"
_CONV = "conv-s42-001"
_ORG = "org-test-uuid"
_PATCH = "app.graphs.whatsapp_pre_attendance.nodes.identify_or_create_lead._call_get_or_create_lead"


def _st(**ov: Any) -> ConversationState:
    b: ConversationState = {
        "conversation_id": _CONV,
        "chatwoot_conversation_id": "cw-99",
        "phone": _PHONE,
        "organization_id": _ORG,
        "handoff_required": False,
        "handoff_active": False,
        "missing_fields": [],
        "messages": [],
        "tool_results": [],
        "errors": [],
        "actions_emitted": [],
        "lead_id": None,
        "customer_id": None,
        "current_stage": None,
        "city_id": None,
        "city_name": None,
        "customer_name": None,
        "activity": None,
        "profile": None,
        "credit_objective": None,
        "scr_authorized": None,
        "collection_status": None,
        "cpf_collected": False,
    }
    b.update(ov)  # type: ignore[typeddict-item]
    return b


def _pl(**ov: Any) -> dict[str, Any]:
    p: dict[str, Any] = {
        "conversation_id": _CONV,
        "customer_phone": _PHONE,
        "organization_id": _ORG,
        "chatwoot_conversation_id": "cw-99",
        "message_text": "Ola quero credito",
        "message_timestamp": "2026-06-18T00:00:00Z",
    }
    p.update(ov)
    return p


def _ls(**kw: Any) -> GetOrCreateLeadSuccess:
    return GetOrCreateLeadSuccess(
        lead_id=kw.get("lead_id", "lead-s42"),
        customer_id=kw.get("customer_id"),
        created=kw.get("created", True),
        current_stage=kw.get("current_stage", "novo"),
        city_id=kw.get("city_id"),
        assigned_agent_id=None,
    )


# --- ConversationState: novos campos F16-S42 ---

def test_state_has_all_new_fields() -> None:
    expected = {"activity", "profile", "credit_objective", "scr_authorized",
                "collection_status", "handoff_active", "cpf_collected"}
    assert expected.issubset(_KNOWN_KEYS)


def test_cpf_never_raw_in_state() -> None:
    assert "cpf" not in _KNOWN_KEYS
    assert "cpf_number" not in _KNOWN_KEYS
    assert "cpf_collected" in _KNOWN_KEYS


# --- receive_message: extracao dos campos ---

def test_recv_activity() -> None:
    r = receive_message(_st(), payload=_pl(metadata={"activity": "produtor rural"}))
    assert r.get("activity") == "produtor rural"


def test_recv_profile_valid() -> None:
    r = receive_message(_st(), payload=_pl(metadata={"profile": "MICROEMPREENDEDOR"}))
    assert r.get("profile") == "MICROEMPREENDEDOR"


def test_recv_profile_assalariado() -> None:
    r = receive_message(_st(), payload=_pl(metadata={"profile": "ASSALARIADO"}))
    assert r.get("profile") == "ASSALARIADO"


def test_recv_profile_invalid_rejected() -> None:
    r = receive_message(_st(), payload=_pl(metadata={"profile": "HACKER"}))
    assert r.get("profile") is None


def test_recv_credit_objective() -> None:
    r = receive_message(_st(), payload=_pl(metadata={"credit_objective": "giro"}))
    assert r.get("credit_objective") == "giro"


def test_recv_scr_authorized_true() -> None:
    r = receive_message(_st(), payload=_pl(metadata={"scr_authorized": True}))
    assert r.get("scr_authorized") is True


def test_recv_scr_authorized_false_not_none() -> None:
    r = receive_message(_st(), payload=_pl(metadata={"scr_authorized": False}))
    assert r.get("scr_authorized") is False


def test_recv_collection_status_overdue() -> None:
    r = receive_message(_st(), payload=_pl(metadata={"collection_status": "overdue"}))
    assert r.get("collection_status") == "overdue"


def test_recv_collection_status_invalid() -> None:
    r = receive_message(_st(), payload=_pl(metadata={"collection_status": "bogus"}))
    assert r.get("collection_status") is None


def test_recv_cpf_collected_flag() -> None:
    r = receive_message(_st(), payload=_pl(metadata={"cpf_collected": True}))
    assert r.get("cpf_collected") is True


def test_recv_preserves_prior_activity() -> None:
    r = receive_message(_st(activity="MEI"), payload=_pl())
    assert r.get("activity") == "MEI"


def test_recv_preserves_prior_profile() -> None:
    r = receive_message(_st(profile="ASSALARIADO"), payload=_pl())
    assert r.get("profile") == "ASSALARIADO"


def test_recv_handoff_active_defaults_false() -> None:
    r = receive_message(_st(), payload=_pl())
    assert r.get("handoff_active") is False


def test_recv_cpf_collected_defaults_false() -> None:
    r = receive_message(_st(), payload=_pl())
    assert r.get("cpf_collected") is False


# --- Serialize/deserialize roundtrip ---

def test_known_keys_has_all_new_fields() -> None:
    for f in ("activity", "profile", "credit_objective", "scr_authorized",
              "collection_status", "handoff_active", "cpf_collected"):
        assert f in _KNOWN_KEYS, f"{f!r} ausente de _KNOWN_KEYS"


def test_roundtrip_preserves_new_fields() -> None:
    s = _st(activity="comerciante", profile="MICROEMPREENDEDOR",
             credit_objective="giro", scr_authorized=True,
             collection_status="none", handoff_active=False, cpf_collected=True)
    r = deserialize_state(serialize_state(s))
    assert r.get("activity") == "comerciante"
    assert r.get("profile") == "MICROEMPREENDEDOR"
    assert r.get("credit_objective") == "giro"
    assert r.get("scr_authorized") is True
    assert r.get("collection_status") == "none"
    assert r.get("cpf_collected") is True


# --- identify_or_create_lead: customer_name e campos preservados ---

@pytest.mark.asyncio
async def test_identify_lead_preserves_customer_name() -> None:
    s = _st(customer_name="Joao da Silva")
    with patch(_PATCH, new=AsyncMock(return_value=_ls())):
        r = await identify_or_create_lead(s)
    assert r.get("customer_name") == "Joao da Silva"


@pytest.mark.asyncio
async def test_identify_lead_customer_name_none_when_not_collected() -> None:
    s = _st(customer_name=None)
    with patch(_PATCH, new=AsyncMock(return_value=_ls())):
        r = await identify_or_create_lead(s)
    assert r.get("customer_name") is None


@pytest.mark.asyncio
async def test_identify_lead_preserves_activity_profile() -> None:
    s = _st(activity="produtor rural", profile="MICROEMPREENDEDOR")
    with patch(_PATCH, new=AsyncMock(return_value=_ls())):
        r = await identify_or_create_lead(s)
    assert r.get("activity") == "produtor rural"
    assert r.get("profile") == "MICROEMPREENDEDOR"


@pytest.mark.asyncio
async def test_identify_lead_preserves_cpf_collected_no_raw_cpf() -> None:
    s = _st(cpf_collected=True)
    with patch(_PATCH, new=AsyncMock(return_value=_ls())):
        r = await identify_or_create_lead(s)
    assert r.get("cpf_collected") is True
    assert "cpf" not in r
    assert "cpf_number" not in r
