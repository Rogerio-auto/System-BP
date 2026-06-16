"""Tools LangGraph: check_law_firm_status + send_law_firm_referral_ai.

Wrappers finos sobre endpoints internos do backend Node (F19-S03):
  GET  /internal/law-firm-status?customer_id={uuid}
  POST /internal/law-firm-status/customers/{uuid}/law-firm-referral

Nunca acessa Postgres diretamente — toda I/O via InternalApiClient.

LGPD (doc 17 §3.4 / §8.4 / Art. 20):
  - check_law_firm_status: NÃO loga nem expõe CPF, telefone ou nome completo do customer.
  - O contact_phone retornado é do ESCRITÓRIO (PJ) — pode aparecer na mensagem ao cliente.
  - send_law_firm_referral_ai: registra apenas customer_id (opaco) e law_firm_id.
  - LGPD Art. 20 (decisão automatizada): backend registra ai_decision_logs via
    createAiReferralService; este módulo não duplica esse registro.
"""
from __future__ import annotations

from typing import Literal

import httpx
import structlog
from pydantic import BaseModel, Field

from app.tools._base import InternalApiClient

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

_STATUS_ENDPOINT = "/internal/law-firm-status"
_REFERRAL_ENDPOINT_TPL = "/internal/law-firm-status/customers/{customer_id}/law-firm-referral"


# ---------------------------------------------------------------------------
# Modelos de domínio
# ---------------------------------------------------------------------------


class LawFirmInfo(BaseModel):
    """Dados do escritório de advocacia retornados pelo backend."""

    id: str = Field(description="UUID do escritório de advocacia.")
    name: str = Field(description="Nome do escritório.")
    contact_phone: str = Field(
        description="Telefone de contato do escritório (PJ — pode ser exibido ao cliente)."
    )


# ---------------------------------------------------------------------------
# Tool: check_law_firm_status
# ---------------------------------------------------------------------------


class LawFirmStatusSuccess(BaseModel):
    """Resposta quando cliente é elegível para encaminhamento ao escritório."""

    ok: Literal[True] = True
    eligible: Literal[True] = True
    law_firm: LawFirmInfo
    cooldown_until: None = None
    reason: Literal["ok"] = "ok"


class LawFirmStatusIneligible(BaseModel):
    """Resposta quando cliente NÃO é elegível para encaminhamento."""

    ok: Literal[True] = True
    eligible: Literal[False] = False
    law_firm: None = None
    cooldown_until: str | None = Field(
        default=None,
        description="ISO-8601 até quando o cooldown está ativo; null se não for cooldown.",
    )
    reason: str = Field(
        description=(
            "Motivo de inelegibilidade: "
            "'flag_disabled' | 'cooldown_active' | 'no_overdue_dues' | 'no_coverage'."
        )
    )


class LawFirmStatusError(BaseModel):
    """Erro ao consultar elegibilidade."""

    ok: Literal[False] = False
    eligible: Literal[False] = False
    law_firm: None = None
    cooldown_until: None = None
    reason: str = Field(description="Código de erro interno.")
    message: str = Field(description="Mensagem descritiva do erro.")


LawFirmStatusResult = LawFirmStatusSuccess | LawFirmStatusIneligible | LawFirmStatusError


async def check_law_firm_status(
    customer_id: str,
    organization_id: str,
    *,
    client: InternalApiClient | None = None,
) -> LawFirmStatusResult:
    """Verifica se o cliente inadimplente tem escritório vinculado e é elegível.

    Chama GET /internal/law-firm-status?customer_id={uuid} no backend Node.

    Args:
        customer_id: UUID opaco do customer (sem PII bruta).
        organization_id: UUID da organização para logging.
        client: InternalApiClient injetável em testes; cria instância se None.

    Returns:
        LawFirmStatusSuccess    → elegível, law_firm preenchido.
        LawFirmStatusIneligible → não elegível, cooldown_until e reason presentes.
        LawFirmStatusError      → falha de infra (timeout / 5xx).

    LGPD: NÃO loga customer_id em nível info nem expõe nenhum dado do customer.
    """
    _client = client or InternalApiClient()

    try:
        data = await _client.get(
            _STATUS_ENDPOINT,
            params={"customer_id": customer_id},
        )
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        log.error(
            "check_law_firm_status_http_error",
            http_status=status,
            organization_id=organization_id,
        )
        return LawFirmStatusError(
            reason="BACKEND_ERROR",
            message=f"Backend respondeu com status {status}.",
        )
    except httpx.TimeoutException:
        log.error(
            "check_law_firm_status_timeout",
            organization_id=organization_id,
        )
        return LawFirmStatusError(
            reason="TIMEOUT",
            message="Timeout ao contactar o backend.",
        )

    try:
        eligible: bool = bool(data.get("eligible", False))

        if eligible:
            raw_firm = data.get("law_firm")
            if not isinstance(raw_firm, dict):
                raise ValueError("Campo 'law_firm' ausente ou inválido na resposta.")

            law_firm = LawFirmInfo(
                id=str(raw_firm["id"]),
                name=str(raw_firm["name"]),
                contact_phone=str(raw_firm["contact_phone"]),
            )
            result: LawFirmStatusResult = LawFirmStatusSuccess(law_firm=law_firm)
            log.info(
                "check_law_firm_status_eligible",
                organization_id=organization_id,
                law_firm_id=law_firm.id,
            )
        else:
            cooldown_until: str | None = (
                str(data["cooldown_until"]) if data.get("cooldown_until") else None
            )
            reason: str = str(data.get("reason", "unknown"))
            result = LawFirmStatusIneligible(
                cooldown_until=cooldown_until,
                reason=reason,
            )
            log.info(
                "check_law_firm_status_ineligible",
                organization_id=organization_id,
                reason=reason,
                has_cooldown=cooldown_until is not None,
            )
    except (KeyError, TypeError, ValueError) as exc:
        log.error(
            "check_law_firm_status_parse_error",
            error=str(exc),
            organization_id=organization_id,
        )
        return LawFirmStatusError(
            reason="PARSE_ERROR",
            message=f"Resposta inesperada do backend: {exc}",
        )

    return result


