"""Testes unitários para log_ai_decision (audit_tools.py).

Cobre:
- Log de sucesso: payload correto, headers obrigatórios, retorno de decision_log_id.
- Log com campo ``error`` preenchido (nó que falhou).
- Omissão de campos opcionais None do payload JSON.
- Campos opcionais presentes quando fornecidos (lead_id, tokens, latency, etc.).
- Propagação de HTTPStatusError quando o backend falha.
"""
from __future__ import annotations

import json
import uuid

import httpx
import pytest
import respx

from app.config import settings
from app.tools.audit_tools import LogAiDecisionInput, LogAiDecisionOutput, log_ai_decision

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _base(path: str) -> str:
    """Monta URL completa a partir de settings — replica lógica de _build_url."""
    raw = str(settings.backend_internal_url)
    base = raw if raw.endswith("/") else f"{raw}/"
    return f"{base}{path.lstrip('/')}"


def _decisions_url() -> str:
    return _base("/internal/ai/decisions")


def _make_input(**overrides: object) -> LogAiDecisionInput:
    """Retorna um LogAiDecisionInput mínimo válido com overrides opcionais."""
    defaults: dict[str, object] = {
        "organization_id": str(uuid.uuid4()),
        "conversation_id": str(uuid.uuid4()),
        "node_name": "classify_intent",
        "correlation_id": str(uuid.uuid4()),
        "decision": {"intent": "quer_simular", "next_node": "identify_city"},
    }
    return LogAiDecisionInput(**{**defaults, **overrides})  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Sucesso básico
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_log_ai_decision_success_returns_decision_log_id() -> None:
    """Deve retornar decision_log_id recebido do backend."""
    expected_id = str(uuid.uuid4())
    url = _decisions_url()

    with respx.mock:
        route = respx.post(url).mock(
            return_value=httpx.Response(200, json={"decision_log_id": expected_id})
        )
        inp = _make_input()
        result = await log_ai_decision(inp)

    assert route.called
    assert isinstance(result, LogAiDecisionOutput)
    assert result.decision_log_id == expected_id


@pytest.mark.asyncio()
async def test_log_ai_decision_sends_internal_token() -> None:
    """X-Internal-Token deve estar presente no request ao backend."""
    url = _decisions_url()

    with respx.mock:
        route = respx.post(url).mock(
            return_value=httpx.Response(200, json={"decision_log_id": str(uuid.uuid4())})
        )
        inp = _make_input()
        await log_ai_decision(inp)

    sent_token = route.calls.last.request.headers.get("x-internal-token")
    assert sent_token == settings.internal_token.get_secret_value()


@pytest.mark.asyncio()
async def test_log_ai_decision_sends_required_fields() -> None:
    """Campos obrigatórios devem estar presentes no payload JSON."""
    url = _decisions_url()
    conv_id = str(uuid.uuid4())
    org_id = str(uuid.uuid4())
    corr_id = str(uuid.uuid4())
    decision_payload: dict[str, object] = {"intent": "quer_credito"}

    with respx.mock:
        route = respx.post(url).mock(
            return_value=httpx.Response(200, json={"decision_log_id": str(uuid.uuid4())})
        )
        inp = _make_input(
            organization_id=org_id,
            conversation_id=conv_id,
            correlation_id=corr_id,
            node_name="classify_intent",
            decision=decision_payload,
        )
        await log_ai_decision(inp)

    body: dict[str, object] = json.loads(route.calls.last.request.content)
    assert body["organizationId"] == org_id
    assert body["conversationId"] == conv_id
    assert body["correlationId"] == corr_id
    assert body["nodeName"] == "classify_intent"
    assert body["decision"] == decision_payload


# ---------------------------------------------------------------------------
# Log com campo error preenchido
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_log_ai_decision_with_error_field() -> None:
    """Quando o nó falhou, ``error`` deve aparecer no payload enviado ao backend."""
    url = _decisions_url()
    error_msg = "LLM timeout after 8s — fallback to human handoff"

    with respx.mock:
        route = respx.post(url).mock(
            return_value=httpx.Response(200, json={"decision_log_id": str(uuid.uuid4())})
        )
        inp = _make_input(
            node_name="generate_simulation",
            error=error_msg,
            decision={},
        )
        result = await log_ai_decision(inp)

    assert isinstance(result, LogAiDecisionOutput)
    body: dict[str, object] = json.loads(route.calls.last.request.content)
    assert body["error"] == error_msg


