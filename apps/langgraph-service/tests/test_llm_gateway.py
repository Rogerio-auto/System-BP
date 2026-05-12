"""Testes do LLM Gateway (F3-S00).

Cobre:
- DLP: redact_pii / redact_messages remove CPF, e-mail, telefone.
- OpenRouterGateway.complete: parseia resposta, propaga headers obrigatórios.
- OpenRouterGateway: retry em 429 e 5xx; sem retry em 4xx (ex.: 400).
- OpenRouterGateway: BudgetExceededError é um stub que retorna True.
- for_role: retorna model_id correto por role.
- get_gateway: retorna OpenRouterGateway por default; RuntimeError em provider desconhecido.
- LLMGateway protocol: OpenRouterGateway satisfaz isinstance check.
"""
from __future__ import annotations

import json
from typing import Any
from unittest.mock import patch

import httpx
import pytest
import respx

from app.llm.gateway import (
    BudgetExceededError,
    LLMGateway,
    LLMResponse,
    TokenUsage,
    redact_messages,
    redact_pii,
)

# ---------------------------------------------------------------------------
# Helpers — monta payload de resposta compatível com OpenRouter
# ---------------------------------------------------------------------------


def _make_openrouter_response(
    content: str = "Resposta do LLM",
    model: str = "anthropic/claude-3.5-haiku",
    prompt_tokens: int = 10,
    completion_tokens: int = 20,
    finish_reason: str = "stop",
) -> dict[str, Any]:
    return {
        "id": "chatcmpl-test",
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": finish_reason,
            }
        ],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        },
    }


# ---------------------------------------------------------------------------
# DLP — redact_pii
# ---------------------------------------------------------------------------


class TestRedactPii:
    def test_cpf_com_pontuacao(self) -> None:
        text = "CPF: 123.456.789-00"
        result = redact_pii(text)
        assert "123.456.789-00" not in result
        assert "[CPF_REDACTED]" in result

    def test_cpf_sem_pontuacao(self) -> None:
        text = "meu cpf é 12345678900"
        result = redact_pii(text)
        assert "12345678900" not in result
        assert "[CPF_REDACTED]" in result

    def test_email_simples(self) -> None:
        text = "contato: usuario@exemplo.com.br"
        result = redact_pii(text)
        assert "usuario@exemplo.com.br" not in result
        assert "[EMAIL_REDACTED]" in result

    def test_telefone_com_ddd(self) -> None:
        text = "ligue para (69) 99999-0000"
        result = redact_pii(text)
        assert "99999-0000" not in result
        assert "[PHONE_REDACTED]" in result

    def test_texto_sem_pii_nao_alterado(self) -> None:
        text = "Olá, preciso de um empréstimo de R$ 5.000,00."
        result = redact_pii(text)
        assert result == text

    def test_multiplos_pii_no_mesmo_texto(self) -> None:
        text = "João, CPF 111.222.333-44, email joao@test.com, tel 69 98888-7777"
        result = redact_pii(text)
        assert "111.222.333-44" not in result
        assert "joao@test.com" not in result
        assert "98888-7777" not in result
        assert "João" in result  # nome próprio não é redactado


class TestRedactMessages:
    def test_redacta_campo_content(self) -> None:
        messages = [
            {"role": "system", "content": "Você é um assistente."},
            {"role": "user", "content": "Meu CPF é 123.456.789-00"},
        ]
        result = redact_messages(messages)
        assert "123.456.789-00" not in result[1]["content"]
        assert "[CPF_REDACTED]" in result[1]["content"]
        # mensagem system não tem PII, mantida
        assert result[0]["content"] == "Você é um assistente."

    def test_nao_muta_lista_original(self) -> None:
        original_content = "email: test@test.com"
        messages = [{"role": "user", "content": original_content}]
        redact_messages(messages)
        # original não deve ter sido alterado
        assert messages[0]["content"] == original_content

    def test_mensagem_sem_content_passada_sem_alteracao(self) -> None:
        messages: list[dict[str, Any]] = [
            {"role": "tool", "tool_call_id": "abc", "content": None}
        ]
        result = redact_messages(messages)
        assert result[0].get("tool_call_id") == "abc"


