"""Tool LangGraph: get_or_create_lead.

Wrapper fino sobre POST /internal/leads/get-or-create (F3-S04).
Nunca acessa Postgres diretamente — toda I/O passa por InternalApiClient.

Doc de referência: docs/06-langgraph-agentes.md §7.1
"""
from __future__ import annotations

from enum import StrEnum
from typing import Literal

import structlog
from langchain_core.tools import tool
from pydantic import BaseModel, Field

from app.tools._base import InternalApiClient

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

_ENDPOINT = "/internal/leads/get-or-create"


# ---------------------------------------------------------------------------
# Tipos de erro mapeados (doc 06 §7.1)
# ---------------------------------------------------------------------------


class LeadErrorCode(StrEnum):
    """Códigos de erro que o backend pode retornar para get-or-create."""

    INVALID_PHONE = "INVALID_PHONE"
    LEAD_MERGE_REQUIRED = "LEAD_MERGE_REQUIRED"
    BACKEND_UNAVAILABLE = "BACKEND_UNAVAILABLE"


# ---------------------------------------------------------------------------
# Schema de entrada
# ---------------------------------------------------------------------------


class GetOrCreateLeadInput(BaseModel):
    """Input validado para a tool get_or_create_lead (doc 06 §7.1)."""

    phone: str = Field(
        description="Telefone no formato E.164 — ex.: +5569999999999",
    )
    name: str | None = Field(
        default=None,
        description="Nome completo do lead, quando disponível.",
    )
    source: str = Field(
        default="whatsapp",
        description="Canal de origem: whatsapp | webchat | api.",
    )
    chatwoot_conversation_id: str | None = Field(
        default=None,
        description="ID da conversa Chatwoot associada, se houver.",
    )
    correlation_id: str | None = Field(
        default=None,
        description="UUID de correlação para rastreamento distribuído.",
    )


# ---------------------------------------------------------------------------
# Schemas de saída
# ---------------------------------------------------------------------------


class GetOrCreateLeadSuccess(BaseModel):
    """Resposta bem-sucedida do backend (doc 06 §7.1 — output)."""

    ok: Literal[True] = True
    lead_id: str
    customer_id: str | None
    created: bool
    current_stage: str
    city_id: str | None
    assigned_agent_id: str | None


class GetOrCreateLeadError(BaseModel):
    """Resposta de erro mapeada do backend (doc 06 §7.1 — erros)."""

    ok: Literal[False] = False
    error_code: LeadErrorCode
    message: str


GetOrCreateLeadResult = GetOrCreateLeadSuccess | GetOrCreateLeadError


# ---------------------------------------------------------------------------
# Implementação da tool
# ---------------------------------------------------------------------------


@tool(args_schema=GetOrCreateLeadInput)
async def get_or_create_lead(
    phone: str,
    name: str | None = None,
    source: str = "whatsapp",
    chatwoot_conversation_id: str | None = None,
    correlation_id: str | None = None,
) -> GetOrCreateLeadResult:
    """Garante que existe um lead para o telefone informado.

    Chama POST /internal/leads/get-or-create no backend Node.
    Retorna GetOrCreateLeadSuccess quando o backend responde com sucesso,
    ou GetOrCreateLeadError com o código de erro tipado para os casos
    INVALID_PHONE, LEAD_MERGE_REQUIRED e BACKEND_UNAVAILABLE.

    Idempotência: usa phone como chave — o backend garante upsert seguro.
    """
    import httpx

    # Montar idempotency key determinística (telefone normalizado)
    idempotency_key = f"get_or_create_lead_{phone}"

    # Propagar correlation_id no contexto structlog se presente
    if correlation_id:
        structlog.contextvars.bind_contextvars(correlation_id=correlation_id)

    payload: dict[str, object] = {"phone": phone, "source": source}
    if name is not None:
        payload["name"] = name
    if chatwoot_conversation_id is not None:
        payload["chatwoot_conversation_id"] = chatwoot_conversation_id
    if correlation_id is not None:
        payload["correlation_id"] = correlation_id

    client = InternalApiClient()

    try:
        data = await client.post(
            _ENDPOINT,
            json=payload,
            idempotency_key=idempotency_key,
        )
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code

        if status in (400, 422, 409):
            # Tentar extrair código de erro do corpo JSON
            try:
                body: dict[str, object] = exc.response.json()
            except Exception:
                body = {}

            raw_code = str(body.get("code", ""))
            message = str(body.get("message", exc.response.text))

            try:
                error_code = LeadErrorCode(raw_code)
            except ValueError:
                # Código desconhecido — tratar como indisponibilidade
                error_code = LeadErrorCode.BACKEND_UNAVAILABLE
                message = f"Unexpected error code '{raw_code}': {message}"

            log.warning(
                "get_or_create_lead_error",
                error_code=error_code,
                phone=_mask_phone(phone),
                http_status=status,
            )
            return GetOrCreateLeadError(error_code=error_code, message=message)

        # 5xx ou outros — reportar como BACKEND_UNAVAILABLE
        log.error(
            "get_or_create_lead_backend_unavailable",
            phone=_mask_phone(phone),
            http_status=status,
        )
        return GetOrCreateLeadError(
            error_code=LeadErrorCode.BACKEND_UNAVAILABLE,
            message=f"Backend respondeu com status {status}.",
        )

    except httpx.TimeoutException:
        log.error("get_or_create_lead_timeout", phone=_mask_phone(phone))
        return GetOrCreateLeadError(
            error_code=LeadErrorCode.BACKEND_UNAVAILABLE,
            message="Timeout ao contactar o backend.",
        )

    # Deserializar resposta de sucesso
    try:
        result = GetOrCreateLeadSuccess(
            lead_id=str(data["lead_id"]),
            customer_id=str(data["customer_id"]) if data.get("customer_id") else None,
            created=bool(data.get("created", False)),
            current_stage=str(data.get("current_stage", "")),
            city_id=str(data["city_id"]) if data.get("city_id") else None,
            assigned_agent_id=(
                str(data["assigned_agent_id"]) if data.get("assigned_agent_id") else None
            ),
        )
    except (KeyError, TypeError, ValueError) as exc:
        log.error("get_or_create_lead_parse_error", error=str(exc))
        return GetOrCreateLeadError(
            error_code=LeadErrorCode.BACKEND_UNAVAILABLE,
            message=f"Resposta inesperada do backend: {exc}",
        )

    log.info(
        "get_or_create_lead_ok",
        lead_id=result.lead_id,
        created=result.created,
        current_stage=result.current_stage,
    )
    return result


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mask_phone(phone: str) -> str:
    """Mascara telefone para logs — preserva DDD, oculta 4 dígitos centrais.

    Ex.: +5569999999999 → +5569****9999
    """
    if len(phone) < 8:
        return "***"
    return f"{phone[:6]}****{phone[-4:]}"
