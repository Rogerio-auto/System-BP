"""Nó LangGraph: lawyer_handoff_node.

Implementa o fluxo D17 de 3 turnos para encaminhamento autônomo ao escritório
de advocacia quando o cliente inadimplente tem cobertura ativa.

Fluxo D17 (guard-rails obrigatórios):
  Turno 1 — Cumprimentar o cliente pelo primeiro nome.
  Turno 2 — Confirmar identidade (aguarda 'sim' / 'não').
  Turno 3 — Se confirmado: registrar referral e informar contato do escritório.
             Se negado/ausente após 2 tentativas: escalar para agente humano.

Condições de ativação (verificadas ANTES de entrar neste nó):
  - check_law_firm_status(customer_id).eligible == True
  - Feature flag retornada pelo backend (eligible=False com reason='flag_disabled' bloqueia)

Restrições LGPD (doc 17 §3.4 / §8.4 / Art. 20):
  - Apenas primeiro_nome no cumprimento — NUNCA CPF, email, telefone do customer.
  - contact_phone é do ESCRITÓRIO (PJ) — permitido na mensagem de saída.
  - Registro de decisão automatizada: backend persiste via createAiReferralService.

Restrição de arquitetura:
  - NUNCA acessa Postgres diretamente — toda I/O via tools de InternalApiClient.
  - Sem imports de Anthropic/OpenAI direto — se precisar de LLM, usar gateway.py.
"""
from __future__ import annotations

import time
from enum import StrEnum
from typing import Any

import structlog
from pydantic import BaseModel, Field

from app.tools._base import InternalApiClient
from app.tools.lawyer_handoff import (
    LawFirmInfo,
    LawFirmReferralCooldown,
    LawFirmReferralDisabled,
    LawFirmReferralSuccess,
    LawFirmStatusSuccess,
    check_law_firm_status,
    send_law_firm_referral_ai,
)

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Estado interno do nó (persistido em tool_results entre turnos)
# ---------------------------------------------------------------------------

_MAX_IDENTITY_ATTEMPTS = 2  # tentativas máximas de confirmação de identidade


class D17Step(StrEnum):
    """Etapas canônicas do fluxo D17."""

    GREET = "greet"
    CONFIRM_IDENTITY = "confirm_identity"
    SEND_REFERRAL = "send_referral"
    DONE = "done"


class LawyerHandoffState(BaseModel):
    """Estado persistido entre turnos do fluxo D17 (salvo em tool_results)."""

    step: D17Step = D17Step.GREET
    identity_attempts: int = 0
    law_firm_id: str | None = None
    law_firm_name: str | None = None
    law_firm_contact_phone: str | None = None
    referral_id: str | None = None
    escalated: bool = False

    model_config = {"use_enum_values": True}


# ---------------------------------------------------------------------------
# Helpers de mensagem (sem PII do customer — apenas primeiro nome e dados do escritório)
# ---------------------------------------------------------------------------


def _first_name(full_name: str | None) -> str:
    """Extrai o primeiro nome sem expor o nome completo."""
    if not full_name or not full_name.strip():
        return "cliente"
    return full_name.strip().split()[0]


def _msg_greet(first_name: str) -> str:
    return (
        f"Olá, {first_name}! Sou o assistente do Banco do Povo. "
        "Preciso confirmar algumas informações sobre sua situação."
    )


def _msg_confirm_identity(first_name: str) -> str:
    # LGPD §3.4 minimização: usa apenas o primeiro nome. Sobrenome removido
    # para não expor PII adicional no canal de mensagens (fix M1).
    return (
        f"Estou falando com {first_name}? "
        "Confirme com 'sim' ou 'não'."
    )


def _msg_referral_sent(law_firm_name: str, contact_phone: str) -> str:
    return (
        f"Seu processo foi encaminhado para o escritório {law_firm_name}. "
        f"Entre em contato pelo: {contact_phone}."
    )