# ---------------------------------------------------------------------------
# Tool: send_law_firm_referral_ai
# ---------------------------------------------------------------------------


class LawFirmReferralSuccess(BaseModel):
    """Resposta de sucesso do POST de encaminhamento ao escritório."""

    ok: Literal[True] = True
    referral_id: str = Field(description="UUID do referral registrado.")


class LawFirmReferralCooldown(BaseModel):
    """Resposta 409 — cooldown ativo; encaminhamento não pode ser feito agora."""

    ok: Literal[False] = False
    error: Literal["LAW_FIRM_COOLDOWN"] = "LAW_FIRM_COOLDOWN"
    cooldown_until: str = Field(description="ISO-8601 até quando o cooldown está ativo.")


class LawFirmReferralDisabled(BaseModel):
    """Resposta 403 — feature desabilitada na organização."""

    ok: Literal[False] = False
    error: Literal["FEATURE_DISABLED"] = "FEATURE_DISABLED"


class LawFirmReferralError(BaseModel):
    """Erro inesperado ao registrar encaminhamento."""

    ok: Literal[False] = False
    error: str
    message: str


LawFirmReferralResult = (
    LawFirmReferralSuccess
    | LawFirmReferralCooldown
    | LawFirmReferralDisabled
    | LawFirmReferralError
)


async def send_law_firm_referral_ai(
    customer_id: str,
    law_firm_id: str,
    organization_id: str,
    *,
    client: InternalApiClient | None = None,
) -> LawFirmReferralResult:
    """Registra encaminhamento autônomo ao escritório de advocacia.

    Chama POST /internal/law-firm-status/customers/{uuid}/law-firm-referral
    com channel='ai'. O backend registra cooldown de 7 dias automaticamente
    e grava em ai_decision_logs via createAiReferralService.

    Args:
        customer_id: UUID opaco do customer.
        law_firm_id: UUID do escritório de advocacia.
        organization_id: UUID da organização para logging.
        client: InternalApiClient injetável em testes; cria instância se None.

    Returns:
        LawFirmReferralSuccess  → encaminhamento registrado, referral_id disponível.
        LawFirmReferralCooldown → 409 — cooldown ativo, cooldown_until informado.
        LawFirmReferralDisabled → 403 — feature desabilitada.
        LawFirmReferralError    → erro inesperado de infra.

    LGPD Art. 20: o backend persiste o registro de decisão automatizada.
    """
    _client = client or InternalApiClient()
    path = _REFERRAL_ENDPOINT_TPL.format(customer_id=customer_id)

    try:
        data = await _client.post(
            path,
            json={"law_firm_id": law_firm_id, "channel": "ai"},
            idempotency_key=f"law_firm_referral_ai_{customer_id}_{law_firm_id}",
        )
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code

        if status == 409:
            try:
                body: dict[str, object] = exc.response.json()
                details = body.get("details")
                cooldown_raw: object = (
                    details.get("cooldown_until") if isinstance(details, dict) else None
                )
                cooldown_until_str: str = str(cooldown_raw) if cooldown_raw else ""
            except Exception:
                cooldown_until_str = ""
            log.warning(
                "send_law_firm_referral_cooldown",
                customer_id=customer_id,
                organization_id=organization_id,
                cooldown_until=cooldown_until_str,
            )
            return LawFirmReferralCooldown(cooldown_until=cooldown_until_str)

        if status == 403:
            log.warning(
                "send_law_firm_referral_feature_disabled",
                customer_id=customer_id,
                organization_id=organization_id,
            )
            return LawFirmReferralDisabled()

        log.error(
            "send_law_firm_referral_http_error",
            http_status=status,
            customer_id=customer_id,
            organization_id=organization_id,
        )
        return LawFirmReferralError(
            error="BACKEND_ERROR",
            message=f"Backend respondeu com status {status}.",
        )

    except httpx.TimeoutException:
        log.error(
            "send_law_firm_referral_timeout",
            customer_id=customer_id,
            organization_id=organization_id,
        )
        return LawFirmReferralError(
            error="TIMEOUT",
            message="Timeout ao contactar o backend.",
        )

    try:
        referral_id: str = str(data["referral_id"])
    except (KeyError, TypeError, ValueError) as exc:
        log.error(
            "send_law_firm_referral_parse_error",
            error=str(exc),
            organization_id=organization_id,
        )
        return LawFirmReferralError(
            error="PARSE_ERROR",
            message=f"Resposta inesperada do backend: {exc}",
        )

    log.info(
        "send_law_firm_referral_ok",
        organization_id=organization_id,
        law_firm_id=law_firm_id,
        referral_id=referral_id,
    )
    return LawFirmReferralSuccess(referral_id=referral_id)


__all__ = [
    "LawFirmInfo",
    "LawFirmReferralCooldown",
    "LawFirmReferralDisabled",
    "LawFirmReferralError",
    "LawFirmReferralResult",
    "LawFirmReferralSuccess",
    "LawFirmStatusError",
    "LawFirmStatusIneligible",
    "LawFirmStatusResult",
    "LawFirmStatusSuccess",
    "check_law_firm_status",
    "send_law_firm_referral_ai",
]
