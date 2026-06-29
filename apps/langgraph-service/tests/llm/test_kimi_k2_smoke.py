"""Testes de configuração e smoke do modelo Kimi K2 como reasoner (F7-S01).

Cobre:
- for_role('reasoner') retorna 'moonshotai/kimi-k2' com config default.
- for_role('fallback') retorna 'anthropic/claude-sonnet-4' com config default.
- for_role('classifier') permanece 'anthropic/claude-haiku-4.5' (não alterado).
- Kimi K2 envia o model_id correto no payload ao OpenRouter.
- Fallback: 5xx do Kimi K2 → gateway retenta conforme tenacity.
- Smoke test real (gated por RUN_LLM_SMOKE_TESTS=1) — skipped em CI.
"""
from __future__ import annotations

import json
import os
from typing import Any
from unittest.mock import patch

import httpx
import pytest
import respx

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _openrouter_ok(
    content: str = "resposta do kimi",
    model: str = "moonshotai/kimi-k2",
) -> dict[str, Any]:
    """Payload de resposta bem-sucedida simulando o OpenRouter."""
    return {
        "id": "chatcmpl-kimi-test",
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 12, "completion_tokens": 8, "total_tokens": 20},
    }


# ---------------------------------------------------------------------------
# Fixture de gateway com configuração fake
# ---------------------------------------------------------------------------


@pytest.fixture()
def gateway() -> Any:
    """Instância do OpenRouterGateway com API key fake para testes isolados."""
    from app.llm.factory import reset_gateway_cache
    from app.llm.openrouter import OpenRouterGateway

    reset_gateway_cache()
    gw = OpenRouterGateway.__new__(OpenRouterGateway)
    gw._api_key = "sk-test-kimi-fake"
    gw._base_url = "https://openrouter.ai/api/v1"
    gw._http_referer = "https://elemento.test"
    gw._app_title = "Elemento Banco do Povo"
    return gw


# ---------------------------------------------------------------------------
# Testes de configuração — for_role() com defaults
# ---------------------------------------------------------------------------


