"""Montagem do grafo whatsapp_pre_attendance.

Expõe ``build_graph()`` que constrói e compila o ``StateGraph`` com todos
os nós de F3-S23…S30 e as edges condicionais do doc 06 §5.3.

Nota de design — nó ``receive_message``:
    O nó ``receive_message`` tem assinatura ``(state, *, payload)`` e é
    chamado pelo handler HTTP antes de invocar o grafo, para construir o
    estado inicial a partir do payload inbound (doc 06 §4.1).
    O grafo em si parte de ``load_conversation_state``, que carrega o estado
    persistido e mescla com o estado inicial fornecido pelo handler.

Todo caminho termina obrigatoriamente em:
    persist_state → log_decision → END

Versão do grafo (SemVer) exposta em ``graph_version``.
"""
from __future__ import annotations

from langgraph.graph import END, StateGraph

from app.config import settings
from app.graphs.whatsapp_pre_attendance.nodes.agent_turn import (
    agent_turn,
)
from app.graphs.whatsapp_pre_attendance.nodes.classify_intent import (
    classify_intent,
)
from app.graphs.whatsapp_pre_attendance.nodes.collect_missing_profile_data import (
    collect_missing_profile_data,
)
from app.graphs.whatsapp_pre_attendance.nodes.decide_next_step import (
    decide_next_step,
)
from app.graphs.whatsapp_pre_attendance.nodes.generate_simulation import (
    generate_simulation,
)
from app.graphs.whatsapp_pre_attendance.nodes.identify_city import (
    node_identify_city,
)
from app.graphs.whatsapp_pre_attendance.nodes.identify_or_create_lead import (
    identify_or_create_lead,
)
from app.graphs.whatsapp_pre_attendance.nodes.load_state import (
    load_state,
)
from app.graphs.whatsapp_pre_attendance.nodes.log_decision import (
    log_decision,
)
from app.graphs.whatsapp_pre_attendance.nodes.persist_state import (
    persist_state,
)
from app.graphs.whatsapp_pre_attendance.nodes.qualify_credit_interest import (
    qualify_credit_interest,
)
from app.graphs.whatsapp_pre_attendance.nodes.request_handoff import (
    request_handoff,
)
from app.graphs.whatsapp_pre_attendance.nodes.save_simulation import (
    save_simulation,
)
from app.graphs.whatsapp_pre_attendance.nodes.send_response import (
    send_response,
)
from app.graphs.whatsapp_pre_attendance.routes import (
    route_after_city,
    route_after_lead,
    route_by_intent,
    route_conversation,
    route_decide_next_step,
)
from app.graphs.whatsapp_pre_attendance.state import ConversationState

# ---------------------------------------------------------------------------
# Versão semântica do grafo — incrementar a cada mudança estrutural de edges/nós
# ---------------------------------------------------------------------------

graph_version: str = "1.0.0"

# ---------------------------------------------------------------------------
# Nomes canônicos dos nós (usados nas edges — definidos uma única vez)
# ---------------------------------------------------------------------------

_N_LOAD = "load_conversation_state"
_N_CLASSIFY = "classify_intent"
_N_IDENTIFY_LEAD = "identify_or_create_lead"
_N_COLLECT_PROFILE = "collect_missing_profile_data"
_N_IDENTIFY_CITY = "identify_city"
_N_QUALIFY = "qualify_credit_interest"
_N_GENERATE_SIM = "generate_simulation"
_N_SAVE_SIM = "save_simulation"
_N_DECIDE = "decide_next_step"
_N_REQUEST_HANDOFF = "request_handoff"
_N_SEND_RESPONSE = "send_response"
_N_PERSIST = "persist_state"
_N_LOG = "log_decision"
_N_AGENT_TURN = "agent_turn"
_N_ROUTE_CONV = "route_conversation_node"


