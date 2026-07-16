"""Endpoint POST /process/assistant/query — copiloto interno read-only (F6-S08).

Contrato: docs/22-agente-interno-acoes.md 12.4/12.5 + F6-S08.

Fluxo:
    1. Valida payload (principal + question). X-Internal-Token obrigatorio.
    2. Executa o grafo internal_assistant (stateless, sem checkpointer).
    3. Retorna narrative + blocks (F6-S20) + sources; erros retornam resposta graciosa.

Contrato estruturado (F6-S20):
    - `narrative`: comentario/estrutura da resposta SEM PII de cliente.
    - `blocks`: dados de cliente da resposta, referenciados por entidade
      (`ref`, persistivel na Fase 2 do historico -- docs/anexos/lgpd/
      dpia-historico-copiloto.md) + `value` (efemero, so para exibicao
      imediata). E a base do nivel A ("referencia + hidratacao viva") do DPIA.
    - `answer`: RETROCOMPAT -- narrative + blocks renderizados em texto plano.
      Existe para nao quebrar callers que ainda leem so `answer` durante a
      transicao (F6-S21/S22 vao consumir narrative/blocks diretamente).
      Sera removido quando os consumidores migrarem.

Seguranca / LGPD:
    - Principal derivado do JWT pelo endpoint Node (nunca pelo grafo).
    - Timeout de 8s (doc 06 4.4 / settings.graph_timeout_sec).
    - Erros internos retornam HTTP 500 com mensagem opaca.
    - Logs sem PII bruta (question pode ter PII — logamos so tamanho/correlation_id).
      `blocks[].value` NUNCA e logado (pode conter dado de cliente).
"""
from __future__ import annotations

import asyncio
import hmac
import time
from typing import Any, Literal

import structlog
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from app.config import settings
from app.graphs.internal_assistant.graph import build_internal_assistant_graph
from app.graphs.internal_assistant.state import (
    Block,
    HistoryTurn,
    InternalAssistantState,
    Principal,
)

#: Numero maximo de turnos de historico aceitos (contrato do Node F6-S17).
MAX_HISTORY_TURNS: int = 10

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


class HistoryTurnPayload(BaseModel):
    """Turno de historico da sessao -- contrato do Node (F6-S17).

    LGPD: content pode conter PII (respostas anteriores citam dados de lead).
    Nunca logar o content -- apenas contagem/tamanho, como question.
    """

    role: Literal["user", "assistant"]
    content: str = Field(..., max_length=4000)


class AssistantQueryRequest(BaseModel, extra="forbid"):
    principal: PrincipalPayload
    question: str = Field(..., min_length=1, max_length=2000, description="Pergunta do usuario")
    correlation_id: str | None = Field(None, description="ID de rastreamento opcional")
    history: list[HistoryTurnPayload] | None = Field(
        None, description="Historico de turnos da sessao (opcional, max 10)"
    )


class BlockRefPayload(BaseModel):
    """Referencia de entidade de um bloco -- o que sera persistido na Fase 2
    do historico (docs/anexos/lgpd/dpia-historico-copiloto.md). Sem PII.

    kind='aggregate' (funnel_metrics/lead_count/billing): nao referencia entidade,
    mas carrega os parametros NAO-PESSOAIS de reconstrucao (range + city_ids) para
    re-hidratar a consulta ao vivo na leitura do historico (DPIA sec4.3)."""

    kind: Literal["lead", "none", "aggregate"]
    lead_id: str | None = Field(None, description="UUID do lead (so quando kind='lead')")
    range: str | None = Field(None, description="Bucket temporal do agregado (so kind='aggregate')")
    city_ids: list[str] | None = Field(
        None, description="Filtro de cidades do agregado (so kind='aggregate')"
    )


class BlockPayload(BaseModel):
    """Bloco de dado de cliente referenciado por entidade (F6-S20).

    `ref` e persistivel (sem PII); `value` e efemero (dado hidratado para
    exibicao imediata, descartado na persistencia da Fase 2). Campos
    propositalmente distintos -- nunca colapsados.
    """

    type: Literal["lead_summary", "funnel_metrics", "lead_count", "analysis_status", "billing"]
    ref: BlockRefPayload
    value: Any = Field(None, description="Dado hidratado para exibicao imediata (efemero)")


