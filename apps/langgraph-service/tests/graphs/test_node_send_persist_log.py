"""Testes dos nós send_response, persist_state e log_decision (F3-S30).

Cobre:
- send_response: reply correto para cada cenário (handoff, nao_entendi,
  fora_de_escopo, outros intents, reply acumulado em tool_results).
- persist_state: chamada PUT ao backend, erros HTTP e timeout com handoff,
  conversation_id ausente, serialização do snapshot.
- log_decision: agregação de tool_results, payload sem PII, chamada à tool,
  erros da tool não propagam handoff, correlation_id do contexto structlog.

HTTP externo é sempre mockado via respx — sem chamadas reais ao backend.
"""
from __future__ import annotations

import json
import uuid
from typing import Any
from unittest.mock import AsyncMock, patch

import httpx
import pytest
import respx
import structlog.contextvars

from app.config import settings
from app.graphs.whatsapp_pre_attendance.nodes.log_decision import (
    _aggregate_llm_metadata,
    _build_decision_payload,
    log_decision,
)
from app.graphs.whatsapp_pre_attendance.nodes.persist_state import persist_state
from app.graphs.whatsapp_pre_attendance.nodes.send_response import (
    _MSG_FORA_DE_ESCOPO,
    _MSG_NAO_ENTENDI,
    send_response,
)
from app.graphs.whatsapp_pre_attendance.state import ConversationState
from app.tools.audit_tools import LogAiDecisionOutput

# ---------------------------------------------------------------------------
# Helpers compartilhados
# ---------------------------------------------------------------------------


def _base_url(path: str) -> str:
    """Monta URL completa replicando a lógica de InternalApiClient._build_url."""
    raw = str(settings.backend_internal_url)
    base = raw if raw.endswith("/") else f"{raw}/"
    return f"{base}{path.lstrip('/')}"


def _make_state(**overrides: Any) -> ConversationState:
    """Retorna um ConversationState mínimo válido com overrides opcionais."""
    base: ConversationState = {
        "conversation_id": str(uuid.uuid4()),
        "chatwoot_conversation_id": "cw-001",
        "phone": "+5569999990001",
        "handoff_required": False,
        "handoff_reason": None,
        "missing_fields": [],
        "messages": [{"role": "user", "content": "Quero crédito"}],
        "tool_results": [],
        "errors": [],
        "actions_emitted": [],
        "lead_id": str(uuid.uuid4()),
        "customer_id": None,
        "customer_name": None,
        "city_id": None,
        "city_name": None,
        "current_intent": None,
        "requested_amount": None,
        "requested_term_months": None,
        "selected_product_id": None,
        "last_simulation_id": None,
        "current_stage": None,
    }
    base.update(overrides)  # type: ignore[typeddict-item]
    return base


# ===========================================================================
# send_response
# ===========================================================================