def build_graph() -> StateGraph[ConversationState]:
    """Constrói e compila o grafo de pré-atendimento WhatsApp.

    Conecta todos os nós de F3-S23…S30 com as edges condicionais do doc 06 §5.3.
    Todo caminho termina em ``persist_state → log_decision → END``.

    O nó ``receive_message`` tem assinatura especial ``(state, *, payload)`` e
    é invocado pelo handler HTTP antes de chamar o grafo. O estado inicial
    resultante é passado como entrada para este grafo, que começa em
    ``load_conversation_state``.

    Returns:
        ``StateGraph`` compilado, pronto para uso em handlers HTTP.

    Pipeline completo (doc 06 §5.3):

        [receive_message — chamado pelo handler HTTP, fora do grafo]
        → load_conversation_state
        → classify_intent
            ├─ (saudacao / quer_credito / quer_simular / enviar_documentos)
            │       → identify_or_create_lead
            │           ├─ (nome ausente) → collect_missing_profile_data → identify_city
            │           └─ (nome presente) → identify_city
            │               ├─ (city_id presente) → qualify_credit_interest
            │               │       → generate_simulation → save_simulation → decide_next_step
            │               │           ├─ continue → classify_intent
            │               │           ├─ handoff  → request_handoff
            │               │           └─ end      → send_response
            │               └─ (city_id ausente / low confidence) → send_response
            ├─ (falar_atendente / consultar_andamento / cobranca / reclamacao)
            │       → request_handoff
            └─ (nao_entendi / fora_de_escopo / handoff_required) → send_response

        request_handoff → send_response
        send_response   → persist_state → log_decision → END
    """
    graph: StateGraph[ConversationState] = StateGraph(ConversationState)

    # ------------------------------------------------------------------
    # Registro de nós
    # ------------------------------------------------------------------
    graph.add_node(_N_LOAD, load_state)
    graph.add_node(_N_CLASSIFY, classify_intent)
    graph.add_node(_N_IDENTIFY_LEAD, identify_or_create_lead)
    graph.add_node(_N_COLLECT_PROFILE, collect_missing_profile_data)
    graph.add_node(_N_IDENTIFY_CITY, node_identify_city)
    graph.add_node(_N_QUALIFY, qualify_credit_interest)
    graph.add_node(_N_GENERATE_SIM, generate_simulation)
    graph.add_node(_N_SAVE_SIM, save_simulation)
    graph.add_node(_N_DECIDE, decide_next_step)
    graph.add_node(_N_REQUEST_HANDOFF, request_handoff)
    graph.add_node(_N_SEND_RESPONSE, send_response)
    graph.add_node(_N_PERSIST, persist_state)
    graph.add_node(_N_LOG, log_decision)

    # ------------------------------------------------------------------
    # Entry point
    # ------------------------------------------------------------------
    graph.set_entry_point(_N_LOAD)

    # ------------------------------------------------------------------
    # Edges fixas (determinísticas)
    # ------------------------------------------------------------------

    # Início da pipeline: load → classify
    graph.add_edge(_N_LOAD, _N_CLASSIFY)

    # Funil de qualificação: collect_profile → city; qualify → simulate → decide
    graph.add_edge(_N_COLLECT_PROFILE, _N_IDENTIFY_CITY)
    graph.add_edge(_N_QUALIFY, _N_GENERATE_SIM)
    graph.add_edge(_N_GENERATE_SIM, _N_SAVE_SIM)
    graph.add_edge(_N_SAVE_SIM, _N_DECIDE)

    # Handoff → resposta final
    graph.add_edge(_N_REQUEST_HANDOFF, _N_SEND_RESPONSE)

    # Finalização obrigatória: todo caminho passa por persist → log → END
    graph.add_edge(_N_SEND_RESPONSE, _N_PERSIST)
    graph.add_edge(_N_PERSIST, _N_LOG)
    graph.add_edge(_N_LOG, END)

    # ------------------------------------------------------------------
    # Edges condicionais (doc 06 §5.3)
    # ------------------------------------------------------------------

    # classify_intent → roteamento por intenção
    graph.add_conditional_edges(
        _N_CLASSIFY,
        route_by_intent,
        {
            _N_IDENTIFY_LEAD: _N_IDENTIFY_LEAD,
            _N_REQUEST_HANDOFF: _N_REQUEST_HANDOFF,
            _N_SEND_RESPONSE: _N_SEND_RESPONSE,
        },
    )

    # identify_or_create_lead → nome ausente vs presente
    graph.add_conditional_edges(
        _N_IDENTIFY_LEAD,
        route_after_lead,
        {
            _N_COLLECT_PROFILE: _N_COLLECT_PROFILE,
            _N_IDENTIFY_CITY: _N_IDENTIFY_CITY,
            _N_REQUEST_HANDOFF: _N_REQUEST_HANDOFF,
        },
    )

    # identify_city → alta confiança vs pede confirmação
    graph.add_conditional_edges(
        _N_IDENTIFY_CITY,
        route_after_city,
        {
            _N_QUALIFY: _N_QUALIFY,
            _N_SEND_RESPONSE: _N_SEND_RESPONSE,
            _N_REQUEST_HANDOFF: _N_REQUEST_HANDOFF,
        },
    )

    # decide_next_step → continua / handoff / encerra
    graph.add_conditional_edges(
        _N_DECIDE,
        route_decide_next_step,
        {
            _N_CLASSIFY: _N_CLASSIFY,
            _N_REQUEST_HANDOFF: _N_REQUEST_HANDOFF,
            _N_SEND_RESPONSE: _N_SEND_RESPONSE,
        },
    )

    # ------------------------------------------------------------------
    # Pipeline agentica (F16-S40): PRE_ATTENDANCE_AGENTIC_ENABLED
    # DEFAULT OFF -- funil antigo e o caminho live.
    # Ligar apos Bloco B+D validados.
    # ------------------------------------------------------------------
    if settings.pre_attendance_agentic_enabled:
        # Pipeline agentica: load -> route_conversation -> agent_turn -> send_response -> persist
        graph.add_node(_N_AGENT_TURN, agent_turn)

        # Remover a edge _N_LOAD -> _N_CLASSIFY do funil (sobrescreve)
        # LangGraph nao suporta remover edges; usamos grafo separado
        # Construir grafo agentico do zero (sem os nos do funil nao usados neste path)
        agentic_graph: StateGraph[ConversationState] = StateGraph(ConversationState)

        # Nos da pipeline agentica
        agentic_graph.add_node(_N_LOAD, load_state)
        agentic_graph.add_node(_N_AGENT_TURN, agent_turn)
        agentic_graph.add_node(_N_SEND_RESPONSE, send_response)
        agentic_graph.add_node(_N_PERSIST, persist_state)
        agentic_graph.add_node(_N_LOG, log_decision)
        agentic_graph.add_node(_N_REQUEST_HANDOFF, request_handoff)

        # Entry point
        agentic_graph.set_entry_point(_N_LOAD)

        # Edges fixas
        agentic_graph.add_edge(_N_SEND_RESPONSE, _N_PERSIST)
        agentic_graph.add_edge(_N_PERSIST, _N_LOG)
        agentic_graph.add_edge(_N_LOG, END)
        agentic_graph.add_edge(_N_REQUEST_HANDOFF, _N_SEND_RESPONSE)

        # load_state -> route_conversation (condicional)
        agentic_graph.add_conditional_edges(
            _N_LOAD,
            route_conversation,
            {
                _N_AGENT_TURN: _N_AGENT_TURN,
                _N_SEND_RESPONSE: _N_SEND_RESPONSE,
            },
        )

        # agent_turn -> send_response (direto -- handoff_required e tratado por send_response)
        agentic_graph.add_edge(_N_AGENT_TURN, _N_SEND_RESPONSE)

        return agentic_graph

    # Default: pipeline funil deterministica (intacta -- flag off)
    return graph


__all__ = ["build_graph", "graph_version"]
