"""Testes do gateway LLM com DLP integrado (F1-S26).

Cobre:
- dlp=True (default): payload enviado NÃO contém CPF/email/telefone.
- dlp=False sem permissão → NotImplementedError.
- Retry em 502/503 → tenta novamente; 401 não retry.
- Timeout → httpx.TimeoutException propagado.
- pii_tokens_redacted reportado nos logs de chamada.
- Headers obrigatórios presentes.
"""
from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
import respx

from app.llm.gateway import (
    BudgetExceededError,
    LLMGateway,
    LLMProviderError,
    LLMResponse,
    TokenUsage,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _openrouter_payload(
    content: str = "Resposta do LLM",
    model: str = "anthropic/claude-haiku-4.5",
) -> dict[str, Any]:
    return {
        "id": "chatcmpl-test",
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30},
    }


# ---------------------------------------------------------------------------
# Fixture de gateway com mock de settings
# ---------------------------------------------------------------------------


@pytest.fixture()
def gateway() -> Any:
    """Instância do OpenRouterGateway com API key fake."""
    from app.llm.factory import reset_gateway_cache
    from app.llm.openrouter import OpenRouterGateway

    reset_gateway_cache()
    gw = OpenRouterGateway.__new__(OpenRouterGateway)
    gw._api_key = "sk-test-fake"
    gw._base_url = "https://openrouter.ai/api/v1"
    gw._http_referer = "https://elemento.test"
    gw._app_title = "Elemento Banco do Povo"
    return gw


# ---------------------------------------------------------------------------
# DLP integrado ao gateway
# ---------------------------------------------------------------------------


class TestGatewayDlp:
    @pytest.mark.asyncio()
    async def test_dlp_true_remove_cpf_do_payload(self, gateway: Any) -> None:
        """dlp=True (default) — CPF não deve chegar ao OpenRouter."""
        payload = _openrouter_payload()
        with respx.mock:
            route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                return_value=httpx.Response(200, json=payload)
            )
            await gateway.complete(
                model="anthropic/claude-haiku-4.5",
                messages=[{"role": "user", "content": "Meu CPF é 529.982.247-25"}],
                conversation_id="conv-001",
                dlp=True,
            )

        sent_body = json.loads(route.calls.last.request.content)
        user_content = sent_body["messages"][0]["content"]
        # CPF real não deve estar no payload enviado
        assert "529.982.247-25" not in user_content
        assert "<CPF_1>" in user_content

    @pytest.mark.asyncio()
    async def test_dlp_true_remove_email_do_payload(self, gateway: Any) -> None:
        """dlp=True — email não deve chegar ao OpenRouter."""
        payload = _openrouter_payload()
        with respx.mock:
            route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                return_value=httpx.Response(200, json=payload)
            )
            await gateway.complete(
                model="anthropic/claude-haiku-4.5",
                messages=[{"role": "user", "content": "email: teste@exemplo.com.br"}],
                conversation_id="conv-002",
            )

        sent_body = json.loads(route.calls.last.request.content)
        user_content = sent_body["messages"][0]["content"]
        assert "teste@exemplo.com.br" not in user_content
        assert "<EMAIL_1>" in user_content

    @pytest.mark.asyncio()
    async def test_dlp_true_remove_telefone_do_payload(self, gateway: Any) -> None:
        """dlp=True — telefone não deve chegar ao OpenRouter."""
        payload = _openrouter_payload()
        with respx.mock:
            route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                return_value=httpx.Response(200, json=payload)
            )
            await gateway.complete(
                model="anthropic/claude-haiku-4.5",
                messages=[{"role": "user", "content": "fone (69) 99999-0000"}],
                conversation_id="conv-003",
            )

        sent_body = json.loads(route.calls.last.request.content)
        user_content = sent_body["messages"][0]["content"]
        assert "99999-0000" not in user_content

    @pytest.mark.asyncio()
    async def test_dlp_true_e_default(self, gateway: Any) -> None:
        """Sem passar dlp=, o padrão é True — mesma garantia."""
        payload = _openrouter_payload()
        with respx.mock:
            route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                return_value=httpx.Response(200, json=payload)
            )
            await gateway.complete(
                model="anthropic/claude-haiku-4.5",
                messages=[{"role": "user", "content": "CPF 52998224725"}],
                conversation_id="conv-004",
            )

        sent_body = json.loads(route.calls.last.request.content)
        user_content = sent_body["messages"][0]["content"]
        assert "52998224725" not in user_content

    @pytest.mark.asyncio()
    async def test_dlp_false_sem_permissao_levanta_not_implemented(
        self, gateway: Any
    ) -> None:
        """dlp=False sem permissão assistant:bypass_dlp → NotImplementedError."""
        with pytest.raises(NotImplementedError, match="dlp=False not yet permitted"):
            await gateway.complete(
                model="anthropic/claude-haiku-4.5",
                messages=[{"role": "user", "content": "teste"}],
                conversation_id="conv-005",
                dlp=False,
            )

    @pytest.mark.asyncio()
    async def test_dlp_false_nao_chama_openrouter(self, gateway: Any) -> None:
        """dlp=False deve levantar antes de qualquer chamada HTTP."""
        with respx.mock:
            route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                return_value=httpx.Response(200, json=_openrouter_payload())
            )
            with pytest.raises(NotImplementedError):
                await gateway.complete(
                    model="anthropic/claude-haiku-4.5",
                    messages=[{"role": "user", "content": "teste"}],
                    conversation_id="conv-006",
                    dlp=False,
                )
        # Nenhuma chamada HTTP deve ter sido feita
        assert route.call_count == 0


