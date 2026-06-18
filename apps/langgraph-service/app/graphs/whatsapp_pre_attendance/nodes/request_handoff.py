"""Nó request_handoff — cria handoff + nota interna no Chatwoot.

Responsabilidades (doc 06 §5.2 / §7.4 / §7.5):
    1. Gerar o ``summary`` formatado com dados de contexto da conversa.
    2. Chamar a tool ``request_handoff`` → ``POST /internal/handoffs``.
    3. Chamar a tool ``create_chatwoot_note`` → ``POST /internal/chatwoot/notes``.
    4. Gravar ``handoff_required=True`` e ``handoff_reason`` no estado.

Formato do summary (doc 06 §7.4):
    "Cliente <nome|Desconhecido>, <cidade|cidade não identificada>,
    deseja <amount> em <term> meses. <Simulação #<id> gerada. |>
    Motivo da transferência: <reason>."

Restrições (LGPD doc 17):
    - CPF NUNCA em texto plano no summary, razão ou nota.
    - Apenas nome (já coletado com consentimento) e dados de crédito são incluídos.

Restrições de arquitetura:
    - Nunca acessa Postgres diretamente.
    - Em falha das tools, gravar erro no estado e retornar handoff_required=True
      (o grafo deve persistir o estado e encerrar o turno com segurança).
"""
from __future__ import annotations

import time
from typing import Any

import structlog

import app.tools.chatwoot_tools as _chatwoot_tools
from app.graphs.whatsapp_pre_attendance.state import ConversationState
from app.tools._base import InternalApiClient
from app.tools.chatwoot_tools import (
    ChatwootNoteInput,
    HandoffInput,
    create_chatwoot_note,
)

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

# Alias para evitar shadowing do nome da função do nó
_request_handoff_tool = _chatwoot_tools.request_handoff

# ---------------------------------------------------------------------------
# Helper: geração de summary
# ---------------------------------------------------------------------------


def _build_summary(state: ConversationState, reason: str) -> str:
    """Gera o summary no formato canônico definido em doc 06 §7.4.

    Nunca inclui CPF ou dados sensíveis em texto plano (LGPD doc 17).

    Args:
        state: Estado atual do grafo.
        reason: Razão humano-legível da transferência.

    Returns:
        String de resumo pronta para o atendente.

    Example::

        "Cliente Maria Silva, Porto Velho, deseja R$ 5.000,00 em 12 meses.
        Simulação #abc gerada. Motivo da transferência: cliente_solicitou_atendente."
    """
    name: str = state.get("customer_name") or "Desconhecido"
    city: str = state.get("city_name") or "cidade não identificada"

    # Dados de crédito — opcionais
    amount: float | None = state.get("requested_amount")
    term: int | None = state.get("requested_term_months")
    sim_id: str | None = state.get("last_simulation_id")

    credit_part = ""
    if amount is not None and term is not None:
        # Formato BRL sem símbolo de moeda na string para evitar encoding issues
        amount_fmt = f"R$ {amount:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
        credit_part = f", deseja {amount_fmt} em {term} meses"

    sim_part = ""
    if sim_id:
        sim_part = f" Simulação #{sim_id} gerada."

    summary = (
        f"Cliente {name}, {city}{credit_part}.{sim_part}"
        f" Motivo da transferência: {reason}."
    )
    return summary


def _build_note_body(summary: str, intent: str | None) -> str:
    """Formata o corpo da nota interna em markdown para o Chatwoot.

    Args:
        summary: Resumo gerado por ``_build_summary``.
        intent: Intenção classificada no último turno, para contexto.

    Returns:
        String markdown pronta para ``create_chatwoot_note``.
    """
    intent_line = f"**Intenção detectada:** `{intent}`\n\n" if intent else ""
    return (
        "## Transferência via IA — Pré-atendimento\n\n"
        f"{intent_line}"
        f"**Resumo:** {summary}\n\n"
        "_Esta nota foi gerada automaticamente pelo assistente de pré-atendimento._"
    )


# ---------------------------------------------------------------------------
# Nó principal
# ---------------------------------------------------------------------------


