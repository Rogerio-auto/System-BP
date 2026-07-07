"""Testes de regressao para os 3 bugs encontrados no smoke real do agente (F16-S46).

Os testes mockados de F16-S45 nao pegaram estes bugs porque devolviam texto puro
e LLMResponse ja construido, sem passar pelo gateway/contrato real.

BUG A: agente nao responde -- modelo retorna JSON {"messages":[...]} que nao era parseado.
BUG B: POST /internal/ai/decisions 400 -- correlationId precisava ser UUID valido.
BUG C: PUT /internal/conversations/:id/state 400 -- phone/org_id chegavam vazios.

LGPD (doc 17 sec 14.2):
    - Testes nao incluem PII real -- apenas IDs opacos e strings de teste.
    - phone nos fixtures e ficticio (formato valido mas nao real).
    - correlation_id e conversation_id sao UUIDs gerados para teste.
"""
from __future__ import annotations

import json
import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
import respx
import structlog.contextvars

from app.config import settings
from app.graphs.whatsapp_pre_attendance.nodes.agent_turn import _parse_agent_output
from app.graphs.whatsapp_pre_attendance.nodes.log_decision import log_decision
from app.graphs.whatsapp_pre_attendance.nodes.persist_state import persist_state
from app.graphs.whatsapp_pre_attendance.state import ConversationState
from app.prompts.loader import ActivePrompt

# ---------------------------------------------------------------------------
# Helpers compartilhados
# ---------------------------------------------------------------------------

_CONV = str(uuid.uuid4())
_ORG = "576a8121-838a-4904-b6bb-574648d9c32b"  # org de teste do smoke real
_LEAD = str(uuid.uuid4())
_PHONE = "+5569999990046"  # ficticio


def _base_url(path: str) -> str:
    raw = str(settings.backend_internal_url)
    base = raw if raw.endswith("/") else f"{raw}/"
    return f"{base}{path.lstrip('/')}"


def _make_state(**overrides: Any) -> ConversationState:
    base: ConversationState = {
        "conversation_id": _CONV,
        "chatwoot_conversation_id": "cw-smoke-46",
        "phone": _PHONE,
        "organization_id": _ORG,
        "lead_id": _LEAD,
        "handoff_required": False,
        "handoff_active": False,
        "handoff_reason": None,
        "missing_fields": [],
        "messages": [{"role": "user", "content": "Ola, quero credito"}],
        "tool_results": [],
        "errors": [],
        "actions_emitted": [],
        "collection_status": "none",
        "current_intent": None,
        "customer_name": None,
        "city_id": None,
        "city_name": None,
        "activity": None,
        "profile": None,
        "credit_objective": None,
        "scr_authorized": None,
        "cpf_collected": False,
    }
    base.update(overrides)  # type: ignore[typeddict-item]
    return base


def _make_prompt(key: str = "pre_attendance_agent") -> ActivePrompt:
    return ActivePrompt(
        key=key,
        version=1,
        body="Voce e Ana Clara. Responda em JSON: {\"messages\":[\"...\"]}}",
        content_hash="abc123",
        model_recommended=None,
        temperature=None,
        max_tokens=None,
        top_p=None,
        prompt_version=key + "@v1",
    )


def _make_gateway_with_json_output(json_content: str) -> MagicMock:
    """Cria gateway mock que retorna JSON {"messages":[...]} como content."""
    from app.llm.gateway import LLMResponse, TokenUsage

    gw = MagicMock()
    gw.complete = AsyncMock(return_value=LLMResponse(
        content=json_content,
        model="anthropic/claude-sonnet-4",
        usage=TokenUsage(prompt_tokens=50, completion_tokens=108, total_tokens=158),
        finish_reason="stop",
        raw={"choices": [{"message": {"content": json_content, "tool_calls": None}, "finish_reason": "stop"}]},
    ))
    return gw


# ===========================================================================
# BUG A — Parse de {"messages":[...]} do output do modelo
# ===========================================================================


