"""Endpoint POST /process/whatsapp/message — processa uma mensagem via grafo.

Contrato: doc 06 §4.1 (request) e §4.2 (response).

Fluxo:
    1. Valida o payload inbound (Pydantic v2 strict — extra="forbid").
    2. Autentica X-Internal-Token (timing-safe compare_digest).
    3. Verifica idempotência (bounded in-memory cache com TTL).
    4. Aplica rate limit por conversation_id (doc 06 §12).
    5. Prepara estado inicial via nó ``receive_message`` (fora do grafo).
    6. Executa o grafo ``whatsapp_pre_attendance`` (``build_graph()``).
    7. Extrai reply, actions, handoff, state e metadados de LLM do estado final.
    8. Retorna ``WhatsAppMessageResponse`` (doc 06 §4.2).

Segurança / LGPD:
    - ``customer_phone`` nunca aparece em logs — só o sufixo de 4 dígitos.
    - ``correlation_id`` é propagado para o contexto structlog (rastreamento).
    - Erros internos retornam HTTP 500 com mensagem opaca; detalhes ficam em logs.
    - Rate limit retorna HTTP 429 com ``Retry-After`` header.
    - Timeout de 8 s para o grafo inteiro (doc 06 §4.4).
    - X-Internal-Token validado em tempo constante (hmac.compare_digest) — HIGH-1.
    - Idempotency_key deduplicado com cache bounded + TTL — HIGH-2.
"""
from __future__ import annotations

import asyncio
import hmac
import time
from collections import defaultdict, deque
from typing import Any

import structlog
from fastapi import APIRouter, Depends, Header, HTTPException, Response
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app.config import settings
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
# Autenticação — X-Internal-Token (HIGH-1)
# Comparação em tempo constante via hmac.compare_digest para evitar
# timing attacks. Rejeita com 401 se ausente ou inválido.
# ---------------------------------------------------------------------------


async def _require_internal_token(
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> None:
    """FastAPI Depends que valida X-Internal-Token em tempo constante."""
    expected = settings.internal_token.get_secret_value()
    # hmac.compare_digest exige que ambos os operandos sejam do mesmo tipo.
    # Tratar ausência de header como string vazia garante comparação sempre ocorra
    # (evita short-circuit que poderia revelar informação por timing).
    provided = x_internal_token or ""
    if not hmac.compare_digest(provided.encode(), expected.encode()):
        raise HTTPException(
            status_code=401,
            detail={"error": "unauthorized", "message": "Token inválido ou ausente."},
        )


# ---------------------------------------------------------------------------
# Idempotência — bounded in-memory cache com TTL (HIGH-2)
# Evita reexecução do grafo para chaves já processadas na janela de TTL.
# ---------------------------------------------------------------------------

# TTL da janela de idempotência (segundos). Alinhado com a janela de redelivery
# esperada do backend Node (60 s é conservador).
_IDEMPOTENCY_TTL_SEC: float = 60.0
# Limite máximo de entradas no cache (bounded para evitar memory leak).
# Cada entrada é ~400 bytes; 4 096 entradas ≈ 1.6 MB.
_IDEMPOTENCY_MAX_SIZE: int = 4_096

# dict[idempotency_key, (timestamp_monotonic, cached_response)]
_idempotency_cache: dict[str, tuple[float, WhatsAppMessageResponse]] = {}


def _idempotency_lookup(key: str) -> WhatsAppMessageResponse | None:
    """Retorna resposta cacheada se a chave existir dentro do TTL."""
    entry = _idempotency_cache.get(key)
    if entry is None:
        return None
    ts, cached = entry
    if (time.monotonic() - ts) > _IDEMPOTENCY_TTL_SEC:
        # Entrada expirada — remove e trata como cache miss
        del _idempotency_cache[key]
        return None
    return cached


def _idempotency_store(key: str, response: WhatsAppMessageResponse) -> None:
    """Armazena resposta no cache, evitando crescimento ilimitado.

    Quando o cache atinge ``_IDEMPOTENCY_MAX_SIZE``, descarta entradas
    expiradas primeiro; se ainda cheio, descarta a entrada mais antiga (FIFO).
    """
    now = time.monotonic()
    if len(_idempotency_cache) >= _IDEMPOTENCY_MAX_SIZE:
        # 1) Purge expiradas
        expired_keys = [
            k for k, (ts, _) in _idempotency_cache.items()
            if (now - ts) > _IDEMPOTENCY_TTL_SEC
        ]
        for k in expired_keys:
            del _idempotency_cache[k]
        # 2) Se ainda cheio, remove a entrada mais antiga (menor timestamp)
        if len(_idempotency_cache) >= _IDEMPOTENCY_MAX_SIZE:
            oldest_key = min(_idempotency_cache, key=lambda k: _idempotency_cache[k][0])
            del _idempotency_cache[oldest_key]
    _idempotency_cache[key] = (now, response)


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

    # MED-1: remove a entrada do dict quando a deque fica vazia após popleft,
    # evitando acúmulo de chaves inativas (memory leak em longas execuções).
    if not window and conversation_id in _rate_limit_windows:
        del _rate_limit_windows[conversation_id]
        window = _rate_limit_windows[conversation_id]  # recria via defaultdict se necessário

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
    _auth: None = Depends(_require_internal_token),
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

    # ------------------------------------------------------------------
    # Idempotência (HIGH-2)
    # Se a chave já foi processada dentro do TTL, retorna resposta cacheada
    # sem reexecutar o grafo. Evita execução dupla em caso de reentrega.
    # ------------------------------------------------------------------
    cached_resp = _idempotency_lookup(payload.idempotency_key)
    if cached_resp is not None:
        log.info(
            "process_whatsapp_idempotent_hit",
            conversation_id=payload.conversation_id,
            idempotency_key=payload.idempotency_key,
        )
        return cached_resp

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

    # MED-4: sanitiza erros antes de serializar na resposta HTTP.
    # Mantém apenas type/message/node para não vazar stacktraces ou topologia
    # interna (e possíveis PII acidentais em mensagens de exceção).
    raw_errors: list[dict[str, Any]] = list(final_state.get("errors") or [])
    sanitized_errors: list[dict[str, Any]] = [
        {
            k: v
            for k, v in err.items()
            if k in {"type", "message", "node"}
        }
        for err in raw_errors
        if isinstance(err, dict)
    ]

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
        errors=sanitized_errors,
    )

    # HIGH-2: armazena resposta no cache de idempotência após execução bem-sucedida.
    _idempotency_store(payload.idempotency_key, resp)

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
