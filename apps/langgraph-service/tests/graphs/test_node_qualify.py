"""Testes do nó qualify_credit_interest (F3-S27).

Cobre:
- Extração correta de valor e prazo quando ambos informados (dado completo).
- Extração parcial: só valor → missing_fields contém requested_term_months.
- Extração parcial: só prazo → missing_fields contém requested_amount.
- Nenhum dado → missing_fields contém ambos, next_question gerada.
- Merge com estado anterior: valor de turno anterior preservado.
- Atalho quando ambos já estão no estado (sem chamada LLM).
- DLP é aplicado antes do envio (CPF não chega ao LLM).
- Handoff genérico em caso de erro do gateway (sem vazar detalhes).
- missing_fields de outros nós são preservados.
- tool_results contém prompt_key e prompt_version.

O gateway LLM é sempre mockado — sem chamadas reais à API.
"""
from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.graphs.whatsapp_pre_attendance.nodes.qualify_credit_interest import (
    _HANDOFF_REASON_GENERIC,
    _compute_missing_fields,
    _extract_json,
    qualify_credit_interest,
)
from app.graphs.whatsapp_pre_attendance.state import ConversationState

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_state(
    user_message: str = "Quero fazer uma simulação",
    requested_amount: float | None = None,
    requested_term_months: int | None = None,
    missing_fields: list[str] | None = None,
    **extra: Any,
) -> ConversationState:
    """Retorna estado mínimo com uma mensagem de usuário."""
    base: ConversationState = {
        "conversation_id": "conv-qualify-001",
        "chatwoot_conversation_id": "cw-10",
        "phone": "+5569999990010",
        "handoff_required": False,
        "missing_fields": missing_fields if missing_fields is not None else [],
        "messages": [{"role": "user", "content": user_message}],
        "tool_results": [],
        "errors": [],
        "actions_emitted": [],
    }
    if requested_amount is not None:
        base["requested_amount"] = requested_amount
    if requested_term_months is not None:
        base["requested_term_months"] = requested_term_months
    base.update(extra)  # type: ignore[typeddict-item]
    return base


def _llm_json_response(
    amount: float | None = None,
    term: int | None = None,
    next_question: str | None = None,
) -> str:
    """Gera resposta JSON como o LLM retornaria."""
    ready = amount is not None and term is not None
    return json.dumps(
        {
            "requested_amount": amount,
            "requested_term_months": term,
            "next_question": next_question,
            "ready_to_simulate": ready,
        }
    )


def _mock_gateway(llm_response_content: str) -> MagicMock:
    """Cria mock do gateway que retorna ``llm_response_content`` ao chamar complete()."""
    from app.llm.gateway import LLMResponse, TokenUsage

    gw = MagicMock()
    gw.complete = AsyncMock(
        return_value=LLMResponse(
            content=llm_response_content,
            model="anthropic/claude-sonnet-4",
            usage=TokenUsage(prompt_tokens=200, completion_tokens=40, total_tokens=240),
            latency_ms=350.0,
            finish_reason="stop",
        )
    )
    return gw


# ---------------------------------------------------------------------------
# Testes de _extract_json
# ---------------------------------------------------------------------------


