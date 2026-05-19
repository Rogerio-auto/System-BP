"""Testes unitários para app/tools/chatwoot_tools.py.

Cobre request_handoff:
- Handoff criado com sucesso: payload correto, headers obrigatórios presentes.
- Idempotency-Key gerado deterministicamente (UUID v5) quando não fornecido.
- Idempotency-Key explícito enviado sem modificação.
- Reenvio idempotente: mesma (conversation_id, reason) → mesmo idempotency_key.
- simulation_id opcional: presente e ausente no payload.
- Falha 5xx propaga HTTPStatusError ao chamador.
- Falha de timeout propaga TimeoutException ao chamador.

Cobre create_chatwoot_note:
- Nota criada com sucesso: payload correto, headers obrigatórios presentes.
- note_id retornado corretamente no output.
- Idempotency-Key gerado deterministicamente (UUID v5) quando não fornecido.
- Idempotency-Key explícito enviado sem modificação.
- Reenvio idempotente: mesma (chatwoot_conversation_id, body) → mesmo idempotency_key.
- Falha 5xx propaga HTTPStatusError ao chamador.
- Falha de timeout propaga TimeoutException ao chamador.
"""
from __future__ import annotations

import uuid

import httpx
import pytest
import respx

from app.config import settings
from app.tools._base import InternalApiClient
from app.tools.chatwoot_tools import (
    ChatwootNoteInput,
    ChatwootNoteOutput,
    HandoffInput,
    HandoffOutput,
    create_chatwoot_note,
    request_handoff,
)


def _handoff_url() -> str:
    """Monta URL absoluta do endpoint /internal/handoffs."""
    raw = str(settings.backend_internal_url)
    base = raw if raw.endswith("/") else f"{raw}/"
    return f"{base}internal/handoffs"


def _notes_url() -> str:
    """Monta URL absoluta do endpoint /internal/chatwoot/notes."""
    raw = str(settings.backend_internal_url)
    base = raw if raw.endswith("/") else f"{raw}/"
    return f"{base}internal/chatwoot/notes"


_MOCK_RESPONSE: dict[str, object] = {
    "handoff_id": "hnd-0001-0001-0001-000000000001",
    "chatwoot_conversation_id": "42",
    "assigned_agent_id": "agt-0001-0001-0001-000000000001",
    "status": "requested",
}

_LEAD_ID = "ld-0001-0001-0001-000000000001"
_CONV_ID = "cv-0001-0001-0001-000000000001"
_SIM_ID = "sim-0001-0001-0001-00000000001"


def _make_input(
    *,
    reason: str = "cliente_solicitou_atendente",
    summary: str = "Cliente deseja falar com atendente.",
    simulation_id: str | None = None,
) -> HandoffInput:
    return HandoffInput(
        lead_id=_LEAD_ID,
        conversation_id=_CONV_ID,
        reason=reason,
        summary=summary,
        simulation_id=simulation_id,
    )


# ---------------------------------------------------------------------------
# Criação com sucesso — payload e headers
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_request_handoff_returns_output_on_success() -> None:
    """Deve retornar HandoffOutput populado com dados do backend."""
    url = _handoff_url()
    with respx.mock:
        route = respx.post(url).mock(return_value=httpx.Response(201, json=_MOCK_RESPONSE))
        client = InternalApiClient()
        result = await request_handoff(_make_input(), client=client)

    assert isinstance(result, HandoffOutput)
    assert result.handoff_id == _MOCK_RESPONSE["handoff_id"]
    assert result.chatwoot_conversation_id == _MOCK_RESPONSE["chatwoot_conversation_id"]
    assert result.assigned_agent_id == _MOCK_RESPONSE["assigned_agent_id"]
    assert result.status == "requested"
    assert route.called


@pytest.mark.asyncio()
async def test_request_handoff_sends_internal_token() -> None:
    """Header X-Internal-Token deve estar presente em toda chamada."""
    url = _handoff_url()
    with respx.mock:
        route = respx.post(url).mock(return_value=httpx.Response(201, json=_MOCK_RESPONSE))
        client = InternalApiClient()
        await request_handoff(_make_input(), client=client)

    token = route.calls.last.request.headers.get("x-internal-token")
    assert token == settings.internal_token.get_secret_value()


