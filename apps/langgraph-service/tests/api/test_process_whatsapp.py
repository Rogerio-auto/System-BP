"""Testes de integração do endpoint POST /process/whatsapp/message.

Cobre:
- Payload válido retorna HTTP 200 com estrutura doc 06 §4.2.
- Payload com campo extra retorna HTTP 422 (extra="forbid").
- Payload sem campo obrigatório retorna HTTP 422.
- Telefone em formato inválido retorna HTTP 422.
- Rate limit: 21ª requisição na mesma janela retorna HTTP 429 com Retry-After.
- Timeout do grafo retorna HTTP 504.
- Resposta inclui graph_version, latency_ms, model, prompt_version.
- Handoff required: handoff.required=True na resposta.
- Autenticação: ausência ou token errado retorna HTTP 401.
- Idempotência: segunda chamada com mesma chave retorna resposta cacheada sem
  reexecutar o grafo.
- LLM e backend são sempre mockados — sem chamadas reais.
"""
from __future__ import annotations

import asyncio
import time as _time_module
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import app.api.process as _process_module
from app.main import create_app

# ---------------------------------------------------------------------------
# Fixtures e helpers
# ---------------------------------------------------------------------------

_CONVERSATION_ID = "cccccccc-0000-0000-0000-000000000001"
_PHONE = "+5569988887777"
_CORRELATION_ID = "corr-test-001"
_IDEMPOTENCY_KEY = "wa_msg_test_001"
# Token configurado no conftest / env de testes (ver conftest.py)
_INTERNAL_TOKEN = "test-internal-token-for-tests"
_AUTH_HEADERS = {"X-Internal-Token": _INTERNAL_TOKEN}


def _valid_payload(**overrides: Any) -> dict[str, Any]:
    """Payload mínimo válido conforme doc 06 §4.1."""
    base: dict[str, Any] = {
        "conversation_id": _CONVERSATION_ID,
        "lead_id": None,
        "customer_phone": _PHONE,
        "message_text": "Quero simular um crédito",
        "message_attachments": [],
        "message_timestamp": "2026-05-19T10:00:00Z",
        "channel": "whatsapp",
        "chatwoot_conversation_id": "42",
        "chatwoot_account_id": "1",
        "metadata": {
            "city_id": None,
            "city_name": None,
            "customer_name": None,
            "previous_state_loaded": False,
        },
        "correlation_id": _CORRELATION_ID,
        "idempotency_key": _IDEMPOTENCY_KEY,
    }
    base.update(overrides)
    return base


def _build_client() -> TestClient:
    """Cria TestClient com a app FastAPI."""
    app = create_app()
    return TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# Mock do grafo completo: retorna um estado final determinístico
# ---------------------------------------------------------------------------

