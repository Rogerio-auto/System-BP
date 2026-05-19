"""Endpoint POST /process/whatsapp/message — processa uma mensagem via grafo.

Contrato: doc 06 §4.1 (request) e §4.2 (response).

Fluxo:
    1. Valida o payload inbound (Pydantic v2 strict — extra="forbid").
    2. Aplica rate limit por conversation_id (doc 06 §12).
    3. Prepara estado inicial via nó ``receive_message`` (fora do grafo).
    4. Executa o grafo ``whatsapp_pre_attendance`` (``build_graph()``).
    5. Extrai reply, actions, handoff, state e metadados de LLM do estado final.
    6. Retorna ``WhatsAppMessageResponse`` (doc 06 §4.2).

Segurança / LGPD:
    - ``customer_phone`` nunca aparece em logs — só o sufixo de 4 dígitos.
    - ``correlation_id`` é propagado para o contexto structlog (rastreamento).
    - Erros internos retornam HTTP 500 com mensagem opaca; detalhes ficam em logs.
    - Rate limit retorna HTTP 429 com ``Retry-After`` header.
    - Timeout de 8 s para o grafo inteiro (doc 06 §4.4).
"""
from __future__ import annotations

import asyncio
import time
from collections import defaultdict, deque
from typing import Any

import structlog
from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app.graphs.whatsapp_pre_attendance.graph import build_graph, graph_version
from app.graphs.whatsapp_pre_attendance.nodes.receive_message import receive_message
from app.graphs.whatsapp_pre_attendance.state import ConversationState
from app.schemas.inbound import WhatsAppMessageRequest
from app.schemas.outbound import (
    ActionItem,
    HandoffInfo,
    ReplyPayload,
    StateSnapshot,
    WhatsAppMessageResponse,
)

router = APIRouter()
log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Rate limiting — sliding window in-memory (doc 06 §12)
# ---------------------------------------------------------------------------

# Limite: 20 requisições por conversation_id por 60 segundos.
_RATE_LIMIT_MAX_REQUESTS: int = 20
_RATE_LIMIT_WINDOW_SEC: float = 60.0

# dict[conversation_id, deque[timestamp]]
_rate_limit_windows: dict[str, deque[float]] = defaultdict(deque)


def _check_rate_limit(conversation_id: str) -> tuple[bool, int]:
    """Verifica o rate limit para a conversa.

    Implementa sliding window: remove timestamps fora da janela e verifica
    se o número de requisições recentes ultrapassa o limite.

    Args:
        conversation_id: Identificador da conversa (chave de rate limit).

    Returns:
        Tupla ``(permitido, retry_after_sec)``.
        Se permitido, registra o timestamp atual.
        Se bloqueado, ``retry_after_sec`` é o tempo em segundos até liberar.
    """
    now = time.monotonic()
    window = _rate_limit_windows[conversation_id]

    # Remove timestamps fora da janela deslizante
    while window and (now - window[0]) > _RATE_LIMIT_WINDOW_SEC:
        window.popleft()

    if len(window) >= _RATE_LIMIT_MAX_REQUESTS:
        # Calcula quando a requisição mais antiga expira
        oldest = window[0]
        retry_after = int(_RATE_LIMIT_WINDOW_SEC - (now - oldest)) + 1
        return False, retry_after

    window.append(now)
    return True, 0


# ---------------------------------------------------------------------------
# Helpers de extração de estado
# ---------------------------------------------------------------------------


def _extract_reply(state: ConversationState) -> ReplyPayload:
    """Extrai o ``reply`` do estado final do grafo.

    O nó ``send_response`` registra o reply em ``tool_results`` com
    ``node="send_response"`` (doc 06 §5.2).
    Fallback para ``type="none"`` se não encontrado.
    """
    tool_results: list[dict[str, Any]] = list(state.get("tool_results") or [])

    for entry in reversed(tool_results):
        if entry.get("node") == "send_response" and "reply" in entry:
            raw: dict[str, Any] = entry["reply"]
            return ReplyPayload(
                type=raw.get("type", "none"),
                content=raw.get("content", ""),
                template_name=raw.get("template_name"),
                template_variables=raw.get("template_variables"),
            )

    return ReplyPayload(type="none", content="")


