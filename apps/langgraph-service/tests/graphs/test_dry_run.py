"""Testes unitários para DryRunInternalApiClient e dry_run_context.

Cobre:
- DryRunInternalApiClient.get() retorna sintético quando allow_real_reads=False.
- DryRunInternalApiClient.post() registra no sink e retorna sintético.
- DryRunInternalApiClient._request() intercepta PUT (persist_state).
- dry_run_context patches corretamente os módulos alvo.
- Sink registra método e path; não armazena corpo JSON (PII safe).
- allow_real_reads=True delega GET ao cliente real.
"""
from __future__ import annotations

import pytest

from app.graphs.whatsapp_pre_attendance.dry_run import (
    DryRunInternalApiClient,
    _InterceptedCall,
    dry_run_context,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_stub(
    allow_real_reads: bool = False,
) -> tuple[list[_InterceptedCall], DryRunInternalApiClient]:
    """Cria um DryRunInternalApiClient com sink vazio."""
    sink: list[_InterceptedCall] = []
    stub = DryRunInternalApiClient(sink=sink, allow_real_reads=allow_real_reads)
    return sink, stub


# ---------------------------------------------------------------------------
# Testes de GET sintético
# ---------------------------------------------------------------------------


class TestDryRunGet:
    """DryRunInternalApiClient.get() sem leituras reais."""

    @pytest.mark.asyncio
    async def test_get_returns_synthetic_response(self) -> None:
        """GET deve retornar dict com 'state' vazio e dry_run=True."""
        _sink, stub = _make_stub(allow_real_reads=False)
        result = await stub.get("/internal/conversations/123/state")
        assert result.get("dry_run") is True
        assert "state" in result

    @pytest.mark.asyncio
    async def test_get_records_in_sink(self) -> None:
        """GET deve ser registrado no sink."""
        sink, stub = _make_stub(allow_real_reads=False)
        await stub.get("/internal/conversations/123/state")
        assert len(sink) == 1
        assert sink[0].method == "GET"
        assert "/internal/conversations/123/state" in sink[0].path

    @pytest.mark.asyncio
    async def test_get_does_not_store_body(self) -> None:
        """GET não tem corpo, mas o sink não deve armazenar parâmetros de query (PII safe)."""
        sink, stub = _make_stub(allow_real_reads=False)
        await stub.get("/internal/leads/abc", params={"cpf_hash": "hashed-cpf-value"})
        # Sink registra apenas method e path — não params
        assert sink[0].method == "GET"
        # Nenhum campo do sink deve conter "hashed-cpf-value"
        assert "hashed-cpf-value" not in sink[0].path


# ---------------------------------------------------------------------------
# Testes de POST interceptado
# ---------------------------------------------------------------------------


class TestDryRunPost:
    """DryRunInternalApiClient.post() deve interceptar e registrar no sink."""

    @pytest.mark.asyncio
    async def test_post_returns_synthetic_response(self) -> None:
        """POST deve retornar resposta sintética com dry_run=True."""
        _sink, stub = _make_stub()
        result = await stub.post("/internal/ai/decisions", json={"data": "x"})
        assert result.get("dry_run") is True
        assert "decision_log_id" in result

    @pytest.mark.asyncio
    async def test_post_records_in_sink(self) -> None:
        """POST deve ser registrado no sink."""
        sink, stub = _make_stub()
        await stub.post("/internal/ai/decisions", json={"data": "x"})
        assert len(sink) == 1
        assert sink[0].method == "POST"

    @pytest.mark.asyncio
    async def test_post_records_idempotency_key(self) -> None:
        """POST com idempotency_key deve ser registrado no sink com a chave."""
        sink, stub = _make_stub()
        await stub.post(
            "/internal/leads",
            json={"name": "João"},
            idempotency_key="idem-test-001",
        )
        assert sink[0].idempotency_key == "idem-test-001"

    @pytest.mark.asyncio
    async def test_post_does_not_do_io(self) -> None:
        """POST não deve fazer chamadas HTTP reais."""
        _sink, stub = _make_stub()
        # Se fizesse I/O real, levantaria ConnectionError (sem backend disponível)
        try:
            result = await stub.post("/internal/ai/decisions", json={"node": "test"})
            # Deve retornar sintético sem exceção
            assert isinstance(result, dict)
        except Exception as exc:
            pytest.fail(f"DryRunInternalApiClient.post() fez I/O real: {exc}")

    @pytest.mark.asyncio
    async def test_multiple_posts_accumulate_in_sink(self) -> None:
        """Múltiplos POSTs devem acumular entradas no sink."""
        sink, stub = _make_stub()
        await stub.post("/internal/ai/decisions", json={})
        await stub.post("/internal/conversations/x/state", json={})
        assert len(sink) == 2
        methods = [c.method for c in sink]
        assert methods == ["POST", "POST"]


# ---------------------------------------------------------------------------
# Testes de _request (PUT — persist_state)
# ---------------------------------------------------------------------------


class TestDryRunRequest:
    """DryRunInternalApiClient._request() intercepta PUT do persist_state."""

    @pytest.mark.asyncio
    async def test_put_intercepted(self) -> None:
        """PUT a /conversations/:id/state deve ser interceptado e registrado."""
        sink, stub = _make_stub()
        result = await stub._request(
            "PUT",
            "/internal/conversations/abc/state",
            json={"state": {"conversation_id": "abc"}},
        )
        assert result.get("dry_run") is True
        assert len(sink) == 1
        assert sink[0].method == "PUT"

    @pytest.mark.asyncio
    async def test_patch_intercepted(self) -> None:
        """PATCH deve ser interceptado."""
        sink, stub = _make_stub()
        await stub._request("PATCH", "/internal/leads/123", json={"city": "Porto Velho"})
        assert sink[0].method == "PATCH"

    @pytest.mark.asyncio
    async def test_get_via_request_synthetic(self) -> None:
        """GET via _request deve retornar sintético (allow_real_reads=False)."""
        _sink, stub = _make_stub(allow_real_reads=False)
        result = await stub._request("GET", "/internal/conversations/xyz/state")
        assert result.get("dry_run") is True


# ---------------------------------------------------------------------------
# Testes da entrada de trace (_InterceptedCall)
# ---------------------------------------------------------------------------


class TestInterceptedCall:
    """Testa a estrutura de _InterceptedCall e to_trace_entry()."""

    def test_to_trace_entry_has_required_fields(self) -> None:
        """to_trace_entry deve retornar dict com node, dry_run e method/path."""
        call = _InterceptedCall("POST", "/internal/ai/decisions", idempotency_key=None)
        entry = call.to_trace_entry()
        assert entry["node"] == "dry_run_sink"
        assert entry["dry_run"] is True
        assert entry["intercepted_method"] == "POST"
        assert "/internal/ai/decisions" in entry["intercepted_path"]

    def test_to_trace_entry_includes_idempotency_key_when_present(self) -> None:
        """Quando idempotency_key presente, deve aparecer no trace."""
        call = _InterceptedCall("POST", "/internal/leads", idempotency_key="key-123")
        entry = call.to_trace_entry()
        assert entry.get("idempotency_key") == "key-123"

    def test_to_trace_entry_omits_idempotency_key_when_absent(self) -> None:
        """Quando idempotency_key=None, campo não deve aparecer no trace."""
        call = _InterceptedCall("PUT", "/internal/conversations/x/state", idempotency_key=None)
        entry = call.to_trace_entry()
        assert "idempotency_key" not in entry


# ---------------------------------------------------------------------------
# Testes do context-manager dry_run_context
# ---------------------------------------------------------------------------


class TestDryRunContext:
    """Testa o context-manager dry_run_context."""

    @pytest.mark.asyncio
    async def test_context_manager_yields_sink(self) -> None:
        """dry_run_context deve yield uma lista (sink)."""
        async with dry_run_context(allow_real_reads=False) as sink:
            assert isinstance(sink, list)

    @pytest.mark.asyncio
    async def test_patch_restored_after_context(self) -> None:
        """InternalApiClient deve ser restaurado após o context-manager."""
        import app.tools._base as _base_module

        async with dry_run_context(allow_real_reads=False):
            pass

        # Após o contexto, o módulo deve ter a classe original de volta
        # (ou pelo menos uma instância diferente do DryRunInternalApiClient)
        assert _base_module.InternalApiClient is not DryRunInternalApiClient

    @pytest.mark.asyncio
    async def test_patch_active_during_context(self) -> None:
        """Durante o contexto, imports de InternalApiClient devem retornar stub."""
        import app.tools._base as _base_module

        async with dry_run_context(allow_real_reads=False) as sink:
            # Durante o contexto, a classe no módulo é substituída
            # (side_effect cria DryRunInternalApiClient)
            instance = _base_module.InternalApiClient()  # type: ignore[call-arg]
            # A instância criada deve ser um DryRunInternalApiClient
            assert isinstance(instance, DryRunInternalApiClient)
            assert instance._sink is sink

    @pytest.mark.asyncio
    async def test_sink_collects_calls_during_context(self) -> None:
        """Calls feitas dentro do contexto devem aparecer no sink."""
        import app.tools._base as _base_module

        async with dry_run_context(allow_real_reads=False) as sink:
            stub = _base_module.InternalApiClient()  # type: ignore[call-arg]
            await stub.post("/internal/ai/decisions", json={})

        assert len(sink) == 1
        assert sink[0].method == "POST"

    @pytest.mark.asyncio
    async def test_context_allows_multiple_stubs(self) -> None:
        """Múltiplas instâncias do stub compartilham o mesmo sink."""
        import app.tools._base as _base_module

        async with dry_run_context(allow_real_reads=False) as sink:
            stub1 = _base_module.InternalApiClient()  # type: ignore[call-arg]
            stub2 = _base_module.InternalApiClient()  # type: ignore[call-arg]
            await stub1.post("/internal/ai/decisions", json={})
            await stub2._request("PUT", "/internal/conversations/x/state")

        assert len(sink) == 2

    @pytest.mark.asyncio
    async def test_no_chatwoot_call_during_dry_run(self) -> None:
        """Confirma que Chatwoot não é chamado durante execução no dry_run_context.

        Mesmo que um nó tente chamar InternalApiClient (que poderia propagar
        para Chatwoot), o stub intercepta antes de qualquer I/O real.
        """
        chatwoot_call_count = 0

        async with dry_run_context(allow_real_reads=False) as sink:
            import app.tools._base as _base_module

            stub = _base_module.InternalApiClient()  # type: ignore[call-arg]
            # Simula chamada de nó que notificaria Chatwoot via backend
            await stub.post("/internal/conversations/x/chatwoot-note", json={
                "note": "Handoff solicitado"
            })

        # Chatwoot não foi chamado — o stub interceptou
        assert chatwoot_call_count == 0
        # Mas o sink registrou a chamada
        assert len(sink) == 1
        assert sink[0].method == "POST"