def _msg_cooldown(cooldown_until: str) -> str:
    return (
        "Seu processo já foi encaminhado recentemente para o escritório de advocacia. "
        f"Um novo encaminhamento poderá ser feito após {cooldown_until}."
    )


# ---------------------------------------------------------------------------
# Detecção de confirmação de identidade
# ---------------------------------------------------------------------------

_POSITIVE_RESPONSES = frozenset(
    {
        "sim",
        "sim.",
        "s",
        "yes",
        "confirmo",
        "correto",
        "certo",
        "exato",
        "isso",
        "é",
        "e",
        "sou eu",
        "sou",
    }
)

_NEGATIVE_RESPONSES = frozenset(
    {
        "não",
        "nao",
        "n",
        "no",
        "errado",
        "incorreto",
        "não sou",
        "nao sou",
        "engano",
    }
)


def _parse_confirmation(message: str) -> bool | None:
    """Interpreta a resposta do cliente como confirmação ou negação.

    Returns:
        True   → cliente confirmou identidade.
        False  → cliente negou.
        None   → resposta ambígua / não reconhecida.
    """
    normalized = message.strip().lower().rstrip(".,!?")
    if normalized in _POSITIVE_RESPONSES:
        return True
    if normalized in _NEGATIVE_RESPONSES:
        return False
    return None


# ---------------------------------------------------------------------------
# Nó principal
# ---------------------------------------------------------------------------


class LawyerHandoffInput(BaseModel):
    """Parâmetros de entrada para o nó lawyer_handoff_node."""

    customer_id: str = Field(description="UUID opaco do customer.")
    organization_id: str = Field(description="UUID da organização.")
    conversation_id: str = Field(description="UUID da conversa.")
    customer_name: str | None = Field(default=None, description="Nome completo do customer.")
    last_user_message: str = Field(
        default="",
        description="Última mensagem do cliente (para detectar confirmação de identidade).",
    )


class LawyerHandoffOutput(BaseModel):
    """Resultado de um turno do nó lawyer_handoff_node."""

    reply: str = Field(description="Mensagem a ser enviada ao cliente.")
    done: bool = Field(
        default=False,
        description="True quando o fluxo D17 foi concluído (referral enviado ou escalado).",
    )
    escalate_human: bool = Field(
        default=False,
        description="True quando o nó decide escalar para agente humano.",
    )
    referral_id: str | None = Field(
        default=None,
        description="UUID do referral registrado (apenas quando done=True e sem escalada).",
    )
    d17_state: dict[str, Any] = Field(
        default_factory=dict,
        description="Estado D17 serializado para persistência entre turnos.",
    )


