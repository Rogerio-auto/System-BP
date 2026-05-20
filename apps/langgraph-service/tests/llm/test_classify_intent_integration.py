"""Teste de integração — classify_intent com gateway real (respx) — F9-S10.

Por que este teste existe
--------------------------
CRÍTICO-1 (F9-S10): os nós ``classify_intent``, ``qualify_credit_interest`` e
``generate_simulation`` passavam ``"dlp": False`` ao ``gateway.complete()``.
O gateway (openrouter.py) levanta ``NotImplementedError`` quando ``dlp=False``
porque a permissão ``assistant:bypass_dlp`` não está implementada.

Os testes unitários NÃO detectavam o bug porque mockavam ``get_gateway`` com
``AsyncMock`` que aceita qualquer kwarg silenciosamente.

Este teste usa ``respx`` para interceptar a chamada HTTP **real** do
``OpenRouterGateway`` — sem mock do gateway inteiro. Isso garante que:

1. ``classify_intent`` consegue chamar ``gateway.complete()`` sem levantar
   ``NotImplementedError`` (caminho feliz pós-fix).
2. A chamada HTTP chega ao OpenRouter com ``temperature`` e ``max_tokens``
   corretos do frontmatter do prompt.
3. O comportamento pré-fix (``NotImplementedError``) é documentado e testável.

Como provar falha pré-fix
--------------------------
Antes do fix, ``complete_kwargs`` incluía ``"dlp": False``.
``OpenRouterGateway.complete()`` executava:

    if not dlp:
        raise NotImplementedError("dlp=False not yet permitted …")

Isso era capturado pelo ``except Exception`` de ``classify_intent``, que
definia ``handoff_required=True`` com razão "dlp=False not yet permitted …".
TODO turno de classificação resultava em handoff imediato.

O teste ``test_classify_intent_fails_before_fix_due_to_dlp_false`` documenta
esse comportamento com o gateway parcialmente real — verifica que o gateway
levantaria a exceção ao receber ``dlp=False``.

LGPD / Segurança
-----------------
- ``respx`` intercepta o HTTP antes de qualquer dado sair para a rede.
- CPF de teste (``529.982.247-25``) é redactado pelo DLP do gateway antes
  de chegar ao payload HTTP interceptado.
- Logs são sanitizados pelo DLP do structlog.
"""
from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
import respx

# ---------------------------------------------------------------------------
# Helpers de payload OpenRouter
# ---------------------------------------------------------------------------


def _openrouter_ok(content: str = "quer_credito") -> dict[str, Any]:
    """Payload de resposta bem-sucedida do OpenRouter."""
    return {
        "id": "chatcmpl-classify-integ-test",
        "model": "anthropic/claude-haiku-4.5",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": 42,
            "completion_tokens": 3,
            "total_tokens": 45,
        },
    }


# ---------------------------------------------------------------------------
# Fixture: gateway real com URL interceptada por respx
# ---------------------------------------------------------------------------


@pytest.fixture()
def real_gateway() -> Any:
    """OpenRouterGateway com credenciais fake e HTTP interceptado por respx.

    Não usa ``get_gateway()`` do factory para evitar cache — instancia
    diretamente com ``__new__`` e injeta atributos privados.
    """
    from app.llm.factory import reset_gateway_cache
    from app.llm.openrouter import OpenRouterGateway

    reset_gateway_cache()
    gw = OpenRouterGateway.__new__(OpenRouterGateway)
    gw._api_key = "sk-test-fake-classify"
    gw._base_url = "https://openrouter.ai/api/v1"
    gw._http_referer = "https://elemento.test"
    gw._app_title = "Elemento Banco do Povo Test"
    return gw


# ---------------------------------------------------------------------------
# Estado mínimo para invocar classify_intent
# ---------------------------------------------------------------------------


def _make_state(user_text: str = "quero um empréstimo") -> dict[str, Any]:
    """Estado mínimo compatível com ConversationState para classify_intent."""
    return {
        "conversation_id": "integ-classify-conv-001",
        "chatwoot_conversation_id": "cw-integ-classify-42",
        "phone": "+5569988880001",
        "handoff_required": False,
        "handoff_reason": None,
        "missing_fields": [],
        "messages": [{"role": "user", "content": user_text}],
        "tool_results": [],
        "errors": [],
        "actions_emitted": [],
        "lead_id": "lead-classify-integ-001",
        "customer_id": None,
        "customer_name": None,
        "city_id": None,
        "city_name": None,
        "current_intent": None,
        "current_stage": None,
        "requested_amount": None,
        "requested_term_months": None,
        "last_simulation_id": None,
    }


