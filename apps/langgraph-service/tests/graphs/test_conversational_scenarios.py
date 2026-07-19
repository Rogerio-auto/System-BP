"""F16-S45 -- Testes conversacionais do agent_turn por cenario (Bloco D).

Valida o no agent_turn com gateway LLM e _dispatch_tool mockados.
9 cenarios: saudacao, simulacao, Porto Velho, curriculo, boleto,
handoff_active, erro gateway, cap tool-calls, org_id vazio.
"""
from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.graphs.whatsapp_pre_attendance.nodes.agent_turn import (
    MAX_TOOL_CALLS_PER_TURN,
    agent_turn,
)
from app.graphs.whatsapp_pre_attendance.state import ConversationState
from app.prompts.loader import ActivePrompt

_CONV = "conv-s45-001"
_ORG = "00000000-0000-0000-0000-000000000001"
_LEAD = "lead-uuid-s45"
_CW_CONV = "cw-99"
_PHONE = "+5569999999999"

_LOAD_PROMPT_PATCH = "app.graphs.whatsapp_pre_attendance.nodes.agent_turn.load_active_prompt"
_GET_GATEWAY_PATCH = "app.graphs.whatsapp_pre_attendance.nodes.agent_turn.get_gateway"
_DISPATCH_TOOL_PATCH = "app.graphs.whatsapp_pre_attendance.nodes.agent_turn._dispatch_tool"


def _make_state(**extra: Any) -> ConversationState:
    base: ConversationState = {
        "conversation_id": _CONV,
        "chatwoot_conversation_id": _CW_CONV,
        "phone": _PHONE,
        "organization_id": _ORG,
        "lead_id": _LEAD,
        "handoff_required": False,
        "handoff_active": False,
        "missing_fields": [],
        "messages": [{"role": "user", "content": "Ola, tudo bem?"}],
        "tool_results": [],
        "errors": [],
        "actions_emitted": [],
        "collection_status": "none",
    }
    base.update(extra)  # type: ignore[typeddict-item]
    return base


def _make_prompt() -> ActivePrompt:
    return ActivePrompt(
        key="pre_attendance_agent",
        version=1,
        body=(
            "Voce e Ana Clara, assistente virtual do Banco do Povo. "
            "Nao informe taxa de juros. Informe avalista quando valor abaixo de R$5.000. "
            "Handoff imediato para curriculo, boleto. "
        ),
        content_hash="s45hash",
        model_recommended=None,
        temperature=None,
        max_tokens=None,
        top_p=None,
        prompt_version="pre_attendance_agent@v1",
    )


def _llm_response(
    content: str = "", finish_reason: str = "stop", tool_calls: list | None = None
) -> Any:
    from app.llm.gateway import LLMResponse, TokenUsage
    raw_tc = tool_calls or []
    return LLMResponse(
        content=content,
        model="moonshot/kimi-k2",
        usage=TokenUsage(prompt_tokens=100, completion_tokens=50, total_tokens=150),
        finish_reason=finish_reason,
        raw={
            "choices": [{
                "message": {
                    "content": content or None,
                    "tool_calls": raw_tc if raw_tc else None,
                },
                "finish_reason": finish_reason,
            }]
        },
    )


def _tool_call_response(tool_name: str, args: dict, call_id: str = "call_1") -> Any:
    return _llm_response(
        finish_reason="tool_calls",
        tool_calls=[{
            "id": call_id,
            "type": "function",
            "function": {"name": tool_name, "arguments": json.dumps(args)},
        }],
    )


def _make_gateway(*responses: Any) -> MagicMock:
    gw = MagicMock()
    if len(responses) == 1:
        gw.complete = AsyncMock(return_value=responses[0])
    else:
        gw.complete = AsyncMock(side_effect=list(responses))
    return gw


def _make_dispatch(tool_responses: dict | None = None) -> AsyncMock:
    responses = tool_responses or {}

    async def _dispatch(tool_name: str, tool_args: dict, s: Any) -> str:
        if tool_name in responses:
            r = responses[tool_name]
            return json.dumps(r) if not isinstance(r, str) else r
        return json.dumps({"ok": True})

    return AsyncMock(side_effect=_dispatch)

