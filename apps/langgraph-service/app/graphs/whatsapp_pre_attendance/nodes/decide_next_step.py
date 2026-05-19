"""Nó decide_next_step — avalia o estado e define a rota de saída do grafo.

Roteamento (doc 06 §5.3):
    - ``continue``  — volta para classify_intent (conversa prossegue).
    - ``handoff``   — transfere para atendente humano.
    - ``end``       — encerra a conversa.

Regras de disparo de handoff:
    1. ``handoff_required=True`` no estado (outro nó já sinalizou).
    2. ``current_intent`` em {"falar_atendente", "consultar_andamento",
       "cobranca", "reclamacao"}.
    3. ``nao_entendi`` por 3 ou mais vezes consecutivas (contador baseado
       em ``tool_results`` — sem adicionar campo ao state).

Regra de encerramento:
    - ``current_intent == "fora_de_escopo"`` sem sinalização de handoff.

Restrições:
    - Função pura: (state) -> dict. Sem chamadas HTTP, sem I/O.
    - Logs estruturados via structlog.
    - Em qualquer dúvida → ``continue`` (mais seguro que encerrar).
"""
from __future__ import annotations

import time
from typing import Any, Literal

import structlog

from app.graphs.whatsapp_pre_attendance.state import ConversationState

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------

RouteDecision = Literal["continue", "handoff", "end"]

#: Intenções que disparam handoff imediato (doc 06 §5.3).
_HANDOFF_INTENTS: frozenset[str] = frozenset(
    {"falar_atendente", "consultar_andamento", "cobranca", "reclamacao"}
)

#: Número máximo de tentativas de ``nao_entendi`` antes de handoff (doc 06 §5.3).
_MAX_NAO_ENTENDI: int = 3

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _count_nao_entendi(tool_results: list[dict[str, Any]]) -> int:
    """Conta quantas vezes ``decide_next_step`` registrou ``nao_entendi`` consecutivo.

    O contador é derivado de ``tool_results`` — nenhum campo extra é adicionado ao
    estado. Cada vez que este nó roteia com intent ``nao_entendi`` e route
    ``continue``, um entry é appended. O total dessas entradas é o contador.

    Args:
        tool_results: Lista acumulada de resultados de ferramentas/nós do turno.

    Returns:
        Número de vezes que ``decide_next_step`` registrou ``nao_entendi``.
    """
    return sum(
        1
        for tr in tool_results
        if tr.get("node") == "decide_next_step" and tr.get("intent") == "nao_entendi"
    )


def _decide_route(state: ConversationState) -> tuple[RouteDecision, str]:
    """Aplica as regras de roteamento e retorna (route, reason).

    Args:
        state: Estado atual do grafo.

    Returns:
        Tupla ``(route, reason)`` onde ``reason`` é uma string descritiva
        para fins de log e auditoria.
    """
    intent: str | None = state.get("current_intent")
    handoff_required: bool = state.get("handoff_required", False)
    tool_results: list[dict[str, Any]] = state.get("tool_results", [])

    # Regra 1: outro nó já sinalizou handoff_required=True
    if handoff_required:
        reason = state.get("handoff_reason") or "handoff_required sinalizado por nó anterior"
        return "handoff", reason

    # Regra 2: intenção de handoff imediato
    if intent in _HANDOFF_INTENTS:
        return "handoff", f"intent={intent}"

    # Regra 3: nao_entendi com excesso de tentativas (doc 06 §5.3: após 3 → handoff)
    if intent == "nao_entendi":
        count = _count_nao_entendi(tool_results)
        # ``count`` é o número de nao_entendi JÁ registrados em tool_results.
        # O turno corrente é a tentativa (count + 1).
        # Quando count >= _MAX_NAO_ENTENDI - 1 o turno atual é a 3ª (ou além) → handoff.
        current_attempt = count + 1
        if count >= _MAX_NAO_ENTENDI - 1:
            return (
                "handoff",
                f"nao_entendi repetido {current_attempt} vezes (limite={_MAX_NAO_ENTENDI})",
            )
        return "continue", f"nao_entendi (tentativa {current_attempt}/{_MAX_NAO_ENTENDI})"

    # Regra 4: fora de escopo → encerra (sem handoff)
    if intent == "fora_de_escopo":
        return "end", "intent=fora_de_escopo"

    # Padrão: continua (intenção válida ou None — state incompleto)
    return "continue", f"intent={intent}"


# ---------------------------------------------------------------------------
# Nó principal
# ---------------------------------------------------------------------------


async def decide_next_step(state: ConversationState) -> dict[str, Any]:
    """Nó LangGraph: avalia o estado e define a rota de saída da conversa.

    Função pura — nenhuma chamada HTTP é realizada.
    O roteamento real (via edges condicionais) é feito pelo grafo com base em
    ``state["next_route"]`` (campo temporário de roteamento) ou interpretando
    ``handoff_required`` / ``current_stage``.

    Esta função grava em ``tool_results`` o registro do decision para auditoria
    (campo ``route``) e atualiza ``current_stage``.

    Args:
        state: Estado atual do grafo (parcial — total=False).

    Returns:
        Dict com os campos atualizados:
        - ``current_stage``: stage atualizado para ``"deciding"``.
        - ``handoff_required``: True quando rota for ``handoff``.
        - ``handoff_reason``: razão do handoff quando ``handoff_required=True``.
        - ``tool_results``: entry adicionado com ``node``, ``route``, ``intent``, ``reason``.
    """
    start = time.monotonic()
    conversation_id: str = state.get("conversation_id", "")
    lead_id: str | None = state.get("lead_id")
    intent: str | None = state.get("current_intent")

    route, reason = _decide_route(state)

    latency_ms = (time.monotonic() - start) * 1000

    log.info(
        "decide_next_step",
        conversation_id=conversation_id,
        lead_id=lead_id,
        intent=intent,
        route=route,
        reason=reason,
        latency_ms=round(latency_ms, 2),
    )

    tool_results: list[dict[str, Any]] = list(state.get("tool_results", []))
    tool_results.append(
        {
            "node": "decide_next_step",
            "route": route,
            "intent": intent,
            "reason": reason,
            "latency_ms": round(latency_ms, 2),
        }
    )

    update: dict[str, Any] = {
        "current_stage": "deciding",
        "tool_results": tool_results,
    }

    if route == "handoff":
        update["handoff_required"] = True
        # Preserve existing handoff_reason if already set; otherwise use our reason.
        existing_reason: str | None = state.get("handoff_reason")
        update["handoff_reason"] = existing_reason or reason

    return update


__all__ = ["RouteDecision", "decide_next_step"]
