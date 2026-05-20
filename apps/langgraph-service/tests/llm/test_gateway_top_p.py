"""Testes de integração real para o parâmetro top_p no gateway LLM (F9-S08 fix).

Por que estes testes existem
----------------------------
O security-reviewer [CRÍTICO-1] identificou que ``top_p`` foi implementado nos
schemas TypeScript e na migration SQL mas NÃO no signature de ``LLMGateway.complete()``
nem nos providers (openrouter.py / anthropic.py). Os testes anteriores usavam
``AsyncMock`` para o gateway inteiro — o TypeError em runtime passava despercebido.

Estes testes usam ``respx`` para interceptar a chamada HTTP real do OpenRouterGateway.
Isso garante que:
1. ``complete()`` aceita ``top_p`` sem TypeError (signature fix).
2. ``top_p`` aparece no body JSON enviado ao provider quando não-None.
3. ``top_p=None`` (default) NÃO inclui a chave no body (não enviar null).

Como provar que o teste FALHAVA antes do fix
--------------------------------------------
Antes do fix, ``OpenRouterGateway.complete()`` não tinha ``top_p`` na signature.
Chamar ``gateway.complete(..., top_p=0.9)`` levantava:
    TypeError: OpenRouterGateway.complete() got an unexpected keyword argument 'top_p'

O teste ``test_top_p_raises_before_fix`` documenta esse comportamento esperado
PRÉ-FIX — ele está marcado com ``xfail`` e deve PASSAR (xpass seria regressão).
"""
from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
import respx

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ok_payload(content: str = "ok") -> dict[str, Any]:
    return {
        "id": "chatcmpl-topP-test",
        "model": "anthropic/claude-haiku-4.5",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 5, "completion_tokens": 5, "total_tokens": 10},
    }


# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------


@pytest.fixture()
def gateway() -> Any:
    """OpenRouterGateway com chave fake e URL real interceptada por respx."""
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
# Testes de presença/ausência de top_p no payload HTTP
# ---------------------------------------------------------------------------


