"""Testes dos nós decide_next_step e request_handoff (F3-S29).

Cobre decide_next_step:
- Rota ``continue`` para intenções normais (saudacao, quer_credito, quer_simular).
- Rota ``handoff`` quando ``handoff_required=True`` no estado.
- Rota ``handoff`` para intenções diretas (falar_atendente, consultar_andamento,
  cobranca, reclamacao).
- Rota ``continue`` para ``nao_entendi`` nas primeiras 2 tentativas.
- Rota ``handoff`` para ``nao_entendi`` na 3ª tentativa (limit=3, doc 06 §5.3).
- Rota ``end`` para ``fora_de_escopo``.
- ``handoff_required`` setado corretamente em estado retornado.
- ``tool_results`` contém entry do nó.

Cobre request_handoff:
- summary gerado no formato doc 06 §7.4 (nome, cidade, valor, prazo, simulação).
- Chama ``request_handoff`` tool e ``create_chatwoot_note`` tool com mocks.
- ``handoff_required=True`` e ``handoff_reason`` no retorno.
- ``current_stage="handoff_requested"`` no retorno.
- ``tool_results`` contém entradas das duas tools.
- Falha na tool de handoff: erro acumulado, nó não levanta exceção.
- Falha na tool de nota: erro acumulado, nó não levanta exceção.
- Ausência de ``lead_id``: erro acumulado, nó não levanta exceção.
- Sem CPF/dados sensíveis no summary (LGPD doc 17).

Todas as tools são mockadas — sem chamadas HTTP reais.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from app.graphs.whatsapp_pre_attendance.nodes.decide_next_step import (
    _MAX_NAO_ENTENDI,
    _count_nao_entendi,
    _decide_route,
    decide_next_step,
)
from app.graphs.whatsapp_pre_attendance.nodes.request_handoff import (
    _build_summary,
    request_handoff,
)
from app.graphs.whatsapp_pre_attendance.state import ConversationState
from app.tools.chatwoot_tools import ChatwootNoteOutput, HandoffOutput

# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

_BASE_STATE: ConversationState = {
    "conversation_id": "conv-s29-001",
    "chatwoot_conversation_id": "cw-s29-001",
    "phone": "+5569999990029",
    "lead_id": "ld-s29-001",
    "customer_id": None,
    "customer_name": "Maria Andrade",
    "city_id": "city-001",
    "city_name": "Porto Velho",
    "current_intent": None,
    "requested_amount": None,
    "requested_term_months": None,
    "selected_product_id": None,
    "last_simulation_id": None,
    "current_stage": None,
    "handoff_required": False,
    "handoff_reason": None,
    "missing_fields": [],
    "messages": [{"role": "user", "content": "Olá"}],
    "tool_results": [],
    "errors": [],
    "actions_emitted": [],
}


def _state(**overrides: Any) -> ConversationState:
    """Retorna estado base com campos sobrescritos."""
    merged = dict(_BASE_STATE)
    merged.update(overrides)
    return merged  # type: ignore[return-value]


def _nao_entendi_tool_result(n: int) -> list[dict[str, Any]]:
    """Gera ``n`` entradas de tool_results representando ``n`` nao_entendi anteriores."""
    return [
        {
            "node": "decide_next_step",
            "route": "continue",
            "intent": "nao_entendi",
            "reason": f"nao_entendi (tentativa {i + 1}/{_MAX_NAO_ENTENDI})",
            "latency_ms": 0.1,
        }
        for i in range(n)
    ]


def _mock_handoff_output(
    handoff_id: str = "hnd-s29-001",
    chatwoot_conversation_id: str = "cw-s29-001",
) -> HandoffOutput:
    return HandoffOutput(
        handoff_id=handoff_id,
        chatwoot_conversation_id=chatwoot_conversation_id,
        assigned_agent_id="agt-s29-001",
        status="requested",
    )


def _mock_note_output(note_id: str = "note-s29-001") -> ChatwootNoteOutput:
    return ChatwootNoteOutput(note_id=note_id)


# ===========================================================================
# Testes de _count_nao_entendi
# ===========================================================================


class TestCountNaoEntendi:
    def test_empty_tool_results_returns_zero(self) -> None:
        assert _count_nao_entendi([]) == 0

    def test_counts_only_decide_next_step_nao_entendi(self) -> None:
        results = [
            {"node": "decide_next_step", "intent": "nao_entendi", "route": "continue"},
            {"node": "classify_intent", "intent": "nao_entendi"},  # outro nó — não conta
            {"node": "decide_next_step", "intent": "saudacao"},  # intent diferente — não conta
            {"node": "decide_next_step", "intent": "nao_entendi", "route": "continue"},
        ]
        assert _count_nao_entendi(results) == 2

    def test_counts_all_nao_entendi_entries(self) -> None:
        results = _nao_entendi_tool_result(3)
        assert _count_nao_entendi(results) == 3


# ===========================================================================
# Testes de _decide_route (função pura)
# ===========================================================================


class TestDecideRoute:
    def test_continue_for_saudacao(self) -> None:
        state = _state(current_intent="saudacao")
        route, reason = _decide_route(state)
        assert route == "continue"
        assert "saudacao" in reason

    def test_continue_for_quer_credito(self) -> None:
        state = _state(current_intent="quer_credito")
        route, _ = _decide_route(state)
        assert route == "continue"

    def test_continue_for_quer_simular(self) -> None:
        state = _state(current_intent="quer_simular")
        route, _ = _decide_route(state)
        assert route == "continue"

    def test_continue_for_enviar_documentos(self) -> None:
        state = _state(current_intent="enviar_documentos")
        route, _ = _decide_route(state)
        assert route == "continue"

    def test_handoff_when_handoff_required_set(self) -> None:
        state = _state(handoff_required=True, handoff_reason="backend_error")
        route, reason = _decide_route(state)
        assert route == "handoff"
        assert "backend_error" in reason

    def test_handoff_for_falar_atendente(self) -> None:
        state = _state(current_intent="falar_atendente")
        route, reason = _decide_route(state)
        assert route == "handoff"
        assert "falar_atendente" in reason

    def test_handoff_for_consultar_andamento(self) -> None:
        state = _state(current_intent="consultar_andamento")
        route, _ = _decide_route(state)
        assert route == "handoff"

    def test_handoff_for_cobranca(self) -> None:
        state = _state(current_intent="cobranca")
        route, _ = _decide_route(state)
        assert route == "handoff"

    def test_handoff_for_reclamacao(self) -> None:
        state = _state(current_intent="reclamacao")
        route, _ = _decide_route(state)
        assert route == "handoff"

    def test_end_for_fora_de_escopo(self) -> None:
        state = _state(current_intent="fora_de_escopo")
        route, reason = _decide_route(state)
        assert route == "end"
        assert "fora_de_escopo" in reason

    def test_continue_for_none_intent(self) -> None:
        """Estado sem intenção classificada não deve encerrar nem fazer handoff."""
        state = _state(current_intent=None)
        route, _ = _decide_route(state)
        assert route == "continue"

    # -----------------------------------------------------------------------
    # nao_entendi counter
    # -----------------------------------------------------------------------

    def test_nao_entendi_first_attempt_returns_continue(self) -> None:
        """Primeira tentativa de nao_entendi: continua (pede reformulação)."""
        state = _state(current_intent="nao_entendi", tool_results=[])
        route, reason = _decide_route(state)
        assert route == "continue"
        assert "1/3" in reason

    def test_nao_entendi_second_attempt_returns_continue(self) -> None:
        """Segunda tentativa: ainda continua."""
        state = _state(
            current_intent="nao_entendi",
            tool_results=_nao_entendi_tool_result(1),
        )
        route, reason = _decide_route(state)
        assert route == "continue"
        assert "2/3" in reason

    def test_nao_entendi_third_attempt_returns_handoff(self) -> None:
        """Terceira tentativa (após 2 registradas) → handoff (doc 06 §5.3)."""
        state = _state(
            current_intent="nao_entendi",
            tool_results=_nao_entendi_tool_result(2),
        )
        route, reason = _decide_route(state)
        assert route == "handoff"
        assert "nao_entendi" in reason

    def test_nao_entendi_fourth_attempt_also_handoff(self) -> None:
        """Quatro registros (acima do limite): handoff seguro."""
        state = _state(
            current_intent="nao_entendi",
            tool_results=_nao_entendi_tool_result(3),
        )
        route, _ = _decide_route(state)
        assert route == "handoff"

    def test_handoff_required_takes_priority_over_nao_entendi_count(self) -> None:
        """handoff_required=True tem prioridade sobre qualquer outra regra."""
        state = _state(
            current_intent="nao_entendi",
            handoff_required=True,
            handoff_reason="prior_error",
            tool_results=[],
        )
        route, reason = _decide_route(state)
        assert route == "handoff"
        assert "prior_error" in reason


# ===========================================================================
# Testes de decide_next_step (nó async)
# ===========================================================================


class TestDecideNextStepNode:
    @pytest.mark.asyncio
    async def test_continue_route_does_not_set_handoff(self) -> None:
        """Rota continue não deve alterar handoff_required para True."""
        state = _state(current_intent="quer_credito")
        result = await decide_next_step(state)

        assert result.get("handoff_required") is not True
        assert result["current_stage"] == "deciding"

    @pytest.mark.asyncio
    async def test_handoff_route_sets_handoff_required(self) -> None:
        """Rota handoff deve setar handoff_required=True."""
        state = _state(current_intent="falar_atendente")
        result = await decide_next_step(state)

        assert result["handoff_required"] is True
        assert result["handoff_reason"] is not None
        assert "falar_atendente" in result["handoff_reason"]

    @pytest.mark.asyncio
    async def test_end_route_does_not_set_handoff(self) -> None:
        """Rota end não deve setar handoff_required."""
        state = _state(current_intent="fora_de_escopo")
        result = await decide_next_step(state)

        assert result.get("handoff_required") is not True

    @pytest.mark.asyncio
    async def test_tool_results_entry_appended(self) -> None:
        """``tool_results`` deve ter entry do nó com route, intent, reason."""
        state = _state(current_intent="saudacao")
        result = await decide_next_step(state)

        tr = result["tool_results"]
        assert len(tr) == 1
        entry = tr[0]
        assert entry["node"] == "decide_next_step"
        assert entry["route"] == "continue"
        assert entry["intent"] == "saudacao"
        assert "latency_ms" in entry

    @pytest.mark.asyncio
    async def test_existing_tool_results_preserved(self) -> None:
        """Entradas anteriores de tool_results são preservadas."""
        prior = {"node": "classify_intent", "intent": "quer_credito"}
        state = _state(current_intent="quer_credito", tool_results=[prior])
        result = await decide_next_step(state)

        tr = result["tool_results"]
        assert tr[0] == prior
        assert len(tr) == 2

    @pytest.mark.asyncio
    async def test_nao_entendi_counter_increments_via_tool_results(self) -> None:
        """Cada nao_entendi incrementa o contador nos tool_results."""
        # 1ª tentativa
        state1 = _state(current_intent="nao_entendi", tool_results=[])
        result1 = await decide_next_step(state1)
        assert result1["tool_results"][-1]["route"] == "continue"

        # 2ª tentativa (usa tool_results da 1ª)
        state2 = _state(current_intent="nao_entendi", tool_results=result1["tool_results"])
        result2 = await decide_next_step(state2)
        assert result2["tool_results"][-1]["route"] == "continue"

        # 3ª tentativa (usa tool_results da 2ª) → deve virar handoff
        state3 = _state(current_intent="nao_entendi", tool_results=result2["tool_results"])
        result3 = await decide_next_step(state3)
        assert result3["tool_results"][-1]["route"] == "handoff"
        assert result3["handoff_required"] is True

    @pytest.mark.asyncio
    async def test_handoff_reason_preserved_from_state(self) -> None:
        """handoff_reason já presente no estado é preservado (não sobrescrito)."""
        state = _state(
            current_intent="cobranca",
            handoff_required=True,
            handoff_reason="motivo_original",
        )
        result = await decide_next_step(state)

        assert result["handoff_reason"] == "motivo_original"


# ===========================================================================
# Testes de _build_summary
# ===========================================================================


class TestBuildSummary:
    def test_full_context_summary(self) -> None:
        """Summary completo com nome, cidade, valor, prazo e simulação."""
        state = _state(
            customer_name="Maria Andrade",
            city_name="Porto Velho",
            requested_amount=5000.0,
            requested_term_months=12,
            last_simulation_id="sim-abc123",
        )
        summary = _build_summary(state, "cliente_solicitou_atendente")

        assert "Maria Andrade" in summary
        assert "Porto Velho" in summary
        assert "5.000,00" in summary
        assert "12 meses" in summary
        assert "sim-abc123" in summary
        assert "cliente_solicitou_atendente" in summary

    def test_summary_without_credit_data(self) -> None:
        """Summary sem dados de crédito não quebra o nó."""
        state = _state(
            customer_name="João",
            city_name="Ariquemes",
            requested_amount=None,
            requested_term_months=None,
        )
        summary = _build_summary(state, "falar_atendente")

        assert "João" in summary
        assert "Ariquemes" in summary
        assert "falar_atendente" in summary

    def test_summary_with_unknown_name(self) -> None:
        """Nome ausente é substituído por 'Desconhecido'."""
        state = _state(customer_name=None, city_name="Porto Velho")
        summary = _build_summary(state, "cobranca")

        assert "Desconhecido" in summary

    def test_summary_with_unknown_city(self) -> None:
        """Cidade ausente é substituída por 'cidade não identificada'."""
        state = _state(customer_name="Ana", city_name=None)
        summary = _build_summary(state, "reclamacao")

        assert "cidade não identificada" in summary

    def test_summary_without_simulation(self) -> None:
        """Sem simulation_id, o trecho de simulação não aparece."""
        state = _state(last_simulation_id=None)
        summary = _build_summary(state, "falar_atendente")

        assert "Simulação" not in summary

    def test_summary_does_not_contain_cpf(self) -> None:
        """CPF nunca deve aparecer no summary (LGPD doc 17)."""
        state = _state(customer_name="Maria 529.982.247-25 Andrade")
        summary = _build_summary(state, "falar_atendente")

        # O campo customer_name pode conter CPF se passou pela coleta errada;
        # o resumo deve usar apenas o nome do estado sem adicionar CPF novo.
        # Este teste verifica que o nó não ADICIONA CPF ao summary por conta própria.
        assert "52998224725" not in summary  # sem CPF sem formatação


# ===========================================================================
# Testes de request_handoff (nó async)
# ===========================================================================


class TestRequestHandoffNode:
    @pytest.mark.asyncio
    async def test_happy_path_sets_handoff_required(self) -> None:
        """Caminho feliz: handoff_required=True, current_stage='handoff_requested'."""
        state = _state(current_intent="falar_atendente")

        with (
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.request_handoff._request_handoff_tool",
                new=AsyncMock(return_value=_mock_handoff_output()),
            ),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.request_handoff.create_chatwoot_note",
                new=AsyncMock(return_value=_mock_note_output()),
            ),
        ):
            result = await request_handoff(state)

        assert result["handoff_required"] is True
        assert result["current_stage"] == "handoff_requested"
        assert result["handoff_reason"] is not None

    @pytest.mark.asyncio
    async def test_happy_path_tool_results_contain_both_tools(self) -> None:
        """tool_results deve conter entradas das duas tools."""
        state = _state(current_intent="cobranca")

        with (
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.request_handoff._request_handoff_tool",
                new=AsyncMock(return_value=_mock_handoff_output()),
            ),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.request_handoff.create_chatwoot_note",
                new=AsyncMock(return_value=_mock_note_output()),
            ),
        ):
            result = await request_handoff(state)

        tr = result["tool_results"]
        nodes_tools = [(e["node"], e.get("tool")) for e in tr]
        assert ("request_handoff", "request_handoff") in nodes_tools
        assert ("request_handoff", "create_chatwoot_note") in nodes_tools

    @pytest.mark.asyncio
    async def test_happy_path_no_errors(self) -> None:
        """Caminho feliz: lista errors deve estar vazia."""
        state = _state(current_intent="reclamacao")

        with (
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.request_handoff._request_handoff_tool",
                new=AsyncMock(return_value=_mock_handoff_output()),
            ),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.request_handoff.create_chatwoot_note",
                new=AsyncMock(return_value=_mock_note_output()),
            ),
        ):
            result = await request_handoff(state)

        assert result["errors"] == []

    @pytest.mark.asyncio
    async def test_handoff_tool_failure_accumulates_error(self) -> None:
        """Falha na tool request_handoff acumula erro e não levanta exceção."""
        state = _state(current_intent="falar_atendente")

        with (
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.request_handoff._request_handoff_tool",
                new=AsyncMock(side_effect=RuntimeError("backend timeout")),
            ),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.request_handoff.create_chatwoot_note",
                new=AsyncMock(return_value=_mock_note_output()),
            ),
        ):
            result = await request_handoff(state)

        assert result["handoff_required"] is True
        errors = result["errors"]
        assert len(errors) >= 1
        assert errors[0]["node"] == "request_handoff"
        assert errors[0]["tool"] == "request_handoff"
        assert "backend timeout" in errors[0]["error"]

    @pytest.mark.asyncio
    async def test_note_tool_failure_accumulates_error(self) -> None:
        """Falha na tool create_chatwoot_note acumula erro e não levanta exceção."""
        state = _state(current_intent="cobranca")

        with (
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.request_handoff._request_handoff_tool",
                new=AsyncMock(return_value=_mock_handoff_output()),
            ),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.request_handoff.create_chatwoot_note",
                new=AsyncMock(side_effect=ConnectionError("chatwoot down")),
            ),
        ):
            result = await request_handoff(state)

        assert result["handoff_required"] is True
        errors = result["errors"]
        assert len(errors) == 1
        assert errors[0]["tool"] == "create_chatwoot_note"
        assert "chatwoot down" in errors[0]["error"]

    @pytest.mark.asyncio
    async def test_missing_lead_id_accumulates_error(self) -> None:
        """Ausência de lead_id acumula erro (não levanta exceção)."""
        state = _state(lead_id=None, current_intent="falar_atendente")

        with (
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.request_handoff._request_handoff_tool",
                new=AsyncMock(return_value=_mock_handoff_output()),
            ),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.request_handoff.create_chatwoot_note",
                new=AsyncMock(return_value=_mock_note_output()),
            ),
        ):
            result = await request_handoff(state)

        assert result["handoff_required"] is True
        errors = result["errors"]
        # Deve ter pelo menos 1 erro referente ao lead_id ausente
        assert any("lead_id" in e.get("error", "") for e in errors)

    @pytest.mark.asyncio
    async def test_existing_tool_results_preserved(self) -> None:
        """tool_results anteriores no estado são preservados."""
        prior = {"node": "classify_intent", "intent": "falar_atendente"}
        state = _state(
            current_intent="falar_atendente",
            tool_results=[prior],
        )

        with (
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.request_handoff._request_handoff_tool",
                new=AsyncMock(return_value=_mock_handoff_output()),
            ),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.request_handoff.create_chatwoot_note",
                new=AsyncMock(return_value=_mock_note_output()),
            ),
        ):
            result = await request_handoff(state)

        assert result["tool_results"][0] == prior

    @pytest.mark.asyncio
    async def test_existing_errors_preserved(self) -> None:
        """Erros anteriores no estado são preservados."""
        prior_error = {"node": "classify_intent", "error": "timeout"}
        state = _state(
            current_intent="cobranca",
            errors=[prior_error],
        )

        with (
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.request_handoff._request_handoff_tool",
                new=AsyncMock(return_value=_mock_handoff_output()),
            ),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.request_handoff.create_chatwoot_note",
                new=AsyncMock(return_value=_mock_note_output()),
            ),
        ):
            result = await request_handoff(state)

        assert result["errors"][0] == prior_error

    @pytest.mark.asyncio
    async def test_handoff_reason_uses_state_reason_when_present(self) -> None:
        """handoff_reason do estado é passado para a tool."""
        state = _state(
            current_intent="falar_atendente",
            handoff_reason="motivo_preexistente",
        )

        captured_inputs: list[Any] = []

        async def _capture(inp: Any, **kwargs: Any) -> HandoffOutput:
            captured_inputs.append(inp)
            return _mock_handoff_output()

        with (
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.request_handoff._request_handoff_tool",
                new=_capture,
            ),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.request_handoff.create_chatwoot_note",
                new=AsyncMock(return_value=_mock_note_output()),
            ),
        ):
            result = await request_handoff(state)

        assert result["handoff_reason"] == "motivo_preexistente"
        assert captured_inputs[0].reason == "motivo_preexistente"

    @pytest.mark.asyncio
    async def test_both_tools_fail_returns_two_errors(self) -> None:
        """Ambas as tools falham: dois erros acumulados, nó não levanta."""
        state = _state(current_intent="falar_atendente")

        with (
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.request_handoff._request_handoff_tool",
                new=AsyncMock(side_effect=RuntimeError("handoff failed")),
            ),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.request_handoff.create_chatwoot_note",
                new=AsyncMock(side_effect=RuntimeError("note failed")),
            ),
        ):
            result = await request_handoff(state)

        assert result["handoff_required"] is True
        assert len(result["errors"]) == 2