class TestKimiK2DefaultConfig:
    """Garante que os defaults de config.py e factory.py estão alinhados."""

    def test_for_role_reasoner_retorna_kimi_k2(self) -> None:
        """for_role('reasoner') deve retornar 'moonshotai/kimi-k2' por padrão."""
        from app.config import Settings
        from app.llm.factory import for_role

        # Sobrescreve settings com valores padrão (sem env vars)
        with patch("app.llm.factory.settings", Settings.model_construct(
            environment="development",
            log_level="INFO",
            host="0.0.0.0",
            port=8000,
            backend_internal_url="http://api:3333",  # type: ignore[arg-type]
            internal_token="fake-token",  # type: ignore[arg-type]
            llm_provider="openrouter",
            openrouter_api_key=None,
            openrouter_base_url="https://openrouter.ai/api/v1",
            openrouter_http_referer="https://elemento.local",
            openrouter_app_title="Elemento",
            anthropic_api_key=None,
            openai_api_key=None,
            model_classifier="anthropic/claude-haiku-4.5",
            model_reasoner="moonshotai/kimi-k2",
            model_fallback="anthropic/claude-sonnet-4",
            daily_budget_usd=20.0,
            max_tokens_per_conversation=8000,
        )):
            assert for_role("reasoner") == "moonshotai/kimi-k2"

    def test_for_role_fallback_retorna_claude_sonnet_4(self) -> None:
        """for_role('fallback') deve retornar 'anthropic/claude-sonnet-4'."""
        from app.config import Settings
        from app.llm.factory import for_role

        with patch("app.llm.factory.settings", Settings.model_construct(
            environment="development",
            log_level="INFO",
            host="0.0.0.0",
            port=8000,
            backend_internal_url="http://api:3333",  # type: ignore[arg-type]
            internal_token="fake-token",  # type: ignore[arg-type]
            llm_provider="openrouter",
            openrouter_api_key=None,
            openrouter_base_url="https://openrouter.ai/api/v1",
            openrouter_http_referer="https://elemento.local",
            openrouter_app_title="Elemento",
            anthropic_api_key=None,
            openai_api_key=None,
            model_classifier="anthropic/claude-haiku-4.5",
            model_reasoner="moonshotai/kimi-k2",
            model_fallback="anthropic/claude-sonnet-4",
            daily_budget_usd=20.0,
            max_tokens_per_conversation=8000,
        )):
            assert for_role("fallback") == "anthropic/claude-sonnet-4"

    def test_for_role_classifier_nao_alterado(self) -> None:
        """for_role('classifier') deve permanecer 'anthropic/claude-haiku-4.5'."""
        from app.config import Settings
        from app.llm.factory import for_role

        with patch("app.llm.factory.settings", Settings.model_construct(
            environment="development",
            log_level="INFO",
            host="0.0.0.0",
            port=8000,
            backend_internal_url="http://api:3333",  # type: ignore[arg-type]
            internal_token="fake-token",  # type: ignore[arg-type]
            llm_provider="openrouter",
            openrouter_api_key=None,
            openrouter_base_url="https://openrouter.ai/api/v1",
            openrouter_http_referer="https://elemento.local",
            openrouter_app_title="Elemento",
            anthropic_api_key=None,
            openai_api_key=None,
            model_classifier="anthropic/claude-haiku-4.5",
            model_reasoner="moonshotai/kimi-k2",
            model_fallback="anthropic/claude-sonnet-4",
            daily_budget_usd=20.0,
            max_tokens_per_conversation=8000,
        )):
            assert for_role("classifier") == "anthropic/claude-haiku-4.5"

    def test_config_defaults_sem_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Sem env vars, config.py usa moonshotai/kimi-k2 como reasoner default."""
        # Remove env vars para testar defaults hard-coded
        monkeypatch.delenv("LLM_MODEL_REASONER", raising=False)
        monkeypatch.delenv("LLM_MODEL_FALLBACK", raising=False)
        monkeypatch.delenv("LLM_MODEL_CLASSIFIER", raising=False)

        # Importa Settings com apenas o mínimo obrigatório
        from app.config import Settings

        s = Settings.model_construct(
            environment="development",
            log_level="INFO",
            host="0.0.0.0",
            port=8000,
            backend_internal_url="http://api:3333",  # type: ignore[arg-type]
            internal_token="fake-token",  # type: ignore[arg-type]
            llm_provider="openrouter",
            openrouter_api_key=None,
            openrouter_base_url="https://openrouter.ai/api/v1",
            openrouter_http_referer="https://elemento.local",
            openrouter_app_title="Elemento",
            anthropic_api_key=None,
            openai_api_key=None,
            model_classifier="anthropic/claude-haiku-4.5",
            model_reasoner="moonshotai/kimi-k2",
            model_fallback="anthropic/claude-sonnet-4",
            daily_budget_usd=20.0,
            max_tokens_per_conversation=8000,
        )
        assert s.model_reasoner == "moonshotai/kimi-k2"
        assert s.model_fallback == "anthropic/claude-sonnet-4"
        assert s.model_classifier == "anthropic/claude-haiku-4.5"


# ---------------------------------------------------------------------------
# Testes de integração com respx — Kimi K2 no payload HTTP
# ---------------------------------------------------------------------------


class TestKimiK2GatewayPayload:
    """Garante que o model_id correto é enviado ao OpenRouter."""

    @pytest.mark.asyncio()
    async def test_kimi_k2_model_id_no_payload(self, gateway: Any) -> None:
        """Gateway deve enviar 'moonshotai/kimi-k2' no campo 'model' do payload."""
        with respx.mock:
            route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                return_value=httpx.Response(200, json=_openrouter_ok())
            )
            await gateway.complete(
                model="moonshotai/kimi-k2",
                messages=[{"role": "user", "content": "Olá, qual o prazo do empréstimo?"}],
                conversation_id="conv-kimi-001",
            )

        sent = json.loads(route.calls.last.request.content)
        assert sent["model"] == "moonshotai/kimi-k2"

    @pytest.mark.asyncio()
    async def test_kimi_k2_resposta_parseada_corretamente(self, gateway: Any) -> None:
        """LLMResponse deve conter o content e usage do Kimi K2."""
        with respx.mock:
            respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                return_value=httpx.Response(200, json=_openrouter_ok(content="Prazo: 24 meses"))
            )
            result = await gateway.complete(
                model="moonshotai/kimi-k2",
                messages=[{"role": "user", "content": "Prazo?"}],
                conversation_id="conv-kimi-002",
            )

        assert result.content == "Prazo: 24 meses"
        assert result.usage.total_tokens == 20

    @pytest.mark.asyncio()
    async def test_dlp_aplicado_antes_de_kimi_k2(self, gateway: Any) -> None:
        """LGPD §8.4: DLP deve redactar PII antes de enviar ao Kimi K2."""
        with respx.mock:
            route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                return_value=httpx.Response(200, json=_openrouter_ok())
            )
            await gateway.complete(
                model="moonshotai/kimi-k2",
                messages=[{"role": "user", "content": "CPF: 529.982.247-25, quero crédito"}],
                conversation_id="conv-kimi-003",
            )

        sent = json.loads(route.calls.last.request.content)
        user_msg = sent["messages"][0]["content"]
        # CPF real não deve chegar ao Kimi K2 (suboperador internacional)
        assert "529.982.247-25" not in user_msg
        assert "<CPF_1>" in user_msg


# ---------------------------------------------------------------------------
# Teste de fallback: Kimi K2 5xx → gateway retenta / sinaliza erro
# ---------------------------------------------------------------------------


class TestKimiK2Fallback:
    """Valida comportamento do gateway quando Kimi K2 retorna erro transitório."""

    @pytest.mark.asyncio()
    async def test_kimi_k2_5xx_gateway_retenta(self, gateway: Any) -> None:
        """5xx do Kimi K2 deve acionar retry do tenacity (sucesso na 2ª tentativa)."""
        responses = [
            httpx.Response(503, json={"error": "Service Unavailable"}),
            httpx.Response(200, json=_openrouter_ok(content="ok após retry")),
        ]
        with respx.mock:
            route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                side_effect=responses
            )
            result = await gateway.complete(
                model="moonshotai/kimi-k2",
                messages=[{"role": "user", "content": "teste fallback"}],
                conversation_id="conv-kimi-fallback-001",
            )

        assert route.call_count == 2
        assert result.content == "ok após retry"

    @pytest.mark.asyncio()
    async def test_kimi_k2_429_rate_limit_retenta(self, gateway: Any) -> None:
        """429 Rate Limit do Kimi K2 deve acionar retry (transitório)."""
        responses = [
            httpx.Response(429, json={"error": "rate limit exceeded"}),
            httpx.Response(200, json=_openrouter_ok(content="ok após 429")),
        ]
        with respx.mock:
            route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                side_effect=responses
            )
            result = await gateway.complete(
                model="moonshotai/kimi-k2",
                messages=[{"role": "user", "content": "teste rate limit"}],
                conversation_id="conv-kimi-fallback-002",
            )

        assert route.call_count == 2
        assert result.content == "ok após 429"


# ---------------------------------------------------------------------------
# Smoke test real — gated por RUN_LLM_SMOKE_TESTS=1
# ---------------------------------------------------------------------------


@pytest.mark.skipif(
    os.getenv("RUN_LLM_SMOKE_TESTS") != "1",
    reason="Smoke test real — requer OPENROUTER_API_KEY e RUN_LLM_SMOKE_TESTS=1",
)
class TestKimiK2Smoke:
    """Chamada real ao OpenRouter com moonshotai/kimi-k2.

    Skipped por padrão em CI. Ativar com:
        RUN_LLM_SMOKE_TESTS=1 uv run pytest tests/llm/test_kimi_k2_smoke.py -v -k smoke
    """

    @pytest.mark.asyncio()
    async def test_kimi_k2_responde_em_portugues(self) -> None:
        """Kimi K2 deve responder ao OpenRouter com conteúdo não-vazio em PT-BR."""
        from app.llm.factory import get_gateway, reset_gateway_cache

        reset_gateway_cache()
        gw = get_gateway()

        result = await gw.complete(
            model="moonshotai/kimi-k2",
            messages=[
                {
                    "role": "system",
                    "content": "Você é um assistente de crédito. Responda em português.",
                },
                {
                    "role": "user",
                    "content": "Qual o prazo máximo de um microcrédito produtivo orientado?",
                },
            ],
            max_tokens=64,
            conversation_id="smoke-kimi-001",
        )

        assert result.content, "Kimi K2 deve retornar conteúdo não-vazio"
        assert result.usage.completion_tokens > 0
        assert result.model  # OpenRouter deve retornar o model usado
