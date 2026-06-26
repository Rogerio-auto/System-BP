"""Regressao do bug de producao 2026-06-26: agente nao responde / trava.

Causa raiz (logs prod): modelos (ex.: Claude Sonnet 4) costumam escrever a
mensagem ao cliente JUNTO com um tool_call e depois encerrar o turno final com
content VAZIO (finish_reason=stop, completion_tokens~=2). O loop so extraia a
resposta do turno final (nao-tool) -> texto perdido -> reply.type=none ->
cliente sem resposta -> "pergunta a mesma coisa e trava".

Fix: guardar o ultimo content nao-vazio de QUALQUER turno e recupera-lo se o
turno final vier vazio; se ainda assim vazio, handoff de seguranca (nunca silencio).

LGPD: fixtures sem PII real -- apenas IDs opacos e strings de teste.
"""
from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.graphs.whatsapp_pre_attendance.nodes.agent_turn import agent_turn
from app.graphs.whatsapp_pre_attendance.state import ConversationState
from app.prompts.loader import ActivePrompt

_LOAD_PROMPT_PATCH = "app.graphs.whatsapp_pre_attendance.nodes.agent_turn.load_active_prompt"
_GET_GATEWAY_PATCH = "app.graphs.whatsapp_pre_attendance.nodes.agent_turn.get_gateway"
_DISPATCH_TOOL_PATCH = "app.graphs.whatsapp_pre_attendance.nodes.agent_turn._dispatch_tool"

_ORG = str(uuid.uuid4())


def _make_state(**overrides: Any) -> ConversationState:
    base: ConversationState = {
        "conversation_id": str(uuid.uuid4()),
        "chatwoot_conversation_id": "cw-empty-turn",
        "phone": "+5569999990046",
        "organization_id": _ORG,
        "lead_id": str(uuid.uuid4()),
        "handoff_required": False,
        "handoff_active": False,
        "handoff_reason": None,
        "missing_fields": [],
        "messages": [{"role": "user", "content": "quero credito"}],
        "tool_results": [],
        "errors": [],
        "actions_emitted": [],
        "collection_status": "none",
        "current_intent": None,
        "customer_name": None,
        "city_id": None,
        "city_name": None,
        "activity": None,
        "profile": None,
        "credit_objective": None,
        "scr_authorized": None,
        "cpf_collected": False,
    }
    base.update(overrides)  # type: ignore[typeddict-item]
    return base


def _make_prompt() -> ActivePrompt:
    return ActivePrompt(
        key="pre_attendance_agent",
        version=1,
        body='Voce e Ana Clara. Responda em JSON: {"messages":["..."]}',
        content_hash="abc123",
        model_recommended=None,
        temperature=None,
        max_tokens=None,
        top_p=None,
        prompt_version="pre_attendance_agent@v1",
    )


def _resp(content: str, finish_reason: str, tool_calls: list[dict[str, Any]] | None = None) -> Any:
    from app.llm.gateway import LLMResponse, TokenUsage

    return LLMResponse(
        content=content,
        model="anthropic/claude-sonnet-4",
        usage=TokenUsage(prompt_tokens=10, completion_tokens=10, total_tokens=20),
        finish_reason=finish_reason,
        raw={
            "choices": [
                {
                    "message": {"content": content, "tool_calls": tool_calls},
                    "finish_reason": finish_reason,
                }
            ]
        },
    )


_TOOL_CALL = {
    "id": "call_1",
    "type": "function",
    "function": {"name": "get_or_create_lead", "arguments": "{}"},
}


@pytest.mark.asyncio
async def test_recovers_message_written_alongside_toolcall_when_final_empty() -> None:
    """O modelo escreve a msg ao cliente no turno do tool_call e encerra vazio.

    O agent_turn deve recuperar o content do turno do tool_call -> reply nao-vazio,
    SEM handoff (a resposta existe)."""
    state = _make_state()
    gw = MagicMock()
    gw.complete = AsyncMock(
        side_effect=[
            # turno 1: tool_call COM a mensagem ao cliente no content
            _resp(
                '{"messages": ["Ola! Sou a Ana Clara. Em qual cidade voce mora?"]}',
                "tool_calls",
                [_TOOL_CALL],
            ),
            # turno final: vazio (o bug)
            _resp("", "stop", None),
        ]
    )

    with patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=_make_prompt())):
        with patch(_GET_GATEWAY_PATCH, return_value=gw):
            with patch(_DISPATCH_TOOL_PATCH, new=AsyncMock(return_value='{"ok": true}')):
                result = await agent_turn(state)

    reply = result.get("reply", {})
    assert reply.get("type") == "text", (
        f"reply.type deveria ser 'text' (recuperado), foi '{reply.get('type')}'"
    )
    assert "Ana Clara" in reply.get("content", ""), "conteudo do turno do tool_call nao foi recuperado"
    assert result.get("handoff_required") is not True, "nao deve handoff: a resposta foi recuperada"


@pytest.mark.asyncio
async def test_handoff_safety_net_when_truly_empty() -> None:
    """Se NENHUM turno produziu texto, faz handoff de seguranca (nunca silencio)."""
    state = _make_state()
    gw = MagicMock()
    gw.complete = AsyncMock(
        side_effect=[
            _resp("", "tool_calls", [_TOOL_CALL]),  # tool call sem texto
            _resp("", "stop", None),  # final vazio
        ]
    )

    with patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=_make_prompt())):
        with patch(_GET_GATEWAY_PATCH, return_value=gw):
            with patch(_DISPATCH_TOOL_PATCH, new=AsyncMock(return_value='{"ok": true}')):
                result = await agent_turn(state)

    reply = result.get("reply", {})
    assert reply.get("type") == "none", "sem texto em lugar nenhum -> reply none"
    assert result.get("handoff_required") is True, "resposta vazia deve disparar handoff de seguranca"
