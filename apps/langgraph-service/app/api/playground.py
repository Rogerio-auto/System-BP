"""Endpoint POST /process/whatsapp/playground — execução dry-run do grafo.

Contrato: F9-S03.

Fluxo:
    1. Valida o payload (Pydantic v2 strict — extra="forbid").
       ``dry_run: Literal[True]`` obrigatório — fail-fast 422 se ausente.
    2. Autentica X-Internal-Token (timing-safe compare_digest, mesmo mecanismo
       de produção — HIGH-1).
    3. Aplica rate limit próprio, mais permissivo: 60 req/min por conversation_id
       (operador testando, não webhook de produção).
    4. Prepara estado inicial via nó ``receive_message`` (fora do grafo).
    5. Executa o grafo ``whatsapp_pre_attendance`` dentro de ``dry_run_context()``:
       - ``InternalApiClient`` substituído por ``DryRunInternalApiClient``.
       - GET: delega ao cliente real se ``allow_real_reads=True``; sintético caso contrário.
       - POST/PUT/PATCH: nunca faz I/O — registra no sink e retorna sintético.
       - Nenhuma chamada a Chatwoot ocorre.
    6. Coleta trace dos nós percorridos (tool_results) + chamadas interceptadas (sink).
    7. Retorna ``PlaygroundResponse`` com reply, trace, tokens e latência.
       Não retorna o estado completo (evita PII de contexto).

Segurança / LGPD:
    - ``customer_phone`` nunca aparece em logs — só sufixo de 4 dígitos.
    - ``message_text`` nunca aparece em logs ou trace.
    - Trace inclui apenas IDs opacos, intenções e tokens — sem PII bruta.
    - Erros internos: HTTP 500 com mensagem opaca; detalhes em logs estruturados.
    - Timeout de 15 s (mais generoso que produção — grafo pode ter retries lentos).
    - X-Internal-Token: same dependency que process.py (HIGH-1).
"""
from __future__ import annotations

import asyncio
import hmac
import time
import uuid
from collections import defaultdict, deque
from typing import Any

import structlog
from fastapi import APIRouter, Depends, Header, HTTPException, Response
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app.config import settings
from app.graphs.whatsapp_pre_attendance.dry_run import dry_run_context
from app.graphs.whatsapp_pre_attendance.graph import build_graph, graph_version
from app.graphs.whatsapp_pre_attendance.nodes.receive_message import receive_message
from app.graphs.whatsapp_pre_attendance.state import ConversationState
from app.schemas.playground import PlaygroundRequest, PlaygroundResponse, TraceEntry

router = APIRouter()
log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Autenticação — X-Internal-Token (reutiliza mesma política de process.py)
# ---------------------------------------------------------------------------