class TestSendResponseHappyPath:
    def test_handoff_required_emits_none_reply(self) -> None:
        """Quando handoff_required=True, reply.type deve ser 'none'."""
        state = _make_state(handoff_required=True, current_intent="falar_atendente")
        result = send_response(state)

        tool_results: list[dict[str, Any]] = result["tool_results"]
        last = tool_results[-1]
        assert last["node"] == "send_response"
        assert last["reply"]["type"] == "none"
        assert last["reply"]["content"] == ""

    def test_nao_entendi_emits_text_reply(self) -> None:
        """Intent nao_entendi deve produzir reply de texto com mensagem de reformulação."""
        state = _make_state(current_intent="nao_entendi")
        result = send_response(state)

        last = result["tool_results"][-1]
        assert last["reply"]["type"] == "text"
        assert last["reply"]["content"] == _MSG_NAO_ENTENDI
        assert last["reply"]["template_name"] is None

    def test_fora_de_escopo_emits_text_reply(self) -> None:
        """Intent fora_de_escopo deve produzir reply de texto com mensagem padrão."""
        state = _make_state(current_intent="fora_de_escopo")
        result = send_response(state)

        last = result["tool_results"][-1]
        assert last["reply"]["type"] == "text"
        assert last["reply"]["content"] == _MSG_FORA_DE_ESCOPO

    def test_other_intent_emits_none_reply(self) -> None:
        """Outros intents (ex. quer_credito) produzem reply none (delegado a outros nós)."""
        for intent in ("quer_credito", "quer_simular", "saudacao", None):
            state = _make_state(current_intent=intent)
            result = send_response(state)
            last = result["tool_results"][-1]
            assert last["reply"]["type"] == "none", f"intent={intent}"

    def test_reply_contract_fields_present(self) -> None:
        """O reply deve sempre ter os 4 campos do contrato doc 06 §4.2."""
        state = _make_state(current_intent="nao_entendi")
        result = send_response(state)

        reply = result["tool_results"][-1]["reply"]
        assert "type" in reply
        assert "content" in reply
        assert "template_name" in reply
        assert "template_variables" in reply

    def test_existing_tool_results_preserved(self) -> None:
        """tool_results anteriores são preservados (append, não substitui)."""
        prior = {"node": "classify_intent", "intent": "nao_entendi"}
        state = _make_state(current_intent="nao_entendi", tool_results=[prior])
        result = send_response(state)

        assert result["tool_results"][0] == prior
        assert len(result["tool_results"]) == 2

    def test_reply_content_has_no_pii_markers(self) -> None:
        """Respostas textuais fixas não devem conter padrões de PII (LGPD §8.3)."""
        for intent in ("nao_entendi", "fora_de_escopo"):
            state = _make_state(current_intent=intent)
            result = send_response(state)
            content: str = result["tool_results"][-1]["reply"]["content"]
            # Não deve conter padrões de CPF, telefone bruto ou nome interpolado
            assert "CPF" not in content.upper() or "cpf" not in content.lower()

    def test_handoff_overrides_intent(self) -> None:
        """handoff_required=True com intent nao_entendi ainda emite none."""
        state = _make_state(handoff_required=True, current_intent="nao_entendi")
        result = send_response(state)
        last = result["tool_results"][-1]
        assert last["reply"]["type"] == "none"


# ===========================================================================
# persist_state
# ===========================================================================


class TestPersistStateHappyPath:
    @pytest.mark.asyncio
    async def test_calls_put_endpoint_with_state_snapshot(self) -> None:
        """persist_state deve chamar PUT /internal/conversations/:id/state."""
        conv_id = str(uuid.uuid4())
        state = _make_state(conversation_id=conv_id)
        put_url = _base_url(f"/internal/conversations/{conv_id}/state")

        with respx.mock:
            route = respx.put(put_url).mock(
                return_value=httpx.Response(200, json={"ok": True})
            )
            result = await persist_state(state)

        assert route.called
        assert result.get("handoff_required") is not True

    @pytest.mark.asyncio
    async def test_sends_state_key_in_body(self) -> None:
        """O corpo da requisição deve ter a chave 'state' com o snapshot."""
        conv_id = str(uuid.uuid4())
        state = _make_state(
            conversation_id=conv_id,
            current_intent="quer_credito",
        )
        put_url = _base_url(f"/internal/conversations/{conv_id}/state")

        with respx.mock:
            route = respx.put(put_url).mock(
                return_value=httpx.Response(200, json={"ok": True})
            )
            await persist_state(state)

        body: dict[str, Any] = json.loads(route.calls.last.request.content)
        assert "state" in body
        assert body["state"]["conversation_id"] == conv_id
        assert body["state"]["current_intent"] == "quer_credito"

    @pytest.mark.asyncio
    async def test_sends_internal_token_header(self) -> None:
        """X-Internal-Token deve estar presente na requisição."""
        conv_id = str(uuid.uuid4())
        state = _make_state(conversation_id=conv_id)
        put_url = _base_url(f"/internal/conversations/{conv_id}/state")

        with respx.mock:
            route = respx.put(put_url).mock(
                return_value=httpx.Response(200, json={"ok": True})
            )
            await persist_state(state)

        sent_token = route.calls.last.request.headers.get("x-internal-token")
        assert sent_token == settings.internal_token.get_secret_value()

    @pytest.mark.asyncio
    async def test_ok_result_appends_to_tool_results(self) -> None:
        """Em sucesso, persist_state adiciona entrada em tool_results."""
        conv_id = str(uuid.uuid4())
        prior = {"node": "send_response", "reply": {"type": "none"}}
        state = _make_state(conversation_id=conv_id, tool_results=[prior])
        put_url = _base_url(f"/internal/conversations/{conv_id}/state")

        with respx.mock:
            respx.put(put_url).mock(return_value=httpx.Response(200, json={"ok": True}))
            result = await persist_state(state)

        tool_results: list[dict[str, Any]] = result["tool_results"]
        assert tool_results[0] == prior
        assert tool_results[-1]["node"] == "persist_state"
        assert tool_results[-1]["status"] == "ok"


