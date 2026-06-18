from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.graphs.whatsapp_pre_attendance.nodes.agent_turn import (
    MAX_TOOL_CALLS_PER_TURN,
    agent_turn,
)
from app.graphs.whatsapp_pre_attendance.routes import route_conversation
from app.graphs.whatsapp_pre_attendance.state import ConversationState
from app.prompts.loader import ActivePrompt

_CONV = "conv-f16s40-001"
_ORG = "org-uuid-test"
_LEAD = "lead-uuid-test"
_PROMPT_KEY = "pre_attendance_agent"


def _make_state(**extra: Any) -> ConversationState:
    base: ConversationState = {
        "conversation_id": _CONV,
        "chatwoot_conversation_id": "cw-99",
        "phone": "+5569999999999",
        "organization_id": _ORG,
        "lead_id": _LEAD,
        "handoff_required": False,
        "handoff_active": False,
        "missing_fields": [],
        "messages": [{"role": "user", "content": "Ola, quero um credito"}],
        "tool_results": [],
        "errors": [],
        "actions_emitted": [],
        "collection_status": "none",
    }
    base.update(extra)  # type: ignore[typeddict-item]
    return base


def _make_prompt() -> ActivePrompt:
    return ActivePrompt(
        key=_PROMPT_KEY,
        version=1,
        body="Voce e Ana Clara, assistente virtual do Banco do Povo.",
        content_hash="abc123",
        model_recommended=None,
        temperature=None,
        max_tokens=None,
        top_p=None,
        prompt_version=_PROMPT_KEY + "@v1",
    )


def _make_gateway(content: str, finish_reason: str = "stop") -> MagicMock:
    from app.llm.gateway import LLMResponse, TokenUsage
    gw = MagicMock()
    gw.complete = AsyncMock(return_value=LLMResponse(
        content=content,
        model="moonshot/kimi-k2",
        usage=TokenUsage(prompt_tokens=100, completion_tokens=50, total_tokens=150),
        finish_reason=finish_reason,
        raw={"choices": [{"message": {"content": content, "tool_calls": None}, "finish_reason": finish_reason}]},
    ))
    return gw

# ---------------------------------------------------------------------------
# Tests: route_conversation
# ---------------------------------------------------------------------------


def test_route_conversation_normal():
    state = _make_state()
    assert route_conversation(state) == "agent_turn"


def test_route_conversation_handoff_active():
    state = _make_state(handoff_active=True)
    assert route_conversation(state) == "send_response"


def test_route_conversation_legal():
    state = _make_state(collection_status="legal")
    assert route_conversation(state) == "send_response"


def test_route_conversation_overdue_is_normal():
    state = _make_state(collection_status="overdue")
    assert route_conversation(state) == "agent_turn"


# ---------------------------------------------------------------------------
# Tests: agent_turn (gateway mockado)
# ---------------------------------------------------------------------------

_LOAD_PROMPT_PATCH = "app.graphs.whatsapp_pre_attendance.nodes.agent_turn.load_active_prompt"
_GET_GATEWAY_PATCH = "app.graphs.whatsapp_pre_attendance.nodes.agent_turn.get_gateway"
_DISPATCH_TOOL_PATCH = "app.graphs.whatsapp_pre_attendance.nodes.agent_turn._dispatch_tool"


@pytest.mark.asyncio
async def test_agent_turn_happy_path():
    state = _make_state()
    prompt = _make_prompt()
    gw = _make_gateway("Ola! Sou a Ana Clara.")

    with patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=prompt)):
        with patch(_GET_GATEWAY_PATCH, return_value=gw):
            result = await agent_turn(state)

    assert result.get("handoff_required") is False
    assert result.get("reply", {}).get("content") == "Ola! Sou a Ana Clara."
    assert result.get("reply", {}).get("type") == "text"
    msgs = result.get("messages", [])
    assert len(msgs) >= 2  # user msg + assistant response
    assert msgs[-1]["role"] == "assistant"