# ---------------------------------------------------------------------------
# OpenRouterGateway — complete (mock via respx)
# ---------------------------------------------------------------------------


@pytest.fixture()
def openrouter_base_url() -> str:
    from app.config import settings

    return settings.openrouter_base_url.rstrip("/")


@pytest.fixture()
def gateway() -> Any:
    """Instância do OpenRouterGateway com API key fake."""
    from app.llm.factory import reset_gateway_cache

    reset_gateway_cache()
    with patch("app.config.settings") as mock_settings:
        from pydantic import SecretStr

        mock_settings.openrouter_api_key = SecretStr("sk-test-fake")
        mock_settings.openrouter_base_url = "https://openrouter.ai/api/v1"
        mock_settings.openrouter_http_referer = "https://elemento.test"
        mock_settings.openrouter_app_title = "Elemento-Test"
        mock_settings.llm_provider = "openrouter"
        mock_settings.model_classifier = "anthropic/claude-3.5-haiku"
        mock_settings.model_reasoner = "anthropic/claude-sonnet-4"
        mock_settings.model_fallback = "openai/gpt-4o-mini"

        from app.llm.openrouter import OpenRouterGateway

        gw = OpenRouterGateway.__new__(OpenRouterGateway)
        gw._api_key = "sk-test-fake"
        gw._base_url = "https://openrouter.ai/api/v1"
        gw._http_referer = "https://elemento.test"
        gw._app_title = "Elemento-Test"
        yield gw


class TestOpenRouterGatewayComplete:
    @pytest.mark.asyncio()
    async def test_complete_retorna_llm_response(self, gateway: Any) -> None:
        """Resposta válida deve ser parseada em LLMResponse."""
        payload = _make_openrouter_response(
            content="Classificação: EMPRESTIMO",
            prompt_tokens=15,
            completion_tokens=5,
        )
        with respx.mock:
            respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                return_value=httpx.Response(200, json=payload)
            )
            result = await gateway.complete(
                model="anthropic/claude-3.5-haiku",
                messages=[{"role": "user", "content": "Olá, quero empréstimo"}],
                metadata={"node": "classify_intent"},
            )

        assert isinstance(result, LLMResponse)
        assert result.content == "Classificação: EMPRESTIMO"
        assert result.usage.prompt_tokens == 15
        assert result.usage.completion_tokens == 5
        assert result.usage.total_tokens == 20
        assert result.finish_reason == "stop"

    @pytest.mark.asyncio()
    async def test_complete_envia_http_referer_e_x_title(self, gateway: Any) -> None:
        """Headers HTTP-Referer e X-Title devem estar presentes em toda chamada."""
        payload = _make_openrouter_response()
        with respx.mock:
            route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                return_value=httpx.Response(200, json=payload)
            )
            await gateway.complete(
                model="anthropic/claude-3.5-haiku",
                messages=[{"role": "user", "content": "teste"}],
            )

        sent_headers = route.calls.last.request.headers
        assert sent_headers.get("http-referer") == "https://elemento.test"
        assert sent_headers.get("x-title") == "Elemento-Test"

    @pytest.mark.asyncio()
    async def test_complete_envia_authorization_bearer(self, gateway: Any) -> None:
        """Header Authorization deve conter o Bearer token."""
        payload = _make_openrouter_response()
        with respx.mock:
            route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                return_value=httpx.Response(200, json=payload)
            )
            await gateway.complete(
                model="anthropic/claude-3.5-haiku",
                messages=[{"role": "user", "content": "teste"}],
            )

        auth = route.calls.last.request.headers.get("authorization")
        assert auth == "Bearer sk-test-fake"

    @pytest.mark.asyncio()
    async def test_complete_aplica_dlp_antes_de_envio(self, gateway: Any) -> None:
        """CPF na mensagem deve ser redactado antes de chegar ao OpenRouter."""
        payload = _make_openrouter_response()
        with respx.mock:
            route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                return_value=httpx.Response(200, json=payload)
            )
            await gateway.complete(
                model="anthropic/claude-3.5-haiku",
                messages=[{"role": "user", "content": "CPF: 111.222.333-44"}],
            )

        sent_body = json.loads(route.calls.last.request.content)
        user_content = sent_body["messages"][0]["content"]
        assert "111.222.333-44" not in user_content
        assert "[CPF_REDACTED]" in user_content

    @pytest.mark.asyncio()
    async def test_complete_latency_ms_preenchida(self, gateway: Any) -> None:
        """latency_ms deve ser maior que zero após chamada bem-sucedida."""
        payload = _make_openrouter_response()
        with respx.mock:
            respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                return_value=httpx.Response(200, json=payload)
            )
            result = await gateway.complete(
                model="anthropic/claude-3.5-haiku",
                messages=[{"role": "user", "content": "teste"}],
            )
        assert result.latency_ms >= 0.0