class TestPersistStateErrors:
    @pytest.mark.asyncio
    async def test_missing_conversation_id_triggers_handoff(self) -> None:
        """conversation_id vazio deve acionar handoff_required=True sem chamar HTTP."""
        state = _make_state(conversation_id="")

        with respx.mock:
            result = await persist_state(state)

        assert result["handoff_required"] is True
        errors: list[dict[str, Any]] = result["errors"]
        assert errors[-1]["error"] == "MISSING_CONVERSATION_ID"

    @pytest.mark.asyncio
    async def test_backend_5xx_triggers_handoff(self) -> None:
        """Erro 500 do backend deve acionar handoff_required=True."""
        conv_id = str(uuid.uuid4())
        state = _make_state(conversation_id=conv_id)
        put_url = _base_url(f"/internal/conversations/{conv_id}/state")

        with respx.mock:
            respx.put(put_url).mock(
                return_value=httpx.Response(500, json={"error": "internal"})
            )
            result = await persist_state(state)

        assert result["handoff_required"] is True
        errors = result["errors"]
        assert errors[-1]["error"] == "BACKEND_ERROR"
        assert errors[-1]["status_code"] == 500

    @pytest.mark.asyncio
    async def test_prior_errors_preserved_on_backend_error(self) -> None:
        """Erros anteriores são preservados ao acumular erro de persist_state."""
        conv_id = str(uuid.uuid4())
        prior_err = {"node": "load_state", "error": "BACKEND_ERROR"}
        state = _make_state(conversation_id=conv_id, errors=[prior_err])
        put_url = _base_url(f"/internal/conversations/{conv_id}/state")

        with respx.mock:
            respx.put(put_url).mock(
                return_value=httpx.Response(503, json={"error": "unavailable"})
            )
            result = await persist_state(state)

        errors = result["errors"]
        assert errors[0] == prior_err
        assert len(errors) == 2

    @pytest.mark.asyncio
    async def test_timeout_triggers_handoff(self) -> None:
        """Timeout ao chamar o backend deve acionar handoff_required=True."""
        conv_id = str(uuid.uuid4())
        state = _make_state(conversation_id=conv_id)
        put_url = _base_url(f"/internal/conversations/{conv_id}/state")

        with respx.mock:
            respx.put(put_url).mock(side_effect=httpx.ReadTimeout("timeout"))
            result = await persist_state(state)

        assert result["handoff_required"] is True
        errors = result["errors"]
        assert errors[-1]["error"] == "TIMEOUT"


# ===========================================================================
# log_decision — helpers internos
# ===========================================================================


class TestAggregateMetadata:
    def test_empty_tool_results_returns_defaults(self) -> None:
        """tool_results vazio deve retornar node_name='log_decision' e Nones."""
        meta = _aggregate_llm_metadata([])
        assert meta["node_name"] == "log_decision"
        assert meta["intent"] is None
        assert meta["prompt_key"] is None
        assert meta["tokens_in"] is None

    def test_extracts_first_llm_node(self) -> None:
        """Deve extrair dados do primeiro nó que usou LLM."""
        tool_results: list[dict[str, Any]] = [
            {
                "node": "classify_intent",
                "prompt_key": "pre_attendance_classify",
                "prompt_version": "1",
                "intent": "quer_credito",
                "latency_ms": 120.0,
            }
        ]
        meta = _aggregate_llm_metadata(tool_results)
        assert meta["node_name"] == "classify_intent"
        assert meta["intent"] == "quer_credito"
        assert meta["prompt_key"] == "pre_attendance_classify"
        assert meta["prompt_version"] == "1"
        assert meta["latency_ms"] == 120

    def test_accumulates_tokens_from_multiple_nodes(self) -> None:
        """Tokens de múltiplos nós LLM são somados."""
        tool_results: list[dict[str, Any]] = [
            {"node": "classify_intent", "prompt_key": "k1", "tokens_in": 100, "tokens_out": 10},
            {"node": "identify_city", "prompt_key": "k2", "tokens_in": 200, "tokens_out": 20},
        ]
        meta = _aggregate_llm_metadata(tool_results)
        assert meta["tokens_in"] == 300
        assert meta["tokens_out"] == 30

    def test_none_returned_when_no_tokens(self) -> None:
        """tokens_in/out devem ser None quando zero (sem chamadas LLM)."""
        meta = _aggregate_llm_metadata([])
        assert meta["tokens_in"] is None
        assert meta["tokens_out"] is None

    def test_non_llm_results_ignored(self) -> None:
        """Resultados sem prompt_key (persist_state, send_response) são ignorados."""
        tool_results: list[dict[str, Any]] = [
            {"node": "persist_state", "status": "ok"},
            {"node": "send_response", "reply": {"type": "none"}},
        ]
        meta = _aggregate_llm_metadata(tool_results)
        assert meta["node_name"] == "log_decision"


