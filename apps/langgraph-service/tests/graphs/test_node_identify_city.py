"""Testes unitários para o nó identify_city (F3-S26).

Cobre os 3 cenários canônicos (doc 06 §7.2) + tratamento de falhas de infra:

  1. Match alto (confidence >= 0.85) → grava city_id/city_name + chama update_lead_profile.
  2. Match baixo (confidence < 0.85) → mensagem de confirmação com alternativas.
  3. Cidade fora da área atendida (out_of_service=True) → mensagem de fluxo alternativo.
  4. Erro de infra (5xx / timeout) → mensagem segura + handoff_required=True.

Nenhuma chamada HTTP real é feita: ``identify_city`` e ``update_lead_profile``
são mockados via ``unittest.mock.AsyncMock``.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.graphs.whatsapp_pre_attendance.nodes.identify_city import (
    node_identify_city,
)
from app.graphs.whatsapp_pre_attendance.state import ConversationState
from app.tools.city_tools import CityAlternative, IdentifyCityResult
from app.tools.leads_tools import UpdateLeadProfileSuccess

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _base_state(**overrides: Any) -> ConversationState:
    """Estado mínimo válido para testar o nó."""
    base: ConversationState = {
        "conversation_id": "conv-001",
        "chatwoot_conversation_id": "cw-001",
        "lead_id": "lead-uuid-1",
        "customer_id": None,
        "phone": "+5569999990001",
        "customer_name": None,
        "city_id": None,
        "city_name": None,
        "current_intent": "quer_credito",
        "requested_amount": None,
        "requested_term_months": None,
        "selected_product_id": None,
        "last_simulation_id": None,
        "current_stage": "city_identification",
        "handoff_required": False,
        "handoff_reason": None,
        "missing_fields": [],
        "messages": [{"role": "user", "content": "porto velho"}],
        "tool_results": [],
        "errors": [],
        "actions_emitted": [],
    }
    base.update(overrides)  # type: ignore[typeddict-item]
    return base


def _make_update_result(city_id: str = "uuid-porto-velho") -> UpdateLeadProfileSuccess:
    return UpdateLeadProfileSuccess(
        ok=True,
        lead_id="lead-uuid-1",
        current_stage="city_identified",
        city_id=city_id,
        name=None,
    )


# ---------------------------------------------------------------------------
# Cenário 1 — Match alto (confidence >= 0.85)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_high_confidence_sets_city_in_state() -> None:
    """confidence >= 0.85 → city_id e city_name gravados no estado."""
    identify_result = IdentifyCityResult(
        city_id="uuid-porto-velho",
        city_name="Porto Velho",
        matched=True,
        confidence=0.97,
        out_of_service=False,
        alternatives=[],
    )
    update_result = _make_update_result()

    with (
        patch(
            "app.graphs.whatsapp_pre_attendance.nodes.identify_city.tool_identify_city",
            new=AsyncMock(return_value=identify_result),
        ),
        patch(
            "app.graphs.whatsapp_pre_attendance.nodes.identify_city.tool_update_lead_profile",
            new=MagicMock(ainvoke=AsyncMock(return_value=update_result)),
        ),
    ):
        result = await node_identify_city(_base_state())

    assert result["city_id"] == "uuid-porto-velho"
    assert result["city_name"] == "Porto Velho"
    assert result.get("handoff_required") is False or result.get("handoff_required") is None


@pytest.mark.asyncio()
async def test_high_confidence_calls_update_lead_profile() -> None:
    """Match alto deve chamar update_lead_profile com city_id correto."""
    identify_result = IdentifyCityResult(
        city_id="uuid-ariquemes",
        city_name="Ariquemes",
        matched=True,
        confidence=0.92,
        out_of_service=False,
        alternatives=[],
    )
    update_mock = AsyncMock(return_value=_make_update_result("uuid-ariquemes"))

    with (
        patch(
            "app.graphs.whatsapp_pre_attendance.nodes.identify_city.tool_identify_city",
            new=AsyncMock(return_value=identify_result),
        ),
        patch(
            "app.graphs.whatsapp_pre_attendance.nodes.identify_city.tool_update_lead_profile",
            new=MagicMock(ainvoke=update_mock),
        ),
    ):
        result = await node_identify_city(
            _base_state(messages=[{"role": "user", "content": "ariquemes"}])
        )

    update_mock.assert_awaited_once()
    call_kwargs: dict[str, Any] = update_mock.call_args[0][0]
    assert call_kwargs["lead_id"] == "lead-uuid-1"
    assert call_kwargs["city_id"] == "uuid-ariquemes"

    # tool_results deve registrar ambas as tools
    tool_names = [t["tool"] for t in result.get("tool_results", [])]
    assert "identify_city" in tool_names
    assert "update_lead_profile" in tool_names


@pytest.mark.asyncio()
async def test_high_confidence_boundary_085() -> None:
    """Exatamente 0.85 deve ser tratado como match alto (>= threshold)."""
    identify_result = IdentifyCityResult(
        city_id="uuid-jaru",
        city_name="Jaru",
        matched=True,
        confidence=0.85,
        out_of_service=False,
        alternatives=[],
    )

    with (
        patch(
            "app.graphs.whatsapp_pre_attendance.nodes.identify_city.tool_identify_city",
            new=AsyncMock(return_value=identify_result),
        ),
        patch(
            "app.graphs.whatsapp_pre_attendance.nodes.identify_city.tool_update_lead_profile",
            new=MagicMock(ainvoke=AsyncMock(return_value=_make_update_result("uuid-jaru"))),
        ),
    ):
        result = await node_identify_city(
            _base_state(messages=[{"role": "user", "content": "jaru"}])
        )

    assert result["city_id"] == "uuid-jaru"


# ---------------------------------------------------------------------------
# Cenário 2 — Match baixo (confidence < 0.85)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_low_confidence_adds_confirmation_message_with_alternatives() -> None:
    """confidence < 0.85 → pergunta de confirmação com alternativas na mensagem."""
    identify_result = IdentifyCityResult(
        city_id=None,
        city_name=None,
        matched=False,
        confidence=0.62,
        out_of_service=False,
        alternatives=[
            CityAlternative(city_id="uuid-cacoal", city_name="Cacoal", confidence=0.62),
            CityAlternative(city_id="uuid-cacaulandia", city_name="Cacaulândia", confidence=0.54),
        ],
    )

    with patch(
        "app.graphs.whatsapp_pre_attendance.nodes.identify_city.tool_identify_city",
        new=AsyncMock(return_value=identify_result),
    ):
        result = await node_identify_city(
            _base_state(messages=[{"role": "user", "content": "cacol"}])
        )

    # city_id/city_name NÃO devem ser gravados
    assert result.get("city_id") is None
    assert result.get("city_name") is None

    # Última mensagem deve ser do assistente com lista de alternativas
    assistant_msgs = [m for m in result["messages"] if m["role"] == "assistant"]
    assert len(assistant_msgs) == 1
    content: str = assistant_msgs[0]["content"]
    assert "Cacoal" in content
    assert "Cacaulândia" in content


@pytest.mark.asyncio()
async def test_low_confidence_no_alternatives_generic_message() -> None:
    """Match baixo sem alternativas → mensagem genérica pedindo cidade completa."""
    identify_result = IdentifyCityResult(
        city_id=None,
        city_name=None,
        matched=False,
        confidence=0.20,
        out_of_service=False,
        alternatives=[],
    )

    with patch(
        "app.graphs.whatsapp_pre_attendance.nodes.identify_city.tool_identify_city",
        new=AsyncMock(return_value=identify_result),
    ):
        result = await node_identify_city(
            _base_state(messages=[{"role": "user", "content": "xyzabc"}])
        )

    assistant_msgs = [m for m in result["messages"] if m["role"] == "assistant"]
    assert len(assistant_msgs) == 1
    # Deve pedir o nome completo da cidade — sem lista de alternativas
    content_lower = assistant_msgs[0]["content"].lower()
    assert "nome completo" in content_lower or "cidade" in content_lower


# ---------------------------------------------------------------------------
# Cenário 3 — Fora da área atendida (out_of_service=True)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_out_of_service_adds_alternative_flow_message() -> None:
    """out_of_service=True → mensagem de fluxo alternativo."""
    identify_result = IdentifyCityResult(
        city_id="uuid-sao-paulo",
        city_name="São Paulo",
        matched=False,
        confidence=0.99,
        out_of_service=True,
        alternatives=[],
    )

    with patch(
        "app.graphs.whatsapp_pre_attendance.nodes.identify_city.tool_identify_city",
        new=AsyncMock(return_value=identify_result),
    ):
        result = await node_identify_city(
            _base_state(messages=[{"role": "user", "content": "são paulo"}])
        )

    # Não deve gravar cidade no estado (cidade não atendida)
    assert result.get("city_id") is None
    assert result.get("city_name") is None

    # Deve haver mensagem de assistente mencionando que não atende
    assistant_msgs = [m for m in result["messages"] if m["role"] == "assistant"]
    assert len(assistant_msgs) == 1
    content = assistant_msgs[0]["content"]
    assert "São Paulo" in content or "não atende" in content.lower() or "Banco do Povo" in content

    # handoff_required NÃO deve ser marcado (é encerramento amigável, não handoff)
    assert result.get("handoff_required") is not True


@pytest.mark.asyncio()
async def test_out_of_service_city_name_fallback_to_text() -> None:
    """Quando city_name é None e out_of_service, deve usar o city_text como label."""
    identify_result = IdentifyCityResult(
        city_id=None,
        city_name=None,
        matched=False,
        confidence=0.91,
        out_of_service=True,
        alternatives=[],
    )

    with patch(
        "app.graphs.whatsapp_pre_attendance.nodes.identify_city.tool_identify_city",
        new=AsyncMock(return_value=identify_result),
    ):
        result = await node_identify_city(
            _base_state(messages=[{"role": "user", "content": "Manaus"}])
        )

    assistant_msgs = [m for m in result["messages"] if m["role"] == "assistant"]
    assert len(assistant_msgs) == 1
    # city_text ("Manaus") deve aparecer na mensagem de resposta
    assert "Manaus" in assistant_msgs[0]["content"]


# ---------------------------------------------------------------------------
# Cenário 4 — Erros de infra (5xx / timeout)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_http_5xx_sets_handoff_and_safe_message() -> None:
    """Erro 5xx do backend → handoff_required=True + mensagem segura (sem URL interna)."""
    mock_response = MagicMock()
    mock_response.status_code = 503
    exc = httpx.HTTPStatusError("Backend error", request=MagicMock(), response=mock_response)

    with patch(
        "app.graphs.whatsapp_pre_attendance.nodes.identify_city.tool_identify_city",
        new=AsyncMock(side_effect=exc),
    ):
        result = await node_identify_city(_base_state())

    assert result.get("handoff_required") is True
    assert result.get("handoff_reason") == "city_identification_infra_error"

    # A URL interna não deve aparecer na mensagem ao cliente
    assistant_msgs = [m for m in result["messages"] if m["role"] == "assistant"]
    assert len(assistant_msgs) == 1
    content = assistant_msgs[0]["content"]
    assert "internal" not in content.lower()
    assert "http" not in content.lower()
    assert "traceback" not in content.lower()

    # Erro deve ser registrado em errors
    assert any(e["node"] == "identify_city" for e in result.get("errors", []))


@pytest.mark.asyncio()
async def test_timeout_sets_handoff_and_safe_message() -> None:
    """Timeout do backend → handoff_required=True + mensagem segura."""
    exc = httpx.ReadTimeout("timed out", request=MagicMock())  # type: ignore[arg-type]

    with patch(
        "app.graphs.whatsapp_pre_attendance.nodes.identify_city.tool_identify_city",
        new=AsyncMock(side_effect=exc),
    ):
        result = await node_identify_city(_base_state())

    assert result.get("handoff_required") is True
    errors = result.get("errors", [])
    assert any(e.get("error") == "timeout" for e in errors)


# ---------------------------------------------------------------------------
# Testes auxiliares — _extract_last_user_message
# ---------------------------------------------------------------------------


def test_extract_last_user_message_basic() -> None:
    """Deve retornar o conteúdo da última mensagem com role==user."""
    from app.graphs.whatsapp_pre_attendance.nodes.identify_city import _extract_last_user_message

    messages: list[dict[str, Any]] = [
        {"role": "assistant", "content": "Olá! Como posso ajudar?"},
        {"role": "user", "content": "Quero crédito"},
        {"role": "assistant", "content": "Qual sua cidade?"},
        {"role": "user", "content": "porto velho"},
    ]
    assert _extract_last_user_message(messages) == "porto velho"


def test_extract_last_user_message_empty() -> None:
    """Lista vazia deve retornar string vazia."""
    from app.graphs.whatsapp_pre_attendance.nodes.identify_city import _extract_last_user_message

    assert _extract_last_user_message([]) == ""


def test_extract_last_user_message_no_user_role() -> None:
    """Sem mensagem de usuário deve retornar string vazia."""
    from app.graphs.whatsapp_pre_attendance.nodes.identify_city import _extract_last_user_message

    messages: list[dict[str, Any]] = [
        {"role": "assistant", "content": "Olá!"},
        {"role": "system", "content": "Você é um assistente."},
    ]
    assert _extract_last_user_message(messages) == ""