async def lawyer_handoff_node(
    inp: LawyerHandoffInput,
    *,
    client: InternalApiClient | None = None,
    _d17_state: LawyerHandoffState | None = None,
) -> LawyerHandoffOutput:
    """Nó LangGraph: orquestra o fluxo D17 de encaminhamento ao escritório.

    Cada chamada representa UM turno da conversa. O estado D17 deve ser
    persistido pelo orquestrador entre turnos via ``d17_state`` em tool_results.

    Turno 1 (step=greet): verifica elegibilidade, cumprimenta pelo primeiro nome.
    Turno 2 (step=confirm_identity): aguarda e interpreta confirmação.
    Turno 3 (step=send_referral): registra referral e informa contato.

    Args:
        inp: Dados de entrada do turno atual.
        client: InternalApiClient injetável em testes.
        _d17_state: Estado D17 do turno anterior (injetável em testes).
                    Em produção deve ser restaurado de tool_results pelo orquestrador.

    Returns:
        LawyerHandoffOutput com a resposta ao cliente e o estado atualizado.
    """
    start = time.monotonic()
    _client = client or InternalApiClient()

    # Restaurar ou iniciar estado D17
    state = _d17_state or LawyerHandoffState()

    log.info(
        "lawyer_handoff_node_start",
        conversation_id=inp.conversation_id,
        organization_id=inp.organization_id,
        step=state.step,
    )

    # ------------------------------------------------------------------
    # Turno 1: Verificar elegibilidade e cumprimentar
    # ------------------------------------------------------------------
    if state.step == D17Step.GREET:
        status_result = await check_law_firm_status(
            customer_id=inp.customer_id,
            organization_id=inp.organization_id,
            client=_client,
        )

        # Inelegível ou erro — não entrar no fluxo D17
        if not isinstance(status_result, LawFirmStatusSuccess):
            ineligible_reason = getattr(status_result, "reason", "unknown")
            log.info(
                "lawyer_handoff_node_ineligible",
                conversation_id=inp.conversation_id,
                organization_id=inp.organization_id,
                reason=ineligible_reason,
                has_cooldown=getattr(status_result, "cooldown_until", None) is not None,
            )

            # Cooldown ativo — informar ao cliente
            cooldown_until: str | None = getattr(status_result, "cooldown_until", None)
            if cooldown_until:
                latency_ms = (time.monotonic() - start) * 1000
                log.info(
                    "lawyer_handoff_node_cooldown_active",
                    conversation_id=inp.conversation_id,
                    latency_ms=round(latency_ms, 2),
                )
                return LawyerHandoffOutput(
                    reply=_msg_cooldown(cooldown_until),
                    done=True,
                    escalate_human=False,
                    d17_state=LawyerHandoffState(step=D17Step.DONE).model_dump(),
                )

            # Flag desabilitada ou sem cobertura — fluxo normal
            latency_ms = (time.monotonic() - start) * 1000
            log.info(
                "lawyer_handoff_node_skip",
                conversation_id=inp.conversation_id,
                reason=ineligible_reason,
                latency_ms=round(latency_ms, 2),
            )
            return LawyerHandoffOutput(
                reply="",
                done=True,
                escalate_human=False,
                d17_state=LawyerHandoffState(step=D17Step.DONE).model_dump(),
            )

        # Elegível — salvar dados do escritório no estado e cumprimentar
        law_firm: LawFirmInfo = status_result.law_firm
        state = LawyerHandoffState(
            step=D17Step.CONFIRM_IDENTITY,
            law_firm_id=law_firm.id,
            law_firm_name=law_firm.name,
            law_firm_contact_phone=law_firm.contact_phone,
        )

        first_name = _first_name(inp.customer_name)
        reply = _msg_greet(first_name)

        latency_ms = (time.monotonic() - start) * 1000
        log.info(
            "lawyer_handoff_node_greet_sent",
            conversation_id=inp.conversation_id,
            organization_id=inp.organization_id,
            law_firm_id=law_firm.id,
            latency_ms=round(latency_ms, 2),
        )
        return LawyerHandoffOutput(
            reply=reply,
            done=False,
            d17_state=state.model_dump(),
        )

    # ------------------------------------------------------------------
    # Turno 2: Confirmar identidade
    # ------------------------------------------------------------------
    if state.step == D17Step.CONFIRM_IDENTITY:
        # Primeira vez neste step → ainda não recebeu confirmação → pedir confirmação
        # (o orquestrador chama com last_user_message="" quando entra pela primeira vez)
        if not inp.last_user_message.strip() and state.identity_attempts == 0:
            first_name = _first_name(inp.customer_name)
            state = state.model_copy(update={"identity_attempts": 1})
            reply = _msg_confirm_identity(first_name)

            latency_ms = (time.monotonic() - start) * 1000
            log.info(
                "lawyer_handoff_node_confirm_identity_requested",
                conversation_id=inp.conversation_id,
                attempt=state.identity_attempts,
                latency_ms=round(latency_ms, 2),
            )
            return LawyerHandoffOutput(
                reply=reply,
                done=False,
                d17_state=state.model_dump(),
            )

        # Interpretar resposta do cliente
        confirmed = _parse_confirmation(inp.last_user_message)

        if confirmed is True:
            # Identidade confirmada → avançar para envio
            state = state.model_copy(update={"step": D17Step.SEND_REFERRAL})
            log.info(
                "lawyer_handoff_node_identity_confirmed",
                conversation_id=inp.conversation_id,
            )
            # Cair para o bloco SEND_REFERRAL abaixo — re-invoca logicamente
            # mas para manter clareza, processamos inline:
            referral_result = await send_law_firm_referral_ai(
                customer_id=inp.customer_id,
                law_firm_id=state.law_firm_id or "",
                organization_id=inp.organization_id,
                client=_client,
            )

            if isinstance(referral_result, LawFirmReferralSuccess):
                state = state.model_copy(
                    update={
                        "step": D17Step.DONE,
                        "referral_id": referral_result.referral_id,
                    }
                )
                reply = _msg_referral_sent(
                    law_firm_name=state.law_firm_name or "",
                    contact_phone=state.law_firm_contact_phone or "",
                )
                latency_ms = (time.monotonic() - start) * 1000
                log.info(
                    "lawyer_handoff_node_referral_sent",
                    conversation_id=inp.conversation_id,
                    organization_id=inp.organization_id,
                    law_firm_id=state.law_firm_id,
                    referral_id=referral_result.referral_id,
                    latency_ms=round(latency_ms, 2),
                )
                return LawyerHandoffOutput(
                    reply=reply,
                    done=True,
                    referral_id=referral_result.referral_id,
                    d17_state=state.model_dump(),
                )

            if isinstance(referral_result, LawFirmReferralCooldown):
                state = state.model_copy(update={"step": D17Step.DONE})
                latency_ms = (time.monotonic() - start) * 1000
                log.info(
                    "lawyer_handoff_node_referral_cooldown",
                    conversation_id=inp.conversation_id,
                    cooldown_until=referral_result.cooldown_until,
                    latency_ms=round(latency_ms, 2),
                )
                return LawyerHandoffOutput(
                    reply=_msg_cooldown(referral_result.cooldown_until),
                    done=True,
                    d17_state=state.model_dump(),
                )

            if isinstance(referral_result, LawFirmReferralDisabled):
                latency_ms = (time.monotonic() - start) * 1000
                log.warning(
                    "lawyer_handoff_node_feature_disabled_on_referral",
                    conversation_id=inp.conversation_id,
                    latency_ms=round(latency_ms, 2),
                )
                state = state.model_copy(update={"step": D17Step.DONE, "escalated": True})
                return LawyerHandoffOutput(
                    reply="",
                    done=True,
                    escalate_human=True,
                    d17_state=state.model_dump(),
                )

            # Erro de infra — escalar
            latency_ms = (time.monotonic() - start) * 1000
            log.error(
                "lawyer_handoff_node_referral_error",
                conversation_id=inp.conversation_id,
                error=getattr(referral_result, "error", "unknown"),
                latency_ms=round(latency_ms, 2),
            )
            state = state.model_copy(update={"step": D17Step.DONE, "escalated": True})
            return LawyerHandoffOutput(
                reply="",
                done=True,
                escalate_human=True,
                d17_state=state.model_dump(),
            )

        if confirmed is False:
            # Cliente negou identidade — escalar para humano
            latency_ms = (time.monotonic() - start) * 1000
            log.info(
                "lawyer_handoff_node_identity_denied",
                conversation_id=inp.conversation_id,
                latency_ms=round(latency_ms, 2),
            )
            state = state.model_copy(update={"step": D17Step.DONE, "escalated": True})
            return LawyerHandoffOutput(
                reply="",
                done=True,
                escalate_human=True,
                d17_state=state.model_dump(),
            )

        # Resposta ambígua — tentar novamente até o limite
        attempts = state.identity_attempts + 1
        state = state.model_copy(update={"identity_attempts": attempts})

        if attempts >= _MAX_IDENTITY_ATTEMPTS:
            latency_ms = (time.monotonic() - start) * 1000
            log.info(
                "lawyer_handoff_node_identity_max_attempts",
                conversation_id=inp.conversation_id,
                attempts=attempts,
                latency_ms=round(latency_ms, 2),
            )
            state = state.model_copy(update={"step": D17Step.DONE, "escalated": True})
            return LawyerHandoffOutput(
                reply="",
                done=True,
                escalate_human=True,
                d17_state=state.model_dump(),
            )

        first_name = _first_name(inp.customer_name)
        reply = _msg_confirm_identity(first_name)

        latency_ms = (time.monotonic() - start) * 1000
        log.info(
            "lawyer_handoff_node_confirm_identity_retry",
            conversation_id=inp.conversation_id,
            attempt=attempts,
            latency_ms=round(latency_ms, 2),
        )
        return LawyerHandoffOutput(
            reply=reply,
            done=False,
            d17_state=state.model_dump(),
        )

    # ------------------------------------------------------------------
    # Turno 3 (step=send_referral): caminho alternativo para re-entrada direta
    # ------------------------------------------------------------------
    if state.step == D17Step.SEND_REFERRAL:
        referral_result = await send_law_firm_referral_ai(
            customer_id=inp.customer_id,
            law_firm_id=state.law_firm_id or "",
            organization_id=inp.organization_id,
            client=_client,
        )

        if isinstance(referral_result, LawFirmReferralSuccess):
            state = state.model_copy(
                update={"step": D17Step.DONE, "referral_id": referral_result.referral_id}
            )
            reply = _msg_referral_sent(
                law_firm_name=state.law_firm_name or "",
                contact_phone=state.law_firm_contact_phone or "",
            )
            latency_ms = (time.monotonic() - start) * 1000
            log.info(
                "lawyer_handoff_node_referral_sent",
                conversation_id=inp.conversation_id,
                organization_id=inp.organization_id,
                law_firm_id=state.law_firm_id,
                referral_id=referral_result.referral_id,
                latency_ms=round(latency_ms, 2),
            )
            return LawyerHandoffOutput(
                reply=reply,
                done=True,
                referral_id=referral_result.referral_id,
                d17_state=state.model_dump(),
            )

        if isinstance(referral_result, LawFirmReferralCooldown):
            state = state.model_copy(update={"step": D17Step.DONE})
            latency_ms = (time.monotonic() - start) * 1000
            log.info(
                "lawyer_handoff_node_referral_cooldown",
                conversation_id=inp.conversation_id,
                cooldown_until=referral_result.cooldown_until,
                latency_ms=round(latency_ms, 2),
            )
            return LawyerHandoffOutput(
                reply=_msg_cooldown(referral_result.cooldown_until),
                done=True,
                d17_state=state.model_dump(),
            )

        # Erro ou feature disabled → escalar
        state = state.model_copy(update={"step": D17Step.DONE, "escalated": True})
        latency_ms = (time.monotonic() - start) * 1000
        log.error(
            "lawyer_handoff_node_send_referral_error",
            conversation_id=inp.conversation_id,
            result_type=type(referral_result).__name__,
            latency_ms=round(latency_ms, 2),
        )
        return LawyerHandoffOutput(
            reply="",
            done=True,
            escalate_human=True,
            d17_state=state.model_dump(),
        )

    # ------------------------------------------------------------------
    # Step DONE — fluxo já encerrado; retorno defensivo
    # ------------------------------------------------------------------
    latency_ms = (time.monotonic() - start) * 1000
    log.warning(
        "lawyer_handoff_node_already_done",
        conversation_id=inp.conversation_id,
        latency_ms=round(latency_ms, 2),
    )
    return LawyerHandoffOutput(
        reply="",
        done=True,
        d17_state=state.model_dump(),
    )


__all__ = [
    "D17Step",
    "LawyerHandoffInput",
    "LawyerHandoffOutput",
    "LawyerHandoffState",
    "lawyer_handoff_node",
]