def _make_final_state(**overrides: Any) -> dict[str, Any]:
    """Estado final mínimo esperado pelo handler para montar a resposta."""
    base: dict[str, Any] = {
        "conversation_id": _CONVERSATION_ID,
        "chatwoot_conversation_id": "42",
        "phone": _PHONE,
        "lead_id": "lead-uuid-001",
        "customer_name": "Ana",
        "city_id": None,
        "city_name": None,
        "current_intent": "quer_credito",
        "current_stage": "pre_atendimento",
        "handoff_required": False,
        "handoff_reason": None,
        "missing_fields": ["city"],
        "messages": [{"role": "user", "content": "Quero simular um crédito"}],
        "tool_results": [
            {
                "node": "classify_intent",
                "prompt_key": "pre_attendance_classify",
                "prompt_version": "pre_attendance@v1",
                "model": "anthropic/claude-3.5-haiku",
                "intent": "quer_credito",
                "tokens_in": 40,
                "tokens_out": 5,
                "latency_ms": 100.0,
            },
            {
                "node": "send_response",
                "reply": {
                    "type": "text",
                    "content": "Olá! Para simular, preciso saber sua cidade.",
                    "template_name": None,
                    "template_variables": None,
                },
            },
        ],
        "errors": [],
        "actions_emitted": [],
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# Patch helper: mock do grafo compilado
# ---------------------------------------------------------------------------

class _MockCompiledGraph:
    """Substitui o grafo compilado por uma versão que retorna estado determinístico."""

    def __init__(self, final_state: dict[str, Any]) -> None:
        self._final_state = final_state

    async def ainvoke(self, _initial_state: Any, **_kwargs: Any) -> dict[str, Any]:
        return self._final_state


class _MockGraph:
    """Substitui build_graph().compile()."""

    def __init__(self, final_state: dict[str, Any]) -> None:
        self._final_state = final_state

    def compile(self) -> _MockCompiledGraph:
        return _MockCompiledGraph(self._final_state)


# ---------------------------------------------------------------------------
# Fixtures pytest
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _reset_rate_limit() -> None:  # type: ignore[return]
    """Limpa o estado do rate limiter entre testes."""
    _process_module._rate_limit_windows.clear()
    yield
    _process_module._rate_limit_windows.clear()


@pytest.fixture(autouse=True)
def _reset_idempotency_cache() -> None:  # type: ignore[return]
    """Limpa o cache de idempotência entre testes."""
    _process_module._idempotency_cache.clear()
    yield
    _process_module._idempotency_cache.clear()


@pytest.fixture()
def client() -> TestClient:
    return _build_client()


# ---------------------------------------------------------------------------
# Testes de validação de payload (sem chamar o grafo)
# ---------------------------------------------------------------------------


class TestPayloadValidation:
    """Valida regras de schema inbound (extra=forbid, campos obrigatórios)."""

    def test_valid_payload_accepted(self, client: TestClient) -> None:
        """Payload válido não deve retornar 422 por validação de schema."""
        final_state = _make_final_state()
        with patch(
            "app.api.process.build_graph",
            return_value=_MockGraph(final_state),
        ):
            resp = client.post(
                "/process/whatsapp/message",
                json=_valid_payload(),
                headers=_AUTH_HEADERS,
            )
        # Pode retornar 200 ou erro de backend (respx não está mockado aqui),
        # mas não deve retornar 422 de validação de schema inbound.
        assert resp.status_code != 422, f"Unexpected 422: {resp.text}"

    def test_extra_field_rejected(self, client: TestClient) -> None:
        """Campos não documentados no schema inbound devem retornar 422."""
        payload = _valid_payload(campo_desconhecido="valor_extra")
        resp = client.post("/process/whatsapp/message", json=payload, headers=_AUTH_HEADERS)
        assert resp.status_code == 422

    def test_missing_conversation_id_rejected(self, client: TestClient) -> None:
        """Payload sem conversation_id deve retornar 422."""
        payload = _valid_payload()
        del payload["conversation_id"]
        resp = client.post("/process/whatsapp/message", json=payload, headers=_AUTH_HEADERS)
        assert resp.status_code == 422

    def test_missing_customer_phone_rejected(self, client: TestClient) -> None:
        """Payload sem customer_phone deve retornar 422."""
        payload = _valid_payload()
        del payload["customer_phone"]
        resp = client.post("/process/whatsapp/message", json=payload, headers=_AUTH_HEADERS)
        assert resp.status_code == 422

    def test_missing_correlation_id_rejected(self, client: TestClient) -> None:
        """Payload sem correlation_id deve retornar 422."""
        payload = _valid_payload()
        del payload["correlation_id"]
        resp = client.post("/process/whatsapp/message", json=payload, headers=_AUTH_HEADERS)
        assert resp.status_code == 422

    def test_phone_without_plus_rejected(self, client: TestClient) -> None:
        """Telefone sem '+' no início deve retornar 422."""
        resp = client.post(
            "/process/whatsapp/message",
            json=_valid_payload(customer_phone="5569988887777"),
            headers=_AUTH_HEADERS,
        )
        assert resp.status_code == 422

    def test_phone_with_letters_rejected(self, client: TestClient) -> None:
        """Telefone com letras após '+' deve retornar 422."""
        resp = client.post(
            "/process/whatsapp/message",
            json=_valid_payload(customer_phone="+556998ABC7777"),
            headers=_AUTH_HEADERS,
        )
        assert resp.status_code == 422

    def test_metadata_extra_field_rejected(self, client: TestClient) -> None:
        """Campo extra dentro de metadata deve retornar 422."""
        payload = _valid_payload()
        payload["metadata"]["campo_desconhecido"] = "valor"
        resp = client.post("/process/whatsapp/message", json=payload, headers=_AUTH_HEADERS)
        assert resp.status_code == 422

    def test_message_timestamp_invalid_format_rejected(self, client: TestClient) -> None:
        """Timestamp em formato inválido deve retornar 422."""
        resp = client.post(
            "/process/whatsapp/message",
            json=_valid_payload(message_timestamp="nao-e-data"),
            headers=_AUTH_HEADERS,
        )
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Testes de resposta completa (grafo mockado)
# ---------------------------------------------------------------------------


class TestResponseStructure:
    """Valida a estrutura da resposta conforme doc 06 §4.2."""

    def test_success_returns_200(self, client: TestClient) -> None:
        """Processamento bem-sucedido deve retornar HTTP 200."""
        final_state = _make_final_state()
        with patch("app.api.process.build_graph", return_value=_MockGraph(final_state)):
            resp = client.post(
                "/process/whatsapp/message", json=_valid_payload(), headers=_AUTH_HEADERS
            )
        assert resp.status_code == 200

    def test_response_has_conversation_id(self, client: TestClient) -> None:
        """Resposta deve incluir conversation_id ecoado."""
        final_state = _make_final_state()
        with patch("app.api.process.build_graph", return_value=_MockGraph(final_state)):
            resp = client.post(
                "/process/whatsapp/message", json=_valid_payload(), headers=_AUTH_HEADERS
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["conversation_id"] == _CONVERSATION_ID

    def test_response_has_graph_version(self, client: TestClient) -> None:
        """Resposta deve incluir graph_version (SemVer)."""
        final_state = _make_final_state()
        with patch("app.api.process.build_graph", return_value=_MockGraph(final_state)):
            resp = client.post(
                "/process/whatsapp/message", json=_valid_payload(), headers=_AUTH_HEADERS
            )
        assert resp.status_code == 200
        body = resp.json()
        assert "graph_version" in body
        parts = body["graph_version"].split(".")
        assert len(parts) == 3

    def test_response_has_latency_ms(self, client: TestClient) -> None:
        """Resposta deve incluir latency_ms >= 0."""
        final_state = _make_final_state()
        with patch("app.api.process.build_graph", return_value=_MockGraph(final_state)):
            resp = client.post(
                "/process/whatsapp/message", json=_valid_payload(), headers=_AUTH_HEADERS
            )
        assert resp.status_code == 200
        body = resp.json()
        assert "latency_ms" in body
        assert body["latency_ms"] >= 0

    def test_response_has_model_from_tool_results(self, client: TestClient) -> None:
        """Resposta deve incluir model extraído de tool_results."""
        final_state = _make_final_state()
        with patch("app.api.process.build_graph", return_value=_MockGraph(final_state)):
            resp = client.post(
                "/process/whatsapp/message", json=_valid_payload(), headers=_AUTH_HEADERS
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["model"] == "anthropic/claude-3.5-haiku"

    def test_response_has_prompt_version_from_tool_results(self, client: TestClient) -> None:
        """Resposta deve incluir prompt_version extraído de tool_results."""
        final_state = _make_final_state()
        with patch("app.api.process.build_graph", return_value=_MockGraph(final_state)):
            resp = client.post(
                "/process/whatsapp/message", json=_valid_payload(), headers=_AUTH_HEADERS
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["prompt_version"] == "pre_attendance@v1"

    def test_response_reply_type_text(self, client: TestClient) -> None:
        """reply.type deve ser 'text' quando send_response emite texto."""
        final_state = _make_final_state()
        with patch("app.api.process.build_graph", return_value=_MockGraph(final_state)):
            resp = client.post(
                "/process/whatsapp/message", json=_valid_payload(), headers=_AUTH_HEADERS
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["reply"]["type"] == "text"
        assert body["reply"]["content"] != ""

    def test_response_handoff_not_required(self, client: TestClient) -> None:
        """handoff.required deve ser False quando o grafo não ativou handoff."""
        final_state = _make_final_state()
        with patch("app.api.process.build_graph", return_value=_MockGraph(final_state)):
            resp = client.post(
                "/process/whatsapp/message", json=_valid_payload(), headers=_AUTH_HEADERS
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["handoff"]["required"] is False

    def test_response_state_snapshot(self, client: TestClient) -> None:
        """state deve incluir current_intent e missing_fields."""
        final_state = _make_final_state()
        with patch("app.api.process.build_graph", return_value=_MockGraph(final_state)):
            resp = client.post(
                "/process/whatsapp/message", json=_valid_payload(), headers=_AUTH_HEADERS
            )
        assert resp.status_code == 200
        body = resp.json()
        assert "state" in body
        assert body["state"]["current_intent"] == "quer_credito"
        assert "city" in body["state"]["missing_fields"]

    def test_response_errors_empty_on_success(self, client: TestClient) -> None:
        """errors deve ser lista vazia em processamento sem erros."""
        final_state = _make_final_state()
        with patch("app.api.process.build_graph", return_value=_MockGraph(final_state)):
            resp = client.post(
                "/process/whatsapp/message", json=_valid_payload(), headers=_AUTH_HEADERS
            )
        assert resp.status_code == 200
        assert resp.json()["errors"] == []


# ---------------------------------------------------------------------------
# Testes de handoff
# ---------------------------------------------------------------------------


class TestHandoffResponse:
    """Valida o comportamento quando o grafo ativa handoff."""

    def test_handoff_required_in_response(self, client: TestClient) -> None:
        """Quando handoff_required=True no estado, handoff.required deve ser True na resposta."""
        final_state = _make_final_state(
            handoff_required=True,
            handoff_reason="falar_atendente",
            tool_results=[
                {
                    "node": "send_response",
                    "reply": {"type": "none", "content": ""},
                }
            ],
        )
        with patch("app.api.process.build_graph", return_value=_MockGraph(final_state)):
            resp = client.post(
                "/process/whatsapp/message", json=_valid_payload(), headers=_AUTH_HEADERS
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["handoff"]["required"] is True
        assert body["handoff"]["reason"] == "falar_atendente"

    def test_handoff_reply_type_none(self, client: TestClient) -> None:
        """Quando handoff_required=True, reply.type deve ser 'none' (backend decide texto)."""
        final_state = _make_final_state(
            handoff_required=True,
            handoff_reason="error",
            tool_results=[
                {
                    "node": "send_response",
                    "reply": {"type": "none", "content": ""},
                }
            ],
        )
        with patch("app.api.process.build_graph", return_value=_MockGraph(final_state)):
            resp = client.post(
                "/process/whatsapp/message", json=_valid_payload(), headers=_AUTH_HEADERS
            )
        assert resp.status_code == 200
        assert resp.json()["reply"]["type"] == "none"


# ---------------------------------------------------------------------------
# Testes de rate limit (doc 06 §12)
# ---------------------------------------------------------------------------


class TestRateLimit:
    """Valida o rate limiting por conversation_id."""

    def test_within_limit_allowed(self, client: TestClient) -> None:
        """Requisições dentro do limite devem ser processadas."""
        final_state = _make_final_state()
        with patch("app.api.process.build_graph", return_value=_MockGraph(final_state)):
            for _ in range(5):
                resp = client.post(
                    "/process/whatsapp/message",
                    json=_valid_payload(idempotency_key=f"wa_msg_{_}"),
                    headers=_AUTH_HEADERS,
                )
            # A última dentro do limite deve ser 200
            assert resp.status_code == 200

    def test_exceeding_limit_returns_429(self, client: TestClient) -> None:
        """21ª requisição dentro da janela deve retornar HTTP 429."""
        # Preenche a janela manualmente com 20 timestamps recentes
        now = _time_module.monotonic()
        window = _process_module._rate_limit_windows[_CONVERSATION_ID]
        for i in range(20):
            window.append(now - i * 0.1)  # 20 timestamps nos últimos 2 segundos

        resp = client.post(
            "/process/whatsapp/message", json=_valid_payload(), headers=_AUTH_HEADERS
        )
        assert resp.status_code == 429

    def test_429_has_retry_after_header(self, client: TestClient) -> None:
        """HTTP 429 deve incluir Retry-After header."""
        now = _time_module.monotonic()
        window = _process_module._rate_limit_windows[_CONVERSATION_ID]
        for i in range(20):
            window.append(now - i * 0.1)

        resp = client.post(
            "/process/whatsapp/message", json=_valid_payload(), headers=_AUTH_HEADERS
        )
        assert resp.status_code == 429
        assert "retry-after" in resp.headers

    def test_429_response_body(self, client: TestClient) -> None:
        """HTTP 429 deve ter corpo com error='rate_limit_exceeded'."""
        now = _time_module.monotonic()
        window = _process_module._rate_limit_windows[_CONVERSATION_ID]
        for i in range(20):
            window.append(now - i * 0.1)

        resp = client.post(
            "/process/whatsapp/message", json=_valid_payload(), headers=_AUTH_HEADERS
        )
        assert resp.status_code == 429
        body = resp.json()
        assert body["detail"]["error"] == "rate_limit_exceeded"

    def test_different_conversations_independent_limits(self, client: TestClient) -> None:
        """Rate limit é por conversation_id — conversas diferentes não interferem."""
        now = _time_module.monotonic()
        # Esgota limite da conversa A
        window_a = _process_module._rate_limit_windows[_CONVERSATION_ID]
        for i in range(20):
            window_a.append(now - i * 0.1)

        # Conversa B ainda não tem requisições — deve passar
        final_state = _make_final_state(conversation_id="conv-b-001")
        with patch("app.api.process.build_graph", return_value=_MockGraph(final_state)):
            resp = client.post(
                "/process/whatsapp/message",
                json=_valid_payload(conversation_id="conv-b-001"),
                headers=_AUTH_HEADERS,
            )
        # Não deve ser 429 (pode ser 200 ou outro erro de backend)
        assert resp.status_code != 429


# ---------------------------------------------------------------------------
# Testes de timeout
# ---------------------------------------------------------------------------


class TestTimeout:
    """Valida comportamento quando o grafo ultrapassa o timeout."""

    def test_graph_timeout_returns_504(self, client: TestClient) -> None:
        """Quando o grafo demora mais que 8 s, deve retornar HTTP 504."""

        class _SlowGraph:
            def compile(self) -> _SlowCompiledGraph:
                return _SlowCompiledGraph()

        class _SlowCompiledGraph:
            async def ainvoke(self, _state: Any, **_kwargs: Any) -> dict[str, Any]:
                await asyncio.sleep(100)  # nunca retorna antes do timeout
                return {}  # pragma: no cover

        with (
            patch("app.api.process.build_graph", return_value=_SlowGraph()),
            patch("app.api.process._GRAPH_TIMEOUT_SEC", 0.05),
        ):
            resp = client.post(
                "/process/whatsapp/message", json=_valid_payload(), headers=_AUTH_HEADERS
            )
        assert resp.status_code == 504
        body = resp.json()
        assert body["detail"]["error"] == "graph_timeout"


# ---------------------------------------------------------------------------
# Testes de reply fallback (sem send_response em tool_results)
# ---------------------------------------------------------------------------


class TestReplyFallback:
    """Valida reply.type='none' quando send_response não está em tool_results."""

    def test_no_send_response_in_tool_results_gives_none_reply(
        self, client: TestClient
    ) -> None:
        """Quando grafo não tem send_response em tool_results, reply.type='none'."""
        final_state = _make_final_state(tool_results=[])
        with patch("app.api.process.build_graph", return_value=_MockGraph(final_state)):
            resp = client.post(
                "/process/whatsapp/message", json=_valid_payload(), headers=_AUTH_HEADERS
            )
        assert resp.status_code == 200
        assert resp.json()["reply"]["type"] == "none"

    def test_no_llm_metadata_gives_none_model(self, client: TestClient) -> None:
        """Quando grafo não usou LLM, model e prompt_version devem ser null."""
        final_state = _make_final_state(tool_results=[])
        with patch("app.api.process.build_graph", return_value=_MockGraph(final_state)):
            resp = client.post(
                "/process/whatsapp/message", json=_valid_payload(), headers=_AUTH_HEADERS
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["model"] is None
        assert body["prompt_version"] is None


# ---------------------------------------------------------------------------
# Testes de actions_emitted
# ---------------------------------------------------------------------------


class TestActionsEmitted:
    """Valida mapeamento de actions_emitted para a resposta."""

    def test_actions_mapped_to_response(self, client: TestClient) -> None:
        """actions_emitted no estado devem aparecer em response.actions."""
        final_state = _make_final_state(
            actions_emitted=[
                {"type": "lead_created", "status": "success", "entity_id": "lead-001"},
            ]
        )
        with patch("app.api.process.build_graph", return_value=_MockGraph(final_state)):
            resp = client.post(
                "/process/whatsapp/message", json=_valid_payload(), headers=_AUTH_HEADERS
            )
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["actions"]) == 1
        assert body["actions"][0]["type"] == "lead_created"
        assert body["actions"][0]["entity_id"] == "lead-001"

    def test_no_actions_gives_empty_list(self, client: TestClient) -> None:
        """Sem actions_emitted, a lista deve ser vazia."""
        final_state = _make_final_state(actions_emitted=[])
        with patch("app.api.process.build_graph", return_value=_MockGraph(final_state)):
            resp = client.post(
                "/process/whatsapp/message", json=_valid_payload(), headers=_AUTH_HEADERS
            )
        assert resp.status_code == 200
        assert resp.json()["actions"] == []


# ---------------------------------------------------------------------------
# Testes de lead_id
# ---------------------------------------------------------------------------


class TestLeadId:
    """Valida propagação de lead_id na resposta."""

    def test_lead_id_propagated(self, client: TestClient) -> None:
        """lead_id do estado final deve aparecer na resposta."""
        final_state = _make_final_state(lead_id="lead-uuid-999")
        with patch("app.api.process.build_graph", return_value=_MockGraph(final_state)):
            resp = client.post(
                "/process/whatsapp/message", json=_valid_payload(), headers=_AUTH_HEADERS
            )
        assert resp.status_code == 200
        assert resp.json()["lead_id"] == "lead-uuid-999"

    def test_null_lead_id_propagated(self, client: TestClient) -> None:
        """Quando lead_id ainda é None, deve aparecer como null na resposta."""
        final_state = _make_final_state(lead_id=None)
        with patch("app.api.process.build_graph", return_value=_MockGraph(final_state)):
            resp = client.post(
                "/process/whatsapp/message", json=_valid_payload(), headers=_AUTH_HEADERS
            )
        assert resp.status_code == 200
        assert resp.json()["lead_id"] is None


# ---------------------------------------------------------------------------
# Testes de autenticação (HIGH-1)
# ---------------------------------------------------------------------------


class TestAuthentication:
    """Valida que X-Internal-Token é obrigatório e verificado em tempo constante."""

    def test_missing_token_returns_401(self, client: TestClient) -> None:
        """Ausência do header X-Internal-Token deve retornar HTTP 401."""
        resp = client.post("/process/whatsapp/message", json=_valid_payload())
        assert resp.status_code == 401

    def test_wrong_token_returns_401(self, client: TestClient) -> None:
        """Token incorreto deve retornar HTTP 401."""
        resp = client.post(
            "/process/whatsapp/message",
            json=_valid_payload(),
            headers={"X-Internal-Token": "token-errado-qualquer"},
        )
        assert resp.status_code == 401

    def test_empty_token_returns_401(self, client: TestClient) -> None:
        """Token vazio deve retornar HTTP 401."""
        resp = client.post(
            "/process/whatsapp/message",
            json=_valid_payload(),
            headers={"X-Internal-Token": ""},
        )
        assert resp.status_code == 401

    def test_valid_token_does_not_return_401(self, client: TestClient) -> None:
        """Token correto não deve retornar HTTP 401 (pode retornar 200 ou outro erro)."""
        final_state = _make_final_state()
        with patch("app.api.process.build_graph", return_value=_MockGraph(final_state)):
            resp = client.post(
                "/process/whatsapp/message",
                json=_valid_payload(),
                headers=_AUTH_HEADERS,
            )
        assert resp.status_code != 401


# ---------------------------------------------------------------------------
# Testes de idempotência (HIGH-2)
# ---------------------------------------------------------------------------


class TestIdempotency:
    """Valida que chamadas duplicadas com mesma idempotency_key não reexecutam o grafo."""

    def test_duplicate_key_returns_cached_response(self, client: TestClient) -> None:
        """Segunda chamada com mesma idempotency_key deve retornar resposta cacheada."""
        final_state = _make_final_state()
        call_count = 0

        class _CountingGraph:
            def compile(self) -> _CountingCompiledGraph:
                return _CountingCompiledGraph()

        class _CountingCompiledGraph:
            async def ainvoke(self, _state: Any, **_kwargs: Any) -> dict[str, Any]:
                nonlocal call_count
                call_count += 1
                return final_state

        with patch("app.api.process.build_graph", return_value=_CountingGraph()):
            resp1 = client.post(
                "/process/whatsapp/message",
                json=_valid_payload(idempotency_key="wa_msg_idem_001"),
                headers=_AUTH_HEADERS,
            )
            resp2 = client.post(
                "/process/whatsapp/message",
                json=_valid_payload(idempotency_key="wa_msg_idem_001"),
                headers=_AUTH_HEADERS,
            )

        assert resp1.status_code == 200
        assert resp2.status_code == 200
        # O grafo deve ter sido executado exatamente 1 vez (segunda chamada usa cache)
        assert call_count == 1, f"Grafo executado {call_count}x — esperado 1x"
        # As respostas devem ter o mesmo conversation_id
        assert resp1.json()["conversation_id"] == resp2.json()["conversation_id"]

    def test_different_keys_execute_graph_twice(self, client: TestClient) -> None:
        """Chaves diferentes devem resultar em execuções independentes do grafo."""
        final_state = _make_final_state()
        call_count = 0

        class _CountingGraph2:
            def compile(self) -> _CountingCompiledGraph2:
                return _CountingCompiledGraph2()

        class _CountingCompiledGraph2:
            async def ainvoke(self, _state: Any, **_kwargs: Any) -> dict[str, Any]:
                nonlocal call_count
                call_count += 1
                return final_state

        with patch("app.api.process.build_graph", return_value=_CountingGraph2()):
            client.post(
                "/process/whatsapp/message",
                json=_valid_payload(idempotency_key="wa_msg_idem_A"),
                headers=_AUTH_HEADERS,
            )
            client.post(
                "/process/whatsapp/message",
                json=_valid_payload(idempotency_key="wa_msg_idem_B"),
                headers=_AUTH_HEADERS,
            )

        # Grafo executado 2x com chaves diferentes
        assert call_count == 2, f"Grafo executado {call_count}x — esperado 2x"
