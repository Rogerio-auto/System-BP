"""Testes dos nós generate_simulation e save_simulation (F3-S28).

Cobre:
- generate_simulation: caminho feliz (produto selecionado, simulação gerada,
  resposta composta via LLM).
- generate_simulation: erro de range (AMOUNT_OUT_OF_RANGE, TERM_OUT_OF_RANGE).
- generate_simulation: sem produtos ativos (lista vazia).
- generate_simulation: produto compatível selecionado a partir da lista.
- generate_simulation: last_simulation_id gravado no estado.
- generate_simulation: pré-condições faltando (lead_id, amount, term_months).
- generate_simulation: falha do gateway LLM → fallback de texto.
- generate_simulation: falha irrecuperável → handoff.
- save_simulation: caminho feliz (ok=True, actions_emitted registrado).
- save_simulation: simulation_id ausente → handoff.
- save_simulation: mark_simulation_sent retorna ok=False → handoff.
- save_simulation: exceção inesperada → handoff.
- _select_compatible_product: seleção correta e ausência de produto.

Os gateways e tools são sempre mockados — sem chamadas reais à API.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.graphs.whatsapp_pre_attendance.nodes.generate_simulation import (
    _error_reply,
    _select_compatible_product,
    generate_simulation,
)
from app.graphs.whatsapp_pre_attendance.nodes.save_simulation import save_simulation
from app.graphs.whatsapp_pre_attendance.state import ConversationState
from app.tools.simulation_tools import (
    CreditProductItem,
    GenerateCreditSimulationOutput,
    ListCreditProductsOutput,
    MarkSimulationSentOutput,
    SimulationErrorCode,
)

# ---------------------------------------------------------------------------
# Helpers e fixtures
# ---------------------------------------------------------------------------


def _make_state(**extra: Any) -> ConversationState:
    """Retorna estado mínimo com dados de qualificação de crédito."""
    base: ConversationState = {
        "conversation_id": "conv-sim-001",
        "chatwoot_conversation_id": "cw-100",
        "phone": "+5569999990001",
        "lead_id": "lead-uuid-001",
        "customer_name": "Maria Silva",
        "city_id": "city-uuid-001",
        "requested_amount": 5000.0,
        "requested_term_months": 12,
        "handoff_required": False,
        "missing_fields": [],
        "messages": [{"role": "user", "content": "Quero simular 5 mil em 12 meses"}],
        "tool_results": [],
        "errors": [],
        "actions_emitted": [],
    }
    base.update(extra)  # type: ignore[typeddict-item]
    return base


def _make_product(
    *,
    id: str = "prod-001",
    name: str = "Microcrédito Produtivo",
    min_amount: str = "500.00",
    max_amount: str = "15000.00",
    min_term: int = 3,
    max_term: int = 24,
    interest_rate: str = "0.025000",
    amortization_type: str = "price",
) -> CreditProductItem:
    return CreditProductItem(
        id=id,
        name=name,
        min_amount=min_amount,
        max_amount=max_amount,
        min_term=min_term,
        max_term=max_term,
        interest_rate=interest_rate,
        amortization_type=amortization_type,
    )


def _make_simulation_success(
    simulation_id: str = "sim-uuid-001",
) -> GenerateCreditSimulationOutput:
    return GenerateCreditSimulationOutput(
        ok=True,
        simulation_id=simulation_id,
        installment="462.50",
        total="5550.00",
        interest="550.00",
        rate="0.025000",
        rule_version="v1",
    )


def _make_simulation_error(
    error_code: SimulationErrorCode = SimulationErrorCode.AMOUNT_OUT_OF_RANGE,
) -> GenerateCreditSimulationOutput:
    return GenerateCreditSimulationOutput(
        ok=False,
        error_code=error_code,
        error_message=f"Business error: {error_code}",
    )


def _mock_llm_response(content: str = "Simulação gerada com sucesso!") -> Any:
    """Cria mock do gateway LLM."""
    from app.llm.gateway import LLMResponse, TokenUsage

    gw = MagicMock()
    gw.complete = AsyncMock(
        return_value=LLMResponse(
            content=content,
            model="anthropic/claude-sonnet-4",
            usage=TokenUsage(prompt_tokens=200, completion_tokens=80, total_tokens=280),
            latency_ms=350.0,
            finish_reason="stop",
        )
    )
    return gw


# ---------------------------------------------------------------------------
# Testes de _select_compatible_product
# ---------------------------------------------------------------------------


class TestSelectCompatibleProduct:
    def test_selects_compatible_product(self) -> None:
        """Produto compatível com valor e prazo é selecionado."""
        products = [_make_product()]
        result = _select_compatible_product(products, amount=5000.0, term_months=12)
        assert result == "prod-001"

    def test_no_compatible_product_returns_none(self) -> None:
        """Nenhum produto compatível → retorna None."""
        products = [_make_product(min_amount="10000.00", max_amount="50000.00")]
        result = _select_compatible_product(products, amount=5000.0, term_months=12)
        assert result is None

    def test_amount_below_min_not_selected(self) -> None:
        """Valor abaixo do mínimo → não seleciona."""
        products = [_make_product(min_amount="6000.00", max_amount="15000.00")]
        result = _select_compatible_product(products, amount=5000.0, term_months=12)
        assert result is None

    def test_term_out_of_range_not_selected(self) -> None:
        """Prazo fora do intervalo → não seleciona."""
        products = [_make_product(min_term=6, max_term=6)]
        result = _select_compatible_product(products, amount=5000.0, term_months=12)
        assert result is None

    def test_selects_first_compatible_from_multiple(self) -> None:
        """Com múltiplos produtos, seleciona o primeiro compatível."""
        products = [
            _make_product(id="prod-A", min_amount="10000.00", max_amount="50000.00"),
            _make_product(id="prod-B", min_amount="500.00", max_amount="10000.00"),
        ]
        result = _select_compatible_product(products, amount=5000.0, term_months=12)
        assert result == "prod-B"

    def test_empty_products_returns_none(self) -> None:
        """Lista vazia → retorna None."""
        result = _select_compatible_product([], amount=5000.0, term_months=12)
        assert result is None


# ---------------------------------------------------------------------------
# Testes de _error_reply
# ---------------------------------------------------------------------------


class TestErrorReply:
    def test_amount_out_of_range_has_message(self) -> None:
        msg = _error_reply(SimulationErrorCode.AMOUNT_OUT_OF_RANGE)
        assert len(msg) > 20
        # Não deve conter taxa ou prazo inventados
        assert "%" not in msg
        assert "R$" not in msg

    def test_term_out_of_range_has_message(self) -> None:
        msg = _error_reply(SimulationErrorCode.TERM_OUT_OF_RANGE)
        assert len(msg) > 20

    def test_no_rule_for_city_has_message(self) -> None:
        msg = _error_reply(SimulationErrorCode.NO_RULE_FOR_CITY)
        assert len(msg) > 20

    def test_no_active_product_has_message(self) -> None:
        msg = _error_reply(SimulationErrorCode.NO_ACTIVE_PRODUCT)
        assert len(msg) > 20

    def test_unknown_error_has_message(self) -> None:
        msg = _error_reply(SimulationErrorCode.UNKNOWN)
        assert len(msg) > 20

    def test_none_error_code_returns_unknown_message(self) -> None:
        msg = _error_reply(None)
        assert len(msg) > 20


# ---------------------------------------------------------------------------
# Testes de generate_simulation — caminho feliz
# ---------------------------------------------------------------------------


class TestGenerateSimulationHappyPath:
    @pytest.mark.asyncio
    async def test_happy_path_sets_last_simulation_id(self) -> None:
        """Simulação bem-sucedida grava last_simulation_id no estado."""
        state = _make_state()
        gw = _mock_llm_response("Simulação pronta, Maria!")
        products_output = ListCreditProductsOutput(products=[_make_product()])
        sim_output = _make_simulation_success(simulation_id="sim-uuid-001")

        with (
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.generate_simulation.list_credit_products",
                new=AsyncMock(return_value=products_output),
            ),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.generate_simulation.generate_credit_simulation",
                new=AsyncMock(return_value=sim_output),
            ),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.generate_simulation.get_gateway",
                return_value=gw,
            ),
        ):
            result = await generate_simulation(state)

        assert result["last_simulation_id"] == "sim-uuid-001"
        assert (
            result.get("handoff_required") is False
            or "handoff_required" not in result
            or not result["handoff_required"]
        )

    @pytest.mark.asyncio
    async def test_happy_path_sets_selected_product_id(self) -> None:
        """Produto selecionado é gravado em selected_product_id."""
        state = _make_state()
        gw = _mock_llm_response("Ótimo produto!")
        products_output = ListCreditProductsOutput(products=[_make_product(id="prod-abc")])
        sim_output = _make_simulation_success()

        with (
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.generate_simulation.list_credit_products",
                new=AsyncMock(return_value=products_output),
            ),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.generate_simulation.generate_credit_simulation",
                new=AsyncMock(return_value=sim_output),
            ),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.generate_simulation.get_gateway",
                return_value=gw,
            ),
        ):
            result = await generate_simulation(state)

        assert result["selected_product_id"] == "prod-abc"

    @pytest.mark.asyncio
    async def test_happy_path_appends_assistant_message(self) -> None:
        """Resposta do LLM é adicionada ao histórico de mensagens como 'assistant'."""
        state = _make_state()
        gw = _mock_llm_response("Sua parcela mensal será R$ 462,50.")
        products_output = ListCreditProductsOutput(products=[_make_product()])
        sim_output = _make_simulation_success()

        with (
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.generate_simulation.list_credit_products",
                new=AsyncMock(return_value=products_output),
            ),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.generate_simulation.generate_credit_simulation",
                new=AsyncMock(return_value=sim_output),
            ),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.generate_simulation.get_gateway",
                return_value=gw,
            ),
        ):
            result = await generate_simulation(state)

        messages: list[dict[str, Any]] = result["messages"]
        assert messages[-1]["role"] == "assistant"
        assert "462,50" in messages[-1]["content"]

    @pytest.mark.asyncio
    async def test_happy_path_emits_simulation_generated_action(self) -> None:
        """Ação simulation_generated é emitida em actions_emitted."""
        state = _make_state()
        gw = _mock_llm_response("Ok!")
        products_output = ListCreditProductsOutput(products=[_make_product()])
        sim_output = _make_simulation_success(simulation_id="sim-999")

        with (
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.generate_simulation.list_credit_products",
                new=AsyncMock(return_value=products_output),
            ),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.generate_simulation.generate_credit_simulation",
                new=AsyncMock(return_value=sim_output),
            ),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.generate_simulation.get_gateway",
                return_value=gw,
            ),
        ):
            result = await generate_simulation(state)

        actions: list[dict[str, Any]] = result["actions_emitted"]
        sim_action = next(
            (a for a in actions if a.get("action") == "simulation_generated"), None
        )
        assert sim_action is not None
        assert sim_action["simulation_id"] == "sim-999"

    @pytest.mark.asyncio
    async def test_happy_path_tool_results_has_prompt_metadata(self) -> None:
        """tool_results contém prompt_key e prompt_version."""
        state = _make_state()
        gw = _mock_llm_response("Ok!")
        products_output = ListCreditProductsOutput(products=[_make_product()])
        sim_output = _make_simulation_success()

        with (
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.generate_simulation.list_credit_products",
                new=AsyncMock(return_value=products_output),
            ),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.generate_simulation.generate_credit_simulation",
                new=AsyncMock(return_value=sim_output),
            ),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.generate_simulation.get_gateway",
                return_value=gw,
            ),
        ):
            result = await generate_simulation(state)

        tool_results: list[dict[str, Any]] = result["tool_results"]
        last = tool_results[-1]
        assert last["node"] == "generate_simulation"
        assert "prompt_key" in last
        assert "prompt_version" in last

    @pytest.mark.asyncio
    async def test_current_stage_set_to_simulacao(self) -> None:
        """current_stage é definido como 'simulacao' após a geração."""
        state = _make_state()
        gw = _mock_llm_response("Ok!")
        products_output = ListCreditProductsOutput(products=[_make_product()])
        sim_output = _make_simulation_success()

        with (
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.generate_simulation.list_credit_products",
                new=AsyncMock(return_value=products_output),
            ),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.generate_simulation.generate_credit_simulation",
                new=AsyncMock(return_value=sim_output),
            ),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.generate_simulation.get_gateway",
                return_value=gw,
            ),
        ):
            result = await generate_simulation(state)

        assert result["current_stage"] == "simulacao"


# ---------------------------------------------------------------------------
# Testes de generate_simulation — erros de range (doc 06 §5.6)
# ---------------------------------------------------------------------------


class TestGenerateSimulationRangeErrors:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "error_code",
        [
            SimulationErrorCode.AMOUNT_OUT_OF_RANGE,
            SimulationErrorCode.TERM_OUT_OF_RANGE,
            SimulationErrorCode.NO_RULE_FOR_CITY,
            SimulationErrorCode.NO_ACTIVE_PRODUCT,
        ],
    )
    async def test_business_error_returns_clear_message(
        self, error_code: SimulationErrorCode
    ) -> None:
        """Erro de range retorna mensagem clara sem inventar taxa/prazo."""
        state = _make_state()
        products_output = ListCreditProductsOutput(products=[_make_product()])
        sim_output = _make_simulation_error(error_code)

        with (
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.generate_simulation.list_credit_products",
                new=AsyncMock(return_value=products_output),
            ),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.generate_simulation.generate_credit_simulation",
                new=AsyncMock(return_value=sim_output),
            ),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.generate_simulation.get_gateway",
                return_value=_mock_llm_response(),
            ),
        ):
            result = await generate_simulation(state)

        messages: list[dict[str, Any]] = result["messages"]
        reply = messages[-1]["content"]
        # Mensagem deve existir e não deve conter taxa/parcela inventada
        assert len(reply) > 10
        # Não deve conter números de parcela calculada
        assert "462" not in reply  # valor de parcela real não deve aparecer
        # Deve estar registrado em errors
        errors: list[dict[str, Any]] = result["errors"]
        assert any(e["node"] == "generate_simulation" for e in errors)

    @pytest.mark.asyncio
    async def test_amount_out_of_range_no_handoff(self) -> None:
        """Erro de range NÃO aciona handoff automático — permite reformulação."""
        state = _make_state()
        products_output = ListCreditProductsOutput(products=[_make_product()])
        sim_output = _make_simulation_error(SimulationErrorCode.AMOUNT_OUT_OF_RANGE)

        with (
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.generate_simulation.list_credit_products",
                new=AsyncMock(return_value=products_output),
            ),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.generate_simulation.generate_credit_simulation",
                new=AsyncMock(return_value=sim_output),
            ),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.generate_simulation.get_gateway",
                return_value=_mock_llm_response(),
            ),
        ):
            result = await generate_simulation(state)

        # handoff_required não deve ser True para erro de range recuperável
        assert not result.get("handoff_required", False)


# ---------------------------------------------------------------------------
# Testes de generate_simulation — lista de produtos vazia
# ---------------------------------------------------------------------------


class TestGenerateSimulationNoProducts:
    @pytest.mark.asyncio
    async def test_empty_product_list_triggers_handoff(self) -> None:
        """Lista de produtos vazia aciona handoff humano."""
        state = _make_state()
        products_output = ListCreditProductsOutput(products=[])

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.generate_simulation.list_credit_products",
            new=AsyncMock(return_value=products_output),
        ):
            result = await generate_simulation(state)

        assert result["handoff_required"] is True
        assert "handoff_reason" in result


# ---------------------------------------------------------------------------
# Testes de generate_simulation — pré-condições faltando
# ---------------------------------------------------------------------------


class TestGenerateSimulationMissingPreconditions:
    @pytest.mark.asyncio
    async def test_missing_lead_id_triggers_handoff(self) -> None:
        """lead_id ausente → handoff imediato."""
        state = _make_state(lead_id=None)

        result = await generate_simulation(state)

        assert result["handoff_required"] is True
        errors: list[dict[str, Any]] = result["errors"]
        assert any(
            e.get("error_code") == "MISSING_LEAD_ID" for e in errors
        )

    @pytest.mark.asyncio
    async def test_missing_amount_triggers_handoff(self) -> None:
        """requested_amount ausente → handoff imediato."""
        state = _make_state(requested_amount=None)

        result = await generate_simulation(state)

        assert result["handoff_required"] is True
        errors: list[dict[str, Any]] = result["errors"]
        assert any(
            e.get("error_code") == "MISSING_QUALIFICATION" for e in errors
        )

    @pytest.mark.asyncio
    async def test_missing_term_triggers_handoff(self) -> None:
        """requested_term_months ausente → handoff imediato."""
        state = _make_state(requested_term_months=None)

        result = await generate_simulation(state)

        assert result["handoff_required"] is True


# ---------------------------------------------------------------------------
# Testes de generate_simulation — falha do gateway LLM
# ---------------------------------------------------------------------------


class TestGenerateSimulationLLMFailure:
    @pytest.mark.asyncio
    async def test_llm_gateway_failure_uses_fallback_text(self) -> None:
        """Falha do gateway LLM → texto de fallback com dados reais, sem handoff."""
        state = _make_state()
        products_output = ListCreditProductsOutput(products=[_make_product()])
        sim_output = _make_simulation_success()

        failing_gw = MagicMock()
        failing_gw.complete = AsyncMock(side_effect=RuntimeError("LLM timeout"))

        with (
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.generate_simulation.list_credit_products",
                new=AsyncMock(return_value=products_output),
            ),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.generate_simulation.generate_credit_simulation",
                new=AsyncMock(return_value=sim_output),
            ),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.generate_simulation.get_gateway",
                return_value=failing_gw,
            ),
        ):
            result = await generate_simulation(state)

        # Deve gravar simulation_id mesmo com LLM falhando
        assert result["last_simulation_id"] == "sim-uuid-001"
        # Deve ter mensagem de fallback (não vazia)
        messages: list[dict[str, Any]] = result["messages"]
        assert messages[-1]["role"] == "assistant"
        assert len(messages[-1]["content"]) > 10

    @pytest.mark.asyncio
    async def test_tool_exception_triggers_handoff(self) -> None:
        """Exceção irrecuperável na tool → handoff humano."""
        state = _make_state()

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.generate_simulation.list_credit_products",
            new=AsyncMock(side_effect=ConnectionError("backend unreachable")),
        ):
            result = await generate_simulation(state)

        assert result["handoff_required"] is True
        errors: list[dict[str, Any]] = result["errors"]
        assert any(e["node"] == "generate_simulation" for e in errors)


# ---------------------------------------------------------------------------
# Testes de save_simulation — caminho feliz
# ---------------------------------------------------------------------------


class TestSaveSimulationHappyPath:
    @pytest.mark.asyncio
    async def test_happy_path_ok(self) -> None:
        """Simulação marcada com sucesso → ok=True no tool_results."""
        state = _make_state(last_simulation_id="sim-uuid-001")
        mark_output = MarkSimulationSentOutput(ok=True, simulation_id="sim-uuid-001")

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.save_simulation.mark_simulation_sent",
            new=AsyncMock(return_value=mark_output),
        ):
            result = await save_simulation(state)

        tool_results: list[dict[str, Any]] = result["tool_results"]
        last = tool_results[-1]
        assert last["ok"] is True
        assert last["simulation_id"] == "sim-uuid-001"
        assert not result.get("handoff_required", False)

    @pytest.mark.asyncio
    async def test_happy_path_emits_simulation_sent_action(self) -> None:
        """Ação simulation_sent é emitida em actions_emitted."""
        state = _make_state(last_simulation_id="sim-uuid-002")
        mark_output = MarkSimulationSentOutput(ok=True, simulation_id="sim-uuid-002")

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.save_simulation.mark_simulation_sent",
            new=AsyncMock(return_value=mark_output),
        ):
            result = await save_simulation(state)

        actions: list[dict[str, Any]] = result["actions_emitted"]
        sent_action = next(
            (a for a in actions if a.get("action") == "simulation_sent"), None
        )
        assert sent_action is not None
        assert sent_action["simulation_id"] == "sim-uuid-002"

    @pytest.mark.asyncio
    async def test_prior_actions_preserved(self) -> None:
        """Ações anteriores no estado são preservadas."""
        prior_action: dict[str, Any] = {"action": "lead_identified", "lead_id": "lead-1"}
        state = _make_state(
            last_simulation_id="sim-uuid-003",
            actions_emitted=[prior_action],
        )
        mark_output = MarkSimulationSentOutput(ok=True, simulation_id="sim-uuid-003")

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.save_simulation.mark_simulation_sent",
            new=AsyncMock(return_value=mark_output),
        ):
            result = await save_simulation(state)

        actions: list[dict[str, Any]] = result["actions_emitted"]
        assert actions[0] == prior_action
        assert len(actions) == 2

    @pytest.mark.asyncio
    async def test_tool_results_has_latency(self) -> None:
        """tool_results contém latency_ms."""
        state = _make_state(last_simulation_id="sim-uuid-004")
        mark_output = MarkSimulationSentOutput(ok=True, simulation_id="sim-uuid-004")

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.save_simulation.mark_simulation_sent",
            new=AsyncMock(return_value=mark_output),
        ):
            result = await save_simulation(state)

        tool_results: list[dict[str, Any]] = result["tool_results"]
        assert "latency_ms" in tool_results[-1]


# ---------------------------------------------------------------------------
# Testes de save_simulation — simulation_id ausente
# ---------------------------------------------------------------------------


class TestSaveSimulationMissingId:
    @pytest.mark.asyncio
    async def test_missing_simulation_id_triggers_handoff(self) -> None:
        """last_simulation_id ausente → handoff imediato sem chamar a tool."""
        state = _make_state()
        # Não define last_simulation_id — usa None implícito do TypedDict

        result = await save_simulation(state)

        assert result["handoff_required"] is True
        errors: list[dict[str, Any]] = result["errors"]
        assert any(
            e.get("error_code") == "MISSING_SIMULATION_ID" for e in errors
        )


# ---------------------------------------------------------------------------
# Testes de save_simulation — falha da tool
# ---------------------------------------------------------------------------


class TestSaveSimulationToolError:
    @pytest.mark.asyncio
    async def test_mark_sent_ok_false_triggers_handoff(self) -> None:
        """mark_simulation_sent retorna ok=False → handoff."""
        state = _make_state(last_simulation_id="sim-uuid-005")
        mark_output = MarkSimulationSentOutput(
            ok=False,
            simulation_id="sim-uuid-005",
            error_message="Simulation not found (404)",
        )

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.save_simulation.mark_simulation_sent",
            new=AsyncMock(return_value=mark_output),
        ):
            result = await save_simulation(state)

        assert result["handoff_required"] is True
        assert "handoff_reason" in result
        errors: list[dict[str, Any]] = result["errors"]
        assert any(e.get("error_code") == "MARK_SENT_FAILED" for e in errors)

    @pytest.mark.asyncio
    async def test_unexpected_exception_triggers_handoff(self) -> None:
        """Exceção inesperada na tool → handoff."""
        state = _make_state(last_simulation_id="sim-uuid-006")

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.save_simulation.mark_simulation_sent",
            new=AsyncMock(side_effect=ConnectionError("backend unreachable")),
        ):
            result = await save_simulation(state)

        assert result["handoff_required"] is True
        errors: list[dict[str, Any]] = result["errors"]
        assert any(e["node"] == "save_simulation" for e in errors)

    @pytest.mark.asyncio
    async def test_prior_tool_results_preserved_on_failure(self) -> None:
        """tool_results anteriores são preservados ao acumular falha."""
        prior_result: dict[str, Any] = {"node": "generate_simulation", "ok": True}
        state = _make_state(
            last_simulation_id="sim-uuid-007",
            tool_results=[prior_result],
        )
        mark_output = MarkSimulationSentOutput(
            ok=False,
            simulation_id="sim-uuid-007",
            error_message="Backend error 500",
        )

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.save_simulation.mark_simulation_sent",
            new=AsyncMock(return_value=mark_output),
        ):
            result = await save_simulation(state)

        tool_results: list[dict[str, Any]] = result["tool_results"]
        assert tool_results[0] == prior_result

    @pytest.mark.asyncio
    async def test_prior_errors_preserved_on_new_error(self) -> None:
        """Erros anteriores são preservados ao acumular novo erro."""
        prior_error: dict[str, Any] = {
            "node": "generate_simulation",
            "error_code": "TERM_OUT_OF_RANGE",
        }
        state = _make_state(
            last_simulation_id="sim-uuid-008",
            errors=[prior_error],
        )
        mark_output = MarkSimulationSentOutput(
            ok=False,
            simulation_id="sim-uuid-008",
            error_message="404",
        )

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.save_simulation.mark_simulation_sent",
            new=AsyncMock(return_value=mark_output),
        ):
            result = await save_simulation(state)

        errors: list[dict[str, Any]] = result["errors"]
        assert errors[0] == prior_error
        assert len(errors) == 2
