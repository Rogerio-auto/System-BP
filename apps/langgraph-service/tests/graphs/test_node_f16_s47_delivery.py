"""Testes F16-S47 — entrega do reply agêntico (bugs do 2º smoke real).

Cobre:
  BUG-2: process._extract_messages extrai messages[] do send_response.
  BUG-4: persist_state normaliza phone (remove '+') antes do PUT /state.

BUG-1 (reply channel) é travado por tests/graphs/test_state.py (reply ∈ _KNOWN_KEYS,
derivado das annotations do ConversationState — o que define o channel no LangGraph).
BUG-3 (leadId) é coberto indiretamente: o agent_turn passa lead_id (None quando ausente),
e audit_tools omite leadId quando None.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from app.api.process import _extract_messages
from app.graphs.whatsapp_pre_attendance.nodes.persist_state import persist_state


# ---------------------------------------------------------------------------
# BUG-2: _extract_messages (process.py)
# ---------------------------------------------------------------------------


def test_extract_messages_from_send_response() -> None:
    state: dict[str, Any] = {
        "tool_results": [
            {"node": "agent_turn", "tool_calls": 0},
            {
                "node": "send_response",
                "reply": {"type": "text", "content": "Olá!"},
                "messages": ["Olá!", "Sou a Ana Clara.", "Como posso ajudar?"],
            },
        ]
    }
    assert _extract_messages(state) == ["Olá!", "Sou a Ana Clara.", "Como posso ajudar?"]


def test_extract_messages_empty_when_no_send_response() -> None:
    state: dict[str, Any] = {"tool_results": [{"node": "agent_turn"}]}
    assert _extract_messages(state) == []


def test_extract_messages_filters_non_string_and_empty() -> None:
    state: dict[str, Any] = {
        "tool_results": [
            {"node": "send_response", "reply": {}, "messages": ["ok", "", 123, "ok2"]},
        ]
    }
    assert _extract_messages(state) == ["ok", "ok2"]


def test_extract_messages_uses_last_send_response_entry() -> None:
    state: dict[str, Any] = {
        "tool_results": [
            {"node": "send_response", "messages": ["antigo"]},
            {"node": "send_response", "messages": ["novo"]},
        ]
    }
    assert _extract_messages(state) == ["novo"]


# ---------------------------------------------------------------------------
# BUG-4: persist_state normaliza phone (remove '+')
# ---------------------------------------------------------------------------

_CLIENT_PATCH = "app.graphs.whatsapp_pre_attendance.nodes.persist_state.InternalApiClient"


@pytest.mark.asyncio
async def test_persist_state_strips_plus_from_phone() -> None:
    captured: dict[str, Any] = {}

    async def _fake_request(method: str, path: str, json: dict[str, Any]) -> dict[str, Any]:
        captured["json"] = json
        return {"created": True}

    state: dict[str, Any] = {
        "conversation_id": "11111111-1111-1111-1111-111111111111",
        "organization_id": "22222222-2222-2222-2222-222222222222",
        "phone": "+5569999990030",
    }
    with patch(_CLIENT_PATCH) as mock_cls:
        mock_cls.return_value._request = AsyncMock(side_effect=_fake_request)
        await persist_state(state)  # type: ignore[arg-type]

    assert captured["json"]["phone"] == "5569999990030"  # sem '+'


@pytest.mark.asyncio
async def test_persist_state_phone_without_plus_unchanged() -> None:
    captured: dict[str, Any] = {}

    async def _fake_request(method: str, path: str, json: dict[str, Any]) -> dict[str, Any]:
        captured["json"] = json
        return {"created": True}

    state: dict[str, Any] = {
        "conversation_id": "11111111-1111-1111-1111-111111111111",
        "organization_id": "22222222-2222-2222-2222-222222222222",
        "phone": "5569999990030",
    }
    with patch(_CLIENT_PATCH) as mock_cls:
        mock_cls.return_value._request = AsyncMock(side_effect=_fake_request)
        await persist_state(state)  # type: ignore[arg-type]

    assert captured["json"]["phone"] == "5569999990030"