@pytest.mark.asyncio()
async def test_request_handoff_payload_contains_required_fields() -> None:
    """Payload JSON deve conter lead_id, conversation_id, reason e summary."""
    url = _handoff_url()
    with respx.mock:
        route = respx.post(url).mock(return_value=httpx.Response(201, json=_MOCK_RESPONSE))
        client = InternalApiClient()
        inp = _make_input(reason="cobranca", summary="Cobrança pendente.")
        await request_handoff(inp, client=client)

    import json

    sent_body: dict[str, object] = json.loads(route.calls.last.request.content)
    assert sent_body["lead_id"] == _LEAD_ID
    assert sent_body["conversation_id"] == _CONV_ID
    assert sent_body["reason"] == "cobranca"
    assert sent_body["summary"] == "Cobrança pendente."


# ---------------------------------------------------------------------------
# simulation_id — opcional
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_request_handoff_includes_simulation_id_when_provided() -> None:
    """simulation_id deve aparecer no payload quando fornecido."""
    url = _handoff_url()
    with respx.mock:
        route = respx.post(url).mock(return_value=httpx.Response(201, json=_MOCK_RESPONSE))
        client = InternalApiClient()
        await request_handoff(_make_input(simulation_id=_SIM_ID), client=client)

    import json

    sent_body: dict[str, object] = json.loads(route.calls.last.request.content)
    assert sent_body.get("simulation_id") == _SIM_ID


@pytest.mark.asyncio()
async def test_request_handoff_omits_simulation_id_when_absent() -> None:
    """simulation_id NÃO deve aparecer no payload quando não fornecido."""
    url = _handoff_url()
    with respx.mock:
        route = respx.post(url).mock(return_value=httpx.Response(201, json=_MOCK_RESPONSE))
        client = InternalApiClient()
        await request_handoff(_make_input(simulation_id=None), client=client)

    import json

    sent_body: dict[str, object] = json.loads(route.calls.last.request.content)
    assert "simulation_id" not in sent_body


# ---------------------------------------------------------------------------
# Idempotency-Key — gerado deterministicamente (UUID v5)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_request_handoff_sends_idempotency_key_header() -> None:
    """Idempotency-Key deve estar presente quando gerado internamente."""
    url = _handoff_url()
    with respx.mock:
        route = respx.post(url).mock(return_value=httpx.Response(201, json=_MOCK_RESPONSE))
        client = InternalApiClient()
        await request_handoff(_make_input(), client=client)

    key_header = route.calls.last.request.headers.get("idempotency-key")
    assert key_header is not None
    # Deve ser um UUID válido
    uuid.UUID(key_header)


@pytest.mark.asyncio()
async def test_request_handoff_idempotency_key_is_deterministic() -> None:
    """Mesma (conversation_id, reason) deve gerar o mesmo Idempotency-Key."""
    url = _handoff_url()
    inp = _make_input(reason="reclamacao")

    keys: list[str] = []
    for _ in range(2):
        with respx.mock:
            route = respx.post(url).mock(return_value=httpx.Response(201, json=_MOCK_RESPONSE))
            client = InternalApiClient()
            await request_handoff(inp, client=client)
            keys.append(route.calls.last.request.headers.get("idempotency-key", ""))

    assert keys[0] == keys[1], "Idempotency-Key deve ser determinístico para mesmos inputs"


@pytest.mark.asyncio()
async def test_request_handoff_different_reasons_produce_different_keys() -> None:
    """Reasons diferentes devem produzir Idempotency-Keys diferentes."""
    url = _handoff_url()
    collected_keys: list[str] = []

    for reason in ("cliente_solicitou_atendente", "cobranca"):
        with respx.mock:
            route = respx.post(url).mock(return_value=httpx.Response(201, json=_MOCK_RESPONSE))
            client = InternalApiClient()
            await request_handoff(_make_input(reason=reason), client=client)
            collected_keys.append(route.calls.last.request.headers.get("idempotency-key", ""))

    assert collected_keys[0] != collected_keys[1]


@pytest.mark.asyncio()
async def test_request_handoff_uses_explicit_idempotency_key() -> None:
    """Idempotency-Key explícito deve ser enviado sem modificação."""
    url = _handoff_url()
    explicit_key = "my-explicit-key-abc123"
    with respx.mock:
        route = respx.post(url).mock(return_value=httpx.Response(201, json=_MOCK_RESPONSE))
        client = InternalApiClient()
        await request_handoff(_make_input(), client=client, idempotency_key=explicit_key)

    key_header = route.calls.last.request.headers.get("idempotency-key")
    assert key_header == explicit_key