async def _require_internal_token(
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> None:
    """FastAPI Depends que valida X-Internal-Token em tempo constante."""
    expected = settings.internal_token.get_secret_value()
    provided = x_internal_token or ""
    if not hmac.compare_digest(provided.encode(), expected.encode()):
        raise HTTPException(
            status_code=401,
            detail={"error": "unauthorized", "message": "Token inválido ou ausente."},
        )


# ---------------------------------------------------------------------------
# Rate limiting — playground tem limite mais permissivo
# Rate limit: 60 req/min por conversation_id (vs 20 em produção)
# ---------------------------------------------------------------------------

_PLAYGROUND_RATE_LIMIT_MAX: int = 60
_PLAYGROUND_RATE_WINDOW_SEC: float = 60.0

_playground_rate_windows: dict[str, deque[float]] = defaultdict(deque)


def _check_playground_rate_limit(conversation_id: str) -> tuple[bool, int]:
    """Sliding window rate limit para o playground.

    Returns:
        ``(permitido, retry_after_sec)``
    """
    now = time.monotonic()
    window = _playground_rate_windows[conversation_id]

    while window and (now - window[0]) > _PLAYGROUND_RATE_WINDOW_SEC:
        window.popleft()

    if not window and conversation_id in _playground_rate_windows:
        # MOD-2: após del, NÃO reler do defaultdict — isso recriaria a entrada
        # vazia e vazaria memória ao longo do tempo. Remover e usar deque local.
        del _playground_rate_windows[conversation_id]

    if len(window) >= _PLAYGROUND_RATE_LIMIT_MAX:
        oldest = window[0]
        retry_after = int(_PLAYGROUND_RATE_WINDOW_SEC - (now - oldest)) + 1
        return False, retry_after

    window.append(now)
    return True, 0


# ---------------------------------------------------------------------------
# Helpers de extração de trace (do estado final + sink)
# ---------------------------------------------------------------------------

# Timeout do grafo em dry-run — mais generoso (15 s) porque grafo pode ter
# retries de LLM e o operator está inspecionando, não um webhook real.
_PLAYGROUND_GRAPH_TIMEOUT_SEC: float = 15.0


def _build_trace_from_tool_results(
    tool_results: list[dict[str, Any]],
) -> list[TraceEntry]:
    """Constrói entradas de trace a partir de ``tool_results`` do estado final.

    Cada entrada de nó que usou LLM (campo ``prompt_key``) gera uma TraceEntry
    com ``node``, ``intent``, ``prompt_version``, ``model``, ``tokens_*``,
    ``latency_ms`` e ``dry_run=True``.

    Entradas sem ``prompt_key`` (nós de infra: persist_state, load_state etc.)
    geram uma TraceEntry simplificada apenas com ``node`` e ``dry_run=True``.

    LGPD: nunca inclui ``message_text``, ``customer_phone`` ou dados brutos.
    """
    entries: list[TraceEntry] = []
    for result in tool_results:
        node_name: str = str(result.get("node", "unknown"))
        entry = TraceEntry(
            node=node_name,
            dry_run=True,
            intent=str(result["intent"]) if "intent" in result else None,
            prompt_version=(
                str(result["prompt_version"]) if "prompt_version" in result else None
            ),
            model=str(result["model"]) if "model" in result else None,
            tokens_in=int(result["tokens_in"]) if "tokens_in" in result else None,
            tokens_out=int(result["tokens_out"]) if "tokens_out" in result else None,
            latency_ms=(
                float(result["latency_ms"]) if "latency_ms" in result else None
            ),
        )
        entries.append(entry)
    return entries


def _collect_prompt_versions(tool_results: list[dict[str, Any]]) -> list[str]:
    """Coleta versões de prompt distintas usadas na execução."""
    seen: set[str] = set()
    versions: list[str] = []
    for result in tool_results:
        pv = result.get("prompt_version")
        if pv and isinstance(pv, str) and pv not in seen:
            seen.add(pv)
            versions.append(pv)
    return versions


def _sum_tokens(tool_results: list[dict[str, Any]]) -> int:
    """Soma total de tokens (in + out) de todos os nós."""
    total = 0
    for result in tool_results:
        total += int(result.get("tokens_in", 0) or 0)
        total += int(result.get("tokens_out", 0) or 0)
    return total


def _sanitize_errors(errors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Sanitiza erros — mantém apenas type/message/node (sem stacktraces ou PII)."""
    return [
        {k: v for k, v in err.items() if k in {"type", "message", "node", "error"}}
        for err in errors
        if isinstance(err, dict)
    ]


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.post(
    "/process/whatsapp/playground",
    response_model=PlaygroundResponse,
    status_code=200,
    summary="Executa o grafo WhatsApp em modo dry-run (playground)",
    description=(
        "Roda o grafo ``whatsapp_pre_attendance`` sem persistir estado no banco "
        "e sem chamar Chatwoot. Retorna o trace de nós percorridos e a resposta "
        "que seria enviada ao cliente. "
        "Requer ``dry_run: true`` no body — fail-fast 422 se ausente."
    ),
    tags=["playground"],
    responses={
        401: {"description": "X-Internal-Token ausente ou inválido."},
        422: {"description": "Payload inválido ou dry_run ausente/false."},
        429: {
            "description": "Rate limit excedido (60 req/min por conversation_id).",
            "headers": {"Retry-After": {"schema": {"type": "integer"}}},
        },
        504: {"description": "Timeout do grafo (> 15 s)."},
    },
)
async def run_playground(
    payload: PlaygroundRequest,
    _auth: None = Depends(_require_internal_token),
) -> Response | PlaygroundResponse:
    """Endpoint POST /process/whatsapp/playground.

    Executa o grafo em modo dry-run. Todo I/O de escrita ao backend é
    interceptado pelo ``DryRunInternalApiClient``; nenhuma chamada a Chatwoot
    ocorre. Retorna trace + resposta sintética sem persistir nada.
    """
    start_ns = time.monotonic_ns()

    # ------------------------------------------------------------------
    # Garante idempotency_key (gerada automaticamente se vazia)
    # ------------------------------------------------------------------
    effective_idem_key = payload.idempotency_key or f"playground-{uuid.uuid4()}"

    # ------------------------------------------------------------------
    # Propaga contexto structlog (sem PII)
    # LGPD: customer_phone → apenas 4 dígitos finais
    # ------------------------------------------------------------------
    structlog.contextvars.bind_contextvars(
        correlation_id=payload.correlation_id,
        conversation_id=payload.conversation_id,
        phone_suffix=payload.customer_phone[-4:] if payload.customer_phone else "",
        dry_run=True,
    )

    # ------------------------------------------------------------------
    # Rate limit (mais permissivo: 60 req/min)
    # ------------------------------------------------------------------
    allowed, retry_after = _check_playground_rate_limit(payload.conversation_id)
    if not allowed:
        log.warning(
            "playground_rate_limit_exceeded",
            conversation_id=payload.conversation_id,
            retry_after=retry_after,
        )
        return JSONResponse(
            status_code=429,
            content={
                "detail": {
                    "error": "rate_limit_exceeded",
                    "message": "Muitas requisições playground. Tente novamente em breve.",
                    "retry_after_sec": retry_after,
                }
            },
            headers={"Retry-After": str(retry_after)},
        )

    log.info(
        "playground_start",
        conversation_id=payload.conversation_id,
        idempotency_key=effective_idem_key,
        allow_real_reads=payload.allow_real_reads,
    )

    # ------------------------------------------------------------------
    # Estado inicial via receive_message (fora do grafo)
    # ------------------------------------------------------------------
    initial_state: ConversationState = {}
    payload_dict = payload.to_inbound_payload_dict()
    initial_state = receive_message(initial_state, payload=payload_dict)

    # ------------------------------------------------------------------
    # Executa o grafo em dry_run_context (timeout 15 s)
    # ------------------------------------------------------------------
    try:
        async with dry_run_context(allow_real_reads=payload.allow_real_reads) as sink:
            graph = build_graph()
            compiled = graph.compile()

            final_state: ConversationState = await asyncio.wait_for(
                compiled.ainvoke(initial_state),  # type: ignore[arg-type]
                timeout=_PLAYGROUND_GRAPH_TIMEOUT_SEC,
            )

    except TimeoutError:
        latency_ms = (time.monotonic_ns() - start_ns) // 1_000_000
        log.error(
            "playground_timeout",
            conversation_id=payload.conversation_id,
            latency_ms=latency_ms,
        )
        raise HTTPException(
            status_code=504,
            detail={
                "error": "graph_timeout",
                "message": "O processamento dry-run excedeu o tempo limite (15 s).",
            },
        ) from None

    except ValidationError as exc:
        latency_ms = (time.monotonic_ns() - start_ns) // 1_000_000
        log.error(
            "playground_validation_error",
            conversation_id=payload.conversation_id,
            latency_ms=latency_ms,
            error_count=len(exc.errors()),
        )
        raise HTTPException(
            status_code=422,
            detail={
                "error": "graph_validation_error",
                "message": "Erro de validação no processamento dry-run.",
            },
        ) from None

    except Exception as exc:
        latency_ms = (time.monotonic_ns() - start_ns) // 1_000_000
        log.error(
            "playground_error",
            conversation_id=payload.conversation_id,
            latency_ms=latency_ms,
            # MOD-1: usar apenas o tipo da exceção (nunca str(exc)) — str(exc)
            # pode vazar URL com credenciais ou PII de httpx.HTTPStatusError.
            # Detalhes completos apenas em nível DEBUG (abaixo do threshold de prod).
            error=type(exc).__name__,
        )
        log.debug(
            "playground_error_detail",
            conversation_id=payload.conversation_id,
            error_detail=str(exc),
        )
        raise HTTPException(
            status_code=500,
            detail={
                "error": "internal_error",
                "message": "Erro interno no playground dry-run.",
            },
        ) from exc

    # ------------------------------------------------------------------
    # Monta trace
    # ------------------------------------------------------------------
    latency_ms = (time.monotonic_ns() - start_ns) // 1_000_000
    tool_results: list[dict[str, Any]] = list(final_state.get("tool_results") or [])

    # Entradas de nós percorridos (com metadados de LLM quando disponíveis)
    trace_from_nodes = _build_trace_from_tool_results(tool_results)

    # Entradas do sink (chamadas ao backend interceptadas)
    trace_from_sink = [
        TraceEntry(**call.to_trace_entry())
        for call in sink
    ]

    full_trace = trace_from_nodes + trace_from_sink

    # ------------------------------------------------------------------
    # Extrai reply do estado final
    # ------------------------------------------------------------------
    reply_type = "none"
    reply_content = ""
    for entry in reversed(tool_results):
        if entry.get("node") == "send_response" and "reply" in entry:
            raw_reply: dict[str, Any] = entry["reply"]
            reply_type = str(raw_reply.get("type", "none"))
            reply_content = str(raw_reply.get("content", ""))
            break

    # ------------------------------------------------------------------
    # Monta a resposta
    # ------------------------------------------------------------------
    raw_errors: list[dict[str, Any]] = list(final_state.get("errors") or [])

    resp = PlaygroundResponse(
        conversation_id=payload.conversation_id,
        dry_run=True,
        reply_type=reply_type,
        reply_content=reply_content,
        handoff_required=bool(final_state.get("handoff_required", False)),
        handoff_reason=final_state.get("handoff_reason"),
        trace=full_trace,
        prompt_versions_used=_collect_prompt_versions(tool_results),
        tokens_total=_sum_tokens(tool_results),
        graph_version=graph_version,
        latency_ms=latency_ms,
        errors=_sanitize_errors(raw_errors),
    )

    log.info(
        "playground_done",
        conversation_id=payload.conversation_id,
        reply_type=reply_type,
        handoff_required=resp.handoff_required,
        trace_entries=len(full_trace),
        intercepted_calls=len(sink),
        tokens_total=resp.tokens_total,
        latency_ms=latency_ms,
    )

    return resp


__all__ = ["router"]