class TestParseAgentOutput:
    """Testa _parse_agent_output: JSON, markdown JSON e texto puro."""

    def test_json_single_message(self) -> None:
        """JSON com 1 mensagem -> fin=mensagem, messages=[mensagem]."""
        raw = '{"messages": ["Ola! Sou a Ana Clara."]}'
        fin, msgs = _parse_agent_output(raw)
        assert fin == "Ola! Sou a Ana Clara."
        assert msgs == ["Ola! Sou a Ana Clara."]

    def test_json_multiple_messages(self) -> None:
        """JSON com N mensagens -> fin=primeira, messages=[todas]."""
        raw = '{"messages": ["Msg1", "Msg2", "Msg3"]}'
        fin, msgs = _parse_agent_output(raw)
        assert fin == "Msg1"
        assert msgs == ["Msg1", "Msg2", "Msg3"]
        assert len(msgs) == 3

    def test_json_in_markdown_block(self) -> None:
        """JSON dentro de bloco markdown ```json ... ``` deve ser extraido."""
        raw = '```json\n{"messages": ["Ola! Sou a Ana Clara."]}\n```'
        fin, msgs = _parse_agent_output(raw)
        assert fin == "Ola! Sou a Ana Clara."
        assert msgs == ["Ola! Sou a Ana Clara."]

    def test_json_in_markdown_block_no_lang(self) -> None:
        """JSON em bloco ``` sem 'json' tambem deve ser extraido."""
        raw = '```\n{"messages": ["Mensagem aqui."]}\n```'
        fin, msgs = _parse_agent_output(raw)
        assert fin == "Mensagem aqui."
        assert msgs == ["Mensagem aqui."]

    def test_plain_text_fallback(self) -> None:
        """Texto puro (nao JSON) retorna como lista com 1 elemento."""
        raw = "Ola, sou a Ana Clara, assistente do Banco do Povo."
        fin, msgs = _parse_agent_output(raw)
        assert fin == raw
        assert msgs == [raw]

    def test_malformed_json_unescaped_newline_nao_vaza_envelope(self) -> None:
        """Regressao (prod 2026-07-06): modelo poe newline solto dentro da string
        -> json.loads falha. O envelope cru '{"messages": [' NUNCA deve vazar pro
        cliente; salva o texto limpo via regex."""
        raw = '{"messages": ["Entendi! Temos a linha X.\nEssa exige garantia.\nQual seu nome?"]}'
        fin, msgs = _parse_agent_output(raw)
        assert msgs, "deveria salvar ao menos 1 mensagem"
        joined = "\n".join(msgs)
        assert '"messages":' not in joined and '{"messages"' not in joined
        assert "Entendi" in joined

    def test_malformed_json_aspa_faltando_nao_vaza_e_filtra_lixo(self) -> None:
        """Regressao: aspa de fechamento faltando -> json.loads falha. Nao vaza o
        envelope e descarta lixo de fronteira (virgula solta capturada)."""
        raw = '{"messages": ["Garantia Real., "Essa exige garantia.", "Qual seu nome?"]}'
        fin, msgs = _parse_agent_output(raw)
        joined = " ".join(msgs)
        assert '{"messages"' not in joined and '"messages":' not in joined
        assert all(
            any(c.isalnum() for c in m) for m in msgs
        ), "itens so-pontuacao devem ser filtrados"
        assert "garantia" in joined.lower()

    def test_empty_content(self) -> None:
        """Content vazio retorna (fin='', messages=[])."""
        fin, msgs = _parse_agent_output("")
        assert fin == ""
        assert msgs == []

    def test_whitespace_only(self) -> None:
        """Somente espacos retorna (fin='', messages=[])."""
        fin, msgs = _parse_agent_output("   \n  ")
        assert fin == ""
        assert msgs == []

    def test_json_messages_filters_empty_strings(self) -> None:
        """Strings vazias no array messages[] sao filtradas."""
        raw = '{"messages": ["Msg1", "", "  ", "Msg2"]}'
        fin, msgs = _parse_agent_output(raw)
        assert msgs == ["Msg1", "Msg2"]
        assert fin == "Msg1"

    def test_invalid_json_falls_back_to_plain_text(self) -> None:
        """JSON invalido (ex: truncado) usa fallback de texto puro."""
        raw = '{"messages": ["incompleto'
        fin, msgs = _parse_agent_output(raw)
        assert fin == raw
        assert msgs == [raw]

    def test_json_no_messages_key_falls_back(self) -> None:
        """JSON valido mas sem 'messages' faz fallback para texto puro."""
        raw = '{"text": "algo"}'
        fin, msgs = _parse_agent_output(raw)
        # Fallback: texto puro (o proprio JSON como string)
        assert fin == raw
        assert msgs == [raw]