class TestExtractJson:
    def test_complete_json_extracted(self) -> None:
        """JSON completo com valor e prazo é extraído corretamente."""
        raw = json.dumps(
            {
                "requested_amount": 5000.0,
                "requested_term_months": 12,
                "next_question": None,
                "ready_to_simulate": True,
            }
        )
        result = _extract_json(raw)
        assert result["requested_amount"] == 5000.0
        assert result["requested_term_months"] == 12
        assert result["next_question"] is None
        assert result["ready_to_simulate"] is True

    def test_json_with_markdown_fence(self) -> None:
        """JSON dentro de cerca de código markdown é extraído."""
        payload = json.dumps(
            {
                "requested_amount": 3000.0,
                "requested_term_months": 18,
                "next_question": None,
                "ready_to_simulate": True,
            }
        )
        raw = f"```json\n{payload}\n```"
        result = _extract_json(raw)
        assert result["requested_amount"] == 3000.0
        assert result["requested_term_months"] == 18

    def test_null_values_return_none(self) -> None:
        """Campos null no JSON retornam None."""
        raw = json.dumps(
            {
                "requested_amount": None,
                "requested_term_months": None,
                "next_question": "Qual valor você precisa?",
                "ready_to_simulate": False,
            }
        )
        result = _extract_json(raw)
        assert result["requested_amount"] is None
        assert result["requested_term_months"] is None
        assert result["next_question"] == "Qual valor você precisa?"
        assert result["ready_to_simulate"] is False

    def test_invalid_json_returns_empty(self) -> None:
        """JSON inválido retorna estrutura vazia."""
        result = _extract_json("não é json")
        assert result["requested_amount"] is None
        assert result["requested_term_months"] is None
        assert result["ready_to_simulate"] is False

    def test_negative_amount_ignored(self) -> None:
        """Valor negativo é descartado (deve ser > 0)."""
        raw = json.dumps(
            {
                "requested_amount": -100.0,
                "requested_term_months": 12,
                "next_question": None,
                "ready_to_simulate": False,
            }
        )
        result = _extract_json(raw)
        assert result["requested_amount"] is None
        # ready_to_simulate recomputado como False
        assert result["ready_to_simulate"] is False

    def test_zero_term_ignored(self) -> None:
        """Prazo zero é descartado (deve ser > 0)."""
        raw = json.dumps(
            {
                "requested_amount": 5000.0,
                "requested_term_months": 0,
                "next_question": None,
                "ready_to_simulate": False,
            }
        )
        result = _extract_json(raw)
        assert result["requested_term_months"] is None

    def test_ready_to_simulate_derived_from_fields(self) -> None:
        """``ready_to_simulate`` é derivado dos campos, não confiado no LLM."""
        # LLM diz ready=true mas amount é None → nossa lógica diz false
        raw = json.dumps(
            {
                "requested_amount": None,
                "requested_term_months": 12,
                "next_question": "X",
                "ready_to_simulate": True,
            }
        )
        result = _extract_json(raw)
        assert result["ready_to_simulate"] is False


# ---------------------------------------------------------------------------
# Testes de _compute_missing_fields
# ---------------------------------------------------------------------------


class TestComputeMissingFields:
    def test_both_collected_removes_from_missing(self) -> None:
        """Quando ambos coletados, remove os campos da lista."""
        result = _compute_missing_fields(
            ["requested_amount", "requested_term_months"], 5000.0, 12
        )
        assert "requested_amount" not in result
        assert "requested_term_months" not in result

    def test_amount_missing_added_to_list(self) -> None:
        """Quando amount é None, é adicionado à lista."""
        result = _compute_missing_fields([], None, 12)
        assert "requested_amount" in result
        assert "requested_term_months" not in result

    def test_term_missing_added_to_list(self) -> None:
        """Quando term é None, é adicionado à lista."""
        result = _compute_missing_fields([], 5000.0, None)
        assert "requested_term_months" in result
        assert "requested_amount" not in result

    def test_other_fields_preserved(self) -> None:
        """Campos de outros nós (ex.: city) são preservados."""
        result = _compute_missing_fields(["city", "requested_amount"], 5000.0, 12)
        assert "city" in result
        assert "requested_amount" not in result

    def test_both_missing_both_added(self) -> None:
        """Quando ambos None, ambos são adicionados."""
        result = _compute_missing_fields([], None, None)
        assert "requested_amount" in result
        assert "requested_term_months" in result

    def test_no_duplicate_if_already_in_list(self) -> None:
        """Campo já na lista não é duplicado."""
        result = _compute_missing_fields(["requested_amount", "requested_amount"], None, 12)
        assert result.count("requested_amount") == 1


# ---------------------------------------------------------------------------
# Testes de qualify_credit_interest — dado completo
# ---------------------------------------------------------------------------


