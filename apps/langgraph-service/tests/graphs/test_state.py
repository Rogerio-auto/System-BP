"""Testes de ConversationState, serialize_state e deserialize_state.

Cobre:
- Round-trip serialize → deserialize preserva todos os campos conhecidos.
- Truncamento de messages às últimas MAX_MESSAGES entradas.
- deserialize_state descarta chaves desconhecidas (forward-compat).
- Campos opcionais ausentes são preservados como ausentes (total=False).
- Listas vazias são preservadas corretamente.
- current_intent aceita apenas os valores do Literal canônico.
"""

from __future__ import annotations

from typing import Any, get_args

import pytest

from app.graphs.whatsapp_pre_attendance.state import (
    _KNOWN_KEYS,
    MAX_MESSAGES,
    ConversationState,
    IntentLiteral,
    deserialize_state,
    serialize_state,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _minimal_state(**overrides: Any) -> ConversationState:
    """Retorna um estado mínimo válido com campos obrigatórios presentes."""
    base: ConversationState = {
        "conversation_id": "conv-001",
        "chatwoot_conversation_id": "cw-42",
        "phone": "+5569999990001",
        "handoff_required": False,
        "missing_fields": [],
        "messages": [],
        "tool_results": [],
        "errors": [],
        "actions_emitted": [],
    }
    base.update(overrides)  # type: ignore[typeddict-item]
    return base


# ---------------------------------------------------------------------------
# Testes de round-trip
# ---------------------------------------------------------------------------


class TestRoundTrip:
    def test_round_trip_minimal(self) -> None:
        """Estado mínimo sobrevive serialize → deserialize sem perda."""
        state = _minimal_state()
        restored = deserialize_state(serialize_state(state))
        assert restored["conversation_id"] == "conv-001"
        assert restored["phone"] == "+5569999990001"
        assert restored["handoff_required"] is False
        assert restored["missing_fields"] == []

    def test_round_trip_full_state(self) -> None:
        """Todos os campos do §5.1 preservados no round-trip."""
        state = _minimal_state(
            lead_id="lead-abc",
            customer_id="cust-xyz",
            customer_name="Maria Silva",
            city_id="city-001",
            city_name="Porto Velho",
            current_intent="quer_simular",
            requested_amount=5000.0,
            requested_term_months=12,
            selected_product_id="prod-001",
            last_simulation_id="sim-001",
            current_stage="simulacao",
            handoff_required=False,
            handoff_reason=None,
            missing_fields=["city"],
            messages=[{"role": "user", "content": "Quero simular"}],
            tool_results=[{"tool": "generate_simulation", "result": {}}],
            errors=[],
            actions_emitted=[{"type": "simulation_sent", "simulation_id": "sim-001"}],
        )
        restored = deserialize_state(serialize_state(state))

        assert restored["lead_id"] == "lead-abc"
        assert restored["customer_name"] == "Maria Silva"
        assert restored["current_intent"] == "quer_simular"
        assert restored["requested_amount"] == 5000.0
        assert restored["requested_term_months"] == 12
        assert restored["selected_product_id"] == "prod-001"
        assert restored["last_simulation_id"] == "sim-001"
        assert restored["current_stage"] == "simulacao"
        assert restored["missing_fields"] == ["city"]
        assert restored["messages"] == [{"role": "user", "content": "Quero simular"}]
        assert restored["tool_results"] == [{"tool": "generate_simulation", "result": {}}]
        assert restored["actions_emitted"] == [
            {"type": "simulation_sent", "simulation_id": "sim-001"}
        ]

    def test_round_trip_none_optionals(self) -> None:
        """Campos opcionais com valor None são preservados."""
        state = _minimal_state(
            lead_id=None,
            customer_id=None,
            customer_name=None,
            city_id=None,
            city_name=None,
            current_intent=None,
            requested_amount=None,
            requested_term_months=None,
            selected_product_id=None,
            last_simulation_id=None,
            current_stage=None,
            handoff_reason=None,
        )
        restored = deserialize_state(serialize_state(state))
        assert restored.get("lead_id") is None
        assert restored.get("current_intent") is None
        assert restored.get("requested_amount") is None


# ---------------------------------------------------------------------------
# Testes de truncamento de messages (doc 06 §8)
# ---------------------------------------------------------------------------


class TestMessagesTruncation:
    def test_no_truncation_when_within_limit(self) -> None:
        """Não trunca quando messages tem exatamente MAX_MESSAGES entradas."""
        messages = [{"role": "user", "content": f"msg-{i}"} for i in range(MAX_MESSAGES)]
        state = _minimal_state(messages=messages)
        serialized = serialize_state(state)
        assert len(serialized["messages"]) == MAX_MESSAGES

    def test_no_truncation_when_below_limit(self) -> None:
        """Não trunca quando messages tem menos que MAX_MESSAGES entradas."""
        messages = [{"role": "user", "content": f"msg-{i}"} for i in range(5)]
        state = _minimal_state(messages=messages)
        serialized = serialize_state(state)
        assert len(serialized["messages"]) == 5

    def test_truncation_keeps_last_n(self) -> None:
        """Trunca para as últimas MAX_MESSAGES quando há mais mensagens."""
        total = MAX_MESSAGES + 10
        messages = [{"role": "user", "content": f"msg-{i}"} for i in range(total)]
        state = _minimal_state(messages=messages)
        serialized = serialize_state(state)
        assert len(serialized["messages"]) == MAX_MESSAGES
        # As últimas N devem ser mantidas
        assert serialized["messages"][0]["content"] == f"msg-{total - MAX_MESSAGES}"
        assert serialized["messages"][-1]["content"] == f"msg-{total - 1}"

    def test_truncation_does_not_mutate_original(self) -> None:
        """serialize_state não modifica a lista original do estado."""
        total = MAX_MESSAGES + 5
        messages = [{"role": "user", "content": f"msg-{i}"} for i in range(total)]
        state = _minimal_state(messages=messages)
        serialize_state(state)
        assert len(state["messages"]) == total

    def test_empty_messages_preserved(self) -> None:
        """Lista vazia de messages não é alterada."""
        state = _minimal_state(messages=[])
        serialized = serialize_state(state)
        assert serialized["messages"] == []

    def test_truncation_default_is_20(self) -> None:
        """MAX_MESSAGES é 20 conforme doc 06 §8."""
        assert MAX_MESSAGES == 20


# ---------------------------------------------------------------------------
# Testes de forward-compatibility (chaves desconhecidas)
# ---------------------------------------------------------------------------


class TestForwardCompat:
    def test_unknown_keys_discarded(self) -> None:
        """Chaves desconhecidas são descartadas ao desserializar."""
        data: dict[str, Any] = {
            "conversation_id": "conv-002",
            "phone": "+5569999990002",
            "handoff_required": False,
            "missing_fields": [],
            "messages": [],
            "tool_results": [],
            "errors": [],
            "actions_emitted": [],
            # Campo desconhecido — versão futura do schema
            "future_field_xyz": "algum valor",
            "another_unknown": 42,
        }
        restored = deserialize_state(data)
        assert "future_field_xyz" not in restored
        assert "another_unknown" not in restored
        assert restored["conversation_id"] == "conv-002"

    def test_only_known_keys_survive(self) -> None:
        """Todos os campos retornados por deserialize_state estão em _KNOWN_KEYS."""
        data: dict[str, Any] = {
            "conversation_id": "conv-003",
            "phone": "+5569999990003",
            "handoff_required": True,
            "missing_fields": ["city"],
            "messages": [],
            "tool_results": [],
            "errors": [],
            "actions_emitted": [],
            "unknown_a": 1,
            "unknown_b": "test",
        }
        restored = deserialize_state(data)
        for key in restored:
            assert key in _KNOWN_KEYS, f"Chave inesperada: {key}"

    def test_empty_dict_returns_empty_state(self) -> None:
        """Dict vazio retorna estado vazio (total=False permite isso)."""
        restored = deserialize_state({})
        assert dict(restored) == {}


# ---------------------------------------------------------------------------
# Testes de IntentLiteral (catálogo canônico)
# ---------------------------------------------------------------------------


class TestIntentLiteral:
    EXPECTED_INTENTS = frozenset(
        [
            "saudacao",
            "quer_credito",
            "quer_simular",
            "enviar_documentos",
            "falar_atendente",
            "consultar_andamento",
            "reclamacao",
            "cobranca",
            "nao_entendi",
            "fora_de_escopo",
        ]
    )

    def test_intent_literal_values(self) -> None:
        """IntentLiteral contém exatamente as intenções do catálogo (doc 06 §5.1)."""
        actual = frozenset(get_args(IntentLiteral))
        assert actual == self.EXPECTED_INTENTS

    def test_intent_count(self) -> None:
        """Exatamente 10 intenções no catálogo."""
        assert len(get_args(IntentLiteral)) == 10

    @pytest.mark.parametrize("intent", list(EXPECTED_INTENTS))
    def test_each_intent_survives_round_trip(self, intent: str) -> None:
        """Cada intenção do catálogo sobrevive ao round-trip."""
        state = _minimal_state(current_intent=intent)  # type: ignore[arg-type]
        restored = deserialize_state(serialize_state(state))
        assert restored["current_intent"] == intent


# ---------------------------------------------------------------------------
# Testes de _KNOWN_KEYS
# ---------------------------------------------------------------------------


class TestKnownKeys:
    EXPECTED_KEYS = frozenset(
        [
            "organization_id",
            "conversation_id",
            "chatwoot_conversation_id",
            "lead_id",
            "customer_id",
            "phone",
            "customer_name",
            "city_id",
            "city_name",
            "current_intent",
            "requested_amount",
            "requested_term_months",
            "selected_product_id",
            "last_simulation_id",
            "current_stage",
            "handoff_required",
            "handoff_reason",
            "missing_fields",
            "messages",
            "tool_results",
            "errors",
            "actions_emitted",
            # Estado leve do agente (F16-S42)
            "activity",
            "profile",
            "credit_objective",
            "scr_authorized",
            "collection_status",
            "handoff_active",
            "cpf_collected",
        ]
    )

    def test_known_keys_complete(self) -> None:
        """_KNOWN_KEYS cobre todos os campos do §5.1."""
        assert _KNOWN_KEYS == self.EXPECTED_KEYS

    def test_known_keys_count(self) -> None:
        """29 campos: 22 originais + 7 do estado leve do agente (F16-S42)."""
        assert len(_KNOWN_KEYS) == 29
