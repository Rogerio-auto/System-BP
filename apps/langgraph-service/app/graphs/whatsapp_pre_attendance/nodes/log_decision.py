"""Nó log_decision — agrega e persiste os dados de decisão do turno.

Responsabilidade (doc 06 §5.2 + §7.9):
    Último nó da pipeline. Coleta os metadados de LLM acumulados em
    ``tool_results`` durante o turno e chama a tool ``log_ai_decision``
    (F3-S19) para persistir em ``ai_decision_logs`` via backend Node.

Dados agregados (doc 06 §7.9):
    - ``node_name``: nome do nó mais relevante do turno (ex.: ``"classify_intent"``).
    - ``intent``: intenção classificada no turno.
    - ``prompt_key`` / ``prompt_version``: versão do prompt usado.
    - ``model``: identificador do modelo LLM via OpenRouter.
    - ``tokens_in`` / ``tokens_out``: consumo de tokens.
    - ``latency_ms``: latência total do LLM.
    - ``decision``: dict estruturado com dados do turno (sem PII).

``organization_id`` é obtido do contexto structlog (propagado pelo handler HTTP).
``correlation_id`` é obtido do contexto structlog (propagado pelo handler HTTP).

LGPD (doc 17 §3.4 / §8.4):
    O campo ``decision`` NUNCA deve conter PII bruta (CPF, RG, nome completo,
    document_number). Somente IDs internos opacos, intenções classificadas,
    dados de fluxo e dados financeiros (valor, prazo) são permitidos.
    Este nó é responsável por garantir isso antes de chamar ``log_ai_decision``.
"""
from __future__ import annotations

import time
import uuid
from typing import Any

import structlog

from app.graphs.whatsapp_pre_attendance.state import ConversationState
from app.tools.audit_tools import LogAiDecisionInput, log_ai_decision

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

# Fallback quando organization_id nao esta no contexto structlog
# F16-S46 BUG-B: organization_id "unknown" nao e UUID -- gera 400 no backend.
# Fallback e apenas para compatibilidade com grafo legado (flag OFF).
# No path agentico, organization_id sempre vem do state (F16-S35).
_UNKNOWN_ORG = "unknown"


def _get_context_str(key: str, fallback: str) -> str:
    """Lê uma string do contexto structlog; retorna fallback se ausente."""
    ctx = structlog.contextvars.get_contextvars()
    raw = ctx.get(key)
    if isinstance(raw, str) and raw.strip():
        return raw
    return fallback


def _aggregate_llm_metadata(
    tool_results: list[dict[str, Any]],
) -> dict[str, Any]:
    """Extrai e agrega metadados de LLM de ``tool_results`` do turno.

    Percorre os resultados em ordem e coleta o primeiro resultado de nó que
    tenha chamado LLM (possui ``prompt_key``). Se mais de um nó usou LLM,
    agrega tokens e latências.

    Args:
        tool_results: Lista de resultados acumulados no turno.

    Returns:
        Dict com os campos agregados:
        ``node_name``, ``intent``, ``prompt_key``, ``prompt_version``,
        ``model``, ``tokens_in``, ``tokens_out``, ``latency_ms``.
    """
    node_name: str = "log_decision"
    intent: str | None = None
    prompt_key: str | None = None
    prompt_version: str | None = None
    model: str | None = None
    total_tokens_in: int = 0
    total_tokens_out: int = 0
    total_latency_ms: float = 0.0

    for result in tool_results:
        # Nós que chamam LLM registram prompt_key em tool_results
        if "prompt_key" in result:
            if node_name == "log_decision":
                # Primeiro nó com LLM — usa como referência principal
                node_name = str(result.get("node", "unknown"))
            if prompt_key is None:
                prompt_key = str(result["prompt_key"])
            if prompt_version is None and "prompt_version" in result:
                prompt_version = str(result["prompt_version"])
            if intent is None and "intent" in result:
                intent = str(result["intent"])
            if model is None and "model" in result:
                model = str(result["model"])
            # Acumula tokens e latência quando presentes
            total_tokens_in += int(result.get("tokens_in", 0) or 0)
            total_tokens_out += int(result.get("tokens_out", 0) or 0)
            total_latency_ms += float(result.get("latency_ms", 0.0) or 0.0)

    return {
        "node_name": node_name,
        "intent": intent,
        "prompt_key": prompt_key,
        "prompt_version": prompt_version,
        "model": model,
        "tokens_in": total_tokens_in if total_tokens_in > 0 else None,
        "tokens_out": total_tokens_out if total_tokens_out > 0 else None,
        "latency_ms": round(total_latency_ms) if total_latency_ms > 0 else None,
    }


