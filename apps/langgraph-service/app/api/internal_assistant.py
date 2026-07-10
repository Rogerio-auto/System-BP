"""Endpoint POST /process/assistant/query — copiloto interno read-only (F6-S08).

Contrato: docs/22-agente-interno-acoes.md 12.4/12.5 + F6-S08.

Fluxo:
    1. Valida payload (principal + question). X-Internal-Token obrigatorio.
    2. Executa o grafo internal_assistant (stateless, sem checkpointer).
    3. Retorna answer + sources; erros retornam resposta graciosa.

Seguranca / LGPD:
    - Principal derivado do JWT pelo endpoint Node (nunca pelo grafo).
    - Timeout de 8s (doc 06 4.4 / settings.graph_timeout_sec).
    - Erros internos retornam HTTP 500 com mensagem opaca.
    - Logs sem PII bruta (question pode ter PII — logamos so tamanho/correlation_id).
"""
from __future__ import annotations

import asyncio
import hmac
import time
from typing import Any

import structlog
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from app.config import settings
from app.graphs.internal_assistant.graph import build_internal_assistant_graph
from app.graphs.internal_assistant.state import InternalAssistantState, Principal

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

router = APIRouter()


async def _require_internal_token(
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> None:
    token = settings.internal_token.get_secret_value()
    if not x_internal_token or not token:
        raise HTTPException(status_code=401, detail="Token interno ausente")
    if not hmac.compare_digest(x_internal_token.encode(), token.encode()):
        raise HTTPException(status_code=401, detail="Token interno invalido")


class PrincipalPayload(BaseModel):
    user_id: str = Field(..., description="UUID do usuario autenticado")
    organization_id: str = Field(..., description="UUID da organizacao")
    permissions: list[str] = Field(..., min_length=1, description="Permissoes efetivas")
    city_scope_ids: list[str] | None = Field(None, description="null=global; []=sem cidade")


class AssistantQueryRequest(BaseModel, extra="forbid"):
    principal: PrincipalPayload
    question: str = Field(..., min_length=1, max_length=2000, description="Pergunta do usuario")
    correlation_id: str | None = Field(None, description="ID de rastreamento opcional")


class AssistantQueryResponse(BaseModel):
    answer: str = Field(..., description="Resposta gerada pelo copiloto")
    sources: list[str] = Field(default_factory=list, description="Fontes de dados usadas")
    tools_called: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    error: str | None = Field(None, description="Codigo de erro (null = sucesso)")


_GRAPH_TIMEOUT_SEC: float = settings.graph_timeout_sec


@router.post(
    "/process/assistant/query",
    response_model=AssistantQueryResponse,
    status_code=200,
    summary="Copiloto interno query",
    tags=["process"],
)
async def process_assistant_query(
    payload: AssistantQueryRequest,
    _auth: None = Depends(_require_internal_token),
) -> AssistantQueryResponse:
    start_ns = time.monotonic_ns()
    correlation_id = payload.correlation_id or "no-correlation-id"

    structlog.contextvars.bind_contextvars(
        correlation_id=correlation_id,
        question_len=len(payload.question),
        org_id=payload.principal.organization_id,
    )

    log.info("assistant_query_start")

    principal: Principal = {
        "user_id": payload.principal.user_id,
        "organization_id": payload.principal.organization_id,
        "permissions": payload.principal.permissions,
        "city_scope_ids": payload.principal.city_scope_ids,
    }

    initial_state: InternalAssistantState = {
        "principal": principal,
        "organization_id": payload.principal.organization_id,
        "question": payload.question,
        "messages": [],
        "answer": "",
        "sources": [],
        "errors": [],
        "metadata": {},
    }

    try:
        graph = build_internal_assistant_graph()
        compiled = graph.compile()
        final_state: InternalAssistantState = await asyncio.wait_for(
            compiled.ainvoke(initial_state),  # type: ignore[arg-type]
            timeout=_GRAPH_TIMEOUT_SEC,
        )
    except TimeoutError:
        latency_ms = (time.monotonic_ns() - start_ns) // 1_000_000
        log.error("assistant_query_timeout", latency_ms=latency_ms)
        return AssistantQueryResponse(
            answer="Nao consegui processar sua consulta no tempo limite. Tente novamente.",
            sources=[],
            tools_called=[],
            metadata={"latency_ms": latency_ms},
            error="graph_timeout",
        )
    except Exception as exc:
        latency_ms = (time.monotonic_ns() - start_ns) // 1_000_000
        log.error("assistant_query_error", latency_ms=latency_ms, error_type=type(exc).__name__)
        return AssistantQueryResponse(
            answer="Nao foi possivel processar sua consulta no momento.",
            sources=[],
            tools_called=[],
            metadata={"latency_ms": latency_ms},
            error="internal_error",
        )

    latency_ms = (time.monotonic_ns() - start_ns) // 1_000_000
    answer = final_state.get("answer", "")
    sources = final_state.get("sources", [])
    meta = {**final_state.get("metadata", {}), "latency_ms": latency_ms}

    if not answer:
        answer = "Nao encontrei informacoes suficientes para responder sua pergunta."

    log.info("assistant_query_done", latency_ms=latency_ms, sources_count=len(sources))

    return AssistantQueryResponse(
        answer=answer,
        sources=sources,
        tools_called=meta.get("tools_called", []),
        metadata=meta,
        error=None,
    )


__all__ = ["router"]