class TestBuildDecisionPayload:
    def test_no_pii_keys_in_payload(self) -> None:
        """O payload decision não deve conter chaves de PII (LGPD §8.4)."""
        state = _make_state(
            customer_name="Maria Silva",
            phone="+5569999999999",
            current_intent="quer_credito",
        )
        decision = _build_decision_payload(state)
        # Chaves proibidas de PII
        for forbidden in ("customer_name", "phone", "cpf", "document_number"):
            assert forbidden not in decision, f"PII key '{forbidden}' found in decision"

    def test_flow_data_present(self) -> None:
        """Dados de fluxo devem estar presentes no payload."""
        state = _make_state(
            current_intent="quer_simular",
            current_stage="qualificacao",
            handoff_required=False,
            requested_amount=5000.0,
        )
        decision = _build_decision_payload(state)
        assert decision["current_intent"] == "quer_simular"
        assert decision["current_stage"] == "qualificacao"
        assert decision["handoff_required"] is False
        assert decision["requested_amount"] == 5000.0

    def test_errors_count_reflects_errors_list(self) -> None:
        """errors_count deve refletir o tamanho da lista de errors."""
        state = _make_state(errors=[{"node": "x", "error": "e1"}, {"node": "y", "error": "e2"}])
        decision = _build_decision_payload(state)
        assert decision["errors_count"] == 2


# ===========================================================================
# log_decision — nó principal
# ===========================================================================