# ---------------------------------------------------------------------------
# Campos opcionais: omitidos quando None
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_log_ai_decision_omits_optional_none_fields() -> None:
    """Campos opcionais com valor None não devem aparecer no payload."""
    url = _decisions_url()

    with respx.mock:
        route = respx.post(url).mock(
            return_value=httpx.Response(200, json={"decision_log_id": str(uuid.uuid4())})
        )
        inp = _make_input(
            lead_id=None,
            intent=None,
            prompt_key=None,
            prompt_version=None,
            model=None,
            tokens_in=None,
            tokens_out=None,
            latency_ms=None,
            error=None,
        )
        await log_ai_decision(inp)

    body: dict[str, object] = json.loads(route.calls.last.request.content)
    for optional_key in (
        "leadId",
        "intent",
        "promptKey",
        "promptVersion",
        "model",
        "tokensIn",
        "tokensOut",
        "latencyMs",
        "error",
    ):
        assert optional_key not in body, f"campo '{optional_key}' não deveria estar no payload"


# ---------------------------------------------------------------------------
# Campos opcionais presentes quando fornecidos
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_log_ai_decision_includes_optional_fields_when_provided() -> None:
    """Campos opcionais devem aparecer no payload quando fornecidos."""
    url = _decisions_url()
    lead_id = str(uuid.uuid4())

    with respx.mock:
        route = respx.post(url).mock(
            return_value=httpx.Response(200, json={"decision_log_id": str(uuid.uuid4())})
        )
        inp = _make_input(
            lead_id=lead_id,
            intent="quer_simular",
            prompt_key="intent_classifier",
            prompt_version="intent_classifier@v3",
            model="anthropic/claude-3.5-haiku",
            tokens_in=512,
            tokens_out=64,
            latency_ms=340,
        )
        await log_ai_decision(inp)

    body: dict[str, object] = json.loads(route.calls.last.request.content)
    assert body["leadId"] == lead_id
    assert body["intent"] == "quer_simular"
    assert body["promptKey"] == "intent_classifier"
    assert body["promptVersion"] == "intent_classifier@v3"
    assert body["model"] == "anthropic/claude-3.5-haiku"
    assert body["tokensIn"] == 512
    assert body["tokensOut"] == 64
    assert body["latencyMs"] == 340


# ---------------------------------------------------------------------------
# Propagação de erro HTTP do backend
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_log_ai_decision_raises_on_backend_error() -> None:
    """HTTPStatusError do backend deve propagar para o chamador (sem swallow)."""
    url = _decisions_url()

    with respx.mock:
        respx.post(url).mock(return_value=httpx.Response(500, json={"error": "internal"}))
        inp = _make_input()
        with pytest.raises(httpx.HTTPStatusError) as exc_info:
            await log_ai_decision(inp)

    # Após retry esgotado, deve levantar o 500
    assert exc_info.value.response.status_code == 500


# ---------------------------------------------------------------------------
# LGPD: campo decision é dict vazio por padrão
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_log_ai_decision_decision_defaults_to_empty_dict() -> None:
    """``decision`` deve ser {} quando não fornecido (Pydantic default_factory)."""
    url = _decisions_url()

    with respx.mock:
        route = respx.post(url).mock(
            return_value=httpx.Response(200, json={"decision_log_id": str(uuid.uuid4())})
        )
        # Cria sem o campo decision
        inp = LogAiDecisionInput(
            organization_id=str(uuid.uuid4()),
            conversation_id=str(uuid.uuid4()),
            node_name="some_node",
            correlation_id=str(uuid.uuid4()),
        )
        await log_ai_decision(inp)

    body: dict[str, object] = json.loads(route.calls.last.request.content)
    assert body["decision"] == {}
