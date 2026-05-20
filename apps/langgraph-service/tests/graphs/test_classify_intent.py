"""Testes de unidade para classify_intent — F9-S09: prompts lidos do DB.

Cobre:
    1. classify_intent passa temperature ao gateway quando prompt define o valor
    2. classify_intent usa default (_DEFAULT_TEMPERATURE) quando DB retorna None
    3. classify_intent inclui top_p no complete_kwargs quando prompt define
    4. classify_intent omite top_p quando prompt não define (None)
    5. classify_intent usa max_tokens do DB quando definido
    6. classify_intent retorna handoff quando load_active_prompt levanta PromptNotFoundError
    7. classify_intent retorna handoff quando load_active_prompt levanta TimeoutException
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.prompts.loader import (
    ActivePrompt,
    PromptNotFoundError,
)

# ---------------------------------------------------------------------------
# Helpers para construir ActivePrompt sintético
# ---------------------------------------------------------------------------


def _make_active_prompt(
    key: str = "pre_attendance_classify",
    version: int = 1,
    *,
    temperature: float | None = None,
    max_tokens: int | None = None,
    top_p: float | None = None,
    body: str = "Classify the user intent.",
    model_recommended: str | None = None,
) -> ActivePrompt:
    """Cria ActivePrompt sintético para testes."""
    return ActivePrompt(
        key=key,
        version=version,
        body=body,
        content_hash="test_hash",
        model_recommended=model_recommended,
        temperature=temperature,
        max_tokens=max_tokens,
        top_p=top_p,
        prompt_version=f"{key}@v{version}",
    )


# ---------------------------------------------------------------------------
# Estado mínimo para o nó
# ---------------------------------------------------------------------------

_BASE_STATE = {
    "conversation_id": "conv-001",
    "lead_id": "lead-001",
    "messages": [{"role": "user", "content": "Quero simular um empréstimo"}],
    "tool_results": [],
    "errors": [],
}


def _make_mock_response(content: str = "simulacao") -> MagicMock:
    """Cria mock de resposta do gateway."""
    resp = MagicMock()
    resp.content = content
    resp.model = "openai/gpt-4o-mini"
    resp.usage = MagicMock(total_tokens=10)
    return resp


@pytest.mark.asyncio
class TestClassifyIntentLlmParams:
    """Testa que classify_intent passa os params LLM corretos ao gateway (F9-S09)."""

    async def test_usa_temperature_do_db_quando_definida(self) -> None:
        """Quando o prompt no DB define temperature=0.5, gateway.complete recebe 0.5."""
        active_prompt = _make_active_prompt(temperature=0.5, max_tokens=32)
        mock_response = _make_mock_response()

        from app.graphs.whatsapp_pre_attendance.nodes import classify_intent as ci

        with (
            patch("app.graphs.whatsapp_pre_attendance.nodes.classify_intent.load_active_prompt",
                  new=AsyncMock(return_value=active_prompt)),
            patch.object(ci, "get_gateway") as mock_get_gateway,
            patch.object(ci, "redact_pii") as mock_dlp,
        ):
            mock_dlp.return_value = MagicMock(text="Quero simular", counts={})

            mock_gateway = MagicMock()
            mock_gateway.complete = AsyncMock(return_value=mock_response)
            mock_get_gateway.return_value = mock_gateway

            await ci.classify_intent(_BASE_STATE)

        call_kwargs = mock_gateway.complete.call_args
        assert call_kwargs is not None
        kwargs = call_kwargs.kwargs if call_kwargs.kwargs else call_kwargs[1]
        assert kwargs.get("temperature") == pytest.approx(0.5)

    async def test_usa_default_temperature_quando_db_retorna_none(self) -> None:
        """Quando o DB retorna temperature=None, gateway recebe _DEFAULT_TEMPERATURE (0.0)."""
        active_prompt = _make_active_prompt()  # temperature=None
        mock_response = _make_mock_response()

        from app.graphs.whatsapp_pre_attendance.nodes import classify_intent as ci

        with (
            patch("app.graphs.whatsapp_pre_attendance.nodes.classify_intent.load_active_prompt",
                  new=AsyncMock(return_value=active_prompt)),
            patch.object(ci, "get_gateway") as mock_get_gateway,
            patch.object(ci, "redact_pii") as mock_dlp,
        ):
            mock_dlp.return_value = MagicMock(text="Quero simular", counts={})

            mock_gateway = MagicMock()
            mock_gateway.complete = AsyncMock(return_value=mock_response)
            mock_get_gateway.return_value = mock_gateway

            await ci.classify_intent(_BASE_STATE)

        call_kwargs = mock_gateway.complete.call_args
        assert call_kwargs is not None
        kwargs = call_kwargs.kwargs if call_kwargs.kwargs else call_kwargs[1]
        assert kwargs.get("temperature") == pytest.approx(ci._DEFAULT_TEMPERATURE)

    async def test_inclui_top_p_quando_db_define(self) -> None:
        """Quando o DB define top_p=0.9, gateway.complete recebe top_p=0.9."""
        active_prompt = _make_active_prompt(top_p=0.9)
        mock_response = _make_mock_response()

        from app.graphs.whatsapp_pre_attendance.nodes import classify_intent as ci

        with (
            patch("app.graphs.whatsapp_pre_attendance.nodes.classify_intent.load_active_prompt",
                  new=AsyncMock(return_value=active_prompt)),
            patch.object(ci, "get_gateway") as mock_get_gateway,
            patch.object(ci, "redact_pii") as mock_dlp,
        ):
            mock_dlp.return_value = MagicMock(text="Quero simular", counts={})

            mock_gateway = MagicMock()
            mock_gateway.complete = AsyncMock(return_value=mock_response)
            mock_get_gateway.return_value = mock_gateway

            await ci.classify_intent(_BASE_STATE)

        call_kwargs = mock_gateway.complete.call_args
        assert call_kwargs is not None
        kwargs = call_kwargs.kwargs if call_kwargs.kwargs else call_kwargs[1]
        assert "top_p" in kwargs
        assert kwargs["top_p"] == pytest.approx(0.9)

    async def test_omite_top_p_quando_db_retorna_none(self) -> None:
        """Quando o DB retorna top_p=None, top_p NÃO é passado ao gateway."""
        active_prompt = _make_active_prompt()  # top_p=None
        mock_response = _make_mock_response()

        from app.graphs.whatsapp_pre_attendance.nodes import classify_intent as ci

        with (
            patch("app.graphs.whatsapp_pre_attendance.nodes.classify_intent.load_active_prompt",
                  new=AsyncMock(return_value=active_prompt)),
            patch.object(ci, "get_gateway") as mock_get_gateway,
            patch.object(ci, "redact_pii") as mock_dlp,
        ):
            mock_dlp.return_value = MagicMock(text="Quero simular", counts={})

            mock_gateway = MagicMock()
            mock_gateway.complete = AsyncMock(return_value=mock_response)
            mock_get_gateway.return_value = mock_gateway

            await ci.classify_intent(_BASE_STATE)

        call_kwargs = mock_gateway.complete.call_args
        assert call_kwargs is not None
        kwargs = call_kwargs.kwargs if call_kwargs.kwargs else call_kwargs[1]
        assert "top_p" not in kwargs

    async def test_usa_max_tokens_do_db(self) -> None:
        """Quando o DB define max_tokens=64, gateway.complete recebe max_tokens=64."""
        active_prompt = _make_active_prompt(max_tokens=64)
        mock_response = _make_mock_response()

        from app.graphs.whatsapp_pre_attendance.nodes import classify_intent as ci

        with (
            patch("app.graphs.whatsapp_pre_attendance.nodes.classify_intent.load_active_prompt",
                  new=AsyncMock(return_value=active_prompt)),
            patch.object(ci, "get_gateway") as mock_get_gateway,
            patch.object(ci, "redact_pii") as mock_dlp,
        ):
            mock_dlp.return_value = MagicMock(text="Quero simular", counts={})

            mock_gateway = MagicMock()
            mock_gateway.complete = AsyncMock(return_value=mock_response)
            mock_get_gateway.return_value = mock_gateway

            await ci.classify_intent(_BASE_STATE)

        call_kwargs = mock_gateway.complete.call_args
        assert call_kwargs is not None
        kwargs = call_kwargs.kwargs if call_kwargs.kwargs else call_kwargs[1]
        assert kwargs.get("max_tokens") == 64

    async def test_retorna_handoff_quando_prompt_not_found(self) -> None:
        """PromptNotFoundError → handoff_required=True com motivo legível."""
        from app.graphs.whatsapp_pre_attendance.nodes import classify_intent as ci

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.classify_intent.load_active_prompt",
            new=AsyncMock(side_effect=PromptNotFoundError("pre_attendance_classify")),
        ):
            result = await ci.classify_intent(_BASE_STATE)

        assert result.get("handoff_required") is True
        assert result.get("current_intent") == ci._FALLBACK_INTENT
        assert "pre_attendance_classify" in result.get("handoff_reason", "")

    async def test_retorna_handoff_quando_timeout(self) -> None:
        """httpx.TimeoutException → handoff_required=True."""
        from app.graphs.whatsapp_pre_attendance.nodes import classify_intent as ci

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.classify_intent.load_active_prompt",
            new=AsyncMock(side_effect=httpx.TimeoutException("timeout")),
        ):
            result = await ci.classify_intent(_BASE_STATE)

        assert result.get("handoff_required") is True
        assert result.get("current_intent") == ci._FALLBACK_INTENT
