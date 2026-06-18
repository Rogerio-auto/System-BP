"""Testes dos nós receive_message e load_state.

Cobre:

receive_message:
- Normaliza campos de sessão a partir do payload (conversation_id, phone,
  chatwoot_conversation_id).
- Append da nova mensagem em state.messages.
- Preserva histórico existente (não-destrutivo).
- Propaga metadata (city_id, city_name, customer_name) quando presente.
- Campos opcionais ausentes no payload não sobrescrevem estado existente.
- Inicializa listas de controle quando ausentes.
- Mensagem sem attachments não inclui chave 'attachments'.
- Mensagem com attachments inclui chave 'attachments'.

load_state:
- 200 → carrega estado persistido e mescla com estado atual.
- 404 → inicializa ConversationState novo com defaults.
- 5xx → handoff_required=True + entry em errors.
- Timeout → handoff_required=True + entry em errors.
- conversation_id ausente → handoff_required=True imediato.
- Header X-Internal-Token presente na chamada.
- Turno corrente: tool_results, errors, actions_emitted começam vazios.
- Mensagens do receive_message são preservadas sobre histórico do backend.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest
import respx

from app.config import settings
from app.graphs.whatsapp_pre_attendance.nodes.load_state import load_state
from app.graphs.whatsapp_pre_attendance.nodes.receive_message import receive_message
from app.graphs.whatsapp_pre_attendance.state import ConversationState

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_CONVERSATION_ID = "aaaaaaaa-0000-0000-0000-000000000001"
_PHONE = "+5569988887777"
_CW_CONV_ID = "42"


def _base_payload(**overrides: Any) -> dict[str, Any]:
    """Payload mínimo válido conforme doc 06 §4.1."""
    base: dict[str, Any] = {
        "conversation_id": _CONVERSATION_ID,
        "lead_id": None,
        "customer_phone": _PHONE,
        "message_text": "Olá, quero simular um crédito",
        "message_attachments": [],
        "message_timestamp": "2026-05-18T10:00:00Z",
        "channel": "whatsapp",
        "chatwoot_conversation_id": _CW_CONV_ID,
        "chatwoot_account_id": "1",
        "metadata": {},
        "correlation_id": "corr-001",
        "idempotency_key": "wa_msg_001",
    }
    base.update(overrides)
    return base


def _empty_state() -> ConversationState:
    """Estado vazio — situação de primeira mensagem."""
    return {}  # type: ignore[return-value]


def _state_url() -> str:
    raw = str(settings.backend_internal_url)
    base = raw if raw.endswith("/") else f"{raw}/"
    return f"{base}internal/conversations/{_CONVERSATION_ID}/state"


def _persisted_state_body(extra: dict[str, Any] | None = None) -> dict[str, Any]:
    """Corpo de resposta simulado do backend para estado existente."""
    state_data: dict[str, Any] = {
        "conversation_id": _CONVERSATION_ID,
        "chatwoot_conversation_id": _CW_CONV_ID,
        "phone": _PHONE,
        "handoff_required": False,
        "missing_fields": [],
        "messages": [
            {
                "role": "user",
                "content": "Olá",
                "channel": "whatsapp",
                "timestamp": "2026-05-17T09:00:00Z",
            }
        ],
        "tool_results": [{"tool": "some_tool", "result": {}}],
        "errors": [],
        "actions_emitted": [],
        "lead_id": "lead-001",
        "customer_id": None,
        "customer_name": "Maria Silva",
        "city_id": "city-001",
        "city_name": "Porto Velho",
        "current_stage": "pre_atendimento",
        "current_intent": None,
        "requested_amount": None,
        "requested_term_months": None,
        "selected_product_id": None,
        "last_simulation_id": None,
        "handoff_reason": None,
    }
    if extra:
        state_data.update(extra)
    return {"state": state_data}


# ===========================================================================
# Tests: receive_message
# ===========================================================================


class TestReceiveMessage:
    def test_normalizes_session_fields(self) -> None:
        """Deve preencher conversation_id, phone e chatwoot_conversation_id do payload."""
        payload = _base_payload()
        result = receive_message(_empty_state(), payload=payload)

        assert result["conversation_id"] == _CONVERSATION_ID
        assert result["phone"] == _PHONE
        assert result["chatwoot_conversation_id"] == _CW_CONV_ID

    def test_appends_message_to_empty_history(self) -> None:
        """Deve criar state.messages com 1 entrada quando estado vem vazio."""
        payload = _base_payload(message_text="Quero um crédito")
        result = receive_message(_empty_state(), payload=payload)

        assert len(result["messages"]) == 1
        assert result["messages"][0]["role"] == "user"
        assert result["messages"][0]["content"] == "Quero um crédito"

    def test_appends_to_existing_history(self) -> None:
        """Deve preservar histórico existente e adicionar nova mensagem ao final."""
        existing: ConversationState = {
            "conversation_id": _CONVERSATION_ID,
            "phone": _PHONE,
            "chatwoot_conversation_id": _CW_CONV_ID,
            "messages": [
                {"role": "user", "content": "msg anterior", "channel": "whatsapp", "timestamp": "t0"},  # noqa: E501
            ],
            "handoff_required": False,
            "missing_fields": [],
            "tool_results": [],
            "errors": [],
            "actions_emitted": [],
        }
        payload = _base_payload(message_text="nova mensagem")
        result = receive_message(existing, payload=payload)

        assert len(result["messages"]) == 2
        assert result["messages"][0]["content"] == "msg anterior"
        assert result["messages"][1]["content"] == "nova mensagem"

    def test_message_includes_channel_and_timestamp(self) -> None:
        """Mensagem normalizada deve conter 'channel' e 'timestamp'."""
        payload = _base_payload(channel="whatsapp", message_timestamp="2026-05-18T10:00:00Z")
        result = receive_message(_empty_state(), payload=payload)

        msg = result["messages"][0]
        assert msg["channel"] == "whatsapp"
        assert msg["timestamp"] == "2026-05-18T10:00:00Z"

    def test_message_without_attachments_has_no_attachments_key(self) -> None:
        """Sem attachments, a chave 'attachments' não deve aparecer na mensagem."""
        payload = _base_payload(message_attachments=[])
        result = receive_message(_empty_state(), payload=payload)

        assert "attachments" not in result["messages"][0]

    def test_message_with_attachments_includes_key(self) -> None:
        """Com attachments, a chave 'attachments' deve aparecer na mensagem."""
        attachments = [{"type": "image", "url": "https://example.com/img.jpg"}]
        payload = _base_payload(message_attachments=attachments)
        result = receive_message(_empty_state(), payload=payload)

        assert result["messages"][0]["attachments"] == attachments

    def test_propagates_metadata_city_info(self) -> None:
        """Deve propagar city_id e city_name de metadata quando presentes."""
        payload = _base_payload(metadata={"city_id": "city-099", "city_name": "Ji-Paraná"})
        result = receive_message(_empty_state(), payload=payload)

        assert result.get("city_id") == "city-099"
        assert result.get("city_name") == "Ji-Paraná"

    def test_propagates_metadata_customer_name(self) -> None:
        """Deve propagar customer_name de metadata quando presente."""
        payload = _base_payload(metadata={"customer_name": "João Moura"})
        result = receive_message(_empty_state(), payload=payload)

        assert result.get("customer_name") == "João Moura"

    def test_empty_metadata_does_not_clear_existing_city(self) -> None:
        """Metadata vazio não deve sobrescrever city_id/city_name já no estado."""
        existing: ConversationState = {
            "conversation_id": _CONVERSATION_ID,
            "phone": _PHONE,
            "chatwoot_conversation_id": _CW_CONV_ID,
            "city_id": "city-001",
            "city_name": "Porto Velho",
            "handoff_required": False,
            "missing_fields": [],
            "messages": [],
            "tool_results": [],
            "errors": [],
            "actions_emitted": [],
        }
        payload = _base_payload(metadata={})
        result = receive_message(existing, payload=payload)

        assert result.get("city_id") == "city-001"
        assert result.get("city_name") == "Porto Velho"

    def test_initializes_control_lists_when_absent(self) -> None:
        """Listas de controle devem ser inicializadas quando ausentes no estado."""
        result = receive_message(_empty_state(), payload=_base_payload())

        assert result["tool_results"] == []
        assert result["errors"] == []
        assert result["actions_emitted"] == []
        assert result["missing_fields"] == []

    def test_preserves_existing_control_lists(self) -> None:
        """Deve preservar listas de controle já existentes no estado."""
        existing: ConversationState = {
            "conversation_id": _CONVERSATION_ID,
            "phone": _PHONE,
            "chatwoot_conversation_id": _CW_CONV_ID,
            "handoff_required": False,
            "missing_fields": ["city"],
            "messages": [],
            "tool_results": [{"tool": "some_tool", "result": {}}],
            "errors": [],
            "actions_emitted": [],
        }
        result = receive_message(existing, payload=_base_payload())

        assert result["missing_fields"] == ["city"]
        assert len(result["tool_results"]) == 1

    def test_lead_id_from_payload_overwrites_none(self) -> None:
        """lead_id do payload deve sobrescrever None no estado."""
        payload = _base_payload()
        payload["lead_id"] = "lead-xyz"
        result = receive_message(_empty_state(), payload=payload)

        assert result.get("lead_id") == "lead-xyz"

    def test_lead_id_none_in_payload_preserves_state(self) -> None:
        """lead_id None no payload não deve apagar lead_id existente no estado."""
        existing: ConversationState = {
            "conversation_id": _CONVERSATION_ID,
            "phone": _PHONE,
            "chatwoot_conversation_id": _CW_CONV_ID,
            "lead_id": "lead-existing",
            "handoff_required": False,
            "missing_fields": [],
            "messages": [],
            "tool_results": [],
            "errors": [],
            "actions_emitted": [],
        }
        payload = _base_payload()
        payload["lead_id"] = None
        result = receive_message(existing, payload=payload)

        assert result.get("lead_id") == "lead-existing"

    def test_handoff_required_defaults_to_false(self) -> None:
        """handoff_required deve ser False em estado novo."""
        result = receive_message(_empty_state(), payload=_base_payload())
        assert result["handoff_required"] is False

    # -----------------------------------------------------------------------
    # F16-S37: organization_id
    # -----------------------------------------------------------------------

    def test_organization_id_from_payload_in_state(self) -> None:
        """Payload com organization_id deve resultar em state com o mesmo valor.

        Regressão F16-S37: receive_message nao extraia organization_id do
        payload, resultando em estado inicial sem org_id. load_state entao
        nao tinha o que preservar e logava organization_id: "<missing>", e
        todas as escritas /internal falhavam com 400.
        """
        _ORG_ID = "org-uuid-1111-0000-0000-000000000001"
        payload = _base_payload()
        payload["organization_id"] = _ORG_ID
        result = receive_message(_empty_state(), payload=payload)

        assert result.get("organization_id") == _ORG_ID, (
            f"organization_id perdido em receive_message: got {result.get('organization_id')!r}"
        )

    def test_organization_id_missing_from_payload_uses_state_fallback(self) -> None:
        """Payload sem organization_id deve usar o valor do state como fallback."""
        _ORG_ID = "org-fallback-2222-0000-0000-000000000002"
        existing: ConversationState = {
            "conversation_id": _CONVERSATION_ID,
            "phone": _PHONE,
            "chatwoot_conversation_id": _CW_CONV_ID,
            "organization_id": _ORG_ID,
            "handoff_required": False,
            "missing_fields": [],
            "messages": [],
            "tool_results": [],
            "errors": [],
            "actions_emitted": [],
        }
        payload = _base_payload()  # sem organization_id
        result = receive_message(existing, payload=payload)

        assert result.get("organization_id") == _ORG_ID

    def test_organization_id_payload_takes_precedence_over_state(self) -> None:
        """Quando payload e state tem org_id, o payload e autoritativo."""
        _ORG_PAYLOAD = "org-payload-aaaa-0000-0000-000000000001"
        _ORG_STATE = "org-state-bbbb-0000-0000-000000000002"
        existing: ConversationState = {
            "conversation_id": _CONVERSATION_ID,
            "phone": _PHONE,
            "chatwoot_conversation_id": _CW_CONV_ID,
            "organization_id": _ORG_STATE,
            "handoff_required": False,
            "missing_fields": [],
            "messages": [],
            "tool_results": [],
            "errors": [],
            "actions_emitted": [],
        }
        payload = _base_payload()
        payload["organization_id"] = _ORG_PAYLOAD
        result = receive_message(existing, payload=payload)

        assert result.get("organization_id") == _ORG_PAYLOAD


# ===========================================================================
# Tests: load_state
# ===========================================================================


class TestLoadState:
    @pytest.mark.asyncio()
    async def test_loads_existing_state_from_backend(self) -> None:
        """200 → deve carregar e mesclar estado persistido."""
        current_state: ConversationState = {
            "conversation_id": _CONVERSATION_ID,
            "phone": _PHONE,
            "chatwoot_conversation_id": _CW_CONV_ID,
            "handoff_required": False,
            "missing_fields": [],
            "messages": [
                {"role": "user", "content": "nova msg", "channel": "whatsapp", "timestamp": "t1"}
            ],
            "tool_results": [],
            "errors": [],
            "actions_emitted": [],
        }
        with respx.mock:
            respx.get(_state_url()).mock(
                return_value=httpx.Response(200, json=_persisted_state_body())
            )
            result = await load_state(current_state)

        assert result["conversation_id"] == _CONVERSATION_ID
        assert result["lead_id"] == "lead-001"
        assert result["customer_name"] == "Maria Silva"
        assert result["current_stage"] == "pre_atendimento"
        # tool_results e actions_emitted devem começar vazios a cada turno
        assert result["tool_results"] == []
        assert result["actions_emitted"] == []

    @pytest.mark.asyncio()
    async def test_404_initializes_new_state(self) -> None:
        """404 → deve inicializar ConversationState novo com defaults."""
        current_state: ConversationState = {
            "conversation_id": _CONVERSATION_ID,
            "phone": _PHONE,
            "chatwoot_conversation_id": _CW_CONV_ID,
            "handoff_required": False,
            "missing_fields": [],
            "messages": [
                {"role": "user", "content": "Oi", "channel": "whatsapp", "timestamp": "t0"}
            ],
            "tool_results": [],
            "errors": [],
            "actions_emitted": [],
        }
        with respx.mock:
            respx.get(_state_url()).mock(
                return_value=httpx.Response(404, json={"message": "not found"})
            )
            result = await load_state(current_state)

        assert result["conversation_id"] == _CONVERSATION_ID
        assert result["phone"] == _PHONE
        assert result["handoff_required"] is False
        # Defaults de novo estado
        assert result.get("lead_id") is None
        assert result.get("current_stage") is None
        assert result.get("current_intent") is None

    @pytest.mark.asyncio()
    async def test_404_preserves_messages_from_receive(self) -> None:
        """404 → mensagens preenchidas por receive_message devem ser preservadas."""
        msgs = [
            {"role": "user", "content": "Quero crédito", "channel": "whatsapp", "timestamp": "t0"}
        ]
        current_state: ConversationState = {
            "conversation_id": _CONVERSATION_ID,
            "phone": _PHONE,
            "chatwoot_conversation_id": _CW_CONV_ID,
            "handoff_required": False,
            "missing_fields": [],
            "messages": msgs,
            "tool_results": [],
            "errors": [],
            "actions_emitted": [],
        }
        with respx.mock:
            respx.get(_state_url()).mock(
                return_value=httpx.Response(404, json={"message": "not found"})
            )
            result = await load_state(current_state)

        assert result["messages"] == msgs

    @pytest.mark.asyncio()
    async def test_5xx_sets_handoff_required(self) -> None:
        """5xx → handoff_required=True e entry em errors."""
        current_state: ConversationState = {
            "conversation_id": _CONVERSATION_ID,
            "phone": _PHONE,
            "chatwoot_conversation_id": _CW_CONV_ID,
            "handoff_required": False,
            "missing_fields": [],
            "messages": [],
            "tool_results": [],
            "errors": [],
            "actions_emitted": [],
        }
        with respx.mock:
            respx.get(_state_url()).mock(
                return_value=httpx.Response(503, json={"error": "service unavailable"})
            )
            result = await load_state(current_state)

        assert result["handoff_required"] is True
        assert len(result["errors"]) == 1
        assert result["errors"][0]["node"] == "load_state"
        assert result["errors"][0]["error"] == "BACKEND_ERROR"

    @pytest.mark.asyncio()
    async def test_timeout_sets_handoff_required(self) -> None:
        """Timeout → handoff_required=True e entry em errors."""
        current_state: ConversationState = {
            "conversation_id": _CONVERSATION_ID,
            "phone": _PHONE,
            "chatwoot_conversation_id": _CW_CONV_ID,
            "handoff_required": False,
            "missing_fields": [],
            "messages": [],
            "tool_results": [],
            "errors": [],
            "actions_emitted": [],
        }
        with respx.mock:
            respx.get(_state_url()).mock(
                side_effect=httpx.ReadTimeout("timed out", request=None)  # type: ignore[arg-type]
            )
            result = await load_state(current_state)

        assert result["handoff_required"] is True
        assert len(result["errors"]) == 1
        assert result["errors"][0]["error"] == "TIMEOUT"

    @pytest.mark.asyncio()
    async def test_missing_conversation_id_sets_handoff(self) -> None:
        """Estado sem conversation_id → handoff_required=True sem chamada HTTP."""
        empty_state: ConversationState = {}  # type: ignore[typeddict-item]
        result = await load_state(empty_state)

        assert result["handoff_required"] is True
        assert any(e["error"] == "MISSING_CONVERSATION_ID" for e in result["errors"])

    @pytest.mark.asyncio()
    async def test_sends_internal_token_header(self) -> None:
        """X-Internal-Token deve estar presente em toda chamada."""
        current_state: ConversationState = {
            "conversation_id": _CONVERSATION_ID,
            "phone": _PHONE,
            "chatwoot_conversation_id": _CW_CONV_ID,
            "handoff_required": False,
            "missing_fields": [],
            "messages": [],
            "tool_results": [],
            "errors": [],
            "actions_emitted": [],
        }
        with respx.mock:
            route = respx.get(_state_url()).mock(
                return_value=httpx.Response(200, json=_persisted_state_body())
            )
            await load_state(current_state)

        token = route.calls.last.request.headers.get("x-internal-token")
        assert token == settings.internal_token.get_secret_value()

    @pytest.mark.asyncio()
    async def test_turn_control_lists_reset_on_load(self) -> None:
        """tool_results, errors e actions_emitted do turno anterior não devem vazar."""
        persisted = _persisted_state_body(extra={
            "tool_results": [{"tool": "old_tool", "result": {}}],
            "errors": [{"node": "old_node", "error": "OLD_ERR"}],
            "actions_emitted": [{"type": "old_action"}],
        })
        current_state: ConversationState = {
            "conversation_id": _CONVERSATION_ID,
            "phone": _PHONE,
            "chatwoot_conversation_id": _CW_CONV_ID,
            "handoff_required": False,
            "missing_fields": [],
            "messages": [],
            "tool_results": [],
            "errors": [],
            "actions_emitted": [],
        }
        with respx.mock:
            respx.get(_state_url()).mock(
                return_value=httpx.Response(200, json=persisted)
            )
            result = await load_state(current_state)

        # Listas de controle do turno anterior não devem vazar para o turno atual
        assert result["tool_results"] == []
        assert result["errors"] == []
        assert result["actions_emitted"] == []

    @pytest.mark.asyncio()
    async def test_messages_from_receive_preserved_over_backend(self) -> None:
        """Mensagem nova (de receive_message) deve ser preservada ao mesclar."""
        new_msg: dict[str, Any] = {
            "role": "user",
            "content": "nova mensagem atual",
            "channel": "whatsapp",
            "timestamp": "t_new",
        }
        # Estado atual tem mensagem nova (appended por receive_message)
        current_state: ConversationState = {
            "conversation_id": _CONVERSATION_ID,
            "phone": _PHONE,
            "chatwoot_conversation_id": _CW_CONV_ID,
            "handoff_required": False,
            "missing_fields": [],
            "messages": [new_msg],
            "tool_results": [],
            "errors": [],
            "actions_emitted": [],
        }
        with respx.mock:
            respx.get(_state_url()).mock(
                return_value=httpx.Response(200, json=_persisted_state_body())
            )
            result = await load_state(current_state)

        # Nova mensagem deve estar presente na lista final
        contents = [m["content"] for m in result["messages"]]
        assert "nova mensagem atual" in contents

    @pytest.mark.asyncio()
    async def test_200_preserves_org_id_from_request_over_missing_persisted(self) -> None:
        """Caminho merge (200): organization_id do request sobrevive ao nó load_state.

        Regressão F16-S36: load_state reconstruía o estado via _initial_state(loaded)
        sem incluir organization_id nos overrides de sessão, descartando o org_id
        que veio no state de entrada (request). Isso causava 400 em todas as escritas
        /internal a jusante (identify_or_create_lead, persist_state, log_decision).
        """
        _ORG_ID = "org-uuid-1111-0000-0000-000000000001"

        current_state: ConversationState = {
            "conversation_id": _CONVERSATION_ID,
            "phone": _PHONE,
            "chatwoot_conversation_id": _CW_CONV_ID,
            "organization_id": _ORG_ID,
            "handoff_required": False,
            "missing_fields": [],
            "messages": [
                {"role": "user", "content": "Oi", "channel": "whatsapp", "timestamp": "t1"}
            ],
            "tool_results": [],
            "errors": [],
            "actions_emitted": [],
        }
        # Estado persistido NAO tem organization_id (gravado por codigo pre-F16-S36)
        persisted_without_org = _persisted_state_body()
        persisted_without_org["state"].pop("organization_id", None)

        with respx.mock:
            respx.get(_state_url()).mock(
                return_value=httpx.Response(200, json=persisted_without_org)
            )
            result = await load_state(current_state)

        assert result.get("organization_id") == _ORG_ID, (
            f"organization_id perdido no caminho merge: got {result.get('organization_id')!r}"
        )

    @pytest.mark.asyncio()
    async def test_200_org_id_request_takes_precedence_over_persisted(self) -> None:
        """Caminho merge (200): request e autoritativo — sobrescreve org_id persistido."""
        _ORG_ID_REQUEST = "org-request-1111-0000-0000-000000000001"
        _ORG_ID_PERSISTED = "org-persisted-2222-0000-0000-000000000002"

        current_state: ConversationState = {
            "conversation_id": _CONVERSATION_ID,
            "phone": _PHONE,
            "chatwoot_conversation_id": _CW_CONV_ID,
            "organization_id": _ORG_ID_REQUEST,
            "handoff_required": False,
            "missing_fields": [],
            "messages": [],
            "tool_results": [],
            "errors": [],
            "actions_emitted": [],
        }
        persisted_with_diff_org = _persisted_state_body(
            extra={"organization_id": _ORG_ID_PERSISTED}
        )

        with respx.mock:
            respx.get(_state_url()).mock(
                return_value=httpx.Response(200, json=persisted_with_diff_org)
            )
            result = await load_state(current_state)

        assert result.get("organization_id") == _ORG_ID_REQUEST

    @pytest.mark.asyncio()
    async def test_404_preserves_org_id_from_request(self) -> None:
        """Caminho 404 (primeira interacao): organization_id do request nao regride."""
        _ORG_ID = "org-uuid-1111-0000-0000-000000000001"

        current_state: ConversationState = {
            "conversation_id": _CONVERSATION_ID,
            "phone": _PHONE,
            "chatwoot_conversation_id": _CW_CONV_ID,
            "organization_id": _ORG_ID,
            "handoff_required": False,
            "missing_fields": [],
            "messages": [
                {"role": "user", "content": "Ola", "channel": "whatsapp", "timestamp": "t0"}
            ],
            "tool_results": [],
            "errors": [],
            "actions_emitted": [],
        }
        with respx.mock:
            respx.get(_state_url()).mock(
                return_value=httpx.Response(404, json={"message": "not found"})
            )
            result = await load_state(current_state)

        assert result.get("organization_id") == _ORG_ID


    # -----------------------------------------------------------------------
    # F16-S37: propagacao ponta-a-ponta (receive_message → load_state)
    # -----------------------------------------------------------------------

    @pytest.mark.asyncio()
    async def test_org_id_survives_receive_message_then_load_state_merge(self) -> None:
        """Anti-regressao F16-S37: org_id do payload sobrevive receive_message e load_state.

        Cadeia completa:
          1. receive_message({}, payload com org_id) → state com org_id.
          2. load_state(state_com_org_id) onde estado persistido NAO tem org_id.
          3. Resultado final deve ter org_id igual ao do payload original.

        Historico de elos perdidos:
          - S35: payload->process.py nao incluia org_id (corrigido).
          - S36: load_state descartava org_id do state de entrada ao mesclar com persistido (corrigido).
          - S37: receive_message nao extraia org_id do payload (este fix).
        """
        _ORG_ID = "org-uuid-propagation-0000-000000000037"
        payload = _base_payload()
        payload["organization_id"] = _ORG_ID

        # Passo 1: receive_message({}, payload) — estado inicial
        state_after_receive = receive_message(_empty_state(), payload=payload)
        assert state_after_receive.get("organization_id") == _ORG_ID, (
            "PASSO 1 FALHOU: receive_message nao copiou org_id do payload"
        )

        # Passo 2: load_state(state_com_org_id) — estado persistido sem org_id
        persisted_without_org = _persisted_state_body()
        persisted_without_org["state"].pop("organization_id", None)

        with respx.mock:
            respx.get(_state_url()).mock(
                return_value=httpx.Response(200, json=persisted_without_org)
            )
            final_state = await load_state(state_after_receive)

        assert final_state.get("organization_id") == _ORG_ID, (
            f"PASSO 2 FALHOU: load_state descartou org_id. got {final_state.get('organization_id')!r}"
        )

    @pytest.mark.asyncio()
    async def test_org_id_survives_receive_message_then_load_state_404(self) -> None:
        """Anti-regressao F16-S37: org_id do payload sobrevive caminho 404 (primeira interacao).

        Verifica que receive_message → load_state (404, conversa nova) preserva
        organization_id do payload em toda a cadeia.
        """
        _ORG_ID = "org-uuid-propagation-404-00000000037"
        payload = _base_payload()
        payload["organization_id"] = _ORG_ID

        state_after_receive = receive_message(_empty_state(), payload=payload)
        assert state_after_receive.get("organization_id") == _ORG_ID

        with respx.mock:
            respx.get(_state_url()).mock(
                return_value=httpx.Response(404, json={"message": "not found"})
            )
            final_state = await load_state(state_after_receive)

        assert final_state.get("organization_id") == _ORG_ID, (
            f"PASSO 404 FALHOU: org_id perdido apos load_state 404. got {final_state.get('organization_id')!r}"
        )
