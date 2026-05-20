"""Testes do nó classify_intent (F3-S24, atualizado para F9-S09).

Cobre:
- Classificação correta de ≥5 intenções do catálogo.
- Fallback para ``nao_entendi`` quando o LLM retorna valor inválido.
- Fallback para ``nao_entendi`` + handoff quando o gateway levanta exceção.
- DLP é aplicado antes do envio (texto com CPF chega mascarado ao LLM).
- Campos ``tool_results`` contêm ``prompt_key`` e ``prompt_version``.
- Mensagem vazia não quebra o nó (retorna ``nao_entendi``).
- F9-S09: prompt carregado do DB via load_active_prompt (mockado).

O gateway LLM é sempre mockado — sem chamadas reais à API.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.graphs.whatsapp_pre_attendance.nodes.classify_intent import (
    _FALLBACK_INTENT,
    _VALID_INTENTS,
    _validate_intent,
    classify_intent,
)
from app.graphs.whatsapp_pre_attendance.state import ConversationState
from app.prompts.loader import ActivePrompt

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_state(user_message: str = "Olá!", **extra: Any) -> ConversationState:
    """Retorna estado mínimo com uma mensagem de usuário."""
    base: ConversationState = {
        "conversation_id": "conv-test-001",
        "chatwoot_conversation_id": "cw-1",
        "phone": "+5569999990001",
        "handoff_required": False,
        "missing_fields": [],
        "messages": [{"role": "user", "content": user_message}],
        "tool_results": [],
        "errors": [],
        "actions_emitted": [],
    }
    base.update(extra)  # type: ignore[typeddict-item]
    return base


def _mock_gateway(llm_response_content: str) -> MagicMock:
    """Cria mock do gateway que retorna ``llm_response_content`` ao chamar complete()."""
    from app.llm.gateway import LLMResponse, TokenUsage

    gw = MagicMock()
    gw.complete = AsyncMock(
        return_value=LLMResponse(
            content=llm_response_content,
            model="anthropic/claude-3.5-haiku",
            usage=TokenUsage(prompt_tokens=50, completion_tokens=3, total_tokens=53),
            latency_ms=120.0,
            finish_reason="stop",
        )
    )
    return gw


def _make_active_prompt(
    key: str = "pre_attendance_classify",
    version: int = 1,
    body: str = "Classify the user intent.",
) -> ActivePrompt:
    """Cria ActivePrompt sintético para testes."""
    return ActivePrompt(
        key=key,
        version=version,
        body=body,
        content_hash="test_hash_abc123",
        model_recommended=None,
        temperature=None,
        max_tokens=None,
        top_p=None,
        prompt_version=f"{key}@v{version}",
    )


# Patch canônico para load_active_prompt em todos os testes
_LOAD_PROMPT_PATCH = (
    "app.graphs.whatsapp_pre_attendance.nodes.classify_intent.load_active_prompt"
)


# ---------------------------------------------------------------------------
# Testes de _validate_intent
# ---------------------------------------------------------------------------


class TestValidateIntent:
    @pytest.mark.parametrize("intent", list(_VALID_INTENTS))
    def test_all_valid_intents_accepted(self, intent: str) -> None:
        """Cada valor do catálogo é aceito sem fallback."""
        assert _validate_intent(intent) == intent

    def test_invalid_intent_returns_fallback(self) -> None:
        """Valor fora do enum retorna ``nao_entendi``."""
        assert _validate_intent("nao_sei") == _FALLBACK_INTENT
        assert _validate_intent("") == _FALLBACK_INTENT
        assert _validate_intent("QUER_CREDITO") in _VALID_INTENTS  # caixa alta normalizada

    def test_whitespace_stripped(self) -> None:
        """Espaços em branco ao redor são ignorados."""
        assert _validate_intent("  saudacao  ") == "saudacao"

    def test_uppercase_normalized(self) -> None:
        """Resposta do LLM em caixa alta é normalizada."""
        assert _validate_intent("QUER_CREDITO") == "quer_credito"

    def test_unknown_value_is_nao_entendi(self) -> None:
        """Qualquer valor não reconhecido vira ``nao_entendi``."""
        assert _validate_intent("bom_dia") == _FALLBACK_INTENT
        assert _validate_intent("sim") == _FALLBACK_INTENT


# ---------------------------------------------------------------------------
# Testes de classify_intent — caminho feliz
# ---------------------------------------------------------------------------


class TestClassifyIntentHappyPath:
    """Testa classificação correta das intenções."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "user_msg, expected_intent",
        [
            ("Olá, bom dia!", "saudacao"),
            ("Quero fazer um empréstimo", "quer_credito"),
            ("Quero simular 5 mil reais em 12 meses", "quer_simular"),
            ("Posso enviar meus documentos aqui?", "enviar_documentos"),
            ("Quero falar com um atendente", "falar_atendente"),
            ("Como está meu processo?", "consultar_andamento"),
            ("Estou insatisfeito com o atendimento", "reclamacao"),
            ("Meu boleto venceu, o que faço?", "cobranca"),
            ("asdflkj", "nao_entendi"),
            ("Me passa uma receita de bolo", "fora_de_escopo"),
        ],
    )
    async def test_classifies_intent(self, user_msg: str, expected_intent: str) -> None:
        """Cada intenção do catálogo é classificada corretamente."""
        state = _make_state(user_message=user_msg)
        gw = _mock_gateway(expected_intent)
        active_prompt = _make_active_prompt()

        with (
            patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=active_prompt)),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.classify_intent.get_gateway",
                return_value=gw,
            ),
        ):
            result = await classify_intent(state)

        assert result["current_intent"] == expected_intent
        assert result["handoff_required"] is False

    @pytest.mark.asyncio
    async def test_result_contains_prompt_metadata(self) -> None:
        """``tool_results`` contém ``prompt_key`` e ``prompt_version``."""
        state = _make_state("Quero crédito")
        gw = _mock_gateway("quer_credito")
        active_prompt = _make_active_prompt()

        with (
            patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=active_prompt)),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.classify_intent.get_gateway",
                return_value=gw,
            ),
        ):
            result = await classify_intent(state)

        tool_results: list[dict[str, Any]] = result["tool_results"]
        assert len(tool_results) >= 1
        last = tool_results[-1]
        assert last["node"] == "classify_intent"
        assert "prompt_key" in last
        assert "prompt_version" in last
        assert last["intent"] == "quer_credito"

    @pytest.mark.asyncio
    async def test_prompt_key_matches_expected(self) -> None:
        """``prompt_key`` no tool_result deve ser ``pre_attendance_classify``."""
        state = _make_state("Boa tarde")
        gw = _mock_gateway("saudacao")
        active_prompt = _make_active_prompt()

        with (
            patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=active_prompt)),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.classify_intent.get_gateway",
                return_value=gw,
            ),
        ):
            result = await classify_intent(state)

        tool_results: list[dict[str, Any]] = result["tool_results"]
        last = tool_results[-1]
        assert last["prompt_key"] == "pre_attendance_classify"
        assert last["prompt_version"] == "pre_attendance_classify@v1"

    @pytest.mark.asyncio
    async def test_existing_tool_results_preserved(self) -> None:
        """``tool_results`` anteriores são preservados no estado."""
        prior_result = {"node": "load_state", "data": "ok"}
        state = _make_state("Quero simular", tool_results=[prior_result])
        gw = _mock_gateway("quer_simular")
        active_prompt = _make_active_prompt()

        with (
            patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=active_prompt)),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.classify_intent.get_gateway",
                return_value=gw,
            ),
        ):
            result = await classify_intent(state)

        assert result["tool_results"][0] == prior_result
        assert len(result["tool_results"]) == 2

    @pytest.mark.asyncio
    async def test_empty_message_returns_nao_entendi(self) -> None:
        """Mensagem vazia não quebra o nó — retorna ``nao_entendi``."""
        state = _make_state(user_message="")
        gw = _mock_gateway("nao_entendi")
        active_prompt = _make_active_prompt()

        with (
            patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=active_prompt)),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.classify_intent.get_gateway",
                return_value=gw,
            ),
        ):
            result = await classify_intent(state)

        assert result["current_intent"] == "nao_entendi"
        assert result["handoff_required"] is False

    @pytest.mark.asyncio
    async def test_no_user_message_in_history(self) -> None:
        """Estado sem mensagens de usuário não quebra o nó."""
        state: ConversationState = {
            "conversation_id": "conv-empty",
            "chatwoot_conversation_id": "cw-2",
            "phone": "+5569999990002",
            "handoff_required": False,
            "missing_fields": [],
            "messages": [{"role": "assistant", "content": "Olá! Como posso ajudar?"}],
            "tool_results": [],
            "errors": [],
            "actions_emitted": [],
        }
        gw = _mock_gateway("nao_entendi")
        active_prompt = _make_active_prompt()

        with (
            patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=active_prompt)),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.classify_intent.get_gateway",
                return_value=gw,
            ),
        ):
            result = await classify_intent(state)

        # Não deve quebrar — LLM recebe string vazia e retorna fallback
        assert "current_intent" in result


