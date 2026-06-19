"""Teste F16-S48 — log_decision normaliza correlationId não-UUID.

Regressão do 3º smoke real: o correlation_id do contexto structlog é
"livechat_msg_<uuid>" (NÃO é UUID puro). O backend valida correlationId com
.uuid() → 400 "correlationId deve ser UUID válido". O log_decision deve, nesse
caso, cair no conversation_id (UUID garantido pelo inbound).
"""
from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import patch

import pytest
import structlog

from app.graphs.whatsapp_pre_attendance.nodes.log_decision import log_decision


def _make_state(conversation_id: str, organization_id: str) -> dict[str, Any]:
    return {
        "conversation_id": conversation_id,
        "organization_id": organization_id,
        "tool_results": [
            {
                "node": "agent_turn",
                "prompt_key": "pre_attendance_agent",
                "prompt_version": "pre_attendance_agent@v1",
                "latency_ms": 100.0,
            }
        ],
        "errors": [],
    }


@pytest.mark.asyncio
async def test_log_decision_non_uuid_context_falls_back_to_conversation_id() -> None:
    conv_id = str(uuid.uuid4())
    org_id = str(uuid.uuid4())
    state = _make_state(conv_id, org_id)

    # Contexto com o formato real do sistema: "livechat_msg_<uuid>" (NÃO é UUID puro)
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(
        correlation_id=f"livechat_msg_{uuid.uuid4()}",
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
        await log_decision(state)  # type: ignore[arg-type]

    structlog.contextvars.clear_contextvars()
    assert len(captured) == 1
    corr = captured[0].correlation_id
    # Não pode ser o valor "livechat_msg_..." e DEVE ser UUID válido (= conversation_id)
    assert not corr.startswith("livechat_msg_")
    uuid.UUID(corr)  # levanta ValueError se não for UUID
    assert corr == conv_id
