"""Nó save_simulation — marca a simulação como enviada ao cliente.

Fluxo (doc 06 §5.2 / §5.3):
    generate_simulation → save_simulation → decide_next_step

Responsabilidades:
- Ler ``last_simulation_id`` do estado.
- Chamar ``mark_simulation_sent`` (F3-S21) para marcar a simulação como enviada.
- Registrar a ação em ``actions_emitted``.
- Em falha da tool → registrar erro e acionar handoff humano.

Restrições (doc 06 §5.6):
- Não aprova/recusa crédito.
- Não acessa Postgres diretamente.
- A operação é idempotente no backend — chamadas repetidas são seguras.
"""
from __future__ import annotations

import time
from typing import Any

import structlog

from app.graphs.whatsapp_pre_attendance.state import ConversationState
from app.tools.simulation_tools import MarkSimulationSentInput, mark_simulation_sent

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)


async def save_simulation(state: ConversationState) -> dict[str, Any]:
    """Nó LangGraph: marca a simulação como enviada ao cliente.

    Lê ``last_simulation_id`` do estado e chama ``mark_simulation_sent``.
    A operação é idempotente — reenvios com o mesmo ``simulation_id`` são
    seguros (garantia do backend). Em falha, aciona handoff humano.

    Args:
        state: Estado atual do grafo. Deve conter ``last_simulation_id``.

    Returns:
        Dict com campos atualizados: ``actions_emitted``, ``tool_results``.
        Em falha: ``handoff_required=True`` + ``handoff_reason`` + ``errors``.
    """
    t0 = time.monotonic()

    conversation_id: str = state.get("conversation_id", "")
    lead_id: str | None = state.get("lead_id")
    simulation_id: str | None = state.get("last_simulation_id")

    log.info(
        "save_simulation_start",
        conversation_id=conversation_id,
        lead_id=lead_id,
        simulation_id=simulation_id,
    )

    # --- Validação de pré-condição ---
    if simulation_id is None:
        log.warning(
            "save_simulation_missing_simulation_id",
            conversation_id=conversation_id,
            lead_id=lead_id,
        )
        # Sem simulation_id não há o que marcar — handoff para o humano resolver.
        return {
            **state,
            "handoff_required": True,
            "handoff_reason": (
                "save_simulation: last_simulation_id ausente no estado. "
                "A simulação pode não ter sido gerada com sucesso."
            ),
            "errors": [
                *list(state.get("errors") or []),
                {
                    "node": "save_simulation",
                    "error_code": "MISSING_SIMULATION_ID",
                    "message": "last_simulation_id ausente no estado.",
                },
            ],
        }

    try:
        mark_input = MarkSimulationSentInput(simulation_id=simulation_id)
        result = await mark_simulation_sent(mark_input)
    except Exception as exc:
        latency_ms = round((time.monotonic() - t0) * 1000, 1)
        log.error(
            "save_simulation_unexpected_error",
            conversation_id=conversation_id,
            lead_id=lead_id,
            simulation_id=simulation_id,
            error=str(exc),
            latency_ms=latency_ms,
        )
        return {
            **state,
            "handoff_required": True,
            # LGPD/segurança: campos persistidos no estado (jsonb) — não usar
            # str(exc) (expõe URL interna). Texto genérico + nome da exceção.
            "handoff_reason": (
                "Erro ao registrar envio da simulação. Transferindo para atendimento."
            ),
            "errors": [
                *list(state.get("errors") or []),
                {
                    "node": "save_simulation",
                    "error_code": "UNEXPECTED_ERROR",
                    "error": type(exc).__name__,
                    "latency_ms": latency_ms,
                },
            ],
        }

    latency_ms = round((time.monotonic() - t0) * 1000, 1)

    if not result.ok:
        log.warning(
            "save_simulation_tool_error",
            conversation_id=conversation_id,
            lead_id=lead_id,
            simulation_id=simulation_id,
            error_message=result.error_message,
            latency_ms=latency_ms,
        )
        return {
            **state,
            "handoff_required": True,
            "handoff_reason": (
                f"save_simulation: mark_simulation_sent retornou erro: "
                f"{result.error_message}"
            ),
            "tool_results": [
                *list(state.get("tool_results") or []),
                {
                    "node": "save_simulation",
                    "simulation_id": simulation_id,
                    "ok": False,
                    "error_message": result.error_message,
                    "latency_ms": latency_ms,
                },
            ],
            "errors": [
                *list(state.get("errors") or []),
                {
                    "node": "save_simulation",
                    "error_code": "MARK_SENT_FAILED",
                    "message": result.error_message or "mark_simulation_sent retornou ok=False.",
                },
            ],
        }

    log.info(
        "save_simulation_ok",
        conversation_id=conversation_id,
        lead_id=lead_id,
        simulation_id=simulation_id,
        latency_ms=latency_ms,
    )

    return {
        **state,
        "tool_results": [
            *list(state.get("tool_results") or []),
            {
                "node": "save_simulation",
                "simulation_id": simulation_id,
                "ok": True,
                "latency_ms": latency_ms,
            },
        ],
        "actions_emitted": [
            *list(state.get("actions_emitted") or []),
            {
                "action": "simulation_sent",
                "simulation_id": simulation_id,
                "lead_id": lead_id,
            },
        ],
    }


__all__ = ["save_simulation"]