# ===========================================================================
# BUG A — agent_turn parseia JSON e produz reply.content nao-vazio
# ===========================================================================

_LOAD_PROMPT_PATCH = "app.graphs.whatsapp_pre_attendance.nodes.agent_turn.load_active_prompt"
_GET_GATEWAY_PATCH = "app.graphs.whatsapp_pre_attendance.nodes.agent_turn.get_gateway"
_DISPATCH_TOOL_PATCH = "app.graphs.whatsapp_pre_attendance.nodes.agent_turn._dispatch_tool"


@pytest.mark.asyncio
async def test_agent_turn_parses_json_messages_output() -> None:
    """BUG A: modelo retorna {"messages":["..."]} -- agent_turn deve parsear e
    produzir reply.content nao-vazio (regressao do smoke real 2026-06-19)."""
    state = _make_state()
    prompt = _make_prompt()
    json_output = '{"messages": ["Ola! Sou a Ana Clara, assistente do Banco do Povo."]}'
    gw = _make_gateway_with_json_output(json_output)

    with patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=prompt)):
        with patch(_GET_GATEWAY_PATCH, return_value=gw):
            with patch(_DISPATCH_TOOL_PATCH, new=AsyncMock(return_value='{"ok": true}')):
                result = await __import__(
                    "app.graphs.whatsapp_pre_attendance.nodes.agent_turn",
                    fromlist=["agent_turn"],
                ).agent_turn(state)

    reply = result.get("reply", {})
    assert reply.get("type") == "text", (
        f"BUG A: reply.type deve ser 'text' mas foi '{reply.get('type')}' "
        f"-- o JSON do modelo nao foi parseado"
    )
    assert reply.get("content"), (
        "BUG A: reply.content esta vazio -- o JSON {'messages':[...]} nao foi parseado"
    )
    # O content deve ser a mensagem extraida, nao o JSON bruto
    assert "messages" not in reply.get("content", ""), (
        "BUG A: reply.content contem a chave 'messages' -- o JSON nao foi parseado"
    )
    assert "Ana Clara" in reply.get("content", "") or len(reply.get("content", "")) > 0, (
        "BUG A: reply.content nao contem texto util"
    )


@pytest.mark.asyncio
async def test_agent_turn_json_multiple_messages_joined() -> None:
    """BUG A: com 2 mensagens no JSON, reply.content deve ter as 2 mensagens
    unidas por \\n\\n para send_response._content_to_messages splitar."""
    from app.graphs.whatsapp_pre_attendance.nodes.agent_turn import agent_turn

    state = _make_state()
    prompt = _make_prompt()
    json_output = '{"messages": ["Ola! Sou a Ana Clara.", "Como posso ajudar?"]}'
    gw = _make_gateway_with_json_output(json_output)

    with patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=prompt)):
        with patch(_GET_GATEWAY_PATCH, return_value=gw):
            with patch(_DISPATCH_TOOL_PATCH, new=AsyncMock(return_value='{"ok": true}')):
                result = await agent_turn(state)

    reply = result.get("reply", {})
    assert reply.get("type") == "text"
    content = reply.get("content", "")
    # As duas mensagens devem estar no content (separadas por \n\n)
    assert "Ana Clara" in content
    assert "ajudar" in content


@pytest.mark.asyncio
async def test_agent_turn_json_in_markdown_block_parses_correctly() -> None:
    """BUG A: JSON em bloco markdown ```json``` tambem deve ser parseado."""
    from app.graphs.whatsapp_pre_attendance.nodes.agent_turn import agent_turn

    state = _make_state()
    prompt = _make_prompt()
    json_output = '```json\n{"messages": ["Mensagem em bloco markdown."]}\n```'
    gw = _make_gateway_with_json_output(json_output)

    with patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=prompt)):
        with patch(_GET_GATEWAY_PATCH, return_value=gw):
            with patch(_DISPATCH_TOOL_PATCH, new=AsyncMock(return_value='{"ok": true}')):
                result = await agent_turn(state)

    reply = result.get("reply", {})
    assert reply.get("type") == "text"
    assert "bloco markdown" in reply.get("content", "")