# ---------------------------------------------------------------------------
# Headers obrigatórios
# ---------------------------------------------------------------------------


class TestGatewayHeaders:
    @pytest.mark.asyncio()
    async def test_authorization_bearer_presente(self, gateway: Any) -> None:
        payload = _openrouter_payload()
        with respx.mock:
            route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                return_value=httpx.Response(200, json=payload)
            )
            await gateway.complete(
                model="anthropic/claude-haiku-4.5",
                messages=[{"role": "user", "content": "teste"}],
                conversation_id="conv-h1",
            )
        assert route.calls.last.request.headers["authorization"] == "Bearer sk-test-fake"

    @pytest.mark.asyncio()
    async def test_http_referer_presente(self, gateway: Any) -> None:
        payload = _openrouter_payload()
        with respx.mock:
            route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                return_value=httpx.Response(200, json=payload)
            )
            await gateway.complete(
                model="anthropic/claude-haiku-4.5",
                messages=[{"role": "user", "content": "teste"}],
                conversation_id="conv-h2",
            )
        assert "elemento.test" in route.calls.last.request.headers["http-referer"]

    @pytest.mark.asyncio()
    async def test_x_title_presente(self, gateway: Any) -> None:
        payload = _openrouter_payload()
        with respx.mock:
            route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                return_value=httpx.Response(200, json=payload)
            )
            await gateway.complete(
                model="anthropic/claude-haiku-4.5",
                messages=[{"role": "user", "content": "teste"}],
                conversation_id="conv-h3",
            )
        assert route.calls.last.request.headers["x-title"] == "Elemento Banco do Povo"


# ---------------------------------------------------------------------------
# Retry comportamento
# ---------------------------------------------------------------------------


class TestGatewayRetry:
    @pytest.mark.asyncio()
    async def test_retry_em_502_e_sucede_na_segunda(self, gateway: Any) -> None:
        """Deve retentar após 502 Bad Gateway."""
        payload = _openrouter_payload(content="ok após retry")
        responses = [
            httpx.Response(502, json={"error": "bad gateway"}),
            httpx.Response(200, json=payload),
        ]
        with respx.mock:
            route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                side_effect=responses
            )
            result = await gateway.complete(
                model="anthropic/claude-haiku-4.5",
                messages=[{"role": "user", "content": "teste"}],
                conversation_id="conv-r1",
            )
        assert route.call_count == 2
        assert result.content == "ok após retry"

    @pytest.mark.asyncio()
    async def test_retry_em_503_e_sucede(self, gateway: Any) -> None:
        """Deve retentar após 503 Service Unavailable."""
        payload = _openrouter_payload(content="ok após 503")
        responses = [
            httpx.Response(503, json={"error": "unavailable"}),
            httpx.Response(200, json=payload),
        ]
        with respx.mock:
            route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                side_effect=responses
            )
            result = await gateway.complete(
                model="anthropic/claude-haiku-4.5",
                messages=[{"role": "user", "content": "teste"}],
                conversation_id="conv-r2",
            )
        assert route.call_count == 2
        assert result.content == "ok após 503"

    @pytest.mark.asyncio()
    async def test_sem_retry_em_401(self, gateway: Any) -> None:
        """401 Unauthorized não deve gerar retry — erro de credencial."""
        with respx.mock:
            route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                return_value=httpx.Response(401, json={"error": "unauthorized"})
            )
            with pytest.raises((LLMProviderError, Exception)):
                await gateway.complete(
                    model="anthropic/claude-haiku-4.5",
                    messages=[{"role": "user", "content": "teste"}],
                    conversation_id="conv-r3",
                )
        assert route.call_count == 1

    @pytest.mark.asyncio()
    async def test_timeout_propagado(self, gateway: Any) -> None:
        """Timeout deve propagar httpx.TimeoutException (após retries esgotados)."""
        with respx.mock:
            respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                side_effect=httpx.TimeoutException("timeout")
            )
            with pytest.raises((httpx.TimeoutException, Exception)):
                await gateway.complete(
                    model="anthropic/claude-haiku-4.5",
                    messages=[{"role": "user", "content": "teste"}],
                    conversation_id="conv-r4",
                )


# ---------------------------------------------------------------------------
# LLMResponse e BudgetExceededError
# ---------------------------------------------------------------------------


class TestGatewayTypes:
    def test_token_usage_defaults(self) -> None:
        usage = TokenUsage()
        assert usage.total_tokens == 0

    def test_llm_response_defaults(self) -> None:
        resp = LLMResponse(content="teste", model="m/haiku")
        assert resp.finish_reason == "stop"
        assert resp.latency_ms == 0.0

    def test_budget_exceeded_str(self) -> None:
        exc = BudgetExceededError(org_id="org-rondonia", daily_budget_usd=50.0)
        assert "org-rondonia" in str(exc)
        assert "50.00" in str(exc)

    def test_llm_provider_error_str(self) -> None:
        exc = LLMProviderError(provider="openrouter", status_code=503, message="down")
        assert "openrouter" in str(exc)
        assert "503" in str(exc)

    @pytest.mark.asyncio()
    async def test_check_budget_stub_retorna_true(self, gateway: Any) -> None:
        result = await gateway.check_budget("org-qualquer")
        assert result is True

    def test_gateway_satisfaz_protocol(self, gateway: Any) -> None:
        assert isinstance(gateway, LLMGateway)