# ---------------------------------------------------------------------------
# Testes de fallback por resposta inválida do LLM
# ---------------------------------------------------------------------------


class TestClassifyIntentInvalidResponse:
    @pytest.mark.asyncio
    async def test_invalid_llm_response_falls_back(self) -> None:
        """Resposta fora do enum → ``nao_entendi``."""
        state = _make_state("Quero algo")
        gw = _mock_gateway("quero_coisa_estranha")
        active_prompt = _make_active_prompt()

        with (
            patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=active_prompt)),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.classify_intent.get_gateway",
                return_value=gw,
            ),
        ):
            result = await classify_intent(state)

        assert result["current_intent"] == "nao_entendi"
        assert result["handoff_required"] is False

    @pytest.mark.asyncio
    async def test_llm_response_with_explanation_falls_back(self) -> None:
        """LLM que explica em vez de só retornar o identificador → fallback."""
        state = _make_state("Oi")
        gw = _mock_gateway("A intenção é uma saudação, portanto: saudacao")
        active_prompt = _make_active_prompt()

        with (
            patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=active_prompt)),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.classify_intent.get_gateway",
                return_value=gw,
            ),
        ):
            result = await classify_intent(state)

        # Texto longo com espaços/pontuação → limpo mas não reconhecível → fallback
        assert result["current_intent"] == _FALLBACK_INTENT


