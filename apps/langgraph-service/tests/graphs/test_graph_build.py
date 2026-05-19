"""Testes de fumaça para build_graph() — grafo whatsapp_pre_attendance.

Verifica que o grafo compila, contém os nós esperados, tem as edges
condicionais do doc 06 §5.3 e que ``graph_version`` está exposto.

Não executa o grafo (sem chamadas LLM/HTTP). Apenas inspeciona a estrutura
do objeto ``StateGraph`` retornado por ``build_graph()``.
"""
from __future__ import annotations

from app.graphs.whatsapp_pre_attendance.graph import build_graph, graph_version
from app.graphs.whatsapp_pre_attendance.routes import (
    route_after_city,
    route_after_lead,
    route_by_intent,
    route_decide_next_step,
)
from app.graphs.whatsapp_pre_attendance.state import ConversationState

# ---------------------------------------------------------------------------
# Nós esperados (conforme doc 06 §5.2 — exceto receive_message, que é externo)
# ---------------------------------------------------------------------------

_EXPECTED_NODES: frozenset[str] = frozenset(
    {
        "load_conversation_state",
        "classify_intent",
        "identify_or_create_lead",
        "collect_missing_profile_data",
        "identify_city",
        "qualify_credit_interest",
        "generate_simulation",
        "save_simulation",
        "decide_next_step",
        "request_handoff",
        "send_response",
        "persist_state",
        "log_decision",
        "__end__",  # LangGraph adiciona END como nó especial
    }
)

# ---------------------------------------------------------------------------
# Nós com edges condicionais de saída (doc 06 §5.3)
# ---------------------------------------------------------------------------

_CONDITIONAL_SOURCE_NODES: frozenset[str] = frozenset(
    {
        "classify_intent",
        "identify_or_create_lead",
        "identify_city",
        "decide_next_step",
    }
)


class TestBuildGraph:
    """Testes estruturais do grafo — compilação e topologia."""

    def test_build_graph_returns_state_graph(self) -> None:
        """build_graph() deve retornar um StateGraph sem lançar exceção."""
        from langgraph.graph import StateGraph

        graph = build_graph()
        assert isinstance(graph, StateGraph)

    def test_graph_has_all_expected_nodes(self) -> None:
        """Todos os nós do doc 06 §5.2 devem estar presentes no grafo."""
        graph = build_graph()
        # StateGraph expõe nodes como dict-like (nome → callable)
        node_names: frozenset[str] = frozenset(graph.nodes.keys())
        # Cada nó esperado deve existir no grafo
        for node in _EXPECTED_NODES - {"__end__"}:
            assert node in node_names, f"Nó ausente no grafo: '{node}'"

    def test_entry_point_is_load_conversation_state(self) -> None:
        """O entry point do grafo deve ser load_conversation_state.

        LangGraph registra o entry point como a edge ('__start__', <node>).
        """
        graph = build_graph()
        # Verifica que existe edge de __start__ → load_conversation_state
        assert ("__start__", "load_conversation_state") in graph.edges

    def test_graph_version_is_semver(self) -> None:
        """graph_version deve estar exposto e seguir o formato SemVer."""
        assert isinstance(graph_version, str)
        parts = graph_version.split(".")
        assert len(parts) == 3, f"graph_version não é SemVer: {graph_version!r}"
        for part in parts:
            assert part.isdigit(), f"Componente não-numérico em graph_version: {part!r}"

    def test_graph_version_not_empty(self) -> None:
        """graph_version não deve ser string vazia."""
        assert graph_version != ""


class TestRouteByIntent:
    """Testes unitários de route_by_intent (saída de classify_intent)."""

    def _state(self, intent: str | None, handoff: bool = False) -> ConversationState:
        return {  # type: ignore[return-value]
            "conversation_id": "test-conv-001",
            "current_intent": intent,  # type: ignore[typeddict-item]
            "handoff_required": handoff,
        }

    def test_saudacao_routes_to_identify_lead(self) -> None:
        assert route_by_intent(self._state("saudacao")) == "identify_or_create_lead"

    def test_quer_credito_routes_to_identify_lead(self) -> None:
        assert route_by_intent(self._state("quer_credito")) == "identify_or_create_lead"

    def test_quer_simular_routes_to_identify_lead(self) -> None:
        assert route_by_intent(self._state("quer_simular")) == "identify_or_create_lead"

    def test_enviar_documentos_routes_to_identify_lead(self) -> None:
        assert route_by_intent(self._state("enviar_documentos")) == "identify_or_create_lead"

    def test_falar_atendente_routes_to_request_handoff(self) -> None:
        assert route_by_intent(self._state("falar_atendente")) == "request_handoff"

    def test_consultar_andamento_routes_to_request_handoff(self) -> None:
        assert route_by_intent(self._state("consultar_andamento")) == "request_handoff"

    def test_cobranca_routes_to_request_handoff(self) -> None:
        assert route_by_intent(self._state("cobranca")) == "request_handoff"

    def test_reclamacao_routes_to_request_handoff(self) -> None:
        assert route_by_intent(self._state("reclamacao")) == "request_handoff"

    def test_nao_entendi_routes_to_send_response(self) -> None:
        assert route_by_intent(self._state("nao_entendi")) == "send_response"

    def test_fora_de_escopo_routes_to_send_response(self) -> None:
        assert route_by_intent(self._state("fora_de_escopo")) == "send_response"

    def test_handoff_required_overrides_intent(self) -> None:
        """Se handoff_required=True, vai para request_handoff mesmo com intent de lead."""
        assert route_by_intent(self._state("saudacao", handoff=True)) == "request_handoff"

    def test_none_intent_routes_to_send_response(self) -> None:
        """Intent None (estado incompleto) cai no fallback send_response."""
        assert route_by_intent(self._state(None)) == "send_response"