@pytest.mark.asyncio
async def test_agent_turn_with_tool_call():
    from app.llm.gateway import LLMResponse, TokenUsage
    state = _make_state()
    prompt = _make_prompt()
    tc_args_json = '{"lead_id": "lead-uuid-test"}'

    from app.llm.gateway import LLMResponse, TokenUsage

    tool_call_response = LLMResponse(
        content="",
        model="moonshot/kimi-k2",
        usage=TokenUsage(),
        finish_reason="tool_calls",
        raw={"choices": [{"message": {"content": "", "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "get_customer_context", "arguments": tc_args_json}}]}, "finish_reason": "tool_calls"}]},
    )
    final_response = LLMResponse(
        content="Encontrei seu cadastro.",
        model="moonshot/kimi-k2",
        usage=TokenUsage(),
        finish_reason="stop",
        raw={"choices": [{"message": {"content": "Encontrei seu cadastro.", "tool_calls": None}, "finish_reason": "stop"}]},
    )
    gw = MagicMock()
    gw.complete = AsyncMock(side_effect=[tool_call_response, final_response])

    with patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=prompt)):
        with patch(_GET_GATEWAY_PATCH, return_value=gw):
            with patch(_DISPATCH_TOOL_PATCH, new=AsyncMock(return_value='{ok: true}')):
                result = await agent_turn(state)

    assert result.get("reply", {}).get("content") == "Encontrei seu cadastro."
    tr = result.get("tool_results", [])
    tc_entries = [t for t in tr if t.get("tool") == "get_customer_context"]
    assert len(tc_entries) == 1


@pytest.mark.asyncio
async def test_agent_turn_gateway_error_triggers_handoff():
    state = _make_state()
    prompt = _make_prompt()

    gw = MagicMock()
    gw.complete = AsyncMock(side_effect=RuntimeError("Gateway timeout"))

    with patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=prompt)):
        with patch(_GET_GATEWAY_PATCH, return_value=gw):
            result = await agent_turn(state)

    assert result.get("handoff_required") is True
    assert "agent_turn falhou" in result.get("handoff_reason", "")
    errors = result.get("errors", [])
    assert any(e.get("node") == "agent_turn" for e in errors)


@pytest.mark.asyncio
async def test_agent_turn_prompt_not_found_triggers_handoff():
    from app.prompts.loader import PromptNotFoundError
    state = _make_state()

    with patch(_LOAD_PROMPT_PATCH, new=AsyncMock(side_effect=PromptNotFoundError("pre_attendance_agent"))):
        result = await agent_turn(state)

    assert result.get("handoff_required") is True
    assert "Prompt de agente nao encontrado" in result.get("handoff_reason", "")


def test_max_tool_calls_per_turn_constant():
    assert MAX_TOOL_CALLS_PER_TURN == 4


# ---------------------------------------------------------------------------
# Tests: graph build com flag off/on
# ---------------------------------------------------------------------------


def test_graph_build_flag_off():
    from app.graphs.whatsapp_pre_attendance.graph import build_graph
    with patch("app.graphs.whatsapp_pre_attendance.graph.settings") as mock_settings:
        mock_settings.pre_attendance_agentic_enabled = False
        g = build_graph()
    nodes = set(g.nodes)
    assert "classify_intent" in nodes, "Funil antigo deve estar intacto com flag off"
    assert "identify_or_create_lead" in nodes


def test_graph_build_flag_on():
    from app.graphs.whatsapp_pre_attendance.graph import build_graph
    with patch("app.graphs.whatsapp_pre_attendance.graph.settings") as mock_settings:
        mock_settings.pre_attendance_agentic_enabled = True
        g = build_graph()
    nodes = set(g.nodes)
    assert "agent_turn" in nodes, "Pipeline agentica deve ter agent_turn"
    assert "load_conversation_state" in nodes