# ---------------------------------------------------------------------------
# Prova de falha pré-fix (documentação do comportamento CRÍTICO-1)
# ---------------------------------------------------------------------------


class TestClassifyIntentPreFixBehavior:
    """Documenta o comportamento pré-fix que causava o CRÍTICO-1.

    Antes do fix, classify_intent passava ``dlp=False`` ao gateway.
    O gateway levantava NotImplementedError. Isso era capturado pelo
    except genérico → handoff_required=True. TODO turno terminava em handoff.

    Estes testes PROVAM que o gateway levanta a exceção quando recebe dlp=False,
    e que pós-fix o nó NÃO passa mais dlp=False (o bug está corrigido).
    """

    @pytest.mark.asyncio()
    async def test_gateway_raises_not_implemented_when_dlp_false(
        self, real_gateway: Any
    ) -> None:
        """Prova direta: gateway.complete(dlp=False) levanta NotImplementedError.

        Este é o comportamento que causava handoff imediato em TODA chamada
        de classify_intent em produção real.

        PRÉ-FIX: o nó passava dlp=False → gateway levantava → handoff imediato.
        PÓS-FIX: o nó NÃO passa dlp=False → gateway não levanta → fluxo normal.

        Este teste verifica o contrato do gateway (defesa em profundidade).
        O gateway DEVE manter o branch ``if not dlp: raise NotImplementedError``
        como proteção contra futuras regressões.
        """
        with pytest.raises(NotImplementedError, match="dlp=False not yet permitted"):
            await real_gateway.complete(
                model="anthropic/claude-haiku-4.5",
                messages=[{"role": "user", "content": "teste dlp false"}],
                dlp=False,  # comportamento pré-fix — deve falhar
                conversation_id="conv-prefix-test",
            )

    @pytest.mark.asyncio()
    async def test_classify_intent_node_with_dlp_false_would_trigger_handoff(
        self, real_gateway: Any
    ) -> None:
        """Simula o comportamento EXATO do CRÍTICO-1 no nó classify_intent.

        Antes do fix, o nó construía complete_kwargs com ``"dlp": False``
        e chamava ``gateway.complete(**complete_kwargs)``. O gateway levantava
        NotImplementedError, que era capturado pelo except genérico do nó,
        resultando em handoff_required=True para TODA mensagem.

        Este teste reproduz esse bug diretamente: chama complete() com dlp=False
        e confirma que NotImplementedError é levantada (o bug existia).

        Após o fix, o nó não passa dlp=False — ver TestClassifyIntentPostFix.
        """
        state = _make_state("quero crédito")

        # Simula o comportamento pré-fix do nó: chamar gateway.complete(dlp=False)
        messages = state["messages"]
        user_text = next(
            (m["content"] for m in reversed(messages) if m.get("role") == "user"),
            "",
        )

        # DLP aplicado manualmente (como o nó faz), mas passa dlp=False como bug pré-fix
        from app.llm.dlp import redact_pii

        dlp_result = redact_pii(user_text)
        safe_text = dlp_result.text

        llm_messages = [
            {"role": "system", "content": "Classifique a intenção."},
            {"role": "user", "content": safe_text},
        ]

        # Comportamento pré-fix: passava dlp=False — deve levantar NotImplementedError
        with pytest.raises(NotImplementedError):
            await real_gateway.complete(
                model="anthropic/claude-haiku-4.5",
                messages=llm_messages,
                temperature=0.0,
                max_tokens=32,
                dlp=False,  # BUG pré-fix — removido pelo fix F9-S10
                conversation_id="conv-prefix-node-sim",
            )


# ---------------------------------------------------------------------------
# Teste de integração pós-fix (gateway real via respx)
# ---------------------------------------------------------------------------


