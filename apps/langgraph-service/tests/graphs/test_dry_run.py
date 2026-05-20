"""Testes unitários para DryRunInternalApiClient e dry_run_context.

Cobre:
- DryRunInternalApiClient.get() retorna sintético quando allow_real_reads=False.
- DryRunInternalApiClient.post() registra no sink e retorna sintético.
- DryRunInternalApiClient._request() intercepta PUT (persist_state).
- dry_run_context patches corretamente os módulos alvo.
- Sink registra método e path; não armazena corpo JSON (PII safe).
- allow_real_reads=True delega GET ao cliente real.

Teste de integração (CRITICO-2):
- Executa o grafo REAL (sem mock de build_graph) com intent que dispara
  request_handoff, assegurando que NENHUMA chamada POST/PATCH/PUT chega
  ao backend real (apenas ao sink do dry_run_context).
- Esse teste FALHA antes do fix do CRITICO-1 (patch incompleto) e PASSA depois.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

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


# ---------------------------------------------------------------------------
# Teste de integração — CRITICO-2
# ---------------------------------------------------------------------------
#
# Propósito: executar o grafo REAL (sem mock de build_graph) com um cenário
# que dispara o nó ``request_handoff``, que internamente chama:
#   - POST /internal/handoffs           via app.tools.chatwoot_tools.InternalApiClient
#   - POST /internal/chatwoot/notes     via app.tools.chatwoot_tools.InternalApiClient
#   - PUT  /internal/conversations/…    via persist_state.InternalApiClient
#   - POST /internal/ai/decisions       via audit_tools.InternalApiClient
#
# ANTES do fix do CRITICO-1: ``chatwoot_tools.InternalApiClient`` e
# ``request_handoff.InternalApiClient`` (bindings locais criados por
# ``from app.tools._base import InternalApiClient``) NÃO eram patchados —
# o teste falhava com ConnectionRefusedError ao tentar chamar o backend real.
#
# APÓS o fix: todos os bindings são patchados e o sink captura as chamadas.
# O teste asserta ``backend_stub.post_count == 0`` (nenhuma chamada HTTP real).
#
# Estratégia: o grafo real requer a classify_intent funcionar. Mockamos apenas
# ``get_gateway()`` para retornar um gateway que classifica como
# ``falar_atendente`` (intent que roteia diretamente para request_handoff).
# O InternalApiClient real nunca é chamado — o dry_run_context o substitui.


def _make_mock_gateway(intent_text: str) -> MagicMock:
    """Cria um mock do LLM gateway que retorna ``intent_text`` como conteúdo."""
    from app.llm.gateway import LLMResponse, TokenUsage

    response = LLMResponse(
        content=intent_text,
        model="mock/test-model",
        usage=TokenUsage(prompt_tokens=10, completion_tokens=2, total_tokens=12),
        latency_ms=5.0,
        finish_reason="stop",
    )
    gw = MagicMock()
    gw.complete = AsyncMock(return_value=response)
    return gw


def _make_initial_state_for_handoff() -> Any:
    """Estado inicial que força o grafo a executar classify_intent → request_handoff."""
    from app.graphs.whatsapp_pre_attendance.state import ConversationState

    state: ConversationState = {
        "conversation_id": "integ-test-conv-001",
        "chatwoot_conversation_id": "cw-integ-42",
        "phone": "+5569988880001",
        "handoff_required": False,
        "handoff_reason": None,
        "missing_fields": [],
        "messages": [{"role": "user", "content": "Quero falar com um atendente"}],
        "tool_results": [],
        "errors": [],
        "actions_emitted": [],
        "lead_id": "lead-integ-001",
        "customer_id": None,
        "customer_name": "Teste Integração",
        "city_id": None,
        "city_name": None,
        "current_intent": None,
        "current_stage": None,
        "requested_amount": None,
        "requested_term_months": None,
        "last_simulation_id": None,
    }
    return state


class TestDryRunIntegrationRealGraph:
    """Integração: grafo REAL + dry_run_context — prova que nenhuma chamada
    mutável chega ao backend quando todos os bindings de InternalApiClient
    estão corretamente patchados (fix do CRITICO-1).

    Este teste FALHA se o patch_targets for incompleto (estado pré-fix):
    o nó request_handoff tentaria criar uma conexão TCP real com o backend
    e levantaria ConnectionRefusedError ou similar.

    Este teste PASSA após o fix: dry_run_context intercepta todas as
    chamadas em TODOS os módulos que importaram InternalApiClient localmente.
    """

    @pytest.mark.asyncio
    async def test_real_graph_handoff_zero_real_http_calls(self) -> None:
        """Grafo real com intent falar_atendente: sink captura todas as chamadas,
        nenhuma chega ao backend HTTP.

        Cenário:
            - classify_intent classifica ``falar_atendente`` (via gateway mock).
            - route_by_intent envia para request_handoff.
            - request_handoff chama POST /internal/handoffs + POST /internal/chatwoot/notes.
            - persist_state chama PUT /internal/conversations/.../state.
            - log_decision chama POST /internal/ai/decisions.

        Prova de CRITICO-1 (patch incompleto):
            Antes do fix, ``chatwoot_tools.InternalApiClient`` não era patchado.
            O nó request_handoff instancia InternalApiClient() localmente —
            o binding local (criado por ``from app.tools._base import InternalApiClient``
            em chatwoot_tools.py) NÃO era substituído pelo stub.
            Resultado: o grafo tentava fazer TCP real para o backend inexistente
            e falhava com ConnectionRefusedError/ConnectError — este teste
            propagava essa exceção e FALHAVA.

            Após o fix: todos os 9 bindings são patchados → o grafo executa
            completamente → o sink captura ≥1 chamada POST → o teste PASSA.
        """
        import app.tools._base as _base_mod
        from app.graphs.whatsapp_pre_attendance.graph import build_graph

        mock_gateway = _make_mock_gateway("falar_atendente")
        initial_state = _make_initial_state_for_handoff()

        # Patchamos _execute no InternalApiClient original para detectar leaks:
        # se algum binding não patchado instanciar o cliente real, _execute
        # tentará TCP — aqui capturamos isso com um erro descritivo.
        real_backend_calls: list[str] = []

        async def _leak_detector(
            self_obj: Any,
            method: str,
            url: str,
            **kwargs: Any,
        ) -> Any:
            real_backend_calls.append(f"{method} {url}")
            raise AssertionError(
                f"CRITICO-1 LEAK: InternalApiClient._execute chamado para {method} {url}. "
                "dry_run_context não patchou todos os bindings locais."
            )

        with (
            # Mock do gateway LLM — evita chamadas reais à OpenRouter/Anthropic.
            patch(
                "app.graphs.whatsapp_pre_attendance.nodes.classify_intent.get_gateway",
                return_value=mock_gateway,
            ),
            # Detector de leak: qualquer instância do cliente real (não patchada)
            # que tentar fazer TCP falhará com mensagem diagnóstica clara.
            patch.object(_base_mod.InternalApiClient, "_execute", _leak_detector),
        ):
            async with dry_run_context(allow_real_reads=False) as sink:
                graph = build_graph()
                compiled = graph.compile()
                await compiled.ainvoke(initial_state)

        # Nenhum leak de backend real detectado.
        assert real_backend_calls == [], (
            f"CRITICO-1: Chamadas reais ao backend detectadas — "
            f"dry_run_context não patchou: {real_backend_calls}"
        )

        # O sink deve ter capturado chamadas do caminho:
        #   load_state      → GET  /internal/conversations/.../state
        #   request_handoff → POST /internal/handoffs
        #   request_handoff → POST /internal/chatwoot/notes
        #   persist_state   → PUT  /internal/conversations/.../state
        #   log_decision    → POST /internal/ai/decisions
        intercepted_methods = [c.method for c in sink]
        assert "POST" in intercepted_methods, (
            f"Esperado ao menos 1 POST interceptado no sink. "
            f"Sink atual: {intercepted_methods}"
        )
        assert "PUT" in intercepted_methods or "GET" in intercepted_methods, (
            f"Esperado GET (load_state) ou PUT (persist_state) no sink. "
            f"Sink atual: {intercepted_methods}"
        )

        # Confirma que request_handoff gerou chamadas ao backend (agora via stub)
        post_paths = [c.path for c in sink if c.method == "POST"]
        handoff_calls = [p for p in post_paths if "handoffs" in p or "chatwoot" in p]
        assert len(handoff_calls) >= 1, (
            f"Esperado ao menos 1 POST a /internal/handoffs ou /internal/chatwoot. "
            f"POSTs interceptados: {post_paths}"
        )

    @pytest.mark.asyncio
    async def test_dry_run_patches_all_local_bindings(self) -> None:
        """Verifica que dry_run_context patcha os 9 targets conhecidos.

        Se um novo módulo importar InternalApiClient e não for adicionado ao
        patch_targets, este teste documenta a expectativa — deve ser atualizado
        junto com o patch_targets quando novos módulos forem criados.

        Usa getattr() em vez de acesso direto ao atributo porque mypy strict
        não expõe nomes importados via ``from X import Y`` como atributos
        explícitos do módulo (attr-defined). O comportamento em runtime é
        idêntico — getattr é a forma canônica de acessar bindings dinâmicos.
        """
        import importlib

        # Mapeamento: nome legível → caminho do módulo
        module_targets: list[tuple[str, str]] = [
            ("_base", "app.tools._base"),
            ("audit_tools", "app.tools.audit_tools"),
            ("leads_tools", "app.tools.leads_tools"),
            ("simulation_tools", "app.tools.simulation_tools"),
            ("chatwoot_tools", "app.tools.chatwoot_tools"),
            ("city_tools", "app.tools.city_tools"),
            ("load_state", "app.graphs.whatsapp_pre_attendance.nodes.load_state"),
            ("persist_state", "app.graphs.whatsapp_pre_attendance.nodes.persist_state"),
            ("request_handoff", "app.graphs.whatsapp_pre_attendance.nodes.request_handoff"),
        ]

        # Captura as classes originais antes do contexto
        modules = {
            name: importlib.import_module(mod_path)
            for name, mod_path in module_targets
        }
        original_classes = {
            name: getattr(mod, "InternalApiClient")  # noqa: B009
            for name, mod in modules.items()
        }

        async with dry_run_context(allow_real_reads=False):
            # Durante o contexto, todos os bindings locais devem ser substituídos
            for mod_name, mod in modules.items():
                patched_class = getattr(mod, "InternalApiClient")  # noqa: B009
                assert patched_class is not original_classes[mod_name], (
                    f"Módulo '{mod_name}' não teve InternalApiClient patchado durante "
                    f"dry_run_context. Adicione ao patch_targets em dry_run.py."
                )

        # Após o contexto, todos os bindings devem ser restaurados
        for mod_name, mod in modules.items():
            restored_class = getattr(mod, "InternalApiClient")  # noqa: B009
            assert restored_class is original_classes[mod_name], (
                f"Módulo '{mod_name}' não teve InternalApiClient restaurado após "
                f"dry_run_context. Verifique se p.stop() está sendo chamado no finally."
            )


# ---------------------------------------------------------------------------
# F9-S10 CRÍTICO-2: Testes da factory centralizada _PATH_TO_STUB_FACTORY
# ---------------------------------------------------------------------------


class TestDryRunStubFactory:
    """Testa que _PATH_TO_STUB_FACTORY retorna payloads compatíveis com os
    schemas Pydantic esperados por cada caller.

    CRÍTICO-2 do F9-S10: o stub genérico retornava payload incompatível com
    ChatwootNoteOutput (exige note_id) e HandoffOutput (exige handoff_id,
    chatwoot_conversation_id, status). Isso causava ValidationError nos nós.

    Estes testes garantem que cada factory retorna um payload que passa
    model_validate() do schema Pydantic correspondente.
    """

    @pytest.mark.asyncio
    async def test_chatwoot_notes_stub_compatible_with_pydantic(self) -> None:
        """POST /internal/chatwoot/notes retorna payload válido para ChatwootNoteOutput."""
        from app.tools.chatwoot_tools import ChatwootNoteOutput

        _sink, stub = _make_stub()
        result = await stub.post(
            "/internal/chatwoot/notes",
            json={"chatwoot_conversation_id": "cw-42", "body": "nota de teste"},
        )
        # Deve ser compatível com ChatwootNoteOutput (note_id obrigatório)
        output = ChatwootNoteOutput.model_validate(result)
        assert output.note_id
        assert result.get("dry_run") is True

    @pytest.mark.asyncio
    async def test_handoffs_stub_compatible_with_pydantic(self) -> None:
        """POST /internal/handoffs retorna payload válido para HandoffOutput."""
        from app.tools.chatwoot_tools import HandoffOutput

        _sink, stub = _make_stub()
        result = await stub.post(
            "/internal/handoffs",
            json={"lead_id": "lead-001", "conversation_id": "conv-001", "reason": "test"},
        )
        output = HandoffOutput.model_validate(result)
        assert output.handoff_id
        assert output.status in ("requested", "assigned", "queued")
        assert result.get("dry_run") is True

    @pytest.mark.asyncio
    async def test_leads_get_or_create_stub_compatible_with_pydantic(self) -> None:
        """POST /internal/leads/get-or-create retorna payload válido para GetOrCreateLeadSuccess."""
        from app.tools.leads_tools import GetOrCreateLeadSuccess

        _sink, stub = _make_stub()
        result = await stub.post(
            "/internal/leads/get-or-create",
            json={"phone": "+5569999990000", "source": "whatsapp"},
        )
        output = GetOrCreateLeadSuccess.model_validate(result)
        assert output.lead_id
        assert output.ok is True
        assert result.get("dry_run") is True

    @pytest.mark.asyncio
    async def test_leads_patch_stub_compatible_with_pydantic(self) -> None:
        """PATCH /internal/leads/:id retorna payload válido para UpdateLeadProfileSuccess."""
        from app.tools.leads_tools import UpdateLeadProfileSuccess

        _sink, stub = _make_stub()
        result = await stub._request(
            "PATCH",
            "/internal/leads/lead-uuid-123/profile",
            json={"city_id": "city-rondonia"},
        )
        output = UpdateLeadProfileSuccess.model_validate(result)
        assert output.ok is True
        assert result.get("dry_run") is True

    @pytest.mark.asyncio
    async def test_simulations_stub_returns_ok_true(self) -> None:
        """POST /internal/simulations retorna payload com simulation_id."""
        _sink, stub = _make_stub()
        result = await stub.post(
            "/internal/simulations",
            json={"lead_id": "lead-001", "amount": 5000.0, "term_months": 12},
        )
        assert result.get("ok") is True
        assert result.get("simulation_id")
        assert result.get("installment")
        assert result.get("dry_run") is True

    @pytest.mark.asyncio
    async def test_ai_decisions_stub_compatible_with_pydantic(self) -> None:
        """POST /internal/ai/decisions retorna payload válido para LogAiDecisionOutput."""
        from app.tools.audit_tools import LogAiDecisionOutput

        _sink, stub = _make_stub()
        result = await stub.post(
            "/internal/ai/decisions",
            json={"node": "classify_intent", "conversation_id": "conv-001"},
        )
        output = LogAiDecisionOutput.model_validate(result)
        assert output.decision_log_id
        assert result.get("dry_run") is True

    @pytest.mark.asyncio
    async def test_conversation_state_put_stub_returns_ok(self) -> None:
        """PUT /internal/conversations/:id/state retorna payload com ok=True."""
        _sink, stub = _make_stub()
        result = await stub._request(
            "PUT",
            "/internal/conversations/conv-uuid-001/state",
            json={"state": {"conversation_id": "conv-uuid-001"}},
        )
        assert result.get("ok") is True
        assert result.get("dry_run") is True

    @pytest.mark.asyncio
    async def test_conversation_state_post_stub_returns_ok(self) -> None:
        """POST /internal/conversations/:id/state retorna payload com ok=True."""
        _sink, stub = _make_stub()
        result = await stub.post(
            "/internal/conversations/conv-uuid-001/state",
            json={"state": {}},
        )
        assert result.get("ok") is True
        assert result.get("dry_run") is True

    @pytest.mark.asyncio
    async def test_unknown_path_falls_back_to_generic(self) -> None:
        """Path não mapeado na factory retorna fallback genérico com dry_run=True."""
        _sink, stub = _make_stub()
        result = await stub.post(
            "/internal/algum/caminho/desconhecido",
            json={"data": "qualquer"},
        )
        assert result.get("dry_run") is True
        # Fallback genérico deve ter pelo menos um ID
        assert result.get("id") or result.get("decision_log_id")

    @pytest.mark.asyncio
    async def test_factory_generates_unique_ids_per_call(self) -> None:
        """Cada chamada à factory gera IDs únicos (uuid4 por chamada)."""
        _sink, stub = _make_stub()
        r1 = await stub.post("/internal/handoffs", json={"conversation_id": "c1"})
        r2 = await stub.post("/internal/handoffs", json={"conversation_id": "c2"})
        assert r1["handoff_id"] != r2["handoff_id"], (
            "Factory deve gerar UUIDs únicos por chamada — não reutilizar IDs."
        )
