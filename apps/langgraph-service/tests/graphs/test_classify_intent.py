"""Testes de unidade para classify_intent — F9-S08: parametrização de LLM.

Cobre:
    1. _load_prompt extrai temperature quando presente no frontmatter
    2. _load_prompt retorna None quando temperature ausente do frontmatter
    3. _load_prompt extrai max_tokens quando presente
    4. _load_prompt extrai top_p quando presente
    5. Valores null/~ no frontmatter retornam None
    6. classify_intent passa temperature ao gateway quando prompt define o valor
    7. classify_intent usa default (_DEFAULT_TEMPERATURE) quando frontmatter não define
    8. classify_intent inclui top_p no complete_kwargs quando frontmatter define
    9. classify_intent omite top_p quando frontmatter não define
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Helpers para construir conteúdo de prompt .md sintético
# ---------------------------------------------------------------------------


def _make_prompt_md(
    key: str = "test_classifier",
    version: str = "1",
    *,
    temperature: str | None = None,
    max_tokens: str | None = None,
    top_p: str | None = None,
    body: str = "Classify the user intent.",
) -> str:
    """Cria conteúdo de arquivo .md de prompt para testes."""
    fm_lines = [f"key: {key}", f"version: {version}"]
    if temperature is not None:
        fm_lines.append(f"temperature: {temperature}")
    if max_tokens is not None:
        fm_lines.append(f"max_tokens: {max_tokens}")
    if top_p is not None:
        fm_lines.append(f"top_p: {top_p}")
    frontmatter = "\n".join(fm_lines)
    return f"---\n{frontmatter}\n---\n{body}\n"


# ---------------------------------------------------------------------------
# Testes de _load_prompt (parser de frontmatter F9-S08)
# ---------------------------------------------------------------------------


class TestLoadPrompt:
    """Testa extração de parâmetros LLM do frontmatter pelo _load_prompt."""

    def _call(self, content: str):
        """Chama _load_prompt com o arquivo mockado."""
        from app.graphs.whatsapp_pre_attendance.nodes import classify_intent as ci

        with patch.object(ci, "_PROMPT_PATH") as mock_path:
            mock_path.exists.return_value = True
            mock_path.read_text.return_value = content
            return ci._load_prompt()

    def test_extrai_temperature_quando_presente(self):
        content = _make_prompt_md(temperature="0.7")
        # RUF059: variáveis não usadas prefixadas com _
        _key, _version, _body, temperature, max_tokens, top_p = self._call(content)
        assert temperature == pytest.approx(0.7)
        assert max_tokens is None
        assert top_p is None

    def test_retorna_none_quando_temperature_ausente(self):
        content = _make_prompt_md()
        _, _, _, temperature, _max_tokens, _top_p = self._call(content)
        assert temperature is None

    def test_extrai_max_tokens_quando_presente(self):
        content = _make_prompt_md(max_tokens="128")
        _, _, _, temperature, max_tokens, _top_p = self._call(content)
        assert max_tokens == 128
        assert temperature is None

    def test_extrai_top_p_quando_presente(self):
        content = _make_prompt_md(top_p="0.95")
        _, _, _, _temperature, _max_tokens, top_p = self._call(content)
        assert top_p == pytest.approx(0.95)

    def test_null_yaml_retorna_none(self):
        content = _make_prompt_md(temperature="null", max_tokens="null", top_p="null")
        _, _, _, temperature, max_tokens, top_p = self._call(content)
        assert temperature is None
        assert max_tokens is None
        assert top_p is None

    def test_tilde_yaml_retorna_none(self):
        content = _make_prompt_md(temperature="~", max_tokens="~", top_p="~")
        _, _, _, temperature, max_tokens, top_p = self._call(content)
        assert temperature is None
        assert max_tokens is None
        assert top_p is None

    def test_extrai_todos_os_tres_campos(self):
        content = _make_prompt_md(temperature="0.2", max_tokens="64", top_p="0.85")
        _, _, _, temperature, max_tokens, top_p = self._call(content)
        assert temperature == pytest.approx(0.2)
        assert max_tokens == 64
        assert top_p == pytest.approx(0.85)

    def test_key_e_version_extraidos_corretamente(self):
        content = _make_prompt_md(key="intent_classifier", version="3", temperature="0.5")
        key, version, _body, *_ = self._call(content)
        assert key == "intent_classifier"
        assert version == "3"


# ---------------------------------------------------------------------------
# Testes de classify_intent — passa parâmetros ao gateway.complete (F9-S08)
# ---------------------------------------------------------------------------

# Estado mínimo para o nó
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
    """Testa que classify_intent passa os params LLM corretos ao gateway."""

    async def test_usa_temperature_do_frontmatter_quando_definida(self):
        """Quando o prompt define temperature=0.5, gateway.complete recebe temperature=0.5."""
        prompt_content = _make_prompt_md(temperature="0.5", max_tokens="32")
        mock_response = _make_mock_response()

        from app.graphs.whatsapp_pre_attendance.nodes import classify_intent as ci

        with (
            patch.object(ci, "_PROMPT_PATH") as mock_path,
            patch.object(ci, "get_gateway") as mock_get_gateway,
            patch.object(ci, "redact_pii") as mock_dlp,
        ):
            mock_path.exists.return_value = True
            mock_path.read_text.return_value = prompt_content

            mock_dlp.return_value = MagicMock(text="Quero simular", counts={})

            mock_gateway = MagicMock()
            mock_gateway.complete = AsyncMock(return_value=mock_response)
            mock_get_gateway.return_value = mock_gateway

            await ci.classify_intent(_BASE_STATE)

        call_kwargs = mock_gateway.complete.call_args
        assert call_kwargs is not None
        # Verifica keyword arguments
        kwargs = call_kwargs.kwargs if call_kwargs.kwargs else call_kwargs[1]
        assert kwargs.get("temperature") == pytest.approx(0.5)

    async def test_usa_default_temperature_quando_frontmatter_nao_define(self):
        """Quando o prompt NÃO define temperature, gateway recebe _DEFAULT_TEMPERATURE (0.0)."""
        prompt_content = _make_prompt_md()  # sem temperature
        mock_response = _make_mock_response()

        from app.graphs.whatsapp_pre_attendance.nodes import classify_intent as ci

        with (
            patch.object(ci, "_PROMPT_PATH") as mock_path,
            patch.object(ci, "get_gateway") as mock_get_gateway,
            patch.object(ci, "redact_pii") as mock_dlp,
        ):
            mock_path.exists.return_value = True
            mock_path.read_text.return_value = prompt_content
            mock_dlp.return_value = MagicMock(text="Quero simular", counts={})

            mock_gateway = MagicMock()
            mock_gateway.complete = AsyncMock(return_value=mock_response)
            mock_get_gateway.return_value = mock_gateway

            await ci.classify_intent(_BASE_STATE)

        call_kwargs = mock_gateway.complete.call_args
        assert call_kwargs is not None
        kwargs = call_kwargs.kwargs if call_kwargs.kwargs else call_kwargs[1]
        assert kwargs.get("temperature") == pytest.approx(ci._DEFAULT_TEMPERATURE)

    async def test_inclui_top_p_quando_frontmatter_define(self):
        """Quando o prompt define top_p=0.9, gateway.complete recebe top_p=0.9."""
        prompt_content = _make_prompt_md(top_p="0.9")
        mock_response = _make_mock_response()

        from app.graphs.whatsapp_pre_attendance.nodes import classify_intent as ci

        with (
            patch.object(ci, "_PROMPT_PATH") as mock_path,
            patch.object(ci, "get_gateway") as mock_get_gateway,
            patch.object(ci, "redact_pii") as mock_dlp,
        ):
            mock_path.exists.return_value = True
            mock_path.read_text.return_value = prompt_content
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

    async def test_omite_top_p_quando_frontmatter_nao_define(self):
        """Quando o prompt NÃO define top_p, top_p não é passado ao gateway."""
        prompt_content = _make_prompt_md()  # sem top_p
        mock_response = _make_mock_response()

        from app.graphs.whatsapp_pre_attendance.nodes import classify_intent as ci

        with (
            patch.object(ci, "_PROMPT_PATH") as mock_path,
            patch.object(ci, "get_gateway") as mock_get_gateway,
            patch.object(ci, "redact_pii") as mock_dlp,
        ):
            mock_path.exists.return_value = True
            mock_path.read_text.return_value = prompt_content
            mock_dlp.return_value = MagicMock(text="Quero simular", counts={})

            mock_gateway = MagicMock()
            mock_gateway.complete = AsyncMock(return_value=mock_response)
            mock_get_gateway.return_value = mock_gateway

            await ci.classify_intent(_BASE_STATE)

        call_kwargs = mock_gateway.complete.call_args
        assert call_kwargs is not None
        kwargs = call_kwargs.kwargs if call_kwargs.kwargs else call_kwargs[1]
        # top_p NÃO deve estar no kwargs quando não definido no frontmatter
        assert "top_p" not in kwargs

    async def test_usa_max_tokens_do_frontmatter(self):
        """Quando o prompt define max_tokens=64, gateway.complete recebe max_tokens=64."""
        prompt_content = _make_prompt_md(max_tokens="64")
        mock_response = _make_mock_response()

        from app.graphs.whatsapp_pre_attendance.nodes import classify_intent as ci

        with (
            patch.object(ci, "_PROMPT_PATH") as mock_path,
            patch.object(ci, "get_gateway") as mock_get_gateway,
            patch.object(ci, "redact_pii") as mock_dlp,
        ):
            mock_path.exists.return_value = True
            mock_path.read_text.return_value = prompt_content
            mock_dlp.return_value = MagicMock(text="Quero simular", counts={})

            mock_gateway = MagicMock()
            mock_gateway.complete = AsyncMock(return_value=mock_response)
            mock_get_gateway.return_value = mock_gateway

            await ci.classify_intent(_BASE_STATE)

        call_kwargs = mock_gateway.complete.call_args
        assert call_kwargs is not None
        kwargs = call_kwargs.kwargs if call_kwargs.kwargs else call_kwargs[1]
        assert kwargs.get("max_tokens") == 64

    async def test_retorna_handoff_quando_prompt_nao_encontrado(self):
        """Quando o prompt .md não existe, classify_intent retorna handoff_required=True."""
        from app.graphs.whatsapp_pre_attendance.nodes import classify_intent as ci

        with patch.object(ci, "_PROMPT_PATH") as mock_path:
            mock_path.exists.return_value = False

            result = await ci.classify_intent(_BASE_STATE)

        assert result.get("handoff_required") is True
        assert result.get("current_intent") == ci._FALLBACK_INTENT
