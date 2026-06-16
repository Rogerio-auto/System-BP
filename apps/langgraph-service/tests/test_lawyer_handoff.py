"""Testes para o fluxo D17 — lawyer_handoff (F19-S06).

Cobre os cenários obrigatórios do slot:
  1. eligible=true → fluxo D17 completo (3 turnos) → referral registrado.
  2. eligible=false (flag_disabled) → não entra no fluxo.
  3. eligible=false (cooldown_active) → retorna cooldown_until ao cliente.
  4. Confirmação negada → escalar para agente humano.
  5. POST retorna 409 cooldown → tratamento correto.
  6. check_law_firm_status: timeout → retorna LawFirmStatusError.
  7. send_law_firm_referral_ai: 403 → LawFirmReferralDisabled.
  8. should_lawyer_handoff: roteamento por intenção e flag explícita.
  9. Resposta ambígua na confirmação de identidade → retry → escalada após limite.

Estratégia de mock:
  - Todas as chamadas HTTP interceptadas por ``respx``.
  - Sem chamadas reais ao backend ou LLM.

LGPD: nenhum dado real de pessoa física (todos sintéticos).
"""
from __future__ import annotations

import uuid

import httpx
import pytest
import respx

from app.config import settings
from app.graph import should_lawyer_handoff
from app.nodes.lawyer_handoff_node import (
    D17Step,
    LawyerHandoffInput,
    LawyerHandoffOutput,
    LawyerHandoffState,
    lawyer_handoff_node,
)
from app.tools.lawyer_handoff import (
    LawFirmReferralCooldown,
    LawFirmReferralDisabled,
    LawFirmReferralSuccess,
    LawFirmStatusError,
    LawFirmStatusIneligible,
    LawFirmStatusSuccess,
    check_law_firm_status,
    send_law_firm_referral_ai,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _base(path: str) -> str:
    """Monta URL completa a partir de settings."""
    raw = str(settings.backend_internal_url)
    base = raw if raw.endswith("/") else f"{raw}/"
    return f"{base}{path.lstrip('/')}"


def _status_url() -> str:
    return _base("/internal/law-firm-status")


def _referral_url(customer_id: str) -> str:
    return _base(
        f"/internal/law-firm-status/customers/{customer_id}/law-firm-referral"
    )


def _make_law_firm(
    *,
    firm_id: str | None = None,
    name: str = "Escritório Silva & Associados",
    phone: str = "(69) 3224-5678",
) -> dict[str, object]:
    return {
        "id": firm_id or str(uuid.uuid4()),
        "name": name,
        "contact_phone": phone,
    }


def _eligible_response(law_firm: dict[str, object]) -> dict[str, object]:
    return {"eligible": True, "law_firm": law_firm, "cooldown_until": None, "reason": "ok"}


def _ineligible_response(
    reason: str, cooldown_until: str | None = None
) -> dict[str, object]:
    return {
        "eligible": False,
        "law_firm": None,
        "cooldown_until": cooldown_until,
        "reason": reason,
    }


# ---------------------------------------------------------------------------
# Testes: check_law_firm_status (tool)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_check_law_firm_status_eligible() -> None:
    """eligible=true → LawFirmStatusSuccess com law_firm preenchido."""
    customer_id = str(uuid.uuid4())
    firm = _make_law_firm()

    with respx.mock:
        respx.get(_status_url()).mock(
            return_value=httpx.Response(200, json=_eligible_response(firm))
        )
        result = await check_law_firm_status(
            customer_id=customer_id,
            organization_id=str(uuid.uuid4()),
        )

    assert isinstance(result, LawFirmStatusSuccess)
    assert result.eligible is True
    assert result.law_firm.id == firm["id"]
    assert result.law_firm.name == firm["name"]
    assert result.law_firm.contact_phone == firm["contact_phone"]


@pytest.mark.asyncio()
async def test_check_law_firm_status_flag_disabled() -> None:
    """eligible=false (flag_disabled) → LawFirmStatusIneligible com reason correto."""
    customer_id = str(uuid.uuid4())

    with respx.mock:
        respx.get(_status_url()).mock(
            return_value=httpx.Response(
                200, json=_ineligible_response("flag_disabled")
            )
        )
        result = await check_law_firm_status(
            customer_id=customer_id,
            organization_id=str(uuid.uuid4()),
        )

    assert isinstance(result, LawFirmStatusIneligible)
    assert result.eligible is False
    assert result.reason == "flag_disabled"
    assert result.cooldown_until is None


@pytest.mark.asyncio()
async def test_check_law_firm_status_cooldown_active() -> None:
    """eligible=false (cooldown_active) → LawFirmStatusIneligible com cooldown_until."""
    customer_id = str(uuid.uuid4())
    cooldown = "2026-06-22T12:00:00Z"

    with respx.mock:
        respx.get(_status_url()).mock(
            return_value=httpx.Response(
                200,
                json=_ineligible_response("cooldown_active", cooldown_until=cooldown),
            )
        )
        result = await check_law_firm_status(
            customer_id=customer_id,
            organization_id=str(uuid.uuid4()),
        )

    assert isinstance(result, LawFirmStatusIneligible)
    assert result.reason == "cooldown_active"
    assert result.cooldown_until == cooldown


@pytest.mark.asyncio()
async def test_check_law_firm_status_timeout() -> None:
    """Timeout na chamada ao backend → LawFirmStatusError com reason=TIMEOUT."""
    customer_id = str(uuid.uuid4())

    with respx.mock:
        respx.get(_status_url()).mock(side_effect=httpx.TimeoutException("timeout"))
        result = await check_law_firm_status(
            customer_id=customer_id,
            organization_id=str(uuid.uuid4()),
        )

    assert isinstance(result, LawFirmStatusError)
    assert result.reason == "TIMEOUT"
    assert result.eligible is False


@pytest.mark.asyncio()
async def test_check_law_firm_status_backend_5xx() -> None:
    """Backend 5xx → LawFirmStatusError com reason=BACKEND_ERROR."""
    customer_id = str(uuid.uuid4())

    with respx.mock:
        respx.get(_status_url()).mock(
            return_value=httpx.Response(500, json={"error": "internal"})
        )
        result = await check_law_firm_status(
            customer_id=customer_id,
            organization_id=str(uuid.uuid4()),
        )

    assert isinstance(result, LawFirmStatusError)
    assert result.reason == "BACKEND_ERROR"


# ---------------------------------------------------------------------------
# Testes: send_law_firm_referral_ai (tool)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_send_law_firm_referral_ai_success() -> None:
    """POST bem-sucedido → LawFirmReferralSuccess com referral_id."""
    customer_id = str(uuid.uuid4())
    law_firm_id = str(uuid.uuid4())
    referral_id = str(uuid.uuid4())

    with respx.mock:
        respx.post(_referral_url(customer_id)).mock(
            return_value=httpx.Response(201, json={"ok": True, "referral_id": referral_id})
        )
        result = await send_law_firm_referral_ai(
            customer_id=customer_id,
            law_firm_id=law_firm_id,
            organization_id=str(uuid.uuid4()),
        )

    assert isinstance(result, LawFirmReferralSuccess)
    assert result.ok is True
    assert result.referral_id == referral_id


@pytest.mark.asyncio()
async def test_send_law_firm_referral_ai_409_cooldown() -> None:
    """POST retorna 409 → LawFirmReferralCooldown com cooldown_until."""
    customer_id = str(uuid.uuid4())
    law_firm_id = str(uuid.uuid4())
    cooldown = "2026-06-23T00:00:00Z"

    with respx.mock:
        respx.post(_referral_url(customer_id)).mock(
            return_value=httpx.Response(
                409,
                json={
                    "error": "LAW_FIRM_COOLDOWN",
                    "details": {"cooldown_until": cooldown},
                },
            )
        )
        result = await send_law_firm_referral_ai(
            customer_id=customer_id,
            law_firm_id=law_firm_id,
            organization_id=str(uuid.uuid4()),
        )

    assert isinstance(result, LawFirmReferralCooldown)
    assert result.error == "LAW_FIRM_COOLDOWN"
    assert result.cooldown_until == cooldown


@pytest.mark.asyncio()
async def test_send_law_firm_referral_ai_403_feature_disabled() -> None:
    """POST retorna 403 → LawFirmReferralDisabled."""
    customer_id = str(uuid.uuid4())
    law_firm_id = str(uuid.uuid4())

    with respx.mock:
        respx.post(_referral_url(customer_id)).mock(
            return_value=httpx.Response(
                403, json={"error": "FEATURE_DISABLED"}
            )
        )
        result = await send_law_firm_referral_ai(
            customer_id=customer_id,
            law_firm_id=law_firm_id,
            organization_id=str(uuid.uuid4()),
        )

    assert isinstance(result, LawFirmReferralDisabled)
    assert result.error == "FEATURE_DISABLED"
    assert result.ok is False


@pytest.mark.asyncio()
async def test_send_law_firm_referral_ai_sends_internal_token() -> None:
    """X-Internal-Token deve estar presente no POST de referral."""
    customer_id = str(uuid.uuid4())
    law_firm_id = str(uuid.uuid4())

    with respx.mock:
        route = respx.post(_referral_url(customer_id)).mock(
            return_value=httpx.Response(
                201, json={"ok": True, "referral_id": str(uuid.uuid4())}
            )
        )
        await send_law_firm_referral_ai(
            customer_id=customer_id,
            law_firm_id=law_firm_id,
            organization_id=str(uuid.uuid4()),
        )

    token = route.calls.last.request.headers.get("x-internal-token")
    assert token == settings.internal_token.get_secret_value()


@pytest.mark.asyncio()
async def test_send_law_firm_referral_ai_sends_channel_ai() -> None:
    """Payload deve ter channel='ai'."""
    import json

    customer_id = str(uuid.uuid4())
    law_firm_id = str(uuid.uuid4())

    with respx.mock:
        route = respx.post(_referral_url(customer_id)).mock(
            return_value=httpx.Response(
                201, json={"ok": True, "referral_id": str(uuid.uuid4())}
            )
        )
        await send_law_firm_referral_ai(
            customer_id=customer_id,
            law_firm_id=law_firm_id,
            organization_id=str(uuid.uuid4()),
        )

    body: dict[str, object] = json.loads(route.calls.last.request.content)
    assert body["channel"] == "ai"
    assert body["law_firm_id"] == law_firm_id


# ---------------------------------------------------------------------------
# Testes: lawyer_handoff_node (nó D17)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_node_eligible_turno1_greet() -> None:
    """Turno 1: eligible=true → cumprimentar pelo primeiro nome, avançar para confirm_identity."""
    customer_id = str(uuid.uuid4())
    firm_id = str(uuid.uuid4())
    firm = _make_law_firm(firm_id=firm_id)
    org_id = str(uuid.uuid4())

    with respx.mock:
        respx.get(_status_url()).mock(
            return_value=httpx.Response(200, json=_eligible_response(firm))
        )
        inp = LawyerHandoffInput(
            customer_id=customer_id,
            organization_id=org_id,
            conversation_id=str(uuid.uuid4()),
            customer_name="Maria Souza",
        )
        result = await lawyer_handoff_node(inp)

    assert isinstance(result, LawyerHandoffOutput)
    assert result.done is False
    assert "Maria" in result.reply  # primeiro nome — sem sobrenome completo exposto
    assert "Banco do Povo" in result.reply
    # Estado avançado para confirmação de identidade
    assert result.d17_state["step"] == D17Step.CONFIRM_IDENTITY
    assert result.d17_state["law_firm_id"] == firm_id


@pytest.mark.asyncio()
async def test_node_d17_complete_happy_path() -> None:
    """Fluxo D17 completo: greet → confirm_identity → send_referral → done."""
    customer_id = str(uuid.uuid4())
    firm_id = str(uuid.uuid4())
    referral_id = str(uuid.uuid4())
    firm = _make_law_firm(firm_id=firm_id, name="Advocacia Lima")
    org_id = str(uuid.uuid4())
    conv_id = str(uuid.uuid4())

    # Turno 1: greet
    with respx.mock:
        respx.get(_status_url()).mock(
            return_value=httpx.Response(200, json=_eligible_response(firm))
        )
        inp1 = LawyerHandoffInput(
            customer_id=customer_id,
            organization_id=org_id,
            conversation_id=conv_id,
            customer_name="João Silva",
        )
        out1 = await lawyer_handoff_node(inp1)

    assert out1.done is False
    assert "João" in out1.reply
    d17 = LawyerHandoffState(**out1.d17_state)
    assert d17.step == D17Step.CONFIRM_IDENTITY

    # Turno 2: pedir confirmação de identidade (sem last_user_message)
    inp2 = LawyerHandoffInput(
        customer_id=customer_id,
        organization_id=org_id,
        conversation_id=conv_id,
        customer_name="João Silva",
        last_user_message="",
    )
    out2 = await lawyer_handoff_node(inp2, _d17_state=d17)

    assert out2.done is False
    assert "João" in out2.reply
    assert "sim" in out2.reply.lower() or "confirme" in out2.reply.lower()
    d17 = LawyerHandoffState(**out2.d17_state)
    assert d17.step == D17Step.CONFIRM_IDENTITY
    assert d17.identity_attempts == 1

    # Turno 3: cliente confirma → enviar referral
    with respx.mock:
        respx.post(_referral_url(customer_id)).mock(
            return_value=httpx.Response(
                201, json={"ok": True, "referral_id": referral_id}
            )
        )
        inp3 = LawyerHandoffInput(
            customer_id=customer_id,
            organization_id=org_id,
            conversation_id=conv_id,
            customer_name="João Silva",
            last_user_message="sim",
        )
        out3 = await lawyer_handoff_node(inp3, _d17_state=d17)

    assert out3.done is True
    assert out3.escalate_human is False
    assert out3.referral_id == referral_id
    assert "Advocacia Lima" in out3.reply
    assert firm["contact_phone"] in out3.reply
    d17_final = LawyerHandoffState(**out3.d17_state)
    assert d17_final.step == D17Step.DONE


@pytest.mark.asyncio()
async def test_node_flag_disabled_skip_flow() -> None:
    """eligible=false (flag_disabled) → não entra no fluxo D17, reply vazio, done=True."""
    customer_id = str(uuid.uuid4())
    org_id = str(uuid.uuid4())

    with respx.mock:
        respx.get(_status_url()).mock(
            return_value=httpx.Response(
                200, json=_ineligible_response("flag_disabled")
            )
        )
        inp = LawyerHandoffInput(
            customer_id=customer_id,
            organization_id=org_id,
            conversation_id=str(uuid.uuid4()),
            customer_name="Ana Costa",
        )
        result = await lawyer_handoff_node(inp)

    assert result.done is True
    assert result.escalate_human is False
    assert result.reply == ""


@pytest.mark.asyncio()
async def test_node_cooldown_active_informs_customer() -> None:
    """eligible=false (cooldown_active) → informa cooldown ao cliente, done=True."""
    customer_id = str(uuid.uuid4())
    cooldown = "2026-06-23T00:00:00Z"
    org_id = str(uuid.uuid4())

    with respx.mock:
        respx.get(_status_url()).mock(
            return_value=httpx.Response(
                200,
                json=_ineligible_response("cooldown_active", cooldown_until=cooldown),
            )
        )
        inp = LawyerHandoffInput(
            customer_id=customer_id,
            organization_id=org_id,
            conversation_id=str(uuid.uuid4()),
            customer_name="Pedro Santos",
        )
        result = await lawyer_handoff_node(inp)

    assert result.done is True
    assert result.escalate_human is False
    assert cooldown in result.reply


@pytest.mark.asyncio()
async def test_node_identity_denied_escalate_human() -> None:
    """Confirmação negada ('não') → escalar para agente humano."""
    customer_id = str(uuid.uuid4())
    firm_id = str(uuid.uuid4())
    firm = _make_law_firm(firm_id=firm_id)
    org_id = str(uuid.uuid4())
    conv_id = str(uuid.uuid4())

    # Estado: já no step confirm_identity (após turno 1 de greet)
    d17 = LawyerHandoffState(
        step=D17Step.CONFIRM_IDENTITY,
        identity_attempts=1,
        law_firm_id=firm_id,
        law_firm_name=firm["name"],  # type: ignore[arg-type]
        law_firm_contact_phone=firm["contact_phone"],  # type: ignore[arg-type]
    )

    inp = LawyerHandoffInput(
        customer_id=customer_id,
        organization_id=org_id,
        conversation_id=conv_id,
        customer_name="Carlos Lima",
        last_user_message="não",
    )
    result = await lawyer_handoff_node(inp, _d17_state=d17)

    assert result.done is True
    assert result.escalate_human is True
    assert result.reply == ""


@pytest.mark.asyncio()
async def test_node_409_cooldown_on_referral() -> None:
    """POST referral retorna 409 → informa cooldown ao cliente, done=True, sem escalar."""
    customer_id = str(uuid.uuid4())
    firm_id = str(uuid.uuid4())
    firm = _make_law_firm(firm_id=firm_id)
    cooldown = "2026-06-23T00:00:00Z"
    org_id = str(uuid.uuid4())
    conv_id = str(uuid.uuid4())

    # Estado: identidade confirmada, pronto para enviar referral
    d17 = LawyerHandoffState(
        step=D17Step.CONFIRM_IDENTITY,
        identity_attempts=1,
        law_firm_id=firm_id,
        law_firm_name=firm["name"],  # type: ignore[arg-type]
        law_firm_contact_phone=firm["contact_phone"],  # type: ignore[arg-type]
    )

    with respx.mock:
        respx.post(_referral_url(customer_id)).mock(
            return_value=httpx.Response(
                409,
                json={
                    "error": "LAW_FIRM_COOLDOWN",
                    "details": {"cooldown_until": cooldown},
                },
            )
        )
        inp = LawyerHandoffInput(
            customer_id=customer_id,
            organization_id=org_id,
            conversation_id=conv_id,
            customer_name="Lucia Ferreira",
            last_user_message="sim",
        )
        result = await lawyer_handoff_node(inp, _d17_state=d17)

    assert result.done is True
    assert result.escalate_human is False
    assert cooldown in result.reply
    assert result.referral_id is None


@pytest.mark.asyncio()
async def test_node_ambiguous_response_escalates_after_max_attempts() -> None:
    """Resposta ambígua repetida → escalar para humano após atingir limite de tentativas."""
    customer_id = str(uuid.uuid4())
    firm_id = str(uuid.uuid4())
    firm = _make_law_firm(firm_id=firm_id)
    org_id = str(uuid.uuid4())
    conv_id = str(uuid.uuid4())

    # Estado: já na segunda tentativa (no limite)
    d17 = LawyerHandoffState(
        step=D17Step.CONFIRM_IDENTITY,
        identity_attempts=2,  # = _MAX_IDENTITY_ATTEMPTS
        law_firm_id=firm_id,
        law_firm_name=firm["name"],  # type: ignore[arg-type]
        law_firm_contact_phone=firm["contact_phone"],  # type: ignore[arg-type]
    )

    inp = LawyerHandoffInput(
        customer_id=customer_id,
        organization_id=org_id,
        conversation_id=conv_id,
        customer_name="Roberto Alves",
        last_user_message="talvez",  # ambíguo
    )
    result = await lawyer_handoff_node(inp, _d17_state=d17)

    assert result.done is True
    assert result.escalate_human is True
    assert result.reply == ""


@pytest.mark.asyncio()
async def test_node_does_not_include_customer_phone_in_reply() -> None:
    """LGPD: telefone do customer NÃO deve aparecer na resposta ao cliente."""
    customer_id = str(uuid.uuid4())
    firm_id = str(uuid.uuid4())
    referral_id = str(uuid.uuid4())
    customer_phone = "+5569912345678"
    firm = _make_law_firm(firm_id=firm_id, phone="(69) 3224-9999")
    org_id = str(uuid.uuid4())
    conv_id = str(uuid.uuid4())

    # Simular turno 3 (identidade já confirmada, enviar referral)
    d17 = LawyerHandoffState(
        step=D17Step.CONFIRM_IDENTITY,
        identity_attempts=1,
        law_firm_id=firm_id,
        law_firm_name=firm["name"],  # type: ignore[arg-type]
        law_firm_contact_phone=firm["contact_phone"],  # type: ignore[arg-type]
    )

    with respx.mock:
        respx.post(_referral_url(customer_id)).mock(
            return_value=httpx.Response(
                201, json={"ok": True, "referral_id": referral_id}
            )
        )
        inp = LawyerHandoffInput(
            customer_id=customer_id,
            organization_id=org_id,
            conversation_id=conv_id,
            customer_name="Teresa Gomes",
            last_user_message="sim",
        )
        result = await lawyer_handoff_node(inp, _d17_state=d17)

    # Telefone do customer NÃO deve aparecer
    assert customer_phone not in result.reply
    # Telefone do escritório PODE aparecer
    assert firm["contact_phone"] in result.reply


@pytest.mark.asyncio()
async def test_node_first_name_only_in_greet() -> None:
    """LGPD: apenas o primeiro nome aparece no cumprimento — não o nome completo."""
    customer_id = str(uuid.uuid4())
    firm = _make_law_firm()
    org_id = str(uuid.uuid4())
    full_name = "Fernanda Cristina Barbosa"

    with respx.mock:
        respx.get(_status_url()).mock(
            return_value=httpx.Response(200, json=_eligible_response(firm))
        )
        inp = LawyerHandoffInput(
            customer_id=customer_id,
            organization_id=org_id,
            conversation_id=str(uuid.uuid4()),
            customer_name=full_name,
        )
        result = await lawyer_handoff_node(inp)

    # Primeiro nome presente
    assert "Fernanda" in result.reply
    # Sobrenome NÃO deve aparecer na saudação
    assert "Cristina" not in result.reply
    assert "Barbosa" not in result.reply


# ---------------------------------------------------------------------------
# Testes: should_lawyer_handoff (roteador)
# ---------------------------------------------------------------------------


def test_should_lawyer_handoff_cobranca_intent() -> None:
    """Intent 'cobranca' deve rotear para lawyer_handoff."""
    state: dict[str, object] = {
        "current_intent": "cobranca",
        "conversation_id": str(uuid.uuid4()),
    }
    assert should_lawyer_handoff(state) == "lawyer_handoff"


def test_should_lawyer_handoff_explicit_flag() -> None:
    """Flag explícita lawyer_handoff_eligible=True deve rotear para lawyer_handoff."""
    state: dict[str, object] = {
        "current_intent": "saudacao",
        "lawyer_handoff_eligible": True,
        "conversation_id": str(uuid.uuid4()),
    }
    assert should_lawyer_handoff(state) == "lawyer_handoff"


def test_should_lawyer_handoff_other_intent() -> None:
    """Outras intenções sem flag → continuar fluxo normal."""
    for intent in ("quer_credito", "falar_atendente", "nao_entendi", "saudacao"):
        state: dict[str, object] = {
            "current_intent": intent,
            "conversation_id": str(uuid.uuid4()),
        }
        assert should_lawyer_handoff(state) == "continue", f"Falhou para intent={intent}"


def test_should_lawyer_handoff_no_intent() -> None:
    """Sem intenção e sem flag → fluxo normal."""
    state: dict[str, object] = {"conversation_id": str(uuid.uuid4())}
    assert should_lawyer_handoff(state) == "continue"


def test_should_lawyer_handoff_flag_false() -> None:
    """Flag explícita False → fluxo normal."""
    state: dict[str, object] = {
        "current_intent": "cobranca",
        "lawyer_handoff_eligible": False,
        "conversation_id": str(uuid.uuid4()),
    }
    # cobranca ainda ativa pelo intent mesmo com flag=False
    assert should_lawyer_handoff(state) == "lawyer_handoff"

    state2: dict[str, object] = {
        "current_intent": "saudacao",
        "lawyer_handoff_eligible": False,
        "conversation_id": str(uuid.uuid4()),
    }
    assert should_lawyer_handoff(state2) == "continue"


# ---------------------------------------------------------------------------
# Testes de segurança: C1 — X-Organization-Id, M3 — 401 / token não logado
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_check_law_firm_status_sends_organization_id_header() -> None:
    """C1: X-Organization-Id deve estar presente no GET /internal/law-firm-status."""
    customer_id = str(uuid.uuid4())
    org_id = str(uuid.uuid4())
    firm = _make_law_firm()

    with respx.mock:
        route = respx.get(_status_url()).mock(
            return_value=httpx.Response(200, json=_eligible_response(firm))
        )
        await check_law_firm_status(
            customer_id=customer_id,
            organization_id=org_id,
        )

    sent_org_id = route.calls.last.request.headers.get("x-organization-id")
    assert sent_org_id == org_id, (
        f"X-Organization-Id ausente ou incorreto na chamada GET. Recebido: {sent_org_id!r}"
    )


@pytest.mark.asyncio()
async def test_send_law_firm_referral_ai_sends_organization_id_header() -> None:
    """C1: X-Organization-Id deve estar presente no POST de referral."""
    customer_id = str(uuid.uuid4())
    law_firm_id = str(uuid.uuid4())
    org_id = str(uuid.uuid4())

    with respx.mock:
        route = respx.post(_referral_url(customer_id)).mock(
            return_value=httpx.Response(
                201, json={"ok": True, "referral_id": str(uuid.uuid4())}
            )
        )
        await send_law_firm_referral_ai(
            customer_id=customer_id,
            law_firm_id=law_firm_id,
            organization_id=org_id,
        )

    sent_org_id = route.calls.last.request.headers.get("x-organization-id")
    assert sent_org_id == org_id, (
        f"X-Organization-Id ausente ou incorreto na chamada POST. Recebido: {sent_org_id!r}"
    )


@pytest.mark.asyncio()
async def test_check_law_firm_status_401_returns_backend_error() -> None:
    """M3: GET retorna 401 → LawFirmStatusError (BACKEND_ERROR), sem retry.

    Verifica:
    1. Resultado é LawFirmStatusError com reason=BACKEND_ERROR.
    2. 401 não é reexecutado (_RETRYABLE_STATUS_CODES exclui 4xx).
    3. X-Internal-Token NÃO aparece no campo 'message' do erro (não logado em texto claro).
    """
    from app.tools._base import _RETRYABLE_STATUS_CODES

    customer_id = str(uuid.uuid4())
    org_id = str(uuid.uuid4())

    # Garantir que 401 não está nos status reexecutáveis
    assert 401 not in _RETRYABLE_STATUS_CODES, (
        "401 NÃO deve estar em _RETRYABLE_STATUS_CODES — autenticação não deve ser retentada."
    )

    with respx.mock:
        route = respx.get(_status_url()).mock(
            return_value=httpx.Response(401, json={"error": "Unauthorized"})
        )
        result = await check_law_firm_status(
            customer_id=customer_id,
            organization_id=org_id,
        )

    # 1. Resultado correto
    assert isinstance(result, LawFirmStatusError)
    assert result.reason == "BACKEND_ERROR"
    assert result.eligible is False

    # 2. Apenas 1 chamada realizada (sem retry)
    assert route.call_count == 1, (
        f"401 foi retentado {route.call_count - 1} vez(es) — não deve ser retentado."
    )

    # 3. Token não exposto na mensagem de erro
    token_value = settings.internal_token.get_secret_value()
    assert token_value not in result.message, (
        "X-Internal-Token não deve aparecer na mensagem de erro (vazamento de credencial)."
    )