# ---------------------------------------------------------------------------
# Cenario 1: Saudacao
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_s45_cenario_01_saudacao_sem_tool_credito():
    """Cenario 1: Ana Clara se identifica; nao chama tool de credito."""
    state = _make_state(lead_id=None, messages=[{"role": "user", "content": "Oi"}])
    prompt = _make_prompt()
    gw = _make_gateway(_llm_response("Ola! Sou a Ana Clara. Qual e o seu nome?"))
    dispatch_mock = _make_dispatch()
    with (
        patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=prompt)),
        patch(_GET_GATEWAY_PATCH, return_value=gw),
        patch(_DISPATCH_TOOL_PATCH, side_effect=dispatch_mock),
    ):
        result = await agent_turn(state)
    assert result.get("handoff_required") is False
    reply = result.get("reply", {})
    assert reply.get("type") == "text"
    assert "Ana Clara" in reply.get("content", "")
    tool_calls_made = [c.args[0] for c in dispatch_mock.await_args_list
                       if c.args[0] not in ("log_ai_decision",)]
    credit_tools = {"generate_credit_simulation", "list_credit_products"}
    assert not credit_tools.intersection(set(tool_calls_made)), (
        f"Tools de credito nao devem ser chamadas na saudacao: {tool_calls_made}"
    )


# ---------------------------------------------------------------------------
# Cenario 2: Simulacao sem taxa, com avalista
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_s45_cenario_02_simulacao_sem_taxa_com_avalista():
    """Cenario 2: Simulacao de R$3.000 -- nao menciona %; informa avalista."""
    state = _make_state(
        messages=[{"role": "user", "content": "Simular 3000 reais em 12 meses"}],
        city_id="city-ji-uuid", city_name="Ji-Parana",
    )
    prompt = _make_prompt()
    sim_tc = _tool_call_response(
        "generate_credit_simulation",
        {"lead_id": _LEAD, "amount": 3000, "term_months": 12},
    )
    sim_result = {"ok": True, "simulation_id": "sim-001", "installment": 290.50, "total": 3486.00}
    final_resp = _llm_response(
        "Simulacao: R$ 290,50 por mes, total R$ 3.486,00. "
        "Para valores abaixo de R$ 5.000, e necessario um avalista."
    )
    gw = _make_gateway(sim_tc, final_resp)
    dispatch_mock = _make_dispatch({"generate_credit_simulation": sim_result})
    with (
        patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=prompt)),
        patch(_GET_GATEWAY_PATCH, return_value=gw),
        patch(_DISPATCH_TOOL_PATCH, side_effect=dispatch_mock),
    ):
        result = await agent_turn(state)
    assert result.get("handoff_required") is False
    content = result.get("reply", {}).get("content", "")
    import re
    assert not re.search(r"\d+[,.]?\d*\s*%", content), f"BUG taxa: {content!r}"
    assert "avalista" in content.lower(), f"BUG avalista: {content!r}"
    sim_calls = [
        c for c in dispatch_mock.await_args_list if c.args[0] == "generate_credit_simulation"
    ]
    assert len(sim_calls) >= 1


# ---------------------------------------------------------------------------
# Cenario 3: Porto Velho -- cidade nao atendida
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_s45_cenario_03_cidade_nao_atendida():
    """Cenario 3: Porto Velho (nao atendida) -- explica; nao simula."""
    state = _make_state(messages=[{"role": "user", "content": "Sou de Porto Velho, quero credito"}])
    prompt = _make_prompt()
    city_tc = _tool_call_response(
        "identify_city", {"city_text": "Porto Velho", "organization_id": _ORG}
    )
    city_result = {
        "matched": True, "city_id": "city-pv", "city_name": "Porto Velho", "served": False
    }
    final_resp = _llm_response("Infelizmente Porto Velho ainda nao esta na cobertura.")
    gw = _make_gateway(city_tc, final_resp)
    dispatch_mock = _make_dispatch({"identify_city": city_result})
    with (
        patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=prompt)),
        patch(_GET_GATEWAY_PATCH, return_value=gw),
        patch(_DISPATCH_TOOL_PATCH, side_effect=dispatch_mock),
    ):
        result = await agent_turn(state)
    assert result.get("handoff_required") is False
    sim_calls = [
        c for c in dispatch_mock.await_args_list if c.args[0] == "generate_credit_simulation"
    ]
    assert len(sim_calls) == 0, "BUG: simulacao chamada para cidade nao atendida"

# Cenario 4: Curriculo -- handoff imediato


@pytest.mark.asyncio
async def test_s45_cenario_04_curriculo_handoff_imediato():
    state = _make_state(messages=[{"role": "user", "content": "Quero enviar curriculo"}])
    prompt = _make_prompt()
    handoff_tc = _tool_call_response(
        "request_handoff",
        {"reason": "curriculo", "lead_id": _LEAD, "chatwoot_conversation_id": _CW_CONV,
         "organization_id": _ORG, "summary": "Cliente perguntou sobre curriculo."},
    )
    final_resp = _llm_response("Vou te conectar.")
    gw = _make_gateway(handoff_tc, final_resp)
    dispatch_mock = _make_dispatch({"request_handoff": {"ok": True}})
    with (
        patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=prompt)),
        patch(_GET_GATEWAY_PATCH, return_value=gw),
        patch(_DISPATCH_TOOL_PATCH, side_effect=dispatch_mock),
    ):
        result = await agent_turn(state)
    assert result.get("handoff_required") is True
    hf_calls = [c for c in dispatch_mock.await_args_list if c.args[0] == "request_handoff"]
    assert len(hf_calls) >= 1