class TestQualifyComplete:
    @pytest.mark.asyncio
    async def test_both_fields_extracted(self) -> None:
        """Valor e prazo extraídos corretamente do JSON do LLM."""
        state = _make_state("Quero 5 mil em 12 meses")
        gw = _mock_gateway(_llm_json_response(amount=5000.0, term=12))

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.qualify_credit_interest.get_gateway",
            return_value=gw,
        ):
            result = await qualify_credit_interest(state)

        assert result["requested_amount"] == 5000.0
        assert result["requested_term_months"] == 12
        assert "requested_amount" not in result["missing_fields"]
        assert "requested_term_months" not in result["missing_fields"]
        assert result["handoff_required"] is False

    @pytest.mark.asyncio
    async def test_no_next_question_when_complete(self) -> None:
        """Quando completo, nenhuma ação ``send_message`` é emitida."""
        state = _make_state("8 mil em 24 meses")
        gw = _mock_gateway(_llm_json_response(amount=8000.0, term=24))

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.qualify_credit_interest.get_gateway",
            return_value=gw,
        ):
            result = await qualify_credit_interest(state)

        # Nenhuma pergunta emitida quando tudo coletado
        send_messages = [
            a for a in result.get("actions_emitted", []) if a.get("type") == "send_message"
        ]
        assert len(send_messages) == 0

    @pytest.mark.asyncio
    async def test_tool_results_contain_metadata(self) -> None:
        """``tool_results`` contém prompt_key, prompt_version e campos extraídos."""
        state = _make_state("3500 em 18 meses")
        gw = _mock_gateway(_llm_json_response(amount=3500.0, term=18))

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.qualify_credit_interest.get_gateway",
            return_value=gw,
        ):
            result = await qualify_credit_interest(state)

        tool_results: list[dict[str, Any]] = result["tool_results"]
        assert len(tool_results) >= 1
        last = tool_results[-1]
        assert last["node"] == "qualify_credit_interest"
        assert "prompt_key" in last
        assert "prompt_version" in last
        assert last["requested_amount"] == 3500.0
        assert last["requested_term_months"] == 18
        assert last["ready_to_simulate"] is True

    @pytest.mark.asyncio
    async def test_prompt_key_matches_expected(self) -> None:
        """``prompt_key`` deve ser ``pre_attendance_qualify``."""
        state = _make_state("Quero 10 mil em 12 meses")
        gw = _mock_gateway(_llm_json_response(amount=10000.0, term=12))

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.qualify_credit_interest.get_gateway",
            return_value=gw,
        ):
            result = await qualify_credit_interest(state)

        last_tool = result["tool_results"][-1]
        assert last_tool["prompt_key"] == "pre_attendance_qualify"
        assert last_tool["prompt_version"] == "1"


# ---------------------------------------------------------------------------
# Testes de qualify_credit_interest — dado parcial
# ---------------------------------------------------------------------------


class TestQualifyPartial:
    @pytest.mark.asyncio
    async def test_only_amount_collected(self) -> None:
        """Quando só valor retornado → prazo em missing_fields e pergunta emitida."""
        state = _make_state("Uns cinco mil reais")
        gw = _mock_gateway(
            _llm_json_response(
                amount=5000.0,
                term=None,
                next_question="Em quantos meses você gostaria de pagar?",
            )
        )

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.qualify_credit_interest.get_gateway",
            return_value=gw,
        ):
            result = await qualify_credit_interest(state)

        assert result["requested_amount"] == 5000.0
        assert result["requested_term_months"] is None
        assert "requested_term_months" in result["missing_fields"]
        assert "requested_amount" not in result["missing_fields"]
        assert result["handoff_required"] is False
        # next_question deve gerar action
        send_messages = [
            a for a in result.get("actions_emitted", []) if a.get("type") == "send_message"
        ]
        assert len(send_messages) == 1
        assert "meses" in send_messages[0]["content"].lower()

    @pytest.mark.asyncio
    async def test_only_term_collected(self) -> None:
        """Quando só prazo retornado → valor em missing_fields."""
        state = _make_state("Quero pagar em 12 meses")
        gw = _mock_gateway(
            _llm_json_response(
                amount=None,
                term=12,
                next_question="Qual o valor que você precisa?",
            )
        )

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.qualify_credit_interest.get_gateway",
            return_value=gw,
        ):
            result = await qualify_credit_interest(state)

        assert result["requested_term_months"] == 12
        assert result["requested_amount"] is None
        assert "requested_amount" in result["missing_fields"]
        assert "requested_term_months" not in result["missing_fields"]

    @pytest.mark.asyncio
    async def test_no_data_both_missing(self) -> None:
        """Quando nenhum dado → ambos em missing_fields, pergunta emitida."""
        state = _make_state("Quero fazer uma simulação")
        gw = _mock_gateway(
            _llm_json_response(
                amount=None,
                term=None,
                next_question="Qual valor você precisa e em quantos meses quer pagar?",
            )
        )

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.qualify_credit_interest.get_gateway",
            return_value=gw,
        ):
            result = await qualify_credit_interest(state)

        assert result["requested_amount"] is None
        assert result["requested_term_months"] is None
        assert "requested_amount" in result["missing_fields"]
        assert "requested_term_months" in result["missing_fields"]

    @pytest.mark.asyncio
    async def test_other_missing_fields_preserved(self) -> None:
        """Campos faltantes de outros nós (ex.: city) são preservados."""
        state = _make_state("Quero 6 mil", missing_fields=["city"])
        gw = _mock_gateway(
            _llm_json_response(amount=6000.0, term=None, next_question="Em quantos meses?")
        )

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.qualify_credit_interest.get_gateway",
            return_value=gw,
        ):
            result = await qualify_credit_interest(state)

        assert "city" in result["missing_fields"]
        assert "requested_term_months" in result["missing_fields"]

    @pytest.mark.asyncio
    async def test_prior_tool_results_preserved(self) -> None:
        """tool_results anteriores são preservados."""
        prior = {"node": "identify_city", "city_id": "ji-parana"}
        state = _make_state("5 mil em 12 meses", tool_results=[prior])
        gw = _mock_gateway(_llm_json_response(amount=5000.0, term=12))

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.qualify_credit_interest.get_gateway",
            return_value=gw,
        ):
            result = await qualify_credit_interest(state)

        assert result["tool_results"][0] == prior
        assert len(result["tool_results"]) == 2


