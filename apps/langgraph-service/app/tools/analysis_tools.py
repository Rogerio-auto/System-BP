"""Tool LangGraph: get_credit_analysis_history — leitura mascarada (F4-S04).

Wrapper fino sobre GET /internal/customers/:id/credit-analyses do backend Node.
Nunca acessa Postgres diretamente — toda I/O passa por InternalApiClient.

LGPD (doc 17 §3.4 + Art. 6º III — Minimização):
  A tool recebe APENAS: analysis_id, status, created_at, updated_at,
  current_version_number.

  NUNCA recebe ou expõe:
    - parecer_text      (texto interno do analista)
    - pendencias        (lista de pendências)
    - attachments       (metadados de arquivos)
    - internal_score    (pontuação de risco)
    - analyst_user_id   (identificação do analista)
    - approved_amount / approved_term_months / approved_rate_monthly
      (dados de aprovação — slot futuro F6)

  Defesa em profundidade: mesmo com prompt injection, o grafo não obtém o
  parecer porque o backend simplesmente não expõe. O mascaramento ocorre na
  fonte (endpoint), não no cliente.

  Log estruturado: NUNCA loga analysis_id de forma que associe a PII do lead.
  Log de lead_id é aceitável (dado operacional — não PII direta neste contexto).

Uso:
  A tool fica disponível para integração em slot futuro de "consultar andamento"
  no decide_next_step do grafo whatsapp_pre_attendance.
  NÃO cria nó novo — apenas habilita a leitura mascarada.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

import structlog
from langchain_core.tools import tool
from pydantic import BaseModel, Field

from app.tools._base import InternalApiClient

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

_ENDPOINT_TPL = "/internal/customers/{lead_id}/credit-analyses"


# ---------------------------------------------------------------------------
# Schemas de saída — mascaramento LGPD
# ---------------------------------------------------------------------------


class AnalysisItemOutput(BaseModel):
    """Item de análise mascarado — apenas dados seguros para o grafo.

    Campos propositalmente OMITIDOS (LGPD Art. 6º III — minimização):
      - parecer_text: texto interno do analista
      - pendencias: lista de pendências documentais
      - attachments: metadados de arquivos
      - internal_score: pontuação de risco
      - analyst_user_id: identificação do analista
      - approved_amount / approved_term_months / approved_rate_monthly:
        dados de aprovação — restritos ao assistente interno (slot futuro F6)

    ``current_version_number``: número da versão atual (0 = sem parecer ainda).
    Permite detectar se houve atualização sem expor o conteúdo.
    """

    analysis_id: str = Field(description="UUID opaco da análise.")
    status: Literal["em_analise", "pendente", "aprovado", "recusado", "cancelado"] = Field(
        description=(
            "Status agregado da análise: em_analise | pendente | aprovado | recusado | cancelado."
        ),
    )
    current_version_number: int = Field(
        description="Número da versão atual (0 = sem parecer ainda, ≥1 = parecer registrado).",
        ge=0,
    )
    created_at: datetime = Field(description="ISO 8601 — quando a análise foi criada.")
    updated_at: datetime = Field(description="ISO 8601 — última atualização da análise.")


class AnalysisHistoryOutput(BaseModel):
    """Histório mascarado de análises de crédito de um lead.

    Lista vazia (``items=[]``) quando o lead não tem análises na organização.
    Ordenação: mais recente primeiro (created_at DESC — garantido pelo backend).
    """

    lead_id: str = Field(description="UUID do lead consultado.")
    items: list[AnalysisItemOutput] = Field(
        description="Lista mascarada de análises, mais recente primeiro.",
    )


class AnalysisHistoryError(BaseModel):
    """Resposta de erro mapeada para get_credit_analysis_history."""

    ok: Literal[False] = False
    error_code: str
    message: str


AnalysisHistoryResult = AnalysisHistoryOutput | AnalysisHistoryError

# Códigos de erro canônicos
_ERR_NOT_FOUND = "LEAD_NOT_FOUND"
_ERR_BACKEND_UNAVAILABLE = "BACKEND_UNAVAILABLE"


# ---------------------------------------------------------------------------
# Schema de entrada
# ---------------------------------------------------------------------------


class GetCreditAnalysisHistoryInput(BaseModel):
    """Input validado para a tool get_credit_analysis_history (F4-S04).

    Aceita ``lead_id`` e ``organization_id`` — ambos obrigatórios para garantir
    escopo multi-tenant correto (regra inviolável #3 — CLAUDE.md).
    """

    lead_id: str = Field(
        description="UUID do lead cujo histórico de análise será consultado.",
    )
    organization_id: str = Field(
        description=(
            "UUID da organização — enviado no header X-Organization-Id "
            "(regra inviolável #3: escopo multi-tenant)."
        ),
    )


# ---------------------------------------------------------------------------
# Implementação da tool
# ---------------------------------------------------------------------------


@tool(args_schema=GetCreditAnalysisHistoryInput)
async def get_credit_analysis_history(
    lead_id: str,
    organization_id: str,
) -> AnalysisHistoryResult:
    """Retorna histórico mascarado de análises de crédito de um lead.

    Chama GET /internal/customers/:id/credit-analyses no backend Node.
    Passa X-Organization-Id para garantir escopo multi-tenant (regra inviolável #3).

    A resposta contém APENAS: analysis_id, status, created_at, updated_at,
    current_version_number. Sem parecer textual, score ou dados financeiros.

    Use esta tool quando o cliente perguntar "minha análise saiu?" — o grafo
    pode responder com o status agregado sem expor decisão interna.

    Retorna AnalysisHistoryOutput (com items possivelmente vazia) em sucesso.
    Retorna AnalysisHistoryError com código tipado em caso de falha.

    Erros mapeados:
      - LEAD_NOT_FOUND: backend retornou 404 (lead não existe ou org incorreta).
      - BACKEND_UNAVAILABLE: timeout ou erro 5xx.

    LGPD: não loga conteúdo de items — apenas contagem e lead_id (dado operacional).
    """
    import httpx

    path = _ENDPOINT_TPL.format(lead_id=lead_id)
    client = InternalApiClient()

    try:
        # Passa X-Organization-Id via request para escopo multi-tenant.
        # InternalApiClient._request aceita extra_headers para headers adicionais.
        data = await client._request(  # private mas intencional: único ponto de auth/retry
            "GET",
            path,
            extra_headers={"X-Organization-Id": organization_id},
        )
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code

        if status == 404:
            log.warning(
                "get_credit_analysis_history_not_found",
                lead_id=lead_id,
                http_status=status,
            )
            return AnalysisHistoryError(
                error_code=_ERR_NOT_FOUND,
                message=f"Lead não encontrado: {lead_id}.",
            )

        log.error(
            "get_credit_analysis_history_backend_error",
            lead_id=lead_id,
            http_status=status,
        )
        return AnalysisHistoryError(
            error_code=_ERR_BACKEND_UNAVAILABLE,
            message=f"Backend respondeu com status {status}.",
        )

    except httpx.TimeoutException:
        log.error("get_credit_analysis_history_timeout", lead_id=lead_id)
        return AnalysisHistoryError(
            error_code=_ERR_BACKEND_UNAVAILABLE,
            message="Timeout ao contactar o backend.",
        )

    # Deserializar resposta mascarada
    try:
        raw_items: list[object] = list(data.get("items") or [])
        items: list[AnalysisItemOutput] = []

        for raw in raw_items:
            if not isinstance(raw, dict):
                raise TypeError(f"Item inesperado no histórico: {type(raw)}")
            # `status` é validado pelo Literal — Pydantic rejeita valores inválidos.
            # mypy aceita str como argumento do Literal via coerção do Pydantic.
            raw_status: str = str(raw["status"])
            items.append(
                AnalysisItemOutput(
                    analysis_id=str(raw["analysis_id"]),
                    status=raw_status,  # type: ignore[arg-type]
                    current_version_number=int(raw["current_version_number"]),
                    created_at=datetime.fromisoformat(str(raw["created_at"])),
                    updated_at=datetime.fromisoformat(str(raw["updated_at"])),
                )
            )

        result = AnalysisHistoryOutput(
            lead_id=str(data["lead_id"]),
            items=items,
        )
    except (KeyError, TypeError, ValueError) as exc:
        log.error(
            "get_credit_analysis_history_parse_error",
            lead_id=lead_id,
            error=str(exc),
        )
        return AnalysisHistoryError(
            error_code=_ERR_BACKEND_UNAVAILABLE,
            message=f"Resposta inesperada do backend: {exc}",
        )

    # LGPD: não loga items — apenas lead_id e contagem (dado operacional)
    log.info(
        "get_credit_analysis_history_ok",
        lead_id=result.lead_id,
        analysis_count=len(result.items),
    )
    return result
