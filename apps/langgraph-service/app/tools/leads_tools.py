"""Tools LangGraph: get_or_create_lead + get_customer_context + update_lead_profile.

Wrappers finos sobre endpoints internos do backend Node.
Nunca acessa Postgres diretamente — toda I/O passa por InternalApiClient.

Docs de referência:
  - get_or_create_lead  → docs/06-langgraph-agentes.md §7.1
  - get_customer_context → docs/06-langgraph-agentes.md §7.6
  - update_lead_profile → docs/06-langgraph-agentes.md §7.1 (PATCH /internal/leads/:id)

LGPD (doc 06 §7.6 + doc 17 §3.4):
  - get_customer_context retorna ficha resumida sem PII sensível.
  - NÃO retorna CPF, phone, email, document_number, notes.
  - `name` retornado por necessidade operacional (personalização da conversa);
    base legal: legítimo interesse (doc 17 §3.3 item 1).
  - Log de name proibido — omitido de todos os log.info/log.warning abaixo.
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
    organization_id: str | None = Field(
        default=None,
        description="UUID da organização (multi-tenant). Repassado ao backend.",
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
    organization_id: str | None = None,
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
    # `if name` (nao `is not None`): string vazia "" do LLM seria rejeitada pelo
    # Zod do backend (name.min(1)) com 400. Tratamos "" como ausente -> backend
    # usa placeholder "Desconhecido" so quando nao ha nenhum nome disponivel.
    if name:
        payload["name"] = name
    if organization_id is not None:
        payload["organization_id"] = organization_id
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


# ===========================================================================
# Tool: get_customer_context (doc 06 §7.6)
# ===========================================================================

_CONTEXT_ENDPOINT_TPL = "/internal/customers/{entity_id}/context"

# ---------------------------------------------------------------------------
# Schema de entrada
# ---------------------------------------------------------------------------


class GetCustomerContextInput(BaseModel):
    """Input validado para a tool get_customer_context (doc 06 §7.6).

    Aceita ``lead_id`` OU ``customer_id`` (exatamente um deve ser fornecido).
    Se ambos forem fornecidos, ``lead_id`` tem precedência.
    """

    lead_id: str | None = Field(
        default=None,
        description=(
            "UUID do lead a ser consultado. "
            "Use este campo quando o LangGraph já conhece o lead_id."
        ),
    )
    customer_id: str | None = Field(
        default=None,
        description=(
            "UUID do customer (entidade convertida). "
            "Use quando o lead_id não está disponível mas o customer_id sim."
        ),
    )


# ---------------------------------------------------------------------------
# Schemas de saída
# ---------------------------------------------------------------------------


class LastSimulation(BaseModel):
    """Ficha resumida da última simulação de crédito (dados financeiros — não PII)."""

    simulation_id: str
    amount_requested: str
    term_months: int
    monthly_payment: str
    created_at: str
    sent_at: str | None


class LastAnalysis(BaseModel):
    """Ficha resumida da última análise de crédito (apenas status e datas — não PII)."""

    analysis_id: str
    status: str
    created_at: str
    concluded_at: str | None


class GetCustomerContextSuccess(BaseModel):
    """Ficha resumida do lead/customer — sem dados sensíveis (doc 06 §7.6 + doc 17 §3.4).

    Campos NÃO presentes (propositalmente omitidos por LGPD):
      CPF, phone, email, RG, document_number, document_hash, notes.

    ``name`` é retornado por necessidade operacional (personalização da conversa);
    base legal: legítimo interesse (doc 17 §3.3 item 1). Não logar em claro.
    """

    ok: Literal[True] = True
    lead_id: str
    customer_id: str | None
    name: str
    city_name: str | None
    agent_name: str | None
    current_stage: str | None
    lead_status: str
    last_simulation: LastSimulation | None
    last_analysis: LastAnalysis | None
    messages_last_30_days: int


class GetCustomerContextError(BaseModel):
    """Resposta de erro mapeada para get_customer_context."""

    ok: Literal[False] = False
    error_code: str
    message: str


GetCustomerContextResult = GetCustomerContextSuccess | GetCustomerContextError

# Códigos de erro canônicos
_ERR_NOT_FOUND = "CUSTOMER_NOT_FOUND"
_ERR_INVALID_INPUT = "INVALID_INPUT"
_ERR_BACKEND_UNAVAILABLE = "BACKEND_UNAVAILABLE"

# ---------------------------------------------------------------------------
# Implementação da tool
# ---------------------------------------------------------------------------


@tool(args_schema=GetCustomerContextInput)
async def get_customer_context(
    lead_id: str | None = None,
    customer_id: str | None = None,
) -> GetCustomerContextResult:
    """Retorna ficha resumida de um lead/customer sem dados sensíveis.

    Chama GET /internal/customers/:id/context no backend Node.
    Aceita lead_id OU customer_id — lead_id tem precedência quando ambos fornecidos.

    A ficha inclui: nome, cidade, agente, estágio atual, último estágio,
    última simulação (dados financeiros), última análise (status + datas),
    contagem de mensagens nos últimos 30 dias.

    NÃO retorna: CPF, phone, email, RG, documentos, notes.

    Erros mapeados:
      - CUSTOMER_NOT_FOUND: backend retornou 404.
      - INVALID_INPUT: nem lead_id nem customer_id fornecidos.
      - BACKEND_UNAVAILABLE: timeout ou erro 5xx.
    """
    import httpx

    # Validar que ao menos um identificador foi fornecido
    if lead_id is None and customer_id is None:
        return GetCustomerContextError(
            error_code=_ERR_INVALID_INPUT,
            message="Forneça lead_id ou customer_id para consultar o contexto.",
        )

    # Determinar entidade e query-param ?type
    if lead_id is not None:
        entity_id = lead_id
        entity_type = "lead"
    else:
        # customer_id is not None por exclusão do if acima
        entity_id = customer_id  # type: ignore[assignment]
        entity_type = "customer"

    path = _CONTEXT_ENDPOINT_TPL.format(entity_id=entity_id)
    client = InternalApiClient()

    try:
        data = await client.get(path, params={"type": entity_type})
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code

        if status == 404:
            log.warning(
                "get_customer_context_not_found",
                entity_type=entity_type,
                entity_id=entity_id,
                http_status=status,
            )
            return GetCustomerContextError(
                error_code=_ERR_NOT_FOUND,
                message=f"{entity_type.capitalize()} não encontrado: {entity_id}.",
            )

        log.error(
            "get_customer_context_backend_error",
            entity_type=entity_type,
            entity_id=entity_id,
            http_status=status,
        )
        return GetCustomerContextError(
            error_code=_ERR_BACKEND_UNAVAILABLE,
            message=f"Backend respondeu com status {status}.",
        )

    except httpx.TimeoutException:
        log.error(
            "get_customer_context_timeout",
            entity_type=entity_type,
            entity_id=entity_id,
        )
        return GetCustomerContextError(
            error_code=_ERR_BACKEND_UNAVAILABLE,
            message="Timeout ao contactar o backend.",
        )

    # Deserializar ficha resumida
    try:
        raw_sim = data.get("last_simulation")
        last_simulation: LastSimulation | None = (
            LastSimulation(
                simulation_id=str(raw_sim["simulation_id"]),
                amount_requested=str(raw_sim["amount_requested"]),
                term_months=int(raw_sim["term_months"]),
                monthly_payment=str(raw_sim["monthly_payment"]),
                created_at=str(raw_sim["created_at"]),
                sent_at=str(raw_sim["sent_at"]) if raw_sim.get("sent_at") else None,
            )
            if raw_sim is not None
            else None
        )

        raw_analysis = data.get("last_analysis")
        last_analysis: LastAnalysis | None = (
            LastAnalysis(
                analysis_id=str(raw_analysis["analysis_id"]),
                status=str(raw_analysis["status"]),
                created_at=str(raw_analysis["created_at"]),
                concluded_at=(
                    str(raw_analysis["concluded_at"])
                    if raw_analysis.get("concluded_at")
                    else None
                ),
            )
            if raw_analysis is not None
            else None
        )

        result = GetCustomerContextSuccess(
            lead_id=str(data["lead_id"]),
            customer_id=str(data["customer_id"]) if data.get("customer_id") else None,
            name=str(data["name"]),
            city_name=str(data["city_name"]) if data.get("city_name") else None,
            agent_name=str(data["agent_name"]) if data.get("agent_name") else None,
            current_stage=str(data["current_stage"]) if data.get("current_stage") else None,
            lead_status=str(data["lead_status"]),
            last_simulation=last_simulation,
            last_analysis=last_analysis,
            messages_last_30_days=int(data.get("messages_last_30_days", 0)),
        )
    except (KeyError, TypeError, ValueError) as exc:
        log.error("get_customer_context_parse_error", error=str(exc))
        return GetCustomerContextError(
            error_code=_ERR_BACKEND_UNAVAILABLE,
            message=f"Resposta inesperada do backend: {exc}",
        )

    # LGPD: não logar name em claro (doc 17 §3.4 / pino.redact equivalente)
    log.info(
        "get_customer_context_ok",
        lead_id=result.lead_id,
        customer_id=result.customer_id,
        lead_status=result.lead_status,
        messages_last_30_days=result.messages_last_30_days,
    )
    return result


# ===========================================================================
# Tool: update_lead_profile (doc 06 §7.1 — PATCH /internal/leads/:id, F3-S12)
# ===========================================================================

_UPDATE_ENDPOINT_TPL = "/internal/leads/{lead_id}"

# ---------------------------------------------------------------------------
# Schema de entrada
# ---------------------------------------------------------------------------


class UpdateLeadProfileInput(BaseModel):
    """Input validado para a tool update_lead_profile.

    Todos os campos de atualização são opcionais — a tool realiza patch parcial.
    Ao menos um campo de atualização deve ser fornecido além de ``lead_id``.
    """

    lead_id: str = Field(
        description="UUID do lead a ser atualizado.",
    )
    organization_id: str | None = Field(
        default=None,
        description="UUID da organização (obrigatório no backend — canal M2M sem JWT).",
    )
    name: str | None = Field(
        default=None,
        description="Nome completo atualizado do lead.",
    )
    city_id: str | None = Field(
        default=None,
        description="UUID da cidade do lead.",
    )
    requested_amount: str | None = Field(
        default=None,
        description=(
            "Valor solicitado de crédito como string numérica — ex.: '5000.00'."
        ),
    )
    requested_term_months: int | None = Field(
        default=None,
        description="Prazo solicitado em meses — ex.: 12.",
    )


# ---------------------------------------------------------------------------
# Schemas de saída
# ---------------------------------------------------------------------------


class UpdateLeadProfileSuccess(BaseModel):
    """Resposta bem-sucedida do backend para atualização de lead."""

    ok: Literal[True] = True
    lead_id: str
    current_stage: str | None
    city_id: str | None
    name: str | None


class UpdateLeadProfileError(BaseModel):
    """Resposta de erro mapeada para update_lead_profile."""

    ok: Literal[False] = False
    error_code: str
    message: str


UpdateLeadProfileResult = UpdateLeadProfileSuccess | UpdateLeadProfileError

# Códigos de erro canônicos
_ERR_UPDATE_NOT_FOUND = "LEAD_NOT_FOUND"
_ERR_UPDATE_INVALID_INPUT = "INVALID_INPUT"
_ERR_UPDATE_BACKEND_UNAVAILABLE = "BACKEND_UNAVAILABLE"

# ---------------------------------------------------------------------------
# Implementação da tool
# ---------------------------------------------------------------------------


@tool(args_schema=UpdateLeadProfileInput)
async def update_lead_profile(
    lead_id: str,
    organization_id: str | None = None,
    name: str | None = None,
    city_id: str | None = None,
    requested_amount: str | None = None,
    requested_term_months: int | None = None,
) -> UpdateLeadProfileResult:
    """Atualiza o perfil de um lead via PATCH /internal/leads/:id.

    Realiza patch parcial — apenas campos não-nulos são enviados no payload.
    Retorna UpdateLeadProfileSuccess com os dados atualizados do lead,
    ou UpdateLeadProfileError com código tipado em caso de falha.

    Erros mapeados:
      - LEAD_NOT_FOUND: backend retornou 404.
      - INVALID_INPUT: nenhum campo de atualização fornecido.
      - BACKEND_UNAVAILABLE: timeout ou erro 5xx.

    LGPD: ``name`` é dado operacional; não é logado em claro (doc 17 §3.4).
    """
    import httpx

    # Validar que ao menos um campo de atualização foi fornecido
    update_fields: dict[str, object] = {}
    if name is not None:
        update_fields["name"] = name
    if city_id is not None:
        update_fields["city_id"] = city_id
    if requested_amount is not None:
        # O endpoint exige número; o LLM manda string ("5000.00", "5.000,00",
        # "R$ 5000"). Normaliza milhar/decimal e coage para float; se não for
        # numérico, ignora o campo em vez de quebrar o turno (400).
        raw_amount = str(requested_amount).strip().replace("R$", "").replace(" ", "")
        if "," in raw_amount and "." in raw_amount:
            raw_amount = raw_amount.replace(".", "").replace(",", ".")
        elif "," in raw_amount:
            raw_amount = raw_amount.replace(",", ".")
        try:
            update_fields["requested_amount"] = float(raw_amount)
        except ValueError:
            log.warning("update_lead_profile_amount_parse_skip", lead_id=lead_id)
    if requested_term_months is not None:
        update_fields["requested_term_months"] = requested_term_months

    if not update_fields:
        return UpdateLeadProfileError(
            error_code=_ERR_UPDATE_INVALID_INPUT,
            message=(
                "Forneça ao menos um campo para atualizar: "
                "name, city_id, requested_amount ou requested_term_months."
            ),
        )

    # organization_id é OBRIGATÓRIO no body do PATCH (endpoint .strict(), canal
    # M2M sem JWT). Vem autoritativo do estado via agent_turn — não dos update_fields.
    request_body: dict[str, object] = {**update_fields}
    if organization_id is not None:
        request_body["organization_id"] = organization_id

    path = _UPDATE_ENDPOINT_TPL.format(lead_id=lead_id)
    idempotency_key = f"update_lead_profile_{lead_id}"
    client = InternalApiClient()

    try:
        # _request is the shared retry/auth layer; PATCH is not exposed as a
        # named method on InternalApiClient but the transport is method-agnostic.
        data = await client._request(  # private but intentional: shared auth/retry layer
            "PATCH",
            path,
            json=request_body,
            extra_headers={"Idempotency-Key": idempotency_key},
        )
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code

        if status == 404:
            log.warning(
                "update_lead_profile_not_found",
                lead_id=lead_id,
                http_status=status,
            )
            return UpdateLeadProfileError(
                error_code=_ERR_UPDATE_NOT_FOUND,
                message=f"Lead não encontrado: {lead_id}.",
            )

        if status in (400, 422):
            try:
                body: dict[str, object] = exc.response.json()
            except Exception:
                body = {}
            message = str(body.get("message", exc.response.text))
            log.warning(
                "update_lead_profile_validation_error",
                lead_id=lead_id,
                http_status=status,
            )
            return UpdateLeadProfileError(
                error_code=_ERR_UPDATE_INVALID_INPUT,
                message=message,
            )

        # 5xx ou outros — BACKEND_UNAVAILABLE
        log.error(
            "update_lead_profile_backend_error",
            lead_id=lead_id,
            http_status=status,
        )
        return UpdateLeadProfileError(
            error_code=_ERR_UPDATE_BACKEND_UNAVAILABLE,
            message=f"Backend respondeu com status {status}.",
        )

    except httpx.TimeoutException:
        log.error("update_lead_profile_timeout", lead_id=lead_id)
        return UpdateLeadProfileError(
            error_code=_ERR_UPDATE_BACKEND_UNAVAILABLE,
            message="Timeout ao contactar o backend.",
        )

    # Deserializar resposta de sucesso
    try:
        result = UpdateLeadProfileSuccess(
            lead_id=str(data["lead_id"]),
            current_stage=str(data["current_stage"]) if data.get("current_stage") else None,
            city_id=str(data["city_id"]) if data.get("city_id") else None,
            name=str(data["name"]) if data.get("name") else None,
        )
    except (KeyError, TypeError, ValueError) as exc:
        log.error("update_lead_profile_parse_error", lead_id=lead_id, error=str(exc))
        return UpdateLeadProfileError(
            error_code=_ERR_UPDATE_BACKEND_UNAVAILABLE,
            message=f"Resposta inesperada do backend: {exc}",
        )

    # LGPD: não logar name em claro (doc 17 §3.4)
    log.info(
        "update_lead_profile_ok",
        lead_id=result.lead_id,
        city_id=result.city_id,
        current_stage=result.current_stage,
    )
    return result