# ---------------------------------------------------------------------------
# Reenvio idempotente — backend retorna 200 (já existente)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_request_handoff_idempotent_resend_returns_existing() -> None:
    """Reenvio com mesma chave deve retornar o handoff existente (backend 200).

    Simula o comportamento do backend: primeira chamada cria (201),
    segunda chamada com a mesma Idempotency-Key retorna o recurso já
    existente (200) — a tool deve aceitar ambos sem erro.
    """
    url = _handoff_url()
    existing_response = dict(_MOCK_RESPONSE)
    existing_response["status"] = "assigned"

    explicit_key = "idempotent-resend-key-xyz"

    with respx.mock:
        # Primeira chamada — 201 Created
        route = respx.post(url).mock(
            side_effect=[
                httpx.Response(201, json=_MOCK_RESPONSE),
                httpx.Response(200, json=existing_response),
            ]
        )
        client = InternalApiClient()

        result_first = await request_handoff(
            _make_input(), client=client, idempotency_key=explicit_key
        )
        result_second = await request_handoff(
            _make_input(), client=client, idempotency_key=explicit_key
        )

    assert route.call_count == 2
    assert result_first.handoff_id == result_second.handoff_id
    assert result_second.status == "assigned"


# ---------------------------------------------------------------------------
# Propagação de erros — 5xx e timeout
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_request_handoff_raises_on_5xx() -> None:
    """HTTPStatusError deve ser propagado quando o backend retorna 5xx persistente."""
    url = _handoff_url()
    with respx.mock:
        # Dois 5xx esgotam os retries do InternalApiClient (MAX_RETRIES=1)
        respx.post(url).mock(
            side_effect=[
                httpx.Response(500, json={"error": "internal server error"}),
                httpx.Response(500, json={"error": "internal server error"}),
            ]
        )
        client = InternalApiClient()
        with pytest.raises(httpx.HTTPStatusError) as exc_info:
            await request_handoff(_make_input(), client=client)

    assert exc_info.value.response.status_code == 500


@pytest.mark.asyncio()
async def test_request_handoff_raises_on_timeout() -> None:
    """TimeoutException deve ser propagado quando o backend não responde."""
    url = _handoff_url()
    with respx.mock:
        respx.post(url).mock(
            side_effect=httpx.ReadTimeout("timed out", request=None)  # type: ignore[arg-type]
        )
        client = InternalApiClient(timeout=0.001)
        with pytest.raises(httpx.TimeoutException):
            await request_handoff(_make_input(), client=client)


# ===========================================================================
# create_chatwoot_note — testes (doc 06 §7.5)
# ===========================================================================

_CHATWOOT_CONV_ID = "cw-conv-0001"
_NOTE_BODY = "Resumo pré-handoff: cliente solicitou crédito rural."

_MOCK_NOTE_RESPONSE: dict[str, object] = {
    "note_id": "note-0001-0001-0001-000000000001",
}


def _make_note_input(
    *,
    chatwoot_conversation_id: str = _CHATWOOT_CONV_ID,
    body: str = _NOTE_BODY,
) -> ChatwootNoteInput:
    return ChatwootNoteInput(
        chatwoot_conversation_id=chatwoot_conversation_id,
        body=body,
    )


# ---------------------------------------------------------------------------
# Criação com sucesso — payload e headers
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_create_chatwoot_note_returns_output_on_success() -> None:
    """Deve retornar ChatwootNoteOutput populado com note_id do backend."""
    url = _notes_url()
    with respx.mock:
        route = respx.post(url).mock(
            return_value=httpx.Response(201, json=_MOCK_NOTE_RESPONSE)
        )
        client = InternalApiClient()
        result = await create_chatwoot_note(_make_note_input(), client=client)

    assert isinstance(result, ChatwootNoteOutput)
    assert result.note_id == _MOCK_NOTE_RESPONSE["note_id"]
    assert route.called


@pytest.mark.asyncio()
async def test_create_chatwoot_note_sends_internal_token() -> None:
    """Header X-Internal-Token deve estar presente em toda chamada."""
    url = _notes_url()
    with respx.mock:
        route = respx.post(url).mock(
            return_value=httpx.Response(201, json=_MOCK_NOTE_RESPONSE)
        )
        client = InternalApiClient()
        await create_chatwoot_note(_make_note_input(), client=client)

    token = route.calls.last.request.headers.get("x-internal-token")
    assert token == settings.internal_token.get_secret_value()


