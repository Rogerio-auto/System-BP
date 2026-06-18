"""Testes unitários do nó request_handoff — F9-S10.

Cobre:
- Mensagem contextual em modo dry-run (F9-S10 MEDIUM).
- Mensagem genérica no caminho de produção.
- Integração com as tools (mock do InternalApiClient).
- Campos obrigatórios no dict de retorno.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.graphs.whatsapp_pre_attendance.nodes.request_handoff import (
    _build_note_body,
    _build_summary,
    request_handoff,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_state(**overrides: Any) -> dict[str, Any]:
    """Estado mínimo para invocar request_handoff."""
    base: dict[str, Any] = {
        "conversation_id": "conv-handoff-test-001",
        "chatwoot_conversation_id": "42",
        "organization_id": "576a8121-838a-4904-b6bb-574648d9c32b",
        "phone": "+5569988880001",
        "handoff_required": False,
        "handoff_reason": "falar_atendente",
        "missing_fields": [],
        "messages": [{"role": "user", "content": "quero falar com um atendente"}],
        "tool_results": [],
        "errors": [],
        "actions_emitted": [],
        "lead_id": "lead-uuid-handoff-001",
        "customer_id": None,
        "customer_name": "Ana Teste",
        "city_id": None,
        "city_name": "Porto Velho",
        "current_intent": "falar_atendente",
        "current_stage": None,
        "requested_amount": None,
        "requested_term_months": None,
        "last_simulation_id": None,
    }
    base.update(overrides)
    return base


def _make_mock_client(
    handoff_id: str = "handoff-uuid-001",
    note_id: str = "note-uuid-001",
) -> MagicMock:
    """Mock do InternalApiClient com respostas compatíveis com os schemas."""
    client = MagicMock()
    client.post = AsyncMock(side_effect=[
        # Primeira chamada: POST /internal/handoffs
        {
            "handoff_id": handoff_id,
            "chatwoot_conversation_id": "cw-handoff-42",
            "assigned_agent_id": None,
            "status": "requested",
            "dry_run": False,
        },
        # Segunda chamada: POST /internal/chatwoot/notes
        {
            "note_id": note_id,
        },
    ])
    return client


# ---------------------------------------------------------------------------
# Testes de _build_summary
# ---------------------------------------------------------------------------


class TestBuildSummary:
    def test_summary_with_all_fields(self) -> None:
        state = _make_state(
            customer_name="Maria Silva",
            city_name="Porto Velho",
            requested_amount=5000.0,
            requested_term_months=12,
            last_simulation_id="sim-uuid-001",
        )
        summary = _build_summary(state, "cliente_solicitou_atendente")  # type: ignore[arg-type]
        assert "Maria Silva" in summary
        assert "Porto Velho" in summary
        assert "12" in summary
        assert "sim-uuid-001" in summary
        assert "cliente_solicitou_atendente" in summary
        # CPF nunca deve estar no summary (LGPD)
        assert "CPF" not in summary

    def test_summary_without_optional_fields(self) -> None:
        state = _make_state(
            customer_name=None,
            city_name=None,
            requested_amount=None,
            requested_term_months=None,
            last_simulation_id=None,
        )
        summary = _build_summary(state, "ai_decision")  # type: ignore[arg-type]
        assert "Desconhecido" in summary
        assert "cidade não identificada" in summary
        assert "ai_decision" in summary


class TestBuildNoteBody:
    def test_note_body_has_header(self) -> None:
        body = _build_note_body("Resumo do cliente.", "falar_atendente")
        assert "Transferência via IA" in body
        assert "falar_atendente" in body
        assert "Resumo do cliente." in body

    def test_note_body_without_intent(self) -> None:
        body = _build_note_body("Resumo.", None)
        assert "Intenção detectada" not in body


# ---------------------------------------------------------------------------
# Testes de fluxo do nó (com mock do InternalApiClient)
# ---------------------------------------------------------------------------


class TestRequestHandoffNode:
    """Testes do nó request_handoff com client injetável."""

    @pytest.mark.asyncio
    async def test_happy_path_sets_handoff_required(self) -> None:
        """Caminho feliz: ambas as tools funcionam → handoff_required=True."""
        state = _make_state()
        client = _make_mock_client()

        result = await request_handoff(state, client=client)  # type: ignore[arg-type]

        assert result.get("handoff_required") is True
        assert result.get("current_stage") == "handoff_requested"
        assert not result.get("errors")

    @pytest.mark.asyncio
    async def test_happy_path_tool_results_populated(self) -> None:
        """Caminho feliz: tool_results contém entradas das duas tools."""
        state = _make_state()
        client = _make_mock_client()

        result = await request_handoff(state, client=client)  # type: ignore[arg-type]

        tool_results = result.get("tool_results", [])
        tools_used = [t.get("tool") for t in tool_results]
        assert "request_handoff" in tools_used
        assert "create_chatwoot_note" in tools_used

    @pytest.mark.asyncio
    async def test_lead_id_missing_production_error_message(self) -> None:
        """Sem dry_run, lead_id ausente usa mensagem genérica de produção."""
        state = _make_state(lead_id=None)  # sem dry_run=True
        result = await request_handoff(state)  # type: ignore[arg-type]

        assert result.get("handoff_required") is True
        errors = result.get("errors", [])
        error_msgs = " ".join(str(e.get("error", "")) for e in errors)
        assert "handoff requer lead identificado" in error_msgs, (
            "Caminho de produção deve usar mensagem genérica de lead_id ausente."
        )

    @pytest.mark.asyncio
    async def test_lead_id_missing_dry_run_contextual_message(self) -> None:
        """Com dry_run=True, lead_id ausente usa mensagem contextual do playground."""
        state = _make_state(lead_id=None, dry_run=True)
        result = await request_handoff(state)  # type: ignore[arg-type]

        assert result.get("handoff_required") is True
        errors = result.get("errors", [])
        error_msgs = " ".join(str(e.get("error", "")) for e in errors)

        # Mensagem contextual deve mencionar modo sintético ou playground
        assert "sintético" in error_msgs or "playground" in error_msgs.lower(), (
            f"F9-S10 MEDIUM: mensagem contextual esperada, obtido: {error_msgs}"
        )
        # Mensagem genérica de produção não deve aparecer
        assert "handoff requer lead identificado" not in error_msgs, (
            "Mensagem de produção não deve aparecer em dry_run=True"
        )

    @pytest.mark.asyncio
    async def test_note_tool_failure_recorded_in_errors(self) -> None:
        """Falha na tool create_chatwoot_note é registrada em errors."""
        state = _make_state()

        client = MagicMock()
        client.post = AsyncMock(side_effect=[
            # Primeira chamada: POST /internal/handoffs — sucesso
            {
                "handoff_id": "handoff-uuid-ok",
                "chatwoot_conversation_id": "cw-handoff-42",
                "assigned_agent_id": None,
                "status": "requested",
            },
            # Segunda chamada: POST /internal/chatwoot/notes — falha
            Exception("backend indisponível"),
        ])

        result = await request_handoff(state, client=client)  # type: ignore[arg-type]

        assert result.get("handoff_required") is True
        errors = result.get("errors", [])
        assert len(errors) == 1  # apenas erro da nota (handoff ok)
        assert errors[0]["tool"] == "create_chatwoot_note"

    @pytest.mark.asyncio
    async def test_handoff_tool_failure_recorded_in_errors(self) -> None:
        """Falha na tool request_handoff é registrada em errors."""
        state = _make_state()

        client = MagicMock()
        client.post = AsyncMock(side_effect=[
            # Primeira chamada: POST /internal/handoffs — falha
            Exception("timeout ao criar handoff"),
            # Segunda chamada: POST /internal/chatwoot/notes — sucesso
            {"note_id": "note-uuid-fallback"},
        ])

        result = await request_handoff(state, client=client)  # type: ignore[arg-type]

        assert result.get("handoff_required") is True
        errors = result.get("errors", [])
        assert any(e["tool"] == "request_handoff" for e in errors)

    @pytest.mark.asyncio
    async def test_returns_required_fields(self) -> None:
        """Retorno deve conter todos os campos obrigatórios."""
        state = _make_state()
        client = _make_mock_client()

        result = await request_handoff(state, client=client)  # type: ignore[arg-type]

        assert "handoff_required" in result
        assert "handoff_reason" in result
        assert "current_stage" in result
        assert "tool_results" in result
        assert "errors" in result
