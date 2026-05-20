"""Testes do loader de prompts do DB (F9-S09).

Cobre:
    1. load_active_prompt retorna ActivePrompt em resposta 200 válida.
    2. load_active_prompt levanta PromptNotFoundError em resposta 404.
    3. load_active_prompt propaga httpx.TimeoutException em timeout.
    4. load_active_prompt usa cache após primeira chamada (cache hit).
    5. Cache expirado não é retornado (TTL validado via mock de tempo).
    6. ActivePrompt rejeita campos extras (extra='forbid').
    7. Campos LLM nullable retornados corretamente (None).
    8. InternalApiClient é chamado com o path correto.
"""
from __future__ import annotations

import time
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.prompts.loader import (
    _TTL_SECONDS,
    ActivePrompt,
    PromptNotFoundError,
    _invalidate_cache,
    load_active_prompt,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_prompt_payload(
    key: str = "pre_attendance_classify",
    version: int = 1,
    *,
    model_recommended: str | None = "anthropic/claude-3-5-haiku",
    temperature: float | None = None,
    max_tokens: int | None = None,
    top_p: float | None = None,
    body: str = "# Papel\n\nVocê classifica a intenção.",
    content_hash: str = "abc123",
    prompt_version: str | None = None,
) -> dict[str, Any]:
    """Cria payload de resposta do endpoint /internal/prompts/active/:key."""
    return {
        "key": key,
        "version": version,
        "body": body,
        "content_hash": content_hash,
        "model_recommended": model_recommended,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "top_p": top_p,
        "prompt_version": prompt_version or f"{key}@v{version}",
    }


# ---------------------------------------------------------------------------
# Helper para limpar cache entre testes
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def clear_cache() -> None:  # type: ignore[misc]
    """Limpa o cache do loader antes de cada teste para isolamento."""
    _invalidate_cache()
    yield
    _invalidate_cache()


# ---------------------------------------------------------------------------
# Testes de load_active_prompt — caminho feliz
# ---------------------------------------------------------------------------


class TestLoadActivePromptHappyPath:
    @pytest.mark.asyncio
    async def test_retorna_active_prompt_em_200(self) -> None:
        """Resposta 200 válida → ActivePrompt parseado corretamente."""
        payload = _make_prompt_payload()

        with patch("app.prompts.loader.InternalApiClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.get = AsyncMock(return_value=payload)
            mock_client_cls.return_value = mock_client

            result = await load_active_prompt("pre_attendance_classify")

        assert isinstance(result, ActivePrompt)
        assert result.key == "pre_attendance_classify"
        assert result.version == 1
        assert result.body == "# Papel\n\nVocê classifica a intenção."
        assert result.content_hash == "abc123"
        assert result.model_recommended == "anthropic/claude-3-5-haiku"
        assert result.temperature is None
        assert result.max_tokens is None
        assert result.top_p is None
        assert result.prompt_version == "pre_attendance_classify@v1"

    @pytest.mark.asyncio
    async def test_chama_endpoint_com_path_correto(self) -> None:
        """InternalApiClient.get é chamado com /internal/prompts/active/{key}."""
        payload = _make_prompt_payload(key="simulation")

        with patch("app.prompts.loader.InternalApiClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.get = AsyncMock(return_value=payload)
            mock_client_cls.return_value = mock_client

            await load_active_prompt("simulation")

        mock_client.get.assert_called_once_with("/internal/prompts/active/simulation")

    @pytest.mark.asyncio
    async def test_retorna_campos_llm_quando_definidos(self) -> None:
        """Campos LLM (temperature, max_tokens, top_p) são preservados quando não-null."""
        payload = _make_prompt_payload(temperature=0.3, max_tokens=512, top_p=0.95)

        with patch("app.prompts.loader.InternalApiClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.get = AsyncMock(return_value=payload)
            mock_client_cls.return_value = mock_client

            result = await load_active_prompt("pre_attendance_classify")

        assert result.temperature == pytest.approx(0.3)
        assert result.max_tokens == 512
        assert result.top_p == pytest.approx(0.95)

    @pytest.mark.asyncio
    async def test_model_recommended_null_aceito(self) -> None:
        """model_recommended=null é aceito e retornado como None."""
        payload = _make_prompt_payload(model_recommended=None)

        with patch("app.prompts.loader.InternalApiClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.get = AsyncMock(return_value=payload)
            mock_client_cls.return_value = mock_client

            result = await load_active_prompt("pre_attendance_classify")

        assert result.model_recommended is None


# ---------------------------------------------------------------------------
# Testes de PromptNotFoundError (404)
# ---------------------------------------------------------------------------


class TestLoadActivePromptNotFound:
    @pytest.mark.asyncio
    async def test_levanta_prompt_not_found_error_em_404(self) -> None:
        """404 do endpoint levanta PromptNotFoundError com a key correta."""
        mock_response = MagicMock()
        mock_response.status_code = 404
        http_error = httpx.HTTPStatusError(
            "404 Not Found",
            request=MagicMock(),
            response=mock_response,
        )

        with patch("app.prompts.loader.InternalApiClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.get = AsyncMock(side_effect=http_error)
            mock_client_cls.return_value = mock_client

            with pytest.raises(PromptNotFoundError) as exc_info:
                await load_active_prompt("chave_inexistente")

        assert exc_info.value.key == "chave_inexistente"
        assert "chave_inexistente" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_mensagem_prompt_not_found_contem_key(self) -> None:
        """Mensagem de PromptNotFoundError contém a key no formato canônico."""
        mock_response = MagicMock()
        mock_response.status_code = 404
        http_error = httpx.HTTPStatusError("404", request=MagicMock(), response=mock_response)

        with patch("app.prompts.loader.InternalApiClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.get = AsyncMock(side_effect=http_error)
            mock_client_cls.return_value = mock_client

            with pytest.raises(PromptNotFoundError) as exc_info:
                await load_active_prompt("simulation")

        assert "key=simulation" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_5xx_propaga_http_status_error(self) -> None:
        """Resposta 5xx propaga httpx.HTTPStatusError (não PromptNotFoundError)."""
        mock_response = MagicMock()
        mock_response.status_code = 503
        http_error = httpx.HTTPStatusError("503", request=MagicMock(), response=mock_response)

        with patch("app.prompts.loader.InternalApiClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.get = AsyncMock(side_effect=http_error)
            mock_client_cls.return_value = mock_client

            with pytest.raises(httpx.HTTPStatusError):
                await load_active_prompt("any_key")


# ---------------------------------------------------------------------------
# Testes de timeout
# ---------------------------------------------------------------------------


class TestLoadActivePromptTimeout:
    @pytest.mark.asyncio
    async def test_propaga_timeout_exception(self) -> None:
        """httpx.TimeoutException é propagado sem wrap."""
        timeout_exc = httpx.TimeoutException("Timeout")

        with patch("app.prompts.loader.InternalApiClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.get = AsyncMock(side_effect=timeout_exc)
            mock_client_cls.return_value = mock_client

            with pytest.raises(httpx.TimeoutException):
                await load_active_prompt("pre_attendance_classify")


# ---------------------------------------------------------------------------
# Testes de cache TTL
# ---------------------------------------------------------------------------


class TestLoadActivePromptCache:
    @pytest.mark.asyncio
    async def test_segunda_chamada_usa_cache(self) -> None:
        """Segunda chamada para a mesma key usa cache — InternalApiClient chamado 1x."""
        payload = _make_prompt_payload()

        with patch("app.prompts.loader.InternalApiClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.get = AsyncMock(return_value=payload)
            mock_client_cls.return_value = mock_client

            result1 = await load_active_prompt("pre_attendance_classify")
            result2 = await load_active_prompt("pre_attendance_classify")

        # Client instanciado 1x, .get chamado 1x
        assert mock_client.get.call_count == 1
        assert result1.version == result2.version
        assert result1.body == result2.body

    @pytest.mark.asyncio
    async def test_cache_diferente_por_key(self) -> None:
        """Cache é independente por key — 2 keys distintas fazem 2 chamadas HTTP."""
        payload_classify = _make_prompt_payload(
            key="pre_attendance_classify",
            prompt_version="pre_attendance_classify@v1",
        )
        payload_simulation = _make_prompt_payload(
            key="simulation",
            prompt_version="simulation@v1",
        )

        with patch("app.prompts.loader.InternalApiClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.get = AsyncMock(
                side_effect=[payload_classify, payload_simulation]
            )
            mock_client_cls.return_value = mock_client

            result_classify = await load_active_prompt("pre_attendance_classify")
            result_simulation = await load_active_prompt("simulation")

        assert mock_client.get.call_count == 2
        assert result_classify.key == "pre_attendance_classify"
        assert result_simulation.key == "simulation"

    @pytest.mark.asyncio
    async def test_cache_expirado_faz_nova_chamada(self) -> None:
        """Após expiração do TTL, próxima chamada busca novamente do endpoint."""
        payload = _make_prompt_payload()

        with patch("app.prompts.loader.InternalApiClient") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.get = AsyncMock(return_value=payload)
            mock_client_cls.return_value = mock_client

            # Primeira chamada
            await load_active_prompt("pre_attendance_classify")
            assert mock_client.get.call_count == 1

            # Simula expiração do TTL: avança o tempo monotônico além do TTL
            original_monotonic = time.monotonic
            future_time = original_monotonic() + _TTL_SECONDS + 1.0

            with patch("app.prompts.loader.time") as mock_time:
                mock_time.monotonic.return_value = future_time

                # Nova chamada após expiração deve buscar do endpoint
                await load_active_prompt("pre_attendance_classify")

            assert mock_client.get.call_count == 2


# ---------------------------------------------------------------------------
# Testes de ActivePrompt (schema Pydantic)
# ---------------------------------------------------------------------------


class TestActivePromptSchema:
    def test_parse_valido(self) -> None:
        """ActivePrompt aceita payload válido completo."""
        payload = _make_prompt_payload(temperature=0.0, max_tokens=32, top_p=0.9)
        prompt = ActivePrompt.model_validate(payload)
        assert prompt.key == "pre_attendance_classify"
        assert prompt.version == 1

    def test_extra_forbid_rejeita_campos_extras(self) -> None:
        """extra='forbid' — campos desconhecidos levantam ValidationError."""
        payload = _make_prompt_payload()
        payload["campo_desconhecido"] = "valor inesperado"

        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            ActivePrompt.model_validate(payload)

    def test_campos_nullable_aceitos(self) -> None:
        """temperature, max_tokens, top_p e model_recommended aceitam null."""
        payload = _make_prompt_payload(
            model_recommended=None,
            temperature=None,
            max_tokens=None,
            top_p=None,
        )
        prompt = ActivePrompt.model_validate(payload)
        assert prompt.model_recommended is None
        assert prompt.temperature is None
        assert prompt.max_tokens is None
        assert prompt.top_p is None
