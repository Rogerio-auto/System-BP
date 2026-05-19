"""Funções de roteamento condicional do grafo whatsapp_pre_attendance.

Todas as funções são puras — recebem ConversationState e retornam uma string
literal que identifica o próximo nó (ou END). Nenhuma chamada HTTP ou I/O.

Roteamento canônico (doc 06 §5.3):

    classify_intent
       ├─ saudacao / quer_credito / quer_simular / enviar_documentos
       │       → identify_or_create_lead
       ├─ falar_atendente / consultar_andamento / cobranca / reclamacao
       │       → request_handoff
       ├─ nao_entendi → send_response
       └─ fora_de_escopo → send_response

    identify_or_create_lead
       ├─ nome ausente  → collect_missing_profile_data
       └─ nome presente → identify_city

    collect_missing_profile_data → identify_city

    identify_city
       ├─ city_id presente (confidence >= 0.85) → qualify_credit_interest
       └─ city_id ausente  (pede confirmação)   → send_response

    decide_next_step
       ├─ handoff   → request_handoff
       ├─ continue  → classify_intent
       └─ end       → send_response

    Todos terminam em:  persist_state → log_decision → END
"""
from __future__ import annotations

from typing import Any

import structlog

from app.graphs.whatsapp_pre_attendance.state import ConversationState

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Literais de destino (nomes dos nós — devem bater com os add_node em graph.py)
# ---------------------------------------------------------------------------

_NODE_IDENTIFY_LEAD = "identify_or_create_lead"
_NODE_COLLECT_PROFILE = "collect_missing_profile_data"
_NODE_IDENTIFY_CITY = "identify_city"
_NODE_QUALIFY = "qualify_credit_interest"
_NODE_SEND_RESPONSE = "send_response"
_NODE_REQUEST_HANDOFF = "request_handoff"
_NODE_CLASSIFY = "classify_intent"

# Intenções que roteiam para identify_or_create_lead (início do funil)
_LEAD_INTENTS: frozenset[str] = frozenset(
    {"saudacao", "quer_credito", "quer_simular", "enviar_documentos"}
)

# Intenções que disparam handoff imediato (doc 06 §5.3)
_HANDOFF_INTENTS: frozenset[str] = frozenset(
    {"falar_atendente", "consultar_andamento", "cobranca", "reclamacao"}
)


# ---------------------------------------------------------------------------
# route_by_intent — saída de classify_intent
# ---------------------------------------------------------------------------


def route_by_intent(state: ConversationState) -> str:
    """Roteia a saída de ``classify_intent`` para o próximo nó.

    Regras (doc 06 §5.3):
    - saudacao / quer_credito / quer_simular / enviar_documentos
          → identify_or_create_lead
    - falar_atendente / consultar_andamento / cobranca / reclamacao
          → request_handoff
    - nao_entendi  → send_response (pede reformulação; counter gerenciado
                     por decide_next_step após N tentativas)
    - fora_de_escopo → send_response (mensagem padrão)
    - Qualquer outro (None / desconhecido) → send_response (fallback seguro)

    Também respeita ``handoff_required=True`` sinalizado por classify_intent
    em caso de falha irrecuperável.

    Args:
        state: Estado atual do grafo.

    Returns:
        Nome do nó destino.
    """
    # Handoff sinalizado pelo próprio nó classify_intent (falha irrecuperável)
    if state.get("handoff_required"):
        log.info(
            "route_by_intent",
            decision=_NODE_REQUEST_HANDOFF,
            reason="handoff_required_from_classify",
            intent=state.get("current_intent"),
        )
        return _NODE_REQUEST_HANDOFF

    intent: str | None = state.get("current_intent")

    if intent in _LEAD_INTENTS:
        destination = _NODE_IDENTIFY_LEAD
    elif intent in _HANDOFF_INTENTS:
        destination = _NODE_REQUEST_HANDOFF
    else:
        # nao_entendi, fora_de_escopo ou None
        destination = _NODE_SEND_RESPONSE

    log.info(
        "route_by_intent",
        intent=intent,
        decision=destination,
    )
    return destination