# ---------------------------------------------------------------------------
# Testes de handoff em caso de erro do gateway
# ---------------------------------------------------------------------------


class TestClassifyIntentGatewayError:
    @pytest.mark.asyncio
    async def test_gateway_exception_triggers_handoff(self) -> None:
        """Exceção do gateway → handoff_required=True, intent=nao_entendi."""
        state = _make_state("Quero crédito")
        gw = MagicMock()
        gw.complete = AsyncMock(side_effect=RuntimeError("timeout"))
        active_prompt = _make_active_prompt()

        with (
            patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=active_prompt)),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.classify_intent.get_gateway",
                return_value=gw,
            ),
        ):
            result = await classify_intent(state)

        assert result["current_intent"] == _FALLBACK_INTENT
        assert result["handoff_required"] is True
        assert "handoff_reason" in result
        assert "classify_intent" in result["handoff_reason"]

    @pytest.mark.asyncio
    async def test_gateway_error_accumulates_in_errors(self) -> None:
        """Erro é registrado na lista ``errors`` do estado."""
        state = _make_state("Ola")
        gw = MagicMock()
        gw.complete = AsyncMock(side_effect=ValueError("LLM indisponível"))
        active_prompt = _make_active_prompt()

        with (
            patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=active_prompt)),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.classify_intent.get_gateway",
                return_value=gw,
            ),
        ):
            result = await classify_intent(state)

        errors: list[dict[str, Any]] = result["errors"]
        assert len(errors) >= 1
        assert errors[-1]["node"] == "classify_intent"
        assert "LLM indisponível" in errors[-1]["error"]

    @pytest.mark.asyncio
    async def test_prior_errors_preserved_on_new_error(self) -> None:
        """Erros anteriores no estado são preservados ao acumular novo erro."""
        prior_error = {"node": "load_state", "error": "backend timeout"}
        state = _make_state("Ola", errors=[prior_error])
        gw = MagicMock()
        gw.complete = AsyncMock(side_effect=ConnectionError("net"))
        active_prompt = _make_active_prompt()

        with (
            patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=active_prompt)),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.classify_intent.get_gateway",
                return_value=gw,
            ),
        ):
            result = await classify_intent(state)

        errors: list[dict[str, Any]] = result["errors"]
        assert errors[0] == prior_error
        assert len(errors) == 2

    @pytest.mark.asyncio
    async def test_prompt_not_found_triggers_handoff(self) -> None:
        """PromptNotFoundError → handoff_required=True, motivo contém a key."""
        from app.prompts.loader import PromptNotFoundError

        state = _make_state("Quero crédito")

        with patch(
            _LOAD_PROMPT_PATCH,
            new=AsyncMock(side_effect=PromptNotFoundError("pre_attendance_classify")),
        ):
            result = await classify_intent(state)

        assert result["current_intent"] == _FALLBACK_INTENT
        assert result["handoff_required"] is True
        assert "pre_attendance_classify" in result.get("handoff_reason", "")


# ---------------------------------------------------------------------------
# Testes de DLP
# ---------------------------------------------------------------------------


class TestClassifyIntentDLP:
    @pytest.mark.asyncio
    async def test_pii_redacted_before_llm(self) -> None:
        """CPF na mensagem NÃO deve aparecer no payload enviado ao LLM."""
        cpf_message = "Meu CPF é 529.982.247-25 e quero crédito"
        state = _make_state(user_message=cpf_message)
        active_prompt = _make_active_prompt()

        captured_messages: list[list[dict[str, Any]]] = []

        async def _capture_complete(
            *,
            model: str,
            messages: list[dict[str, Any]],
            **kwargs: Any,
        ) -> Any:
            from app.llm.gateway import LLMResponse, TokenUsage

            captured_messages.append(messages)
            return LLMResponse(
                content="quer_credito",
                model=model,
                usage=TokenUsage(prompt_tokens=40, completion_tokens=3, total_tokens=43),
                latency_ms=100.0,
            )

        gw = MagicMock()
        gw.complete = _capture_complete  # type: ignore[method-assign]

        with (
            patch(_LOAD_PROMPT_PATCH, new=AsyncMock(return_value=active_prompt)),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.classify_intent.get_gateway",
                return_value=gw,
            ),
        ):
            result = await classify_intent(state)

        assert result["current_intent"] == "quer_credito"
        assert len(captured_messages) == 1
        user_content = captured_messages[0][-1]["content"]
        # CPF real não deve estar no payload
        assert "529.982.247-25" not in user_content
        assert "52998224725" not in user_content
        # Token de substituição deve estar presente
        assert "<CPF_" in user_content
