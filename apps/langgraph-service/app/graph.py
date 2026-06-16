"""Roteamento e integração do nó lawyer_handoff nos grafos LangGraph.

Expõe ``should_lawyer_handoff`` — função de roteamento condicional que determina
se a conversa deve ser direcionada ao fluxo D17 de encaminhamento ao escritório.

Uso no grafo whatsapp_pre_attendance (ou qualquer grafo que implemente cobrança):

    from app.graph import should_lawyer_handoff
    from app.nodes.lawyer_handoff_node import lawyer_handoff_node

    graph.add_node("lawyer_handoff", lawyer_handoff_node_wrapper)
    graph.add_conditional_edges(
        "load_conversation_state",
        should_lawyer_handoff,
        {
            "lawyer_handoff": "lawyer_handoff",
            "continue": <próximo_nó_normal>,
        },
    )

A verificação de elegibilidade real é feita DENTRO do nó ``lawyer_handoff_node``
(turno 1) via ``check_law_firm_status``. A função de roteamento aqui é um
guarda leve baseado em sinalização de estado — o nó verifica elegibilidade no
backend e retorna vazio (reply="") para inelegíveis, permitindo que o orquestrador
continue o fluxo normal.

Regra de ativação (doc F19 §D17):
  - Intent ``cobranca`` OU sinalização ``lawyer_handoff_eligible`` no estado.
  - O backend já filtra feature flag e cooldown via GET /internal/law-firm-status.
"""
from __future__ import annotations

from typing import Any

import structlog

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

# Intenções que podem acionar o fluxo de encaminhamento ao escritório
_LAWYER_HANDOFF_INTENTS: frozenset[str] = frozenset({"cobranca"})


def should_lawyer_handoff(state: dict[str, Any]) -> str:
    """Roteamento condicional: verifica se a conversa deve entrar no fluxo D17.

    Baseado na intenção classificada e/ou na sinalização explícita de elegibilidade
    no estado. A verificação definitiva de elegibilidade é feita pelo próprio nó
    ``lawyer_handoff_node`` no turno 1 (via backend).

    Args:
        state: Estado atual do grafo (dict compatível com ConversationState).

    Returns:
        ``"lawyer_handoff"`` → direcionar para o nó lawyer_handoff_node.
        ``"continue"``       → seguir o fluxo normal do grafo.
    """
    intent: str | None = state.get("current_intent")
    explicit_flag: bool = bool(state.get("lawyer_handoff_eligible", False))

    if explicit_flag or intent in _LAWYER_HANDOFF_INTENTS:
        log.info(
            "should_lawyer_handoff_route",
            decision="lawyer_handoff",
            intent=intent,
            explicit_flag=explicit_flag,
            conversation_id=state.get("conversation_id"),
        )
        return "lawyer_handoff"

    log.info(
        "should_lawyer_handoff_route",
        decision="continue",
        intent=intent,
        conversation_id=state.get("conversation_id"),
    )
    return "continue"


__all__ = ["should_lawyer_handoff"]