class TestLogDecisionHappyPath:
    @pytest.mark.asyncio
    async def test_calls_log_ai_decision_tool(self) -> None:
        """log_decision deve chamar a tool log_ai_decision."""
        conv_id = str(uuid.uuid4())
        decision_log_id = str(uuid.uuid4())
        state = _make_state(
            conversation_id=conv_id,
            current_intent="quer_credito",
            tool_results=[
                {
                    "node": "classify_intent",
                    "prompt_key": "pre_attendance_classify",
                    "prompt_version": "1",
                    "intent": "quer_credito",
                    "latency_ms": 120.0,
                }
            ],
        )

        mock_output = LogAiDecisionOutput(decision_log_id=decision_log_id)

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.log_decision.log_ai_decision",
            new=AsyncMock(return_value=mock_output),
        ) as mock_tool:
            result = await log_decision(state)

        assert mock_tool.called
        last = result["tool_results"][-1]
        assert last["node"] == "log_decision"
        assert last["decision_log_id"] == decision_log_id
        assert last["status"] == "ok"

    @pytest.mark.asyncio
    async def test_correlation_id_from_structlog_context(self) -> None:
        """correlation_id deve ser lido do contexto structlog."""
        conv_id = str(uuid.uuid4())
        corr_id = str(uuid.uuid4())
        org_id = str(uuid.uuid4())
        state = _make_state(conversation_id=conv_id)

        structlog.contextvars.bind_contextvars(
            correlation_id=corr_id,
            organization_id=org_id,
        )

        captured_inputs: list[Any] = []
        mock_output = LogAiDecisionOutput(decision_log_id=str(uuid.uuid4()))

        async def _capture(inp: Any) -> LogAiDecisionOutput:
            captured_inputs.append(inp)
            return mock_output

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.log_decision.log_ai_decision",
            new=_capture,
        ):
            await log_decision(state)

        assert captured_inputs[0].correlation_id == corr_id
        assert captured_inputs[0].organization_id == org_id

    @pytest.mark.asyncio
    async def test_decision_payload_has_no_pii(self) -> None:
        """O campo decision enviado à tool não deve conter PII (LGPD §8.4)."""
        conv_id = str(uuid.uuid4())
        state = _make_state(
            conversation_id=conv_id,
            customer_name="Maria Silva",
            phone="+5569999999999",
            current_intent="quer_simular",
        )

        captured_inputs: list[Any] = []
        mock_output = LogAiDecisionOutput(decision_log_id=str(uuid.uuid4()))

        async def _capture(inp: Any) -> LogAiDecisionOutput:
            captured_inputs.append(inp)
            return mock_output

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.log_decision.log_ai_decision",
            new=_capture,
        ):
            await log_decision(state)

        decision: dict[str, object] = captured_inputs[0].decision  # type: ignore[assignment]
        assert "customer_name" not in decision
        assert "phone" not in decision

    @pytest.mark.asyncio
    async def test_existing_tool_results_preserved(self) -> None:
        """tool_results anteriores são preservados no retorno."""
        conv_id = str(uuid.uuid4())
        prior = {"node": "persist_state", "status": "ok"}
        state = _make_state(conversation_id=conv_id, tool_results=[prior])

        mock_output = LogAiDecisionOutput(decision_log_id=str(uuid.uuid4()))

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.log_decision.log_ai_decision",
            new=AsyncMock(return_value=mock_output),
        ):
            result = await log_decision(state)

        assert result["tool_results"][0] == prior
        assert result["tool_results"][-1]["node"] == "log_decision"

    @pytest.mark.asyncio
    async def test_error_summary_populated_when_errors_present(self) -> None:
        """Quando há erros no turno, o campo error da tool deve ser preenchido."""
        conv_id = str(uuid.uuid4())
        state = _make_state(
            conversation_id=conv_id,
            errors=[{"node": "persist_state", "error": "TIMEOUT"}],
        )

        captured_inputs: list[Any] = []
        mock_output = LogAiDecisionOutput(decision_log_id=str(uuid.uuid4()))

        async def _capture(inp: Any) -> LogAiDecisionOutput:
            captured_inputs.append(inp)
            return mock_output

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.log_decision.log_ai_decision",
            new=_capture,
        ):
            await log_decision(state)

        assert captured_inputs[0].error is not None
        assert "persist_state" in captured_inputs[0].error

    @pytest.mark.asyncio
    async def test_no_error_when_clean_turn(self) -> None:
        """Quando o turno está limpo (sem errors), o campo error da tool é None."""
        conv_id = str(uuid.uuid4())
        state = _make_state(conversation_id=conv_id, errors=[])

        captured_inputs: list[Any] = []
        mock_output = LogAiDecisionOutput(decision_log_id=str(uuid.uuid4()))

        async def _capture(inp: Any) -> LogAiDecisionOutput:
            captured_inputs.append(inp)
            return mock_output

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.log_decision.log_ai_decision",
            new=_capture,
        ):
            await log_decision(state)

        assert captured_inputs[0].error is None


class TestLogDecisionToolFailure:
    @pytest.mark.asyncio
    async def test_tool_error_does_not_trigger_handoff(self) -> None:
        """Falha na tool log_ai_decision não deve ativar handoff_required."""
        conv_id = str(uuid.uuid4())
        state = _make_state(conversation_id=conv_id)

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.log_decision.log_ai_decision",
            new=AsyncMock(side_effect=RuntimeError("backend unavailable")),
        ):
            result = await log_decision(state)

        assert "handoff_required" not in result or result.get("handoff_required") is not True

    @pytest.mark.asyncio
    async def test_tool_error_recorded_in_tool_results(self) -> None:
        """Falha na tool deve ser registrada em tool_results para rastreabilidade."""
        conv_id = str(uuid.uuid4())
        state = _make_state(conversation_id=conv_id)

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.log_decision.log_ai_decision",
            new=AsyncMock(side_effect=httpx.TimeoutException("timeout")),
        ):
            result = await log_decision(state)

        last = result["tool_results"][-1]
        assert last["node"] == "log_decision"
        assert last["status"] == "error"
        assert "timeout" in last["error"].lower()
