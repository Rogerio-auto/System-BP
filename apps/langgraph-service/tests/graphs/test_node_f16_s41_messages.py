from __future__ import annotations

import uuid
from typing import Any

import pytest

from app.graphs.whatsapp_pre_attendance.nodes.send_response import (
    _content_to_messages,
    _truncate_messages,
    send_response,
)
from app.graphs.whatsapp_pre_attendance.state import ConversationState
from app.schemas.outbound import MESSAGES_MAX_TOTAL_CHARS, WhatsAppMessageResponse

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_state(**overrides: Any) -> ConversationState:
    base: ConversationState = {
        "conversation_id": str(uuid.uuid4()),
        "chatwoot_conversation_id": "cw-001",
        "phone": "+5569999990001",
        "handoff_required": False,
        "handoff_reason": None,
        "missing_fields": [],
        "messages": [{"role": "user", "content": "Oi"}],
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
# _content_to_messages
# ===========================================================================


class TestContentToMessages:
    def test_split_by_double_newline(self) -> None:
        result = _content_to_messages("Ola!" + chr(10)*2 + "Tudo bem?")
        assert result == ["Ola!", "Tudo bem?"]

    def test_single_newline_normalized_to_space(self) -> None:
        result = _content_to_messages("Linha um" + chr(10) + "Linha dois")
        assert result == ["Linha um Linha dois"]

    def test_empty_string_returns_empty(self) -> None:
        assert _content_to_messages("") == []

    def test_whitespace_only_returns_empty(self) -> None:
        assert _content_to_messages("   " + chr(10)*2 + "  ") == []

    def test_trailing_empty_parts_ignored(self) -> None:
        result = _content_to_messages("Mensagem" + chr(10)*2)
        assert result == ["Mensagem"]

    def test_multiple_paragraphs(self) -> None:
        result = _content_to_messages("A" + chr(10)*2 + "B" + chr(10)*2 + "C")
        assert result == ["A", "B", "C"]

    def test_internal_whitespace_collapsed(self) -> None:
        result = _content_to_messages("Ola   mundo")
        assert result == ["Ola mundo"]


# ===========================================================================
# _truncate_messages
# ===========================================================================


class TestTruncateMessages:
    def test_fits_exactly(self) -> None:
        msgs = ["A" * 100, "B" * 100, "C" * 100]  # 300 total
        assert _truncate_messages(msgs, max_total=300) == msgs

    def test_last_message_truncated_when_no_space(self) -> None:
        # C*101 does not fit in remaining=100; truncated to C*100 (no spaces to cut)
        msgs = ["A" * 100, "B" * 100, "C" * 101]  # 301 total
        result = _truncate_messages(msgs, max_total=300)
        assert result == ["A" * 100, "B" * 100, "C" * 100]
        assert sum(len(m) for m in result) == 300

    def test_message_dropped_when_remaining_zero(self) -> None:
        # Second msg does not fit at all when remaining=0
        msgs = ["A" * 100, "B" * 100, "C" * 100, "D" * 1]  # 301 total
        result = _truncate_messages(msgs, max_total=300)
        assert sum(len(m) for m in result) <= 300

    def test_partial_truncated_at_word_boundary(self) -> None:
        # "Ola mundo cruel" = 15, max=10; candidate[:10]="Ola mundo c", rfind(" ")=9->"Ola mundo"
        result = _truncate_messages(["Ola mundo cruel"], max_total=10)
        assert result == ["Ola mundo"]

    def test_partial_no_space_takes_prefix(self) -> None:
        result = _truncate_messages(["ABCDEFGHIJ"], max_total=5)
        assert result == ["ABCDE"]

    def test_empty_list(self) -> None:
        assert _truncate_messages([], max_total=300) == []

    def test_all_fit(self) -> None:
        result = _truncate_messages(["Ola", "Mundo"], max_total=300)
        assert result == ["Ola", "Mundo"]

    def test_invariant_sum_never_exceeds_max(self) -> None:
        import random
        rng = random.Random(42)
        for _ in range(50):
            n = rng.randint(1, 10)
            msgs = ["X" * rng.randint(10, 80) for _ in range(n)]
            max_t = rng.randint(20, 300)
            result = _truncate_messages(msgs, max_total=max_t)
            assert sum(len(m) for m in result) <= max_t


# ===========================================================================
# WhatsAppMessageResponse.messages Pydantic validators
# ===========================================================================


_VALID_REPLY = {"type": "text", "content": "Ola", "template_name": None, "template_variables": None}
_VALID_HANDOFF = {"required": False, "reason": None, "summary": None}
_VALID_STATE = {
    "current_stage": None,
    "current_intent": None,
    "next_expected_input": None,
    "missing_fields": [],
}


def _base_resp(**kw: Any) -> dict[str, Any]:
    return {
        "conversation_id": str(uuid.uuid4()),
        "lead_id": None,
        "reply": _VALID_REPLY,
        "actions": [],
        "handoff": _VALID_HANDOFF,
        "state": _VALID_STATE,
        "messages": [],
        "graph_version": "1.0.0",
        "latency_ms": 0,
        "errors": [],
        **kw,
    }


class TestWhatsAppMessageResponseMessages:
    def test_valid_empty_messages(self) -> None:
        obj = WhatsAppMessageResponse(**_base_resp(messages=[]))
        assert obj.messages == []

    def test_valid_messages_array(self) -> None:
        obj = WhatsAppMessageResponse(**_base_resp(messages=["Ola", "Tudo bem"]))
        assert obj.messages == ["Ola", "Tudo bem"]

    def test_item_with_newline_rejected(self) -> None:
        from pydantic import ValidationError
        with pytest.raises(ValidationError, match="newline"):
            WhatsAppMessageResponse(**_base_resp(messages=["Ola" + chr(10) + "Tudo"]))

    def test_empty_item_rejected(self) -> None:
        from pydantic import ValidationError
        with pytest.raises(ValidationError, match="vazio"):
            WhatsAppMessageResponse(**_base_resp(messages=["Ola", ""]))

    def test_sum_over_limit_rejected(self) -> None:
        from pydantic import ValidationError
        msgs = ["A" * 150, "B" * 151]  # 301 total
        with pytest.raises(ValidationError, match="excede"):
            WhatsAppMessageResponse(**_base_resp(messages=msgs))

    def test_sum_exactly_limit_accepted(self) -> None:
        msgs = ["A" * 150, "B" * 150]  # 300 total
        obj = WhatsAppMessageResponse(**_base_resp(messages=msgs))
        assert sum(len(m) for m in obj.messages) == MESSAGES_MAX_TOTAL_CHARS


# ===========================================================================
# send_response -- path agentico (flag ON)
# ===========================================================================


_SETTINGS_PATH = "app.graphs.whatsapp_pre_attendance.nodes.send_response.settings"


class TestSendResponseAgentic:
    def test_dict_reply_populates_messages(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            _SETTINGS_PATH + ".pre_attendance_agentic_enabled",
            True,
            raising=False,
        )
        content = "Ola!" + chr(10)*2 + "Tudo bem?"
        state = _make_state(reply={
            "type": "text",
            "content": content,
            "template_name": None,
            "template_variables": None,
        })
        last = send_response(state)["tool_results"][-1]
        assert last["messages"] == ["Ola!", "Tudo bem?"]
        assert last["reply"]["type"] == "text"

    def test_dict_reply_retrocompat_first_message(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            _SETTINGS_PATH + ".pre_attendance_agentic_enabled",
            True,
            raising=False,
        )
        content = "Primeira" + chr(10)*2 + "Segunda"
        state = _make_state(reply={
            "type": "text",
            "content": content,
            "template_name": None,
            "template_variables": None,
        })
        last = send_response(state)["tool_results"][-1]
        assert last["reply"]["content"] == "Primeira"
        assert last["messages"][0] == "Primeira"

    def test_long_content_truncated_to_300(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            _SETTINGS_PATH + ".pre_attendance_agentic_enabled",
            True,
            raising=False,
        )
        p = "X" * 120
        content = p + chr(10)*2 + p + chr(10)*2 + p  # 360 total
        state = _make_state(reply={
            "type": "text",
            "content": content,
            "template_name": None,
            "template_variables": None,
        })
        last = send_response(state)["tool_results"][-1]
        assert sum(len(m) for m in last["messages"]) <= MESSAGES_MAX_TOTAL_CHARS

    def test_single_message_no_split(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            _SETTINGS_PATH + ".pre_attendance_agentic_enabled",
            True,
            raising=False,
        )
        content = "Mensagem unica sem divisao"
        state = _make_state(reply={
            "type": "text",
            "content": content,
            "template_name": None,
            "template_variables": None,
        })
        last = send_response(state)["tool_results"][-1]
        assert last["messages"] == ["Mensagem unica sem divisao"]


# ===========================================================================
# send_response -- funil antigo (flag OFF)
# ===========================================================================


class TestSendResponseFunilOff:
    def test_flag_off_messages_empty(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            _SETTINGS_PATH + ".pre_attendance_agentic_enabled",
            False,
            raising=False,
        )
        state = _make_state(current_intent="nao_entendi")
        last = send_response(state)["tool_results"][-1]
        assert last["messages"] == []
        assert last["reply"]["type"] == "text"
        assert last["reply"]["content"] != ""

    def test_flag_off_string_reply_unchanged(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            _SETTINGS_PATH + ".pre_attendance_agentic_enabled",
            False,
            raising=False,
        )
        state = _make_state(reply="Texto do no deterministico")
        last = send_response(state)["tool_results"][-1]
        assert last["messages"] == []
        assert last["reply"]["content"] == "Texto do no deterministico"


# ===========================================================================
# send_response -- handoff com flag ON
# ===========================================================================


class TestSendResponseHandoffAgentic:
    def test_handoff_messages_empty(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            _SETTINGS_PATH + ".pre_attendance_agentic_enabled",
            True,
            raising=False,
        )
        state = _make_state(
            handoff_required=True,
            reply={
            "type": "text",
            "content": "Transferindo...",
            "template_name": None,
            "template_variables": None,
        },
        )
        last = send_response(state)["tool_results"][-1]
        assert last["messages"] == []
        assert last["reply"]["type"] == "none"