@pytest.mark.asyncio()
async def test_create_chatwoot_note_payload_contains_required_fields() -> None:
    """Payload JSON deve conter chatwoot_conversation_id, body e type."""
    url = _notes_url()
    with respx.mock:
        route = respx.post(url).mock(
            return_value=httpx.Response(201, json=_MOCK_NOTE_RESPONSE)
        )
        client = InternalApiClient()
        inp = _make_note_input(
            chatwoot_conversation_id="cw-conv-9999",
            body="Nota de teste.",
        )
        await create_chatwoot_note(inp, client=client)

    import json

    sent_body: dict[str, object] = json.loads(route.calls.last.request.content)
    assert sent_body["chatwoot_conversation_id"] == "cw-conv-9999"
    assert sent_body["body"] == "Nota de teste."
    assert sent_body["type"] == "internal"


# ---------------------------------------------------------------------------
# Idempotency-Key — gerado deterministicamente (UUID v5)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_create_chatwoot_note_sends_idempotency_key_header() -> None:
    """Idempotency-Key deve estar presente quando gerado internamente."""
    url = _notes_url()
    with respx.mock:
        route = respx.post(url).mock(
            return_value=httpx.Response(201, json=_MOCK_NOTE_RESPONSE)
        )
        client = InternalApiClient()
        await create_chatwoot_note(_make_note_input(), client=client)

    key_header = route.calls.last.request.headers.get("idempotency-key")
    assert key_header is not None
    # Deve ser um UUID válido
    uuid.UUID(key_header)


@pytest.mark.asyncio()
async def test_create_chatwoot_note_idempotency_key_is_deterministic() -> None:
    """Mesma (chatwoot_conversation_id, body) deve gerar o mesmo Idempotency-Key."""
    url = _notes_url()
    inp = _make_note_input()

    keys: list[str] = []
    for _ in range(2):
        with respx.mock:
            route = respx.post(url).mock(
                return_value=httpx.Response(201, json=_MOCK_NOTE_RESPONSE)
            )
            client = InternalApiClient()
            await create_chatwoot_note(inp, client=client)
            keys.append(route.calls.last.request.headers.get("idempotency-key", ""))

    assert keys[0] == keys[1], "Idempotency-Key deve ser determinístico para mesmos inputs"


@pytest.mark.asyncio()
async def test_create_chatwoot_note_uses_explicit_idempotency_key() -> None:
    """Idempotency-Key explícito deve ser enviado sem modificação."""
    url = _notes_url()
    explicit_key = "note-explicit-key-xyz789"
    with respx.mock:
        route = respx.post(url).mock(
            return_value=httpx.Response(201, json=_MOCK_NOTE_RESPONSE)
        )
        client = InternalApiClient()
        await create_chatwoot_note(
            _make_note_input(), client=client, idempotency_key=explicit_key
        )

    key_header = route.calls.last.request.headers.get("idempotency-key")
    assert key_header == explicit_key


# ---------------------------------------------------------------------------
# Propagação de erros — 5xx e timeout
# ---------------------------------------------------------------------------


@pytest.mark.asyncio()
async def test_create_chatwoot_note_raises_on_5xx() -> None:
    """HTTPStatusError deve ser propagado quando o backend retorna 5xx persistente."""
    url = _notes_url()
    with respx.mock:
        # Dois 5xx esgotam os retries do InternalApiClient (MAX_RETRIES=1)
        respx.post(url).mock(
            side_effect=[
                httpx.Response(500, json={"error": "internal server error"}),
                httpx.Response(500, json={"error": "internal server error"}),
            ]
        )
        client = InternalApiClient()
        with pytest.raises(httpx.HTTPStatusError) as exc_info:
            await create_chatwoot_note(_make_note_input(), client=client)

    assert exc_info.value.response.status_code == 500


@pytest.mark.asyncio()
async def test_create_chatwoot_note_raises_on_timeout() -> None:
    """TimeoutException deve ser propagado quando o backend não responde."""
    url = _notes_url()
    with respx.mock:
        respx.post(url).mock(
            side_effect=httpx.ReadTimeout("timed out", request=None)  # type: ignore[arg-type]
        )
        client = InternalApiClient(timeout=0.001)
        with pytest.raises(httpx.TimeoutException):
            await create_chatwoot_note(_make_note_input(), client=client)