# ---------------------------------------------------------------------------
# route_after_lead — saída de identify_or_create_lead
# ---------------------------------------------------------------------------


def route_after_lead(state: ConversationState) -> str:
    """Roteia após ``identify_or_create_lead``.

    Regras (doc 06 §5.3):
    - Se ``handoff_required=True`` (falha da tool) → request_handoff.
    - Se ``customer_name`` ausente → collect_missing_profile_data.
    - Caso contrário → identify_city.

    Args:
        state: Estado atual do grafo.

    Returns:
        Nome do nó destino.
    """
    if state.get("handoff_required"):
        log.info("route_after_lead", decision=_NODE_REQUEST_HANDOFF, reason="handoff_required")
        return _NODE_REQUEST_HANDOFF

    customer_name: str | None = state.get("customer_name")
    if not customer_name:
        log.info("route_after_lead", decision=_NODE_COLLECT_PROFILE, reason="missing_customer_name")
        return _NODE_COLLECT_PROFILE

    log.info("route_after_lead", decision=_NODE_IDENTIFY_CITY)
    return _NODE_IDENTIFY_CITY


# ---------------------------------------------------------------------------
# route_after_city — saída de identify_city (e collect_missing_profile_data)
# ---------------------------------------------------------------------------


def route_after_city(state: ConversationState) -> str:
    """Roteia após ``identify_city``.

    Regras (doc 06 §5.3):
    - Se ``handoff_required=True`` (erro de infra) → request_handoff.
    - Se ``city_id`` presente (confidence >= 0.85 já confirmado pelo nó)
          → qualify_credit_interest.
    - Se ``city_id`` ausente (confidence < 0.85 → pergunta de confirmação
      já inserida em messages pelo nó) → send_response (entrega a pergunta).

    Args:
        state: Estado atual do grafo.

    Returns:
        Nome do nó destino.
    """
    if state.get("handoff_required"):
        log.info("route_after_city", decision=_NODE_REQUEST_HANDOFF, reason="handoff_required")
        return _NODE_REQUEST_HANDOFF

    city_id: str | None = state.get("city_id")
    if city_id:
        log.info("route_after_city", decision=_NODE_QUALIFY, city_id=city_id)
        return _NODE_QUALIFY

    # city_id ausente → baixa confiança; nó já inseriu pergunta de confirmação
    log.info(
        "route_after_city",
        decision=_NODE_SEND_RESPONSE,
        reason="city_low_confidence_confirmation_needed",
    )
    return _NODE_SEND_RESPONSE


# ---------------------------------------------------------------------------
# route_decide_next_step — saída de decide_next_step
# ---------------------------------------------------------------------------


def route_decide_next_step(state: ConversationState) -> str:
    """Roteia após ``decide_next_step``.

    Lê o último entry de ``decide_next_step`` em ``tool_results`` para
    determinar a rota escolhida pelo nó.

    Regras (doc 06 §5.3):
    - route == "handoff"  → request_handoff
    - route == "end"      → send_response (envia mensagem de encerramento)
    - route == "continue" → classify_intent (nova iteração)
    - fallback            → classify_intent (conservative)

    Args:
        state: Estado atual do grafo.

    Returns:
        Nome do nó destino.
    """
    tool_results: list[dict[str, Any]] = state.get("tool_results") or []

    # Encontra o último registro de decide_next_step (mais recente)
    route: str = "continue"
    for entry in reversed(tool_results):
        if entry.get("node") == "decide_next_step":
            route = str(entry.get("route", "continue"))
            break

    if route == "handoff":
        destination = _NODE_REQUEST_HANDOFF
    elif route == "end":
        destination = _NODE_SEND_RESPONSE
    else:
        destination = _NODE_CLASSIFY

    log.info(
        "route_decide_next_step",
        route=route,
        decision=destination,
        lead_id=state.get("lead_id"),
    )
    return destination


__all__ = [
    "route_after_city",
    "route_after_lead",
    "route_by_intent",
    "route_decide_next_step",
]
