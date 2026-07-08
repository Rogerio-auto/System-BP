"""Grafo internal_assistant (F6-S07) -- copiloto interno read-only.

Stateless: nenhuma persistencia em DB (sem checkpointer).
Principal obrigatoriamente injetado pelo caller via state (nunca inferido).
"""
from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from app.graphs.internal_assistant.nodes.agent_node import agent_node
from app.graphs.internal_assistant.state import InternalAssistantState


def build_internal_assistant_graph() -> StateGraph[InternalAssistantState]:
    """Constroi o grafo do copiloto interno (nao compilado).

    Topologia:
        START -> agent_node -> END

    O loop de tool-calling vive DENTRO do agent_node (padrao stateless).
    O caller e responsavel por compilar: build_internal_assistant_graph().compile().
    """
    builder: StateGraph[InternalAssistantState] = StateGraph(InternalAssistantState)
    builder.add_node("agent_node", agent_node)
    builder.add_edge(START, "agent_node")
    builder.add_edge("agent_node", END)
    return builder


__all__ = ["build_internal_assistant_graph"]