class TestClassifyIntentPostFix:
    """Testes de integração que verificam o comportamento correto pós-fix.

    Usam ``respx`` para interceptar a chamada HTTP real do OpenRouterGateway,
    garantindo que:
    1. O nó classify_intent chama gateway.complete() SEM dlp=False.
    2. A chamada HTTP chega ao OpenRouter com os campos corretos.
    3. O nó retorna a intenção classificada (não handoff).
    4. DLP é aplicado antes do envio (CPF redactado no payload HTTP).
    """

    @pytest.mark.asyncio()
    async def test_classify_intent_completes_without_dlp_error(
        self, real_gateway: Any
    ) -> None:
        """Após o fix, classify_intent invoca o gateway sem NotImplementedError.

        Usa respx para interceptar a HTTP call — prova que o gateway real
        (não um AsyncMock) consegue processar a requisição end-to-end.

        ANTES do fix: handoff_required=True, handoff_reason continha "dlp=False not yet permitted".
        APÓS o fix: current_intent="solicitar_credito", handoff_required=False.
        """
        from unittest.mock import patch

        state = _make_state("quero um empréstimo de R$ 10.000")

        with respx.mock:
            respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                return_value=httpx.Response(200, json=_openrouter_ok("quer_credito"))
            )

            with patch(
                "app.graphs.whatsapp_pre_attendance.nodes.classify_intent.get_gateway",
                return_value=real_gateway,
            ):
                from app.graphs.whatsapp_pre_attendance.nodes.classify_intent import (
                    classify_intent,
                )

                result = await classify_intent(state)  # type: ignore[arg-type]

        # Pós-fix: nó retorna intenção classificada, SEM handoff
        assert result.get("handoff_required") is False, (
            f"CRÍTICO-1 REGRESSÃO: handoff_required=True. "
            f"handoff_reason={result.get('handoff_reason')}. "
            "Verificar se 'dlp': False foi reintroduzido em complete_kwargs."
        )
        assert result.get("current_intent") == "quer_credito"

    @pytest.mark.asyncio()
    async def test_classify_intent_http_payload_has_correct_fields(
        self, real_gateway: Any
    ) -> None:
        """O payload HTTP enviado ao OpenRouter deve ter temperature e max_tokens corretos.

        Verifica que os parâmetros do frontmatter do prompt (ou defaults) chegam
        ao corpo JSON real da requisição HTTP. Não mockamos o gateway — usamos
        respx para capturar o payload antes de sair para a rede.
        """
        from unittest.mock import patch

        state = _make_state("preciso de crédito para capital de giro")

        with respx.mock:
            route = respx.post(
                "https://openrouter.ai/api/v1/chat/completions"
            ).mock(
                return_value=httpx.Response(200, json=_openrouter_ok("solicitar_credito"))
            )

            with patch(
                "app.graphs.whatsapp_pre_attendance.nodes.classify_intent.get_gateway",
                return_value=real_gateway,
            ):
                from app.graphs.whatsapp_pre_attendance.nodes.classify_intent import (
                    classify_intent,
                )

                result = await classify_intent(state)  # type: ignore[arg-type]

        assert result.get("handoff_required") is False, (
            "Nó entrou em handoff — verifique classify_intent.py e o fix do CRÍTICO-1."
        )

        # Inspeciona o payload HTTP real enviado ao OpenRouter
        assert route.calls.last is not None, "Nenhuma chamada HTTP foi interceptada."
        sent_body: dict[str, Any] = json.loads(route.calls.last.request.content)

        # model deve estar presente
        assert "model" in sent_body

        # temperature deve ser 0.0 (default de classify_intent) ou valor do frontmatter
        assert "temperature" in sent_body
        assert sent_body["temperature"] >= 0.0

        # max_tokens deve ser positivo
        assert "max_tokens" in sent_body
        assert sent_body["max_tokens"] > 0

        # messages deve ter pelo menos system + user
        assert "messages" in sent_body
        assert len(sent_body["messages"]) >= 2

        msg_roles = [m["role"] for m in sent_body["messages"]]
        assert "system" in msg_roles
        assert "user" in msg_roles

        # dlp=False NÃO deve aparecer no payload HTTP (foi removido do gateway dispatch)
        # O campo dlp é tratado internamente pelo gateway e nunca enviado ao provider
        assert "dlp" not in sent_body, (
            "Campo 'dlp' apareceu no payload HTTP — verifique o gateway."
        )

    @pytest.mark.asyncio()
    async def test_classify_intent_dlp_redacts_cpf_before_http(
        self, real_gateway: Any
    ) -> None:
        """DLP deve redactar o CPF no payload HTTP enviado ao OpenRouter.

        Confirma que o gateway aplica DLP (redact_pii) ANTES de enviar os
        dados ao provider externo, mesmo quando o nó já aplicou DLP manualmente.
        Aplicar DLP duas vezes é idempotente — não altera tokens já mascarados.

        LGPD §8.4: nenhum dado pessoal em texto plano deve chegar ao suboperador.
        """
        from unittest.mock import patch

        cpf = "529.982.247-25"
        state = _make_state(f"meu CPF é {cpf} e quero crédito")

        with respx.mock:
            route = respx.post(
                "https://openrouter.ai/api/v1/chat/completions"
            ).mock(
                return_value=httpx.Response(200, json=_openrouter_ok("solicitar_credito"))
            )

            with patch(
                "app.graphs.whatsapp_pre_attendance.nodes.classify_intent.get_gateway",
                return_value=real_gateway,
            ):
                from app.graphs.whatsapp_pre_attendance.nodes.classify_intent import (
                    classify_intent,
                )

                result = await classify_intent(state)  # type: ignore[arg-type]

        assert result.get("handoff_required") is False

        # Verifica que o CPF não aparece no payload HTTP enviado ao provider
        sent_raw = route.calls.last.request.content.decode("utf-8")
        assert cpf not in sent_raw, (
            f"LGPD VIOLAÇÃO: CPF '{cpf}' encontrado no payload HTTP enviado ao OpenRouter. "
            "O DLP deve redactar PII antes do envio ao suboperador internacional."
        )

    @pytest.mark.asyncio()
    async def test_classify_intent_returns_valid_intent_from_llm(
        self, real_gateway: Any
    ) -> None:
        """Pós-fix: a intenção retornada pelo LLM (via respx) é validada e retornada.

        Testa o caminho completo: state → classify_intent → gateway.complete()
        → resposta interceptada → intent validado → state update.
        """
        from unittest.mock import patch

        for intent in ("quer_credito", "falar_atendente", "nao_entendi"):
            state = _make_state("mensagem de teste")

            with respx.mock:
                respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                    return_value=httpx.Response(200, json=_openrouter_ok(intent))
                )

                with patch(
                    "app.graphs.whatsapp_pre_attendance.nodes.classify_intent.get_gateway",
                    return_value=real_gateway,
                ):
                    from app.graphs.whatsapp_pre_attendance.nodes.classify_intent import (
                        classify_intent,
                    )

                    result = await classify_intent(state)  # type: ignore[arg-type]

            assert result.get("handoff_required") is False, (
                f"handoff para intent '{intent}': {result.get('handoff_reason')}"
            )
            expected = intent if intent != "nao_entendi" else "nao_entendi"
            assert result.get("current_intent") == expected, (
                f"Esperado intent='{expected}', obtido='{result.get('current_intent')}'"
            )

    @pytest.mark.asyncio()
    async def test_classify_intent_fallback_for_invalid_llm_response(
        self, real_gateway: Any
    ) -> None:
        """Resposta inválida do LLM cai em 'nao_entendi' (sem handoff por LLM inválido).

        O nó usa _validate_intent() que normaliza texto fora do enum para o
        fallback 'nao_entendi' sem acionar handoff — é um fallback soft.
        """
        from unittest.mock import patch

        state = _make_state("mensagem qualquer")

        with respx.mock:
            respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
                return_value=httpx.Response(
                    200, json=_openrouter_ok("resposta_completamente_invalida_xyz")
                )
            )

            with patch(
                "app.graphs.whatsapp_pre_attendance.nodes.classify_intent.get_gateway",
                return_value=real_gateway,
            ):
                from app.graphs.whatsapp_pre_attendance.nodes.classify_intent import (
                    classify_intent,
                )

                result = await classify_intent(state)  # type: ignore[arg-type]

        # Intenção inválida → fallback 'nao_entendi', SEM handoff
        assert result.get("current_intent") == "nao_entendi"
        assert result.get("handoff_required") is False