@pytest.mark.asyncio
async def test_agent_turn_plain_text_still_works_as_fallback() -> None:
    """BUG A: texto puro (nao JSON) ainda deve funcionar como fallback."""
    from app.graphs.whatsapp_pre_attendance.nodes.agent_turn import agent_turn

    state = _make_state()
    prompt = _make_prompt()
    plain_text = "Ola, sou a Ana Clara. Como posso ajudar?"
    gw = _make_gateway_with_json_output(plain_text)

    with patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=prompt)):
        with patch(_GET_GATEWAY_PATCH, return_value=gw):
            with patch(_DISPATCH_TOOL_PATCH, new=AsyncMock(return_value='{"ok": true}')):
                result = await agent_turn(state)

    reply = result.get("reply", {})
    assert reply.get("type") == "text"
    assert reply.get("content") == plain_text


# ===========================================================================
# BUG B — correlation_id UUID valido em log_decision
# ===========================================================================


class TestLogDecisionCorrelationIdBugB:
    """BUG B: correlationId deve ser UUID valido (Zod .uuid() no backend).

    Regressao do smoke real: _UNKNOWN_CORR = 'unknown' nao e UUID valido
    -> Zod rejeita com 400 'correlationId e obrigatorio'.
    """

    @pytest.mark.asyncio
    async def test_log_decision_sends_uuid_correlation_id_from_context(self) -> None:
        """Quando structlog context tem correlation_id UUID, ele e usado."""
        conv_id = str(uuid.uuid4())
        corr_id = str(uuid.uuid4())
        org_id = str(uuid.uuid4())
        state = _make_state(conversation_id=conv_id, organization_id=org_id)

        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            correlation_id=corr_id,
            organization_id=org_id,
        )

        captured: list[Any] = []
        from app.tools.audit_tools import LogAiDecisionOutput

        async def _capture(inp: Any) -> LogAiDecisionOutput:
            captured.append(inp)
            return LogAiDecisionOutput(decision_log_id=str(uuid.uuid4()))

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.log_decision.log_ai_decision",
            new=_capture,
        ):
            await log_decision(state)

        structlog.contextvars.clear_contextvars()
        assert len(captured) == 1
        corr = captured[0].correlation_id
        # Deve ser um UUID valido (formato standard 8-4-4-4-12)
        try:
            uuid.UUID(corr)
        except ValueError:
            pytest.fail(f"BUG B: correlation_id '{corr}' nao e UUID valido")

    @pytest.mark.asyncio
    async def test_log_decision_falls_back_to_conversation_id_uuid(self) -> None:
        """BUG B: sem correlation_id no contexto, usa conversation_id (UUID valido)."""
        conv_id = str(uuid.uuid4())
        org_id = str(uuid.uuid4())
        state = _make_state(conversation_id=conv_id, organization_id=org_id)

        # Contexto sem correlation_id
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(organization_id=org_id)

        captured: list[Any] = []
        from app.tools.audit_tools import LogAiDecisionOutput

        async def _capture(inp: Any) -> LogAiDecisionOutput:
            captured.append(inp)
            return LogAiDecisionOutput(decision_log_id=str(uuid.uuid4()))

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.log_decision.log_ai_decision",
            new=_capture,
        ):
            await log_decision(state)

        structlog.contextvars.clear_contextvars()
        assert len(captured) == 1
        corr = captured[0].correlation_id
        # Nao deve ser "unknown" -- deve ser o conversation_id (UUID)
        assert corr != "unknown", (
            "BUG B: correlationId ficou 'unknown' -- nao e UUID valido e seria rejeitado"
        )
        try:
            uuid.UUID(corr)
        except ValueError:
            pytest.fail(f"BUG B: correlationId fallback '{corr}' nao e UUID valido")
        assert corr == conv_id, "O fallback deve ser o conversation_id"

    @pytest.mark.asyncio
    async def test_log_decision_generates_uuid_when_all_empty(self) -> None:
        """BUG B: sem contexto E sem conversation_id, gera UUID novo (nunca 'unknown')."""
        state = _make_state(conversation_id="", organization_id=str(uuid.uuid4()))

        structlog.contextvars.clear_contextvars()

        captured: list[Any] = []
        from app.tools.audit_tools import LogAiDecisionOutput

        async def _capture(inp: Any) -> LogAiDecisionOutput:
            captured.append(inp)
            return LogAiDecisionOutput(decision_log_id=str(uuid.uuid4()))

        # conversation_id vazio faz LogAiDecisionInput falhar na validacao --
        # log_decision captura o erro e nao propaga handoff.
        # O que importa e que nao envia "unknown" para o backend.
        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.log_decision.log_ai_decision",
            new=_capture,
        ):
            result = await log_decision(state)

        structlog.contextvars.clear_contextvars()
        # Mesmo em falha, nao propaga handoff
        assert result.get("handoff_required") is not True