# ---------------------------------------------------------------------------
# Testes de merge com estado anterior
# ---------------------------------------------------------------------------


class TestQualifyStateMerge:
    @pytest.mark.asyncio
    async def test_existing_amount_preserved_when_llm_returns_null(self) -> None:
        """Valor de turno anterior é preservado quando LLM retorna null para amount."""
        # Turno anterior já tinha coletado o valor
        state = _make_state("Em 12 meses", requested_amount=7000.0)
        gw = _mock_gateway(
            _llm_json_response(amount=None, term=12)
        )

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.qualify_credit_interest.get_gateway",
            return_value=gw,
        ):
            result = await qualify_credit_interest(state)

        # Valor do turno anterior foi preservado
        assert result["requested_amount"] == 7000.0
        assert result["requested_term_months"] == 12
        assert result["missing_fields"] == [] or "requested_amount" not in result["missing_fields"]

    @pytest.mark.asyncio
    async def test_existing_term_preserved_when_llm_returns_null(self) -> None:
        """Prazo de turno anterior é preservado quando LLM retorna null para term."""
        state = _make_state("Quero 4 mil reais", requested_term_months=18)
        gw = _mock_gateway(
            _llm_json_response(amount=4000.0, term=None)
        )

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.qualify_credit_interest.get_gateway",
            return_value=gw,
        ):
            result = await qualify_credit_interest(state)

        assert result["requested_term_months"] == 18
        assert result["requested_amount"] == 4000.0

    @pytest.mark.asyncio
    async def test_shortcut_when_both_already_in_state(self) -> None:
        """Se ambos já estão no estado, não chama o LLM."""
        state = _make_state(
            "Sim, confirmado",
            requested_amount=5000.0,
            requested_term_months=12,
        )
        gw = MagicMock()
        gw.complete = AsyncMock()

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.qualify_credit_interest.get_gateway",
            return_value=gw,
        ):
            result = await qualify_credit_interest(state)

        # LLM não deve ter sido chamado
        gw.complete.assert_not_called()
        assert result["requested_amount"] == 5000.0
        assert result["requested_term_months"] == 12
        assert result["handoff_required"] is False


# ---------------------------------------------------------------------------
# Testes de DLP
# ---------------------------------------------------------------------------


class TestQualifyDLP:
    @pytest.mark.asyncio
    async def test_cpf_redacted_before_llm(self) -> None:
        """CPF na mensagem do cliente NÃO deve aparecer no payload enviado ao LLM."""
        cpf_message = "Meu CPF é 529.982.247-25 e quero 5 mil em 12 meses"
        state = _make_state(user_message=cpf_message)

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
                content=_llm_json_response(amount=5000.0, term=12),
                model=model,
                usage=TokenUsage(prompt_tokens=200, completion_tokens=40, total_tokens=240),
                latency_ms=300.0,
            )

        gw = MagicMock()
        gw.complete = _capture_complete  # type: ignore[method-assign]

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.qualify_credit_interest.get_gateway",
            return_value=gw,
        ):
            result = await qualify_credit_interest(state)

        assert result["requested_amount"] == 5000.0

        assert len(captured_messages) == 1
        # Busca o conteúdo do usuário nas mensagens enviadas
        user_content = ""
        for msg in captured_messages[0]:
            if msg.get("role") == "user":
                user_content = str(msg.get("content", ""))

        # CPF real não deve estar no payload
        assert "529.982.247-25" not in user_content
        assert "52998224725" not in user_content
        # Token de substituição deve estar presente
        assert "<CPF_" in user_content

    @pytest.mark.asyncio
    async def test_phone_redacted_before_llm(self) -> None:
        """Telefone na mensagem do cliente é redactado antes do LLM."""
        phone_message = "Meu telefone é (69) 99999-1234 e quero 3 mil em 6 meses"
        state = _make_state(user_message=phone_message)

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
                content=_llm_json_response(amount=3000.0, term=6),
                model=model,
                usage=TokenUsage(prompt_tokens=150, completion_tokens=30, total_tokens=180),
                latency_ms=250.0,
            )

        gw = MagicMock()
        gw.complete = _capture_complete  # type: ignore[method-assign]

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.qualify_credit_interest.get_gateway",
            return_value=gw,
        ):
            await qualify_credit_interest(state)

        assert len(captured_messages) == 1
        user_content = ""
        for msg in captured_messages[0]:
            if msg.get("role") == "user":
                user_content = str(msg.get("content", ""))

        assert "99999-1234" not in user_content
        assert "<PHONE_" in user_content