@pytest.mark.asyncio
async def test_s45_cenario_05_boleto_handoff_prioridade():
    state = _make_state(messages=[{"role": "user", "content": "Preciso de boleto"}])
    prompt = _make_prompt()
    handoff_tc = _tool_call_response(
        "request_handoff",
        {"reason": "boleto", "lead_id": _LEAD, "chatwoot_conversation_id": _CW_CONV,
         "organization_id": _ORG, "summary": "Cliente solicitou boleto."},
    )
    final_resp = _llm_response("Te conecto com financeiro.")
    gw = _make_gateway(handoff_tc, final_resp)
    dispatch_mock = _make_dispatch({"request_handoff": {"ok": True}})
    with (
        patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=prompt)),
        patch(_GET_GATEWAY_PATCH, return_value=gw),
        patch(_DISPATCH_TOOL_PATCH, side_effect=dispatch_mock),
    ):
        result = await agent_turn(state)
    assert result.get("handoff_required") is True
    hf_calls = [c for c in dispatch_mock.await_args_list if c.args[0] == "request_handoff"]
    assert len(hf_calls) >= 1


def test_s45_cenario_06_handoff_active_silencia():
    from app.graphs.whatsapp_pre_attendance.routes import route_conversation
    state = _make_state(handoff_active=True)
    route = route_conversation(state)
    assert route == "send_response"


@pytest.mark.asyncio
async def test_s45_cenario_07_erro_gateway_fallback_handoff():
    state = _make_state()
    prompt = _make_prompt()
    gw = MagicMock()
    gw.complete = AsyncMock(side_effect=TimeoutError("timeout"))
    with (
        patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=prompt)),
        patch(_GET_GATEWAY_PATCH, return_value=gw),
    ):
        result = await agent_turn(state)
    assert result.get("handoff_required") is True
    assert result.get("handoff_reason")
    errors = result.get("errors", [])
    assert any(e.get("node") == "agent_turn" for e in errors)


@pytest.mark.asyncio
async def test_s45_cenario_08_cap_de_tool_calls():
    state = _make_state()
    prompt = _make_prompt()
    batch_tcs = [
        {"id": f"call_{i}", "type": "function",
         "function": {"name": "get_customer_context", "arguments": json.dumps({"lead_id": "x"})}}
        for i in range(1, 6)
    ]
    batch_response = _llm_response(finish_reason="tool_calls", tool_calls=batch_tcs)
    cap_response = _llm_response("Atingi o limite de acoes por turno.")
    gw = _make_gateway(batch_response, cap_response)
    dispatched: list[str] = []

    async def _mock_dispatch(tn: str, ta: dict, s: Any) -> str:
        dispatched.append(tn)
        return json.dumps({"ok": True})

    with (
        patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=prompt)),
        patch(_GET_GATEWAY_PATCH, return_value=gw),
        patch(_DISPATCH_TOOL_PATCH, side_effect=_mock_dispatch),
    ):
        result = await agent_turn(state)
    real = [t for t in dispatched if t != "log_ai_decision"]
    assert len(real) <= MAX_TOOL_CALLS_PER_TURN, f"BUG cap: {len(real)} > {MAX_TOOL_CALLS_PER_TURN}"
    assert "limite" in result.get("reply", {}).get("content", "")


@pytest.mark.asyncio
async def test_s45_cenario_09_org_id_vazio_handoff_sem_gateway():
    state = _make_state(organization_id="")
    prompt = _make_prompt()
    gw = MagicMock()
    gw.complete = AsyncMock()
    with (
        patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=prompt)),
        patch(_GET_GATEWAY_PATCH, return_value=gw),
    ):
        result = await agent_turn(state)
    assert result.get("handoff_required") is True
    hr = result.get("handoff_reason", "")
    assert "organization_id ausente" in hr, f"BUG reason: {hr}"
    gw.complete.assert_not_called()
    errors = result.get("errors", [])
    assert any(e.get("error") == "MISSING_ORG_ID" for e in errors)


@pytest.mark.asyncio
async def test_s45_reply_sem_quebras_excessivas():
    state = _make_state()
    prompt = _make_prompt()
    gw = _make_gateway(_llm_response("Ola! Posso te ajudar."))
    with (
        patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=prompt)),
        patch(_GET_GATEWAY_PATCH, return_value=gw),
    ):
        result = await agent_turn(state)
    content = result.get("reply", {}).get("content", "")
    assert chr(10) * 3 not in content
    assert len(content) <= 2000