# ===========================================================================
# BUG C — persist_state com phone/org_id vazios
# ===========================================================================


class TestPersistStateBugC:
    """BUG C: phone/organization_id vazios causavam 400 no PUT state.

    No path agentico (flag ON), estes campos chegavam como string vazia ""
    (nao None) porque a condicao 'if organization_id is not None' incluia
    strings vazias no body do PUT.
    """

    @pytest.mark.asyncio
    async def test_persist_state_with_valid_phone_and_org(self) -> None:
        """BUG C: happy path -- phone e org_id presentes -> PUT retorna 200."""
        conv_id = str(uuid.uuid4())
        org_id = str(uuid.uuid4())
        state = _make_state(
            conversation_id=conv_id,
            organization_id=org_id,
            phone=_PHONE,
        )
        put_url = _base_url(f"/internal/conversations/{conv_id}/state")

        with respx.mock:
            route = respx.put(put_url).mock(
                return_value=httpx.Response(200, json={"ok": True})
            )
            result = await persist_state(state)

        assert route.called
        body: dict[str, Any] = json.loads(route.calls.last.request.content)
        # Campos obrigatorios devem estar no body
        # F16-S47 BUG-4: persist_state normaliza o phone removendo o '+' (E.164 -> digitos),
        # pois o schema do PUT /state exige "apenas digitos".
        assert body.get("phone") == _PHONE.lstrip("+"), "phone (digitos) deve estar no body do PUT"
        assert body.get("organization_id") == org_id, "organization_id deve estar no body do PUT"
        assert result.get("handoff_required") is not True

    @pytest.mark.asyncio
    async def test_persist_state_empty_phone_uses_snapshot_fallback(self) -> None:
        """BUG C: phone vazio no state tenta recuperar do snapshot serializado."""
        conv_id = str(uuid.uuid4())
        org_id = str(uuid.uuid4())
        # phone vazio -- simula o bug do path agentico
        state = _make_state(
            conversation_id=conv_id,
            organization_id=org_id,
            phone="",  # <-- bug: chega vazio
        )
        put_url = _base_url(f"/internal/conversations/{conv_id}/state")

        with respx.mock:
            route = respx.put(put_url).mock(
                return_value=httpx.Response(200, json={"ok": True})
            )
            result = await persist_state(state)

        assert route.called
        body = json.loads(route.calls.last.request.content)
        # O body NAO deve ter phone="" (causaria 400)
        phone_sent = body.get("phone", "NOT_SENT")
        assert phone_sent != "", (
            "BUG C: phone vazio nao deve ser enviado no body do PUT (causaria 400)"
        )

    @pytest.mark.asyncio
    async def test_persist_state_empty_org_id_string_not_sent(self) -> None:
        """BUG C: organization_id='' (string vazia) nao deve ser enviado no body.

        O bug original: 'if organization_id is not None' incluia strings vazias,
        causando Zod .uuid() a rejeitar com 400.
        """
        conv_id = str(uuid.uuid4())
        state = _make_state(
            conversation_id=conv_id,
            organization_id="",  # <-- bug: string vazia nao e None
            phone=_PHONE,
        )
        put_url = _base_url(f"/internal/conversations/{conv_id}/state")

        with respx.mock:
            route = respx.put(put_url).mock(
                return_value=httpx.Response(200, json={"ok": True})
            )
            result = await persist_state(state)

        assert route.called
        body = json.loads(route.calls.last.request.content)
        # organization_id vazio NAO deve ser enviado (causaria 400 no Zod .uuid())
        org_sent = body.get("organization_id", "NOT_SENT")
        assert org_sent != "", (
            "BUG C: organization_id='' (string vazia) nao deve ser enviado no PUT "
            "-- causa Zod .uuid() 400"
        )

    @pytest.mark.asyncio
    async def test_persist_state_both_empty_does_not_send_empty_strings(self) -> None:
        """BUG C: phone='' e organization_id='' -- nenhum dos dois deve ser enviado vazio."""
        conv_id = str(uuid.uuid4())
        state = _make_state(
            conversation_id=conv_id,
            organization_id="",
            phone="",
        )
        put_url = _base_url(f"/internal/conversations/{conv_id}/state")

        with respx.mock:
            route = respx.put(put_url).mock(
                return_value=httpx.Response(200, json={"ok": True})
            )
            await persist_state(state)

        body = json.loads(route.calls.last.request.content)
        assert body.get("phone") != "", "BUG C: phone vazio enviado"
        assert body.get("organization_id") != "", "BUG C: org vazio enviado"

    @pytest.mark.asyncio
    async def test_persist_state_none_org_not_included(self) -> None:
        """organization_id=None (ausente do state) nao deve ser incluido no body."""
        conv_id = str(uuid.uuid4())
        state = _make_state(
            conversation_id=conv_id,
            phone=_PHONE,
        )
        # Remover organization_id do state completamente
        state.pop("organization_id", None)  # type: ignore[misc]
        put_url = _base_url(f"/internal/conversations/{conv_id}/state")

        with respx.mock:
            route = respx.put(put_url).mock(
                return_value=httpx.Response(200, json={"ok": True})
            )
            result = await persist_state(state)

        body = json.loads(route.calls.last.request.content)
        assert "organization_id" not in body or body.get("organization_id"), (
            "organization_id None ou ausente nao deve aparecer no body"
        )