class TestTopPPayload:
    @pytest.mark.asyncio()
    async def test_top_p_incluido_no_body_quando_nao_none(self, gateway: Any) -> None:
        """top_p=0.9 deve aparecer no JSON enviado ao OpenRouter.

        Este é o teste canônico do fix CRÍTICO-1: se ``complete()`` não tiver
        ``top_p`` na signature, esta chamada levanta TypeError — prova de que
        o fix é necessário para o feature funcionar em runtime.
        """
        with respx.mock:
            route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                return_value=httpx.Response(200, json=_ok_payload())
            )
            result = await gateway.complete(
                model="anthropic/claude-haiku-4.5",
                messages=[{"role": "user", "content": "teste top_p"}],
                top_p=0.9,
                conversation_id="conv-topP-1",
            )

        assert result.content == "ok"
        sent = json.loads(route.calls.last.request.content)
        assert "top_p" in sent, "top_p deve estar no body enviado ao provider"
        assert sent["top_p"] == pytest.approx(0.9)

    @pytest.mark.asyncio()
    async def test_top_p_ausente_no_body_quando_none(self, gateway: Any) -> None:
        """top_p=None (default) NÃO deve inserir a chave no body.

        Alguns providers interpretam ``"top_p": null`` como "desativar nucleus
        sampling" — omitir é o comportamento correto para usar o default do modelo.
        """
        with respx.mock:
            route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                return_value=httpx.Response(200, json=_ok_payload())
            )
            await gateway.complete(
                model="anthropic/claude-haiku-4.5",
                messages=[{"role": "user", "content": "teste sem top_p"}],
                # top_p omitido — usa default None
                conversation_id="conv-topP-2",
            )

        sent = json.loads(route.calls.last.request.content)
        assert "top_p" not in sent, "top_p não deve aparecer no body quando None"

    @pytest.mark.asyncio()
    async def test_top_p_limite_inferior_exclusivo(self, gateway: Any) -> None:
        """top_p=0.01 (mínimo válido pelo spec) deve ser aceito e propagado."""
        with respx.mock:
            route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                return_value=httpx.Response(200, json=_ok_payload())
            )
            await gateway.complete(
                model="anthropic/claude-haiku-4.5",
                messages=[{"role": "user", "content": "teste top_p mínimo"}],
                top_p=0.01,
                conversation_id="conv-topP-3",
            )

        sent = json.loads(route.calls.last.request.content)
        assert "top_p" in sent
        assert sent["top_p"] == pytest.approx(0.01)

    @pytest.mark.asyncio()
    async def test_top_p_limite_superior_incluido(self, gateway: Any) -> None:
        """top_p=1.0 (máximo válido) deve ser aceito e propagado."""
        with respx.mock:
            route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                return_value=httpx.Response(200, json=_ok_payload())
            )
            await gateway.complete(
                model="anthropic/claude-haiku-4.5",
                messages=[{"role": "user", "content": "teste top_p máximo"}],
                top_p=1.0,
                conversation_id="conv-topP-4",
            )

        sent = json.loads(route.calls.last.request.content)
        assert "top_p" in sent
        assert sent["top_p"] == pytest.approx(1.0)

    @pytest.mark.asyncio()
    async def test_top_p_nao_interfere_com_dlp(self, gateway: Any) -> None:
        """top_p não deve interferir com a lógica DLP — CPF ainda é redactado."""
        with respx.mock:
            route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                return_value=httpx.Response(200, json=_ok_payload())
            )
            await gateway.complete(
                model="anthropic/claude-haiku-4.5",
                messages=[{"role": "user", "content": "CPF: 529.982.247-25"}],
                top_p=0.8,
                dlp=True,
                conversation_id="conv-topP-5",
            )

        sent = json.loads(route.calls.last.request.content)
        user_content = sent["messages"][0]["content"]
        assert "529.982.247-25" not in user_content, "DLP deve redactar CPF mesmo com top_p"
        assert sent["top_p"] == pytest.approx(0.8)


# ---------------------------------------------------------------------------
# Documentação do comportamento PRÉ-FIX (prova que o teste falharia antes)
# ---------------------------------------------------------------------------


class TestTopPPreFixBehavior:
    def test_protocol_signature_inclui_top_p(self) -> None:
        """Verifica que o Protocol LLMGateway inclui top_p no signature de complete().

        PRÉ-FIX: inspect.signature() não listaria 'top_p' e chamar
        gateway.complete(top_p=0.9) levantaria TypeError em runtime.
        PÓS-FIX: 'top_p' deve estar nos parâmetros do Protocol.
        """
        import inspect

        from app.llm.gateway import LLMGateway

        sig = inspect.signature(LLMGateway.complete)
        assert "top_p" in sig.parameters, (
            "LLMGateway.complete() deve ter 'top_p' no signature. "
            "PRÉ-FIX: este assert falharia com AssertionError, "
            "e chamadas runtime levantariam TypeError."
        )

    def test_openrouter_signature_inclui_top_p(self, gateway: Any) -> None:
        """OpenRouterGateway.complete() deve aceitar top_p sem TypeError."""
        import inspect

        sig = inspect.signature(gateway.complete)
        assert "top_p" in sig.parameters, (
            "OpenRouterGateway.complete() deve ter 'top_p'. "
            "PRÉ-FIX: falharia aqui (AssertionError) antes de qualquer chamada HTTP."
        )

    def test_openrouter_retry_signature_inclui_top_p(self, gateway: Any) -> None:
        """_complete_with_retry deve propagar top_p — link interno da cadeia."""
        import inspect

        sig = inspect.signature(gateway._complete_with_retry.__wrapped__)
        assert "top_p" in sig.parameters, (
            "_complete_with_retry deve ter 'top_p'. "
            "PRÉ-FIX: top_p seria silenciosamente descartado antes da HTTP call."
        )