def _extract_actions(state: ConversationState) -> list[ActionItem]:
    """Extrai ``actions_emitted`` do estado e mapeia para ``ActionItem``."""
    raw_actions: list[dict[str, Any]] = list(state.get("actions_emitted") or [])
    actions: list[ActionItem] = []
    for a in raw_actions:
        actions.append(
            ActionItem(
                type=a.get("type", "unknown"),
                status=a.get("status", "success"),
                entity_id=a.get("entity_id"),
                data=a.get("data"),
            )
        )
    return actions


def _extract_handoff(state: ConversationState) -> HandoffInfo:
    """Extrai informações de handoff do estado final."""
    return HandoffInfo(
        required=bool(state.get("handoff_required", False)),
        reason=state.get("handoff_reason"),
        summary=None,  # Resumo gerado pelo backend quando necessário
    )


def _extract_state_snapshot(state: ConversationState) -> StateSnapshot:
    """Extrai snapshot de estado de fluxo (sem PII bruta)."""
    missing = list(state.get("missing_fields") or [])
    # Determina o próximo input esperado baseado nos campos ausentes
    next_input: str | None = missing[0] if missing else None

    return StateSnapshot(
        current_stage=state.get("current_stage"),
        current_intent=state.get("current_intent"),
        next_expected_input=next_input,
        missing_fields=missing,
    )


def _extract_llm_metadata(state: ConversationState) -> tuple[str | None, str | None]:
    """Extrai ``model`` e ``prompt_version`` do primeiro nó que usou LLM.

    O nó ``classify_intent`` e outros nós que chamam LLM registram estes
    campos em ``tool_results`` com chave ``prompt_key``.

    Returns:
        Tupla ``(model, prompt_version)``.
    """
    tool_results: list[dict[str, Any]] = list(state.get("tool_results") or [])
    model: str | None = None
    prompt_version: str | None = None

    for entry in tool_results:
        if "prompt_key" in entry:
            if model is None:
                model = entry.get("model")
            if prompt_version is None and "prompt_version" in entry:
                prompt_version = str(entry["prompt_version"])

    return model, prompt_version


# ---------------------------------------------------------------------------
# Endpoint principal
# ---------------------------------------------------------------------------

# Timeout de 8 s para o grafo inteiro (doc 06 §4.4)
_GRAPH_TIMEOUT_SEC: float = 8.0