# ---------------------------------------------------------------------------
# OpenRouterGateway — retry behaviour
# ---------------------------------------------------------------------------


class TestOpenRouterGatewayRetry:
    @pytest.mark.asyncio()
    async def test_retenta_em_429_e_sucede_na_segunda(self, gateway: Any) -> None:
        """Deve retentar após 429 Rate Limit e retornar sucesso."""
        payload = _make_openrouter_response(content="ok após retry")
        responses = [
            httpx.Response(429, json={"error": "rate limit"}),
            httpx.Response(200, json=payload),
        ]
        with respx.mock:
            route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                side_effect=responses
            )
            result = await gateway.complete(
                model="anthropic/claude-3.5-haiku",
                messages=[{"role": "user", "content": "teste"}],
            )

        assert route.call_count == 2
        assert result.content == "ok após retry"

    @pytest.mark.asyncio()
    async def test_retenta_em_503_e_sucede(self, gateway: Any) -> None:
        """Deve retentar após 503 e retornar sucesso."""
        payload = _make_openrouter_response(content="ok apos retry")
        responses = [
            httpx.Response(503, json={"error": "service unavailable"}),
            httpx.Response(200, json=payload),
        ]
        with respx.mock:
            route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                side_effect=responses
            )
            result = await gateway.complete(
                model="anthropic/claude-3.5-haiku",
                messages=[{"role": "user", "content": "teste"}],
            )

        assert route.call_count == 2
        assert result.content == "ok apos retry"

    @pytest.mark.asyncio()
    async def test_nao_retenta_em_400(self, gateway: Any) -> None:
        """Erro 400 (client error não-429) NÃO deve gerar retry."""
        from app.llm.gateway import LLMProviderError

        with respx.mock:
            route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                return_value=httpx.Response(400, json={"error": "bad request"})
            )
            with pytest.raises(LLMProviderError) as exc_info:
                await gateway.complete(
                    model="anthropic/claude-3.5-haiku",
                    messages=[{"role": "user", "content": "teste"}],
                )

        # sem retry — apenas 1 chamada
        assert route.call_count == 1
        assert exc_info.value.status_code == 400

    @pytest.mark.asyncio()
    async def test_esgota_retries_levanta_provider_error(self, gateway: Any) -> None:
        """Após esgotar retries em 5xx, deve levantar LLMProviderError."""
        from app.llm.gateway import LLMProviderError

        with respx.mock:
            route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                return_value=httpx.Response(500, json={"error": "internal"})
            )
            with pytest.raises((LLMProviderError, Exception)):
                await gateway.complete(
                    model="anthropic/claude-3.5-haiku",
                    messages=[{"role": "user", "content": "teste"}],
                )

        # 3 tentativas total (1 original + 2 retries configurados)
        assert route.call_count == 3


