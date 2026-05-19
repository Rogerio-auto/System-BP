"""Nó persist_state — persiste o snapshot do estado do turno no backend.

Responsabilidade (doc 06 §5.2):
    Chamar ``PUT /internal/conversations/:id/state`` (implementado em F3-S02)
    com o snapshot serializado do estado atual, para que o próximo turno
    possa carregar o estado via ``load_state``.

Contrato:
    - Toda chamada HTTP usa ``InternalApiClient._request`` com método PUT
      (header ``X-Internal-Token`` injetado automaticamente).
    - Falha no backend → registra erro em ``errors`` e ativa ``handoff_required``.
    - Nunca acessa Postgres diretamente.

Endpoint chamado: ``PUT /internal/conversations/{conversation_id}/state``
    Body: ``{ "state": <snapshot_serializado> }``
    200 → sucesso
    4xx/5xx → erro registrado + handoff

LGPD (doc 17 §8.3 / §8.4):
    O estado persistido passa pela serialização canônica (``serialize_state``)
    que trunca ``messages`` mas não faz mascaramento de PII — dados pessoais
    (nome, cidade) são necessários para continuidade da conversa e são
    protegidos em repouso pela criptografia do Postgres (pgcrypto) gerenciada
    pelo backend Node. Nenhum dado de terceiro é introduzido aqui.
"""
from __future__ import annotations

import time
from typing import Any

import httpx
import structlog

from app.graphs.whatsapp_pre_attendance.state import (
    ConversationState,
    serialize_state,
)
from app.tools._base import InternalApiClient

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)


async def persist_state(state: ConversationState) -> dict[str, Any]:
    """Nó LangGraph: salva o estado corrente do grafo no backend.

    Serializa o ``ConversationState`` via ``serialize_state`` (com truncamento
    de messages, doc 06 §8) e faz ``PUT /internal/conversations/:id/state``.

    Em caso de erro HTTP ou timeout, registra o erro em ``errors`` e
    ativa ``handoff_required=True`` para que o backend saiba que este turno
    não foi persistido corretamente.

    Args:
        state: Estado atual do grafo (deve ter ``conversation_id``).

    Returns:
        Dict com campos atualizados:
        - ``tool_results``: com entrada do resultado de persist_state.
        - ``errors``: com entrada de erro (somente em falha).
        - ``handoff_required``: True somente em erro irrecuperável.
        - ``handoff_reason``: descrição do erro (somente em falha).
    """
    start_ns = time.monotonic_ns()
    conversation_id: str = state.get("conversation_id", "")
    lead_id: str | None = state.get("lead_id")

    if not conversation_id:
        log.error("persist_state_missing_conversation_id")
        errors: list[dict[str, Any]] = list(state.get("errors") or [])
        errors.append(
            {
                "node": "persist_state",
                "error": "MISSING_CONVERSATION_ID",
                "message": "conversation_id ausente — estado não pode ser persistido.",
            }
        )
        return {
            "errors": errors,
            "handoff_required": True,
            "handoff_reason": "persist_state: conversation_id ausente.",
        }

    # Serializa com truncamento de messages (doc 06 §8)
    snapshot: dict[str, Any] = serialize_state(state)

    client = InternalApiClient()
    path = f"/internal/conversations/{conversation_id}/state"

    try:
        # InternalApiClient._request aceita qualquer método HTTP; PUT não tem
        # método público dedicado ainda, mas o mecanismo interno é idêntico.
        await client._request("PUT", path, json={"state": snapshot})
        latency_ms = (time.monotonic_ns() - start_ns) // 1_000_000

        log.info(
            "persist_state_ok",
            conversation_id=conversation_id,
            lead_id=lead_id,
            latency_ms=latency_ms,
        )

        tool_results: list[dict[str, Any]] = list(state.get("tool_results") or [])
        tool_results.append(
            {
                "node": "persist_state",
                "status": "ok",
                "latency_ms": latency_ms,
            }
        )
        return {"tool_results": tool_results}

    except httpx.HTTPStatusError as exc:
        latency_ms = (time.monotonic_ns() - start_ns) // 1_000_000
        error_entry: dict[str, Any] = {
            "node": "persist_state",
            "error": "BACKEND_ERROR",
            "status_code": exc.response.status_code,
            "message": str(exc),
            "latency_ms": latency_ms,
        }
        errors = list(state.get("errors") or [])
        errors.append(error_entry)
        log.error(
            "persist_state_backend_error",
            conversation_id=conversation_id,
            status_code=exc.response.status_code,
            latency_ms=latency_ms,
        )
        return {
            "errors": errors,
            "handoff_required": True,
            "handoff_reason": f"persist_state: backend error {exc.response.status_code}",
        }

    except httpx.TimeoutException as exc:
        latency_ms = (time.monotonic_ns() - start_ns) // 1_000_000
        error_entry = {
            "node": "persist_state",
            "error": "TIMEOUT",
            "message": f"Timeout ao persistir estado: {exc}",
            "latency_ms": latency_ms,
        }
        errors = list(state.get("errors") or [])
        errors.append(error_entry)
        log.error(
            "persist_state_timeout",
            conversation_id=conversation_id,
            latency_ms=latency_ms,
        )
        return {
            "errors": errors,
            "handoff_required": True,
            "handoff_reason": "persist_state: timeout ao salvar estado.",
        }


__all__ = ["persist_state"]