@router.post(
    "/process/whatsapp/message",
    response_model=WhatsAppMessageResponse,
    status_code=200,
    summary="Processa mensagem WhatsApp via grafo LangGraph",
    description=(
        "Recebe uma mensagem de WhatsApp do backend Node, executa o grafo "
        "``whatsapp_pre_attendance`` e retorna a resposta estruturada. "
        "Contrato: doc 06 §4.1/§4.2."
    ),
    tags=["process"],
    responses={
        429: {
            "description": "Rate limit excedido",
            "headers": {"Retry-After": {"schema": {"type": "integer"}}},
        },
    },
)
async def process_whatsapp_message(
    payload: WhatsAppMessageRequest,
) -> Response | WhatsAppMessageResponse:
    """Endpoint POST /process/whatsapp/message.

    Valida o payload inbound, aplica rate limit, executa o grafo e retorna
    a resposta estruturada conforme doc 06 §4.2.

    Rate limit: {_RATE_LIMIT_MAX_REQUESTS} req / {_RATE_LIMIT_WINDOW_SEC}s por conversation_id.
    Timeout de grafo: {_GRAPH_TIMEOUT_SEC}s (doc 06 §4.4).
    """
    start_ns = time.monotonic_ns()

    # ------------------------------------------------------------------
    # Propaga correlation_id e phone_suffix para o contexto structlog
    # LGPD: nunca logamos o telefone completo (doc 17 §8.3)
    # ------------------------------------------------------------------
    structlog.contextvars.bind_contextvars(
        correlation_id=payload.correlation_id,
        conversation_id=payload.conversation_id,
        phone_suffix=payload.customer_phone[-4:] if payload.customer_phone else "",
    )

    # ------------------------------------------------------------------
    # Rate limit (doc 06 §12)
    # ------------------------------------------------------------------
    allowed, retry_after = _check_rate_limit(payload.conversation_id)
    if not allowed:
        log.warning(
            "rate_limit_exceeded",
            conversation_id=payload.conversation_id,
            retry_after=retry_after,
        )
        return JSONResponse(
            status_code=429,
            content={
                "detail": {
                    "error": "rate_limit_exceeded",
                    "message": "Muitas requisições para esta conversa. Tente novamente em breve.",
                    "retry_after_sec": retry_after,
                }
            },
            headers={"Retry-After": str(retry_after)},
        )

    log.info(
        "process_whatsapp_message_start",
        conversation_id=payload.conversation_id,
        idempotency_key=payload.idempotency_key,
        channel=payload.channel,
    )

    # ------------------------------------------------------------------
    # Estado inicial via receive_message (fora do grafo — doc 06 §4 nota)
    # ------------------------------------------------------------------
    initial_state: ConversationState = {}
    payload_dict = payload.to_payload_dict()
    initial_state = receive_message(initial_state, payload=payload_dict)

    # ------------------------------------------------------------------
    # Executa o grafo com timeout (doc 06 §4.4)
    # ------------------------------------------------------------------
    try:
        graph = build_graph()
        compiled = graph.compile()

        final_state: ConversationState = await asyncio.wait_for(
            compiled.ainvoke(initial_state),  # type: ignore[arg-type]
            timeout=_GRAPH_TIMEOUT_SEC,
        )

    except TimeoutError:
        latency_ms = (time.monotonic_ns() - start_ns) // 1_000_000
        log.error(
            "process_whatsapp_timeout",
            conversation_id=payload.conversation_id,
            latency_ms=latency_ms,
        )
        raise HTTPException(
            status_code=504,
            detail={
                "error": "graph_timeout",
                "message": "O processamento excedeu o tempo limite.",
            },
        ) from None

    except ValidationError as exc:
        latency_ms = (time.monotonic_ns() - start_ns) // 1_000_000
        log.error(
            "process_whatsapp_validation_error",
            conversation_id=payload.conversation_id,
            latency_ms=latency_ms,
            # Não loga o detalhe do erro para evitar vazar PII acidentalmente
            error_count=len(exc.errors()),
        )
        raise HTTPException(
            status_code=422,
            detail={
                "error": "graph_validation_error",
                "message": "Erro de validação no processamento.",
            },
        ) from None

    except Exception as exc:
        latency_ms = (time.monotonic_ns() - start_ns) // 1_000_000
        log.error(
            "process_whatsapp_error",
            conversation_id=payload.conversation_id,
            latency_ms=latency_ms,
            error=str(exc),
        )
        raise HTTPException(
            status_code=500,
            detail={
                "error": "internal_error",
                "message": "Erro interno no processamento da mensagem.",
            },
        ) from exc

    # ------------------------------------------------------------------
    # Monta a resposta (doc 06 §4.2)
    # ------------------------------------------------------------------
    latency_ms = (time.monotonic_ns() - start_ns) // 1_000_000
    model_used, prompt_ver = _extract_llm_metadata(final_state)

    resp = WhatsAppMessageResponse(
        conversation_id=payload.conversation_id,
        lead_id=final_state.get("lead_id"),
        reply=_extract_reply(final_state),
        actions=_extract_actions(final_state),
        handoff=_extract_handoff(final_state),
        state=_extract_state_snapshot(final_state),
        model=model_used,
        prompt_version=prompt_ver,
        graph_version=graph_version,
        latency_ms=latency_ms,
        errors=list(final_state.get("errors") or []),
    )

    log.info(
        "process_whatsapp_message_done",
        conversation_id=payload.conversation_id,
        lead_id=resp.lead_id,
        intent=final_state.get("current_intent"),
        handoff_required=resp.handoff.required,
        reply_type=resp.reply.type,
        latency_ms=latency_ms,
    )

    return resp


__all__ = ["router"]