class AssistantQueryResponse(BaseModel):
    narrative: str = Field(
        ..., description="Comentario/estrutura da resposta, SEM PII de cliente (F6-S20)"
    )
    blocks: list[BlockPayload] = Field(
        default_factory=list,
        description="Dados de cliente da resposta, referenciados por entidade (F6-S20)",
    )
    answer: str = Field(
        ...,
        description=(
            "[RETROCOMPAT F6-S20] narrative + blocks renderizados em texto plano. "
            "Mantido para nao quebrar callers que ainda leem so `answer` durante a "
            "transicao (F6-S21/S22 migram para narrative/blocks). Sera removido "
            "quando todos os consumidores migrarem."
        ),
    )
    sources: list[str] = Field(default_factory=list, description="Fontes de dados usadas")
    tools_called: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    error: str | None = Field(None, description="Codigo de erro (null = sucesso)")


def _stringify_block_value(value: Any) -> str:
    """Renderiza `value` de um bloco em texto legivel para o `answer` derivado.

    Best-effort: nunca lanca excecao (usado so no fallback de retrocompat).
    """
    if isinstance(value, dict):
        parts = [f"{k}: {v}" for k, v in value.items() if v is not None]
        return "; ".join(parts)
    if isinstance(value, list):
        return "; ".join(_stringify_block_value(item) for item in value)
    return str(value)


def _derive_answer(narrative: str, blocks: list[Block]) -> str:
    """Deriva o campo `answer` (retrocompat F6-S20) a partir de narrative + blocks.

    Uniao textual simples: a narrativa seguida de uma linha por bloco com o
    `value` renderizado. Callers legados que so leem `answer` continuam
    funcionando durante a transicao. Este helper e temporario -- F6-S21/S22
    devem consumir `narrative`/`blocks` diretamente.
    """
    if not blocks:
        return narrative
    rendered_blocks = [
        f"[{block['type']}] {_stringify_block_value(block['value'])}"
        for block in blocks
        if block.get("value") is not None
    ]
    parts = [narrative] if narrative else []
    parts.extend(rendered_blocks)
    return "\n".join(parts).strip()


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

    # Truncamento defensivo aos ultimos MAX_HISTORY_TURNS (o Node ja capa, mas
    # nunca confiamos apenas no caller). Nunca logar o content -- so a contagem.
    history: list[HistoryTurn] = [
        HistoryTurn(role=turn.role, content=turn.content)
        for turn in (payload.history or [])
    ][-MAX_HISTORY_TURNS:]

    structlog.contextvars.bind_contextvars(
        correlation_id=correlation_id,
        question_len=len(payload.question),
        org_id=payload.principal.organization_id,
        history_turns=len(history),
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
        "history": history,
        "messages": [],
        "narrative": "",
        "blocks": [],
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
        fallback_narrative = "Nao consegui processar sua consulta no tempo limite. Tente novamente."
        return AssistantQueryResponse(
            narrative=fallback_narrative,
            blocks=[],
            answer=fallback_narrative,
            sources=[],
            tools_called=[],
            metadata={"latency_ms": latency_ms},
            error="graph_timeout",
        )
    except Exception as exc:
        latency_ms = (time.monotonic_ns() - start_ns) // 1_000_000
        log.error("assistant_query_error", latency_ms=latency_ms, error_type=type(exc).__name__)
        fallback_narrative = "Nao foi possivel processar sua consulta no momento."
        return AssistantQueryResponse(
            narrative=fallback_narrative,
            blocks=[],
            answer=fallback_narrative,
            sources=[],
            tools_called=[],
            metadata={"latency_ms": latency_ms},
            error="internal_error",
        )

    latency_ms = (time.monotonic_ns() - start_ns) // 1_000_000
    narrative = final_state.get("narrative", "")
    blocks: list[Block] = final_state.get("blocks", [])
    sources = final_state.get("sources", [])
    meta = {**final_state.get("metadata", {}), "latency_ms": latency_ms}

    if not narrative and not blocks:
        narrative = "Nao encontrei informacoes suficientes para responder sua pergunta."

    # Nunca logar narrative/blocks (podem ser derivados de PII redigida ou
    # carregar dado de cliente em blocks[].value) -- so contagens.
    log.info(
        "assistant_query_done",
        latency_ms=latency_ms,
        sources_count=len(sources),
        blocks_count=len(blocks),
    )

    return AssistantQueryResponse(
        narrative=narrative,
        blocks=blocks,  # type: ignore[arg-type]
        answer=_derive_answer(narrative, blocks),
        sources=sources,
        tools_called=meta.get("tools_called", []),
        metadata=meta,
        error=None,
    )


__all__ = ["router"]