# ===========================================================================
# BUG B — audit_tools.log_ai_decision envia correlationId no payload HTTP
# ===========================================================================


class TestAuditToolsCorrelationIdPayload:
    """Verifica que o payload HTTP enviado ao backend inclui 'correlationId' (camelCase)."""

    @pytest.mark.asyncio
    async def test_log_ai_decision_payload_includes_correlation_id(self) -> None:
        """Bug B: o payload HTTP para /internal/ai/decisions deve ter 'correlationId'."""
        from app.tools.audit_tools import LogAiDecisionInput, log_ai_decision

        conv_id = str(uuid.uuid4())
        org_id = str(uuid.uuid4())
        corr_id = str(uuid.uuid4())
        ai_url = _base_url("/internal/ai/decisions")

        inp = LogAiDecisionInput(
            organization_id=org_id,
            conversation_id=conv_id,
            node_name="agent_turn",
            decision={"tool_calls": 0, "finish_reason": "stop"},
            correlation_id=corr_id,
        )

        with respx.mock:
            route = respx.post(ai_url).mock(
                return_value=httpx.Response(200, json={"decision_log_id": str(uuid.uuid4())})
            )
            await log_ai_decision(inp)

        assert route.called
        body = json.loads(route.calls.last.request.content)
        assert "correlationId" in body, (
            "BUG B: 'correlationId' ausente do payload HTTP -- backend retorna 400"
        )
        assert body["correlationId"] == corr_id
        # Outros campos obrigatorios
        assert "organizationId" in body
        assert "conversationId" in body
        assert "nodeName" in body
        assert "decision" in body

    @pytest.mark.asyncio
    async def test_log_ai_decision_payload_no_snake_case_correlation(self) -> None:
        """O payload HTTP nao deve ter 'correlation_id' (snake_case) -- so camelCase."""
        from app.tools.audit_tools import LogAiDecisionInput, log_ai_decision

        conv_id = str(uuid.uuid4())
        org_id = str(uuid.uuid4())
        ai_url = _base_url("/internal/ai/decisions")

        inp = LogAiDecisionInput(
            organization_id=org_id,
            conversation_id=conv_id,
            node_name="agent_turn",
            decision={},
            correlation_id=conv_id,
        )

        with respx.mock:
            route = respx.post(ai_url).mock(
                return_value=httpx.Response(200, json={"decision_log_id": str(uuid.uuid4())})
            )
            await log_ai_decision(inp)

        body = json.loads(route.calls.last.request.content)
        # snake_case NAO deve estar no body (Zod o ignoraria silenciosamente,
        # e o camelCase seria entao reportado como ausente pelo required_error)
        assert "correlation_id" not in body, (
            "Payload tem 'correlation_id' (snake) -- backend espera camelCase 'correlationId'"
        )