# ---------------------------------------------------------------------------
# Testes de handoff em caso de erro
# ---------------------------------------------------------------------------


class TestQualifyHandoff:
    @pytest.mark.asyncio
    async def test_gateway_exception_triggers_handoff(self) -> None:
        """Exceção do gateway → handoff_required=True."""
        state = _make_state("Quero 5 mil em 12 meses")
        gw = MagicMock()
        gw.complete = AsyncMock(side_effect=RuntimeError("connection timeout"))

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.qualify_credit_interest.get_gateway",
            return_value=gw,
        ):
            result = await qualify_credit_interest(state)

        assert result["handoff_required"] is True
        assert "handoff_reason" in result

    @pytest.mark.asyncio
    async def test_handoff_reason_is_generic(self) -> None:
        """``handoff_reason`` é genérico — sem stack trace, URL ou dados internos."""
        state = _make_state("Quero simular")
        gw = MagicMock()
        gw.complete = AsyncMock(side_effect=ValueError("https://openrouter.ai/api"))

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.qualify_credit_interest.get_gateway",
            return_value=gw,
        ):
            result = await qualify_credit_interest(state)

        assert result["handoff_required"] is True
        # Razão genérica — sem URL nem mensagem de exceção interna
        assert result["handoff_reason"] == _HANDOFF_REASON_GENERIC
        # URL do erro interno não deve vazar
        assert "openrouter" not in result["handoff_reason"]
        assert "https" not in result["handoff_reason"]

    @pytest.mark.asyncio
    async def test_gateway_error_accumulates_in_errors(self) -> None:
        """Erro é registrado na lista ``errors`` do estado."""
        state = _make_state("Quero crédito")
        gw = MagicMock()
        gw.complete = AsyncMock(side_effect=ConnectionError("LLM indisponível"))

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.qualify_credit_interest.get_gateway",
            return_value=gw,
        ):
            result = await qualify_credit_interest(state)

        errors: list[dict[str, Any]] = result["errors"]
        assert len(errors) >= 1
        assert errors[-1]["node"] == "qualify_credit_interest"
        assert "LLM indisponível" in errors[-1]["error"]

    @pytest.mark.asyncio
    async def test_prior_errors_preserved_on_new_error(self) -> None:
        """Erros anteriores no estado são preservados ao acumular novo erro."""
        prior_error = {"node": "identify_city", "error": "city not found"}
        state = _make_state("Quero crédito", errors=[prior_error])
        gw = MagicMock()
        gw.complete = AsyncMock(side_effect=ConnectionError("net"))

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.qualify_credit_interest.get_gateway",
            return_value=gw,
        ):
            result = await qualify_credit_interest(state)

        errors: list[dict[str, Any]] = result["errors"]
        assert errors[0] == prior_error
        assert len(errors) == 2

    @pytest.mark.asyncio
    async def test_prompt_not_found_triggers_handoff(self) -> None:
        """Se o prompt não existir, handoff genérico é acionado."""
        state = _make_state("Quero simular")
        gw = MagicMock()

        with (
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.qualify_credit_interest.get_gateway",
                return_value=gw,
            ),
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.qualify_credit_interest._load_prompt",
                side_effect=RuntimeError("Prompt não encontrado"),
            ),
        ):
            result = await qualify_credit_interest(state)

        assert result["handoff_required"] is True
        assert result["handoff_reason"] == _HANDOFF_REASON_GENERIC

    @pytest.mark.asyncio
    async def test_invalid_json_response_produces_empty_result(self) -> None:
        """Resposta inválida do LLM → campos None, ambos em missing_fields."""
        state = _make_state("Quero simular algo")
        gw = _mock_gateway("não é json nenhum")

        with patch(
            "app.graphs.whatsapp_pre_attendance.nodes.qualify_credit_interest.get_gateway",
            return_value=gw,
        ):
            result = await qualify_credit_interest(state)

        # Não deve dar handoff por JSON inválido — apenas nada coletado
        assert result["handoff_required"] is False
        assert result["requested_amount"] is None
        assert result["requested_term_months"] is None
        assert "requested_amount" in result["missing_fields"]
        assert "requested_term_months" in result["missing_fields"]
