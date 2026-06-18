"""Nó identify_or_create_lead — garante lead_id no estado.

Chama a tool `get_or_create_lead` (F3-S13) via invocação direta (não via LLM)
e grava `lead_id`, `customer_id`, `current_stage` e `city_id` no estado.
Registra a ação em `actions_emitted`.

Em caso de falha da tool (ok=False), acrescenta um erro em `errors` e activa
`handoff_required` para escalada graciosa — a conversa não quebra silenciosamente.

Referência: doc 06 §5.2.
"""
from __future__ import annotations

import time
from typing import Any, cast

import structlog

from app.graphs.whatsapp_pre_attendance.state import ConversationState
from app.tools.leads_tools import (
    GetOrCreateLeadError,
    GetOrCreateLeadResult,
    GetOrCreateLeadSuccess,
    get_or_create_lead,
)

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Wrapper isolado para injeção/mock em testes
# ---------------------------------------------------------------------------


async def _call_get_or_create_lead(
    phone: str,
    name: str | None,
    organization_id: str | None,
    chatwoot_conversation_id: str | None,
    correlation_id: str | None,
) -> GetOrCreateLeadResult:
    """Wrapper fino sobre get_or_create_lead que permite patch em testes."""
    raw = await get_or_create_lead.ainvoke(
        {
            "phone": phone,
            "name": name,
            "source": "whatsapp",
            "organization_id": organization_id,
            "chatwoot_conversation_id": chatwoot_conversation_id,
            "correlation_id": correlation_id,
        }
    )
    return cast(GetOrCreateLeadResult, raw)


# ---------------------------------------------------------------------------
# Nó
# ---------------------------------------------------------------------------


async def identify_or_create_lead(state: ConversationState) -> ConversationState:
    """Garante que existe um lead_id válido no estado.

    Invoca `get_or_create_lead` diretamente com o telefone do estado.
    Em sucesso: preenche `lead_id`, `customer_id`, `current_stage`, `city_id`
    e registra `lead_identified` em `actions_emitted`.
    Em falha: acrescenta entrada em `errors` e activa `handoff_required`.

    Args:
        state: Estado atual do grafo. Deve conter `phone`.

    Returns:
        Novo estado com campos de lead preenchidos (ou com erro e handoff).
    """
    t0 = time.monotonic()

    phone: str = state["phone"]
    conversation_id: str = state.get("conversation_id", "")
    organization_id: str | None = state.get("organization_id")
    chatwoot_conversation_id: str | None = state.get("chatwoot_conversation_id")
    customer_name: str | None = state.get("customer_name")

    log.info(
        "identify_or_create_lead_start",
        conversation_id=conversation_id,
    )

    try:
        result = await _call_get_or_create_lead(
            phone=phone,
            name=customer_name,
            organization_id=organization_id,
            chatwoot_conversation_id=chatwoot_conversation_id,
            correlation_id=conversation_id or None,
        )
    except Exception as exc:
        log.error(
            "identify_or_create_lead_unexpected_error",
            conversation_id=conversation_id,
            error=str(exc),
        )
        errors: list[dict[str, Any]] = list(state.get("errors") or [])
        errors.append(
            {
                "node": "identify_or_create_lead",
                "error_code": "UNEXPECTED_ERROR",
                "message": str(exc),
            }
        )
        return {
            **state,
            "handoff_required": True,
            "handoff_reason": "Falha inesperada ao identificar o lead.",
            "errors": errors,
        }

    latency_ms = int((time.monotonic() - t0) * 1000)

    # --- Falha da tool ---
    if not result.ok:
        error_result = result
        assert isinstance(error_result, GetOrCreateLeadError)
        log.warning(
            "identify_or_create_lead_tool_error",
            conversation_id=conversation_id,
            error_code=error_result.error_code,
            latency_ms=latency_ms,
        )
        errors = list(state.get("errors") or [])
        errors.append(
            {
                "node": "identify_or_create_lead",
                "error_code": str(error_result.error_code),
                "message": error_result.message,
            }
        )
        return {
            **state,
            "handoff_required": True,
            "handoff_reason": (
                f"Não foi possível identificar o lead: {error_result.error_code}."
            ),
            "errors": errors,
        }

    # --- Sucesso ---
    assert isinstance(result, GetOrCreateLeadSuccess)
    success_result = result
    actions: list[dict[str, Any]] = list(state.get("actions_emitted") or [])
    actions.append(
        {
            "action": "lead_identified",
            "lead_id": success_result.lead_id,
            "created": success_result.created,
            "current_stage": success_result.current_stage,
        }
    )

    log.info(
        "identify_or_create_lead_ok",
        conversation_id=conversation_id,
        lead_id=success_result.lead_id,
        created=success_result.created,
        current_stage=success_result.current_stage,
        latency_ms=latency_ms,
    )

    # Propagar customer_name do estado (preenchido por receive_message a partir
    # do metadata do payload ou de turnos anteriores). O backend /get-or-create
    # não retorna nome por restrição LGPD §8.1 — o nome vem da coleta conversacional.
    preserved_customer_name: str | None = state.get("customer_name")

    return {
        **state,
        "lead_id": success_result.lead_id,
        "customer_id": success_result.customer_id,
        "current_stage": success_result.current_stage,
        "city_id": success_result.city_id,
        "actions_emitted": actions,
        # customer_name: explicitamente propagado para garantir que coleta anterior
        # não é perdida no merge (pegadinha F16-S36/S37).
        "customer_name": preserved_customer_name,
    }
