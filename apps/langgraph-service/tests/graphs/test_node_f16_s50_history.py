"""Testes F16-S50 — histórico conversacional do agente.

Cobre:
  BUG 1: _merge_messages (load_state) anexa a msg nova ao histórico persistido
         (antes descartava quando persisted > current → IA re-saudava).
  BUG 2: agent_turn persiste o reply COMPLETO no histórico (todas as mensagens),
         não só a primeira → a IA enxerga o que realmente disse.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.graphs.whatsapp_pre_attendance.nodes.load_state import _merge_messages


# ---------------------------------------------------------------------------
# BUG 1: _merge_messages
# ---------------------------------------------------------------------------


def _m(role: str, content: str) -> dict[str, Any]:
    return {"role": role, "content": content}


def test_merge_appends_new_message_to_longer_persisted() -> None:
    """Regressão do smoke: persisted maior que current NÃO pode descartar a nova."""
    persisted = [_m("user", "Oi"), _m("assistant", "Olá!"), _m("user", "quero crédito")]
    current = [_m("user", "Meu nome é João")]
    merged = _merge_messages(persisted=persisted, current=current)
    assert merged == persisted + current
    assert merged[-1]["content"] == "Meu nome é João"
    assert len(merged) == 4


def test_merge_empty_persisted() -> None:
    current = [_m("user", "Oi")]
    assert _merge_messages(persisted=[], current=current) == current


def test_merge_empty_current() -> None:
    persisted = [_m("user", "Oi"), _m("assistant", "Olá!")]
    assert _merge_messages(persisted=persisted, current=[]) == persisted


# ---------------------------------------------------------------------------
# BUG 2: agent_turn persiste reply completo no histórico
# ---------------------------------------------------------------------------

_LOAD_PROMPT_PATCH = "app.graphs.whatsapp_pre_attendance.nodes.agent_turn.load_active_prompt"
_GET_GATEWAY_PATCH = "app.graphs.whatsapp_pre_attendance.nodes.agent_turn.get_gateway"
_DISPATCH_TOOL_PATCH = "app.graphs.whatsapp_pre_attendance.nodes.agent_turn._dispatch_tool"


def _make_prompt() -> Any:
    from app.prompts.loader import ActivePrompt

    return ActivePrompt(
        key="pre_attendance_agent",
        body="Você é a Ana Clara.",
        version=1,
        content_hash="0" * 64,
        model_recommended=None,
        temperature=None,
        max_tokens=None,
        top_p=None,
        prompt_version="pre_attendance_agent@v1",
    )


def _make_gateway(json_content: str) -> MagicMock:
    from app.llm.gateway import LLMResponse, TokenUsage

    gw = MagicMock()
    gw.complete = AsyncMock(return_value=LLMResponse(
        content=json_content,
        model="anthropic/claude-sonnet-4",
        usage=TokenUsage(prompt_tokens=50, completion_tokens=40, total_tokens=90),
        finish_reason="stop",
        raw={"choices": [{"message": {"content": json_content, "tool_calls": None}, "finish_reason": "stop"}]},
    ))
    return gw


@pytest.mark.asyncio
async def test_agent_turn_persists_full_reply_in_history() -> None:
    """A msg do assistant no histórico deve ter TODAS as mensagens, não só a 1ª."""
    state: dict[str, Any] = {
        "conversation_id": "11111111-1111-1111-1111-111111111111",
        "organization_id": "22222222-2222-2222-2222-222222222222",
        "phone": "+5569999990030",
        "messages": [{"role": "user", "content": "Oi"}],
    }
    json_output = '{"messages": ["Olá! Tudo bem?", "Sou a Ana Clara.", "Qual seu nome completo?"]}'
    gw = _make_gateway(json_output)

    with patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=_make_prompt())):
        with patch(_GET_GATEWAY_PATCH, return_value=gw):
            with patch(_DISPATCH_TOOL_PATCH, new=AsyncMock(return_value='{"ok": true}')):
                result = await __import__(
                    "app.graphs.whatsapp_pre_attendance.nodes.agent_turn",
                    fromlist=["agent_turn"],
                ).agent_turn(state)  # type: ignore[arg-type]

    hist = result.get("messages", [])
    assistant_msgs = [m for m in hist if m.get("role") == "assistant"]
    assert assistant_msgs, "deve haver uma mensagem assistant no historico"
    last = assistant_msgs[-1]["content"]
    # Conteudo completo: as 3 mensagens, nao so "Olá! Tudo bem?"
    assert "Qual seu nome completo?" in last, (
        f"historico do assistant truncado na 1a msg: {last!r}"
    )
    assert "Sou a Ana Clara." in last