class TestRouteAfterLead:
    """Testes unitários de route_after_lead (saída de identify_or_create_lead)."""

    def _state(
        self,
        customer_name: str | None = None,
        handoff: bool = False,
    ) -> ConversationState:
        return {  # type: ignore[return-value]
            "conversation_id": "test-conv-002",
            "handoff_required": handoff,
            "customer_name": customer_name,
        }

    def test_name_present_routes_to_identify_city(self) -> None:
        assert route_after_lead(self._state("Ana Silva")) == "identify_city"

    def test_name_absent_routes_to_collect_profile(self) -> None:
        assert route_after_lead(self._state(None)) == "collect_missing_profile_data"

    def test_empty_name_routes_to_collect_profile(self) -> None:
        assert route_after_lead(self._state("")) == "collect_missing_profile_data"

    def test_handoff_required_routes_to_request_handoff(self) -> None:
        assert route_after_lead(self._state("Ana", handoff=True)) == "request_handoff"

    def test_handoff_required_with_no_name_routes_to_request_handoff(self) -> None:
        assert route_after_lead(self._state(None, handoff=True)) == "request_handoff"


class TestRouteAfterCity:
    """Testes unitários de route_after_city (saída de identify_city)."""

    def _state(
        self,
        city_id: str | None = None,
        handoff: bool = False,
    ) -> ConversationState:
        return {  # type: ignore[return-value]
            "conversation_id": "test-conv-003",
            "handoff_required": handoff,
            "city_id": city_id,
        }

    def test_city_id_present_routes_to_qualify(self) -> None:
        assert route_after_city(self._state("city-001")) == "qualify_credit_interest"

    def test_city_id_absent_routes_to_send_response(self) -> None:
        """Confiança baixa → city_id ausente → pede confirmação via send_response."""
        assert route_after_city(self._state(None)) == "send_response"

    def test_handoff_required_routes_to_request_handoff(self) -> None:
        assert route_after_city(self._state(None, handoff=True)) == "request_handoff"

    def test_handoff_required_with_city_id_routes_to_request_handoff(self) -> None:
        """handoff_required tem precedência sobre city_id."""
        assert route_after_city(self._state("city-001", handoff=True)) == "request_handoff"


class TestRouteDecideNextStep:
    """Testes unitários de route_decide_next_step (saída de decide_next_step)."""

    def _state(self, route: str | None) -> ConversationState:
        """Monta estado com um entry de decide_next_step em tool_results."""
        tool_results = []
        if route is not None:
            tool_results.append({"node": "decide_next_step", "route": route})
        return {  # type: ignore[return-value]
            "conversation_id": "test-conv-004",
            "tool_results": tool_results,
        }

    def test_handoff_routes_to_request_handoff(self) -> None:
        assert route_decide_next_step(self._state("handoff")) == "request_handoff"

    def test_end_routes_to_send_response(self) -> None:
        assert route_decide_next_step(self._state("end")) == "send_response"

    def test_continue_routes_to_classify_intent(self) -> None:
        assert route_decide_next_step(self._state("continue")) == "classify_intent"

    def test_no_entry_defaults_to_classify_intent(self) -> None:
        """Sem entry de decide_next_step em tool_results → fallback classify_intent."""
        assert route_decide_next_step(self._state(None)) == "classify_intent"

    def test_uses_latest_entry(self) -> None:
        """Deve usar o último entry de decide_next_step (mais recente)."""
        state: ConversationState = {  # type: ignore[assignment]
            "conversation_id": "test-conv-005",
            "tool_results": [
                {"node": "decide_next_step", "route": "continue"},
                {"node": "decide_next_step", "route": "handoff"},
            ],
        }
        assert route_decide_next_step(state) == "request_handoff"