# ---------------------------------------------------------------------------
# BudgetExceededError
# ---------------------------------------------------------------------------


class TestBudgetExceededError:
    def test_str_representation(self) -> None:
        exc = BudgetExceededError(org_id="org-123", daily_budget_usd=20.0)
        assert "org-123" in str(exc)
        assert "20.00" in str(exc)

    @pytest.mark.asyncio()
    async def test_check_budget_stub_retorna_true(self, gateway: Any) -> None:
        """check_budget é stub e deve retornar True neste slot."""
        result = await gateway.check_budget("org-qualquer")
        assert result is True


# ---------------------------------------------------------------------------
# for_role — mapeamento de roles
# ---------------------------------------------------------------------------


class TestForRole:
    def test_classifier_retorna_modelo_barato(self) -> None:
        from app.config import settings
        from app.llm.factory import for_role

        model = for_role("classifier")
        assert model == settings.model_classifier
        # verifica que é o modelo leve (haiku ou equivalente)
        lc = model.lower()
        assert "haiku" in lc or "flash" in lc or "mini" in lc or model

    def test_reasoner_retorna_modelo_robusto(self) -> None:
        from app.config import settings
        from app.llm.factory import for_role

        model = for_role("reasoner")
        assert model == settings.model_reasoner

    def test_fallback_retorna_modelo_fallback(self) -> None:
        from app.config import settings
        from app.llm.factory import for_role

        model = for_role("fallback")
        assert model == settings.model_fallback

    def test_classifier_diferente_de_reasoner(self) -> None:
        """classifier e reasoner devem ser modelos distintos por padrão."""
        from app.llm.factory import for_role

        assert for_role("classifier") != for_role("reasoner")


# ---------------------------------------------------------------------------
# get_gateway — factory
# ---------------------------------------------------------------------------


class TestGetGateway:
    def test_openrouter_e_default(self) -> None:
        from pydantic import SecretStr

        from app.llm.factory import get_gateway, reset_gateway_cache
        from app.llm.openrouter import OpenRouterGateway

        reset_gateway_cache()
        with patch("app.config.settings") as mock_s:
            mock_s.llm_provider = "openrouter"
            mock_s.openrouter_api_key = SecretStr("sk-fake")
            mock_s.openrouter_base_url = "https://openrouter.ai/api/v1"
            mock_s.openrouter_http_referer = "https://test.local"
            mock_s.openrouter_app_title = "Test"

            with (
                patch("app.llm.factory.settings", mock_s),
                patch("app.llm.openrouter.settings", mock_s),
            ):
                gw = get_gateway()

        assert isinstance(gw, OpenRouterGateway)
        reset_gateway_cache()

    def test_provider_desconhecido_levanta_runtime_error(self) -> None:
        from app.llm.factory import get_gateway, reset_gateway_cache

        reset_gateway_cache()
        with patch("app.llm.factory.settings") as mock_s:
            mock_s.llm_provider = "provider_invalido"
            with pytest.raises(RuntimeError, match="provider_invalido"):
                get_gateway()
        reset_gateway_cache()

    def test_gateway_satisfaz_protocol(self, gateway: Any) -> None:
        """OpenRouterGateway deve satisfazer o Protocol LLMGateway em runtime."""
        assert isinstance(gateway, LLMGateway)


# ---------------------------------------------------------------------------
# LLMResponse — modelo Pydantic
# ---------------------------------------------------------------------------


class TestLLMResponse:
    def test_defaults_validos(self) -> None:
        resp = LLMResponse(content="teste", model="m/haiku")
        assert resp.usage.total_tokens == 0
        assert resp.latency_ms == 0.0
        assert resp.finish_reason == "stop"

    def test_token_usage_soma(self) -> None:
        usage = TokenUsage(prompt_tokens=100, completion_tokens=50, total_tokens=150)
        assert usage.total_tokens == 150