def _build_decision_payload(state: ConversationState) -> dict[str, object]:
    """Monta o dict ``decision`` sem PII bruta (LGPD doc 17 §3.4 / §8.4).

    Inclui apenas IDs internos opacos, intenções classificadas, dados de fluxo
    e dados financeiros. Nunca inclui CPF, RG, nome completo, telefone ou
    qualquer identificador pessoal bruto.

    Args:
        state: Estado atual do grafo.

    Returns:
        Dict seguro para persistência em ``ai_decision_logs.decision``.
    """
    return {
        # IDs internos opacos (não são PII)
        "lead_id": state.get("lead_id"),
        "city_id": state.get("city_id"),
        "selected_product_id": state.get("selected_product_id"),
        "last_simulation_id": state.get("last_simulation_id"),
        # Dados de fluxo
        "current_intent": state.get("current_intent"),
        "current_stage": state.get("current_stage"),
        "handoff_required": state.get("handoff_required", False),
        "handoff_reason": state.get("handoff_reason"),
        "missing_fields": state.get("missing_fields") or [],
        # Dados financeiros (permitidos por doc 17 §8.4)
        "requested_amount": state.get("requested_amount"),
        "requested_term_months": state.get("requested_term_months"),
        # Erros acumulados no turno
        "errors_count": len(state.get("errors") or []),
    }


async def log_decision(state: ConversationState) -> dict[str, Any]:
    """Nó LangGraph: agrega dados do turno e persiste em ``ai_decision_logs``.

    Coleta metadados de LLM de ``tool_results``, monta o payload sem PII e
    chama ``log_ai_decision`` (F3-S19). Erros são logados mas não propagam
    handoff — a pipeline já terminou; a falha de logging não deve interromper
    o fluxo do cliente.

    Args:
        state: Estado atual do grafo.

    Returns:
        Dict com ``tool_results`` atualizado com o resultado do log.
    """
    start_ns = time.monotonic_ns()
    conversation_id: str = state.get("conversation_id", "")
    lead_id: str | None = state.get("lead_id")

    # F16-S35: prefere organization_id do state (fonte confiavel do request);
    # cai no contexto structlog apenas como fallback (compatibilidade com grafo legado).
    organization_id = (
        state.get("organization_id")
        or _get_context_str("organization_id", _UNKNOWN_ORG)
    )
    # F16-S46/S48 BUG-B: correlationId DEVE ser UUID valido (Zod .uuid() no backend).
    # O correlation_id do contexto structlog e "livechat_msg_<uuid>" (NAO e UUID puro),
    # entao so o usamos se for UUID valido; senao preferimos conversation_id (UUID
    # garantido pelo inbound schema), com uuid4() como ultimo recurso. Isso espelha o
    # agent_turn (que ja usa conversation_id) e evita o 400 "correlationId deve ser UUID".
    def _as_uuid_or_none(v: str) -> str | None:
        try:
            return str(uuid.UUID(v))
        except (ValueError, AttributeError, TypeError):
            return None

    correlation_id = (
        _as_uuid_or_none(_get_context_str("correlation_id", ""))
        or _as_uuid_or_none(conversation_id)
        or str(uuid.uuid4())
    )

    tool_results: list[dict[str, Any]] = list(state.get("tool_results") or [])

    # Agrega metadados de LLM acumulados no turno
    llm_meta = _aggregate_llm_metadata(tool_results)

    # Monta payload de decisão (sem PII)
    decision_payload = _build_decision_payload(state)

    # Verifica erros do turno para preencher campo error
    errors: list[dict[str, Any]] = list(state.get("errors") or [])
    error_summary: str | None = None
    if errors:
        last_error = errors[-1]
        error_summary = f"{last_error.get('node', 'unknown')}: {last_error.get('error', 'error')}"

    try:
        # F16-S46 BUG-B: construcao do input dentro do try para capturar
        # ValidationError (ex: conversation_id vazio) sem propagar handoff.
        # Log_decision failure nunca deve interromper o fluxo do cliente.
        inp = LogAiDecisionInput(
            organization_id=organization_id,
            conversation_id=conversation_id,
            lead_id=lead_id,
            node_name=llm_meta["node_name"],
            intent=llm_meta["intent"],
            prompt_key=llm_meta["prompt_key"],
            prompt_version=llm_meta["prompt_version"],
            model=llm_meta["model"],
            tokens_in=llm_meta["tokens_in"],
            tokens_out=llm_meta["tokens_out"],
            latency_ms=llm_meta["latency_ms"],
            decision=decision_payload,
            error=error_summary,
            correlation_id=correlation_id,
        )
        output = await log_ai_decision(inp)
        latency_ms = (time.monotonic_ns() - start_ns) // 1_000_000

        log.info(
            "log_decision_ok",
            conversation_id=conversation_id,
            lead_id=lead_id,
            decision_log_id=output.decision_log_id,
            node_name=llm_meta["node_name"],
            intent=llm_meta["intent"],
            latency_ms=latency_ms,
        )

        tool_results_updated = [
            *tool_results,
            {
                "node": "log_decision",
                "decision_log_id": output.decision_log_id,
                "status": "ok",
                "latency_ms": latency_ms,
            },
        ]
        return {"tool_results": tool_results_updated}

    except Exception as exc:
        latency_ms = (time.monotonic_ns() - start_ns) // 1_000_000
        log.error(
            "log_decision_error",
            conversation_id=conversation_id,
            lead_id=lead_id,
            error=str(exc),
            latency_ms=latency_ms,
        )
        # Logging failure não deve gerar handoff — pipeline já concluída.
        # Registra em tool_results para rastreabilidade.
        tool_results_updated = [
            *tool_results,
            {
                "node": "log_decision",
                "status": "error",
                "error": str(exc),
                "latency_ms": latency_ms,
            },
        ]
        return {"tool_results": tool_results_updated}


__all__ = ["log_decision"]