async def request_handoff(
    state: ConversationState,
    *,
    client: InternalApiClient | None = None,
) -> dict[str, Any]:
    """Nó LangGraph: cria handoff e nota interna no Chatwoot.

    Chama sequencialmente:
    1. ``request_handoff`` tool → ``POST /internal/handoffs``.
    2. ``create_chatwoot_note`` tool → ``POST /internal/chatwoot/notes``.

    Em caso de falha em qualquer chamada, o erro é acumulado em ``errors``
    e ``handoff_required=True`` é mantido/setado. O grafo deve encerrar o
    turno e persistir o estado para retry manual.

    Args:
        state: Estado atual do grafo (parcial — total=False).
        client: Instância de ``InternalApiClient`` (injetável em testes).
                Se ``None``, cria uma instância padrão.

    Returns:
        Dict com os campos atualizados:
        - ``handoff_required``: True (sempre).
        - ``handoff_reason``: razão da transferência.
        - ``current_stage``: ``"handoff_requested"``.
        - ``tool_results``: entradas das duas tools chamadas.
        - ``errors``: erros acumulados (vazio em caminho feliz).
    """
    start = time.monotonic()
    conversation_id: str = state.get("conversation_id", "")
    chatwoot_conversation_id: str = state.get("chatwoot_conversation_id", "")
    lead_id: str | None = state.get("lead_id")
    organization_id: str = state.get("organization_id", "")
    intent: str | None = state.get("current_intent")
    sim_id: str | None = state.get("last_simulation_id")

    # Razão da transferência — pode vir do estado ou derivada da intenção
    reason: str = (
        state.get("handoff_reason")
        or (f"intent={intent}" if intent else "ai_decision")
    )

    summary = _build_summary(state, reason)
    note_body = _build_note_body(summary, intent)

    _client = client or InternalApiClient()
    tool_results: list[dict[str, Any]] = list(state.get("tool_results", []))
    errors: list[dict[str, Any]] = list(state.get("errors", []))

    handoff_id: str | None = None

    # ------------------------------------------------------------------
    # 1. Criar handoff
    # ------------------------------------------------------------------
    try:
        if not lead_id:
            # F9-S10 MEDIUM: mensagem contextual em modo dry-run (playground sintético).
            # No caminho de produção, lead_id SEMPRE existe porque o nó identify_lead
            # foi executado antes. No playground sem lead_id, a mensagem genérica
            # é confusa — substituímos por uma mensagem orientativa para o operador.
            if state.get("dry_run") is True:
                raise ValueError(
                    "Modo sintético sem lead identificado — em produção o lead seria "
                    "criado antes do handoff. Para testar handoff completo, selecione "
                    "um lead real no playground."
                )
            raise ValueError("lead_id ausente — handoff requer lead identificado")

        handoff_input = HandoffInput(
            lead_id=lead_id,
            chatwoot_conversation_id=chatwoot_conversation_id,
            organization_id=organization_id,
            reason=reason,
            summary=summary,
            simulation_id=sim_id,
        )
        handoff_output = await _request_handoff_tool(handoff_input, client=_client)
        handoff_id = handoff_output.handoff_id

        log.info(
            "node_request_handoff_created",
            conversation_id=conversation_id,
            lead_id=lead_id,
            handoff_id=handoff_id,
            reason=reason,
        )

        tool_results.append(
            {
                "node": "request_handoff",
                "tool": "request_handoff",
                "handoff_id": handoff_id,
                "status": handoff_output.status,
                "reason": reason,
            }
        )

    except Exception as exc:
        latency_ms = (time.monotonic() - start) * 1000
        log.error(
            "node_request_handoff_tool_error",
            conversation_id=conversation_id,
            lead_id=lead_id,
            error=str(exc),
            latency_ms=round(latency_ms, 2),
        )
        errors.append(
            {
                "node": "request_handoff",
                "tool": "request_handoff",
                "error": str(exc),
                "latency_ms": round(latency_ms, 2),
            }
        )

    # ------------------------------------------------------------------
    # 2. Criar nota interna no Chatwoot
    # ------------------------------------------------------------------
    try:
        note_input = ChatwootNoteInput(
            chatwoot_conversation_id=chatwoot_conversation_id,
            body=note_body,
        )
        note_output = await create_chatwoot_note(note_input, client=_client)

        log.info(
            "node_request_handoff_note_created",
            conversation_id=conversation_id,
            chatwoot_conversation_id=chatwoot_conversation_id,
            note_id=note_output.note_id,
        )

        tool_results.append(
            {
                "node": "request_handoff",
                "tool": "create_chatwoot_note",
                "note_id": note_output.note_id,
                "chatwoot_conversation_id": chatwoot_conversation_id,
            }
        )

    except Exception as exc:
        latency_ms = (time.monotonic() - start) * 1000
        log.error(
            "node_request_handoff_note_error",
            conversation_id=conversation_id,
            chatwoot_conversation_id=chatwoot_conversation_id,
            error=str(exc),
            latency_ms=round(latency_ms, 2),
        )
        errors.append(
            {
                "node": "request_handoff",
                "tool": "create_chatwoot_note",
                "error": str(exc),
                "latency_ms": round(latency_ms, 2),
            }
        )

    total_latency_ms = (time.monotonic() - start) * 1000

    log.info(
        "node_request_handoff_done",
        conversation_id=conversation_id,
        lead_id=lead_id,
        handoff_id=handoff_id,
        errors_count=len(errors),
        latency_ms=round(total_latency_ms, 2),
    )

    return {
        "handoff_required": True,
        "handoff_reason": reason,
        "current_stage": "handoff_requested",
        "tool_results": tool_results,
        "errors": errors,
    }


__all__ = ["request_handoff"]