# ---------------------------------------------------------------------------
# Tests: hardening de seguranca (F16-S40 security review)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_agent_turn_tool_cap_batch_5_dispatches_at_most_4():
    """FIX 1: modelo retorna 5 tool_calls num unico response -> no maximo 4
    despachadas; o cap nao e burlavel por batch grande."""
    from app.llm.gateway import LLMResponse, TokenUsage

    state = _make_state()
    prompt = _make_prompt()

    def _make_tc(i: int) -> dict[str, Any]:
        return {
            "id": f"call_{i}",
            "type": "function",
            "function": {"name": "get_customer_context", "arguments": '{"lead_id": "x"}'},
        }

    # Primeira resposta: 5 tool_calls num batch so
    batch_response = LLMResponse(
        content="",
        model="moonshot/kimi-k2",
        usage=TokenUsage(),
        finish_reason="tool_calls",
        raw={
            "choices": [{
                "message": {
                    "content": "",
                    "tool_calls": [_make_tc(i) for i in range(1, 6)],
                },
                "finish_reason": "tool_calls",
            }]
        },
    )
    cap_response = LLMResponse(
        content="Atingi o limite de acoes por turno.",
        model="moonshot/kimi-k2",
        usage=TokenUsage(),
        finish_reason="stop",
        raw={"choices": [{"message": {"content": "Atingi o limite de acoes por turno.", "tool_calls": None}, "finish_reason": "stop"}]},
    )
    gw = MagicMock()
    gw.complete = AsyncMock(side_effect=[batch_response, cap_response])

    dispatched: list[str] = []

    async def _mock_dispatch(tool_name: str, tool_args: dict[str, Any], s: Any) -> str:
        dispatched.append(tool_name)
        return '{"ok": true}'

    with patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=prompt)):
        with patch(_GET_GATEWAY_PATCH, return_value=gw):
            with patch(_DISPATCH_TOOL_PATCH, side_effect=_mock_dispatch):
                result = await agent_turn(state)

    # Apenas 4 tools devem ter sido despachadas (cap = MAX_TOOL_CALLS_PER_TURN)
    real_dispatches = [t for t in dispatched if t != "log_ai_decision"]
    assert len(real_dispatches) <= MAX_TOOL_CALLS_PER_TURN, (
        f"Cap burlado: {len(real_dispatches)} tool_calls despachadas, max={MAX_TOOL_CALLS_PER_TURN}"
    )
    # A resposta final deve vir do cap_response
    assert "limite" in result.get("reply", {}).get("content", "")


@pytest.mark.asyncio
async def test_agent_turn_audit_called_even_without_llm_log_tool():
    """FIX 2: log_ai_decision e chamada ao fim do turno mesmo que o LLM
    nao tenha invocado a tool de auditoria."""
    state = _make_state()
    prompt = _make_prompt()
    gw = _make_gateway("Ola! Sou a Ana Clara.")

    audit_calls: list[str] = []

    async def _mock_dispatch(tool_name: str, tool_args: dict[str, Any], s: Any) -> str:
        if tool_name == "log_ai_decision":
            audit_calls.append(tool_name)
            # Verifica que nao ha PII — apenas IDs e contadores
            assert "organization_id" in tool_args
            assert "conversation_id" in tool_args
            assert "node_name" in tool_args
            assert "decision" in tool_args
        return '{"ok": true}'

    with patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=prompt)):
        with patch(_GET_GATEWAY_PATCH, return_value=gw):
            with patch(_DISPATCH_TOOL_PATCH, side_effect=_mock_dispatch):
                result = await agent_turn(state)

    assert len(audit_calls) >= 1, "log_ai_decision deve ser chamada incondicionalmente ao fim do turno"
    assert result.get("handoff_required") is False


@pytest.mark.asyncio
async def test_agent_turn_empty_org_id_triggers_handoff_without_gateway():
    """FIX 3: org_id vazio -> handoff imediato sem chamar o gateway."""
    state = _make_state(organization_id="")
    prompt = _make_prompt()
    gw = MagicMock()
    gw.complete = AsyncMock()

    with patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=prompt)):
        with patch(_GET_GATEWAY_PATCH, return_value=gw):
            result = await agent_turn(state)

    assert result.get("handoff_required") is True
    assert "organization_id ausente" in result.get("handoff_reason", "")
    # Gateway nunca deve ser chamado
    gw.complete.assert_not_called()
    errors = result.get("errors", [])
    assert any(e.get("error") == "MISSING_ORG_ID" for e in errors)

