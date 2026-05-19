"""Testes conversacionais ponta-a-ponta para o grafo whatsapp_pre_attendance.

Runner pytest que carrega 5 fixtures YAML de ``tests/fixtures/conversations/``,
executa o grafo com LLM determinístico (mockado) e backend mockado via respx,
e verifica as asserções descritas em cada fixture.

Referência: doc 06 §10.2 — testes conversacionais.
Cada fixture cobre um cenário diferente do funil de pré-atendimento:

  01 — Fluxo feliz completo: saudação → cidade → valor/prazo → simulação → end
  02 — Cidade com baixa confiança → confirmação solicitada
  03 — Intenção falar_atendente → handoff direto
  04 — nao_entendi 3x -> handoff por esgotamento
  05 — Cidade fora de área atendida (out_of_service)

Estratégia de mock:
- LLMs (classify_intent, qualify_credit_interest, generate_simulation/compose_reply)
  são substituídos via ``unittest.mock.patch`` por AsyncMock determinístico.
- Backend HTTP é interceptado por ``respx`` com as respostas definidas no YAML.
- Nenhuma chamada real de rede ocorre em CI.

LGPD: nenhum dado real de pessoa física nas fixtures (todos sintéticos).
"""
from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import httpx
import pytest
import respx

from app.config import settings
from app.graphs.whatsapp_pre_attendance.graph import build_graph
from app.graphs.whatsapp_pre_attendance.state import ConversationState
from app.llm.gateway import LLMResponse, TokenUsage

# ---------------------------------------------------------------------------
# Localização das fixtures
# ---------------------------------------------------------------------------

_FIXTURES_DIR = Path(__file__).parent / "fixtures" / "conversations"

# ---------------------------------------------------------------------------
# Helpers para carregamento de YAML
# ---------------------------------------------------------------------------


def _load_yaml(path: Path) -> dict[str, Any]:
    """Carrega um arquivo YAML em dict."""
    import yaml  # type: ignore[import-untyped]

    with path.open(encoding="utf-8") as fh:
        data: dict[str, Any] = yaml.safe_load(fh)
    return data


# ---------------------------------------------------------------------------
# Helpers para construção do estado inicial
# ---------------------------------------------------------------------------


def _build_initial_state(raw: dict[str, Any]) -> ConversationState:
    """Converte o dict lido do YAML num ConversationState válido."""
    for list_field in ("missing_fields", "messages", "tool_results", "errors", "actions_emitted"):
        if raw.get(list_field) is None:
            raw[list_field] = []
    return raw  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Backend URL helper
# ---------------------------------------------------------------------------


def _base_url() -> str:
    """URL base do backend sem trailing slash."""
    return str(settings.backend_internal_url).rstrip("/")


# ---------------------------------------------------------------------------
# Montagem de mocks respx a partir das backend_mocks do YAML
# ---------------------------------------------------------------------------


def _register_backend_mocks(
    router: respx.MockRouter,
    backend_mocks: dict[str, Any],
    base: str,
    initial_state: dict[str, Any],
) -> None:
    """Registra as rotas no router respx baseadas nas backend_mocks do YAML.

    Args:
        router: Router respx onde as rotas serão registradas.
        backend_mocks: Dict de mocks extraído do YAML.
        base: URL base sem trailing slash.
        initial_state: Estado inicial — usado para interpolação de IDs.
    """
    conversation_id: str = initial_state.get("conversation_id", "")

    def _mock(method: str, url: str, status: int, body: dict[str, Any]) -> None:
        resp = httpx.Response(
            status,
            json=body,
            headers={"content-type": "application/json"},
        )
        if method == "GET":
            router.get(url).mock(return_value=resp)
        elif method == "POST":
            router.post(url).mock(return_value=resp)
        elif method == "PUT":
            router.put(url).mock(return_value=resp)
        elif method == "PATCH":
            router.patch(url).mock(return_value=resp)

    # --- load_state (GET /internal/conversations/:id/state) ---
    load_cfg = backend_mocks.get("load_state", {})
    _mock(
        "GET",
        f"{base}/internal/conversations/{conversation_id}/state",
        int(load_cfg.get("status", 404)),
        load_cfg.get("body", {}) or {},
    )

    # --- persist_state (PUT /internal/conversations/:id/state) ---
    persist_cfg = backend_mocks.get("persist_state", {})
    _mock(
        "PUT",
        f"{base}/internal/conversations/{conversation_id}/state",
        int(persist_cfg.get("status", 200)),
        {},
    )

    # --- get_or_create_lead (POST /internal/leads/get-or-create) ---
    lead_cfg = backend_mocks.get("get_or_create_lead")
    if lead_cfg:
        _mock(
            "POST",
            f"{base}/internal/leads/get-or-create",
            int(lead_cfg.get("status", 200)),
            lead_cfg.get("body", {}),
        )

    # --- identify_city (POST /internal/cities/identify) ---
    city_cfg = backend_mocks.get("identify_city")
    if city_cfg:
        _mock(
            "POST",
            f"{base}/internal/cities/identify",
            int(city_cfg.get("status", 200)),
            city_cfg.get("body", {}),
        )

    # --- update_lead_profile (PATCH /internal/leads/:id) ---
    update_cfg = backend_mocks.get("update_lead_profile")
    if update_cfg:
        # Use url__regex to match any lead_id in the URL path
        router.patch(url__regex=rf"{base}/internal/leads/[^/]+$").mock(
            return_value=httpx.Response(
                int(update_cfg.get("status", 200)),
                json=update_cfg.get("body", {}),
                headers={"content-type": "application/json"},
            )
        )

    # --- list_credit_products (GET /internal/credit-products) ---
    products_cfg = backend_mocks.get("list_credit_products")
    if products_cfg:
        _mock(
            "GET",
            f"{base}/internal/credit-products",
            int(products_cfg.get("status", 200)),
            products_cfg.get("body", {}),
        )

    # --- generate_credit_simulation (POST /internal/simulations) ---
    sim_cfg = backend_mocks.get("generate_credit_simulation")
    if sim_cfg:
        _mock(
            "POST",
            f"{base}/internal/simulations",
            int(sim_cfg.get("status", 200)),
            sim_cfg.get("body", {}),
        )

    # --- mark_simulation_sent (POST /internal/simulations/:id/sent) ---
    mark_cfg = backend_mocks.get("save_simulation")
    if mark_cfg:
        router.post(
            url__regex=rf"{base}/internal/simulations/[^/]+/sent"
        ).mock(
            return_value=httpx.Response(
                int(mark_cfg.get("status", 200)),
                json=mark_cfg.get("body", {}),
                headers={"content-type": "application/json"},
            )
        )

    # --- request_handoff (POST /internal/handoffs) ---
    handoff_cfg = backend_mocks.get("request_handoff")
    if handoff_cfg:
        _mock(
            "POST",
            f"{base}/internal/handoffs",
            int(handoff_cfg.get("status", 200)),
            handoff_cfg.get("body", {}),
        )

    # --- create_chatwoot_note (POST /internal/chatwoot/notes) ---
    note_cfg = backend_mocks.get("create_chatwoot_note")
    if note_cfg:
        _mock(
            "POST",
            f"{base}/internal/chatwoot/notes",
            int(note_cfg.get("status", 200)),
            note_cfg.get("body", {}),
        )

    # --- log_ai_decision (POST /internal/ai/decisions) ---
    log_cfg = backend_mocks.get("log_ai_decision")
    if log_cfg:
        _mock(
            "POST",
            f"{base}/internal/ai/decisions",
            int(log_cfg.get("status", 200)),
            log_cfg.get("body", {}),
        )


# ---------------------------------------------------------------------------
# Fábrica de mock de gateway LLM
# ---------------------------------------------------------------------------


def _make_llm_mock(
    llm_mocks: dict[str, Any],
    llm_sequence_mocks: dict[str, list[str]] | None = None,
) -> MagicMock:
    """Cria mock do LLM gateway retornando respostas determinísticas por nó.

    Suporta dois modos:
    - ``llm_mocks``: resposta fixa por nó (mesmo conteúdo em todas as chamadas).
    - ``llm_sequence_mocks``: lista de respostas em ordem por nó (uma por chamada).
      Quando a lista se esgota, repete a última resposta.

    O gateway é chamado pelos nós classify_intent, qualify_credit_interest e
    generate_simulation (composição de resposta). Cada nó passa ``metadata``
    com ``node`` para identificar qual mock usar.

    Args:
        llm_mocks: Dict extraído do YAML com resposta fixa por nó.
        llm_sequence_mocks: Dict extraído do YAML com lista de respostas por nó.

    Returns:
        MagicMock com ``.complete`` como função assíncrona determinística.
    """
    # Contadores de chamadas por nó (para sequence_mocks)
    call_counters: dict[str, int] = {}

    async def _complete(
        *,
        model: str,
        messages: list[dict[str, Any]],
        metadata: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> LLMResponse:
        node_name: str = (metadata or {}).get("node", "")

        # Tenta sequence_mocks primeiro
        if llm_sequence_mocks and node_name in llm_sequence_mocks:
            sequence: list[str] = llm_sequence_mocks[node_name]
            idx = call_counters.get(node_name, 0)
            content = sequence[min(idx, len(sequence) - 1)]
            call_counters[node_name] = idx + 1
        else:
            content = llm_mocks.get(node_name, "nao_entendi")

        # Sentinel especial: simula falha irrecuperável do LLM (esgotamento)
        if content == "RAISE_EXCEPTION":
            raise RuntimeError("LLM simulado falhou por esgotamento (fixture)")

        return LLMResponse(
            content=content,
            model=model,
            usage=TokenUsage(prompt_tokens=30, completion_tokens=10, total_tokens=40),
            latency_ms=50.0,
            finish_reason="stop",
        )

    gw = MagicMock()
    gw.complete = _complete  # type: ignore[method-assign]
    return gw


# ---------------------------------------------------------------------------
# Executor de fixture
# ---------------------------------------------------------------------------

_GATEWAY_PATCH_TARGETS = [
    "app.graphs.whatsapp_pre_attendance.nodes.classify_intent.get_gateway",
    "app.graphs.whatsapp_pre_attendance.nodes.qualify_credit_interest.get_gateway",
    "app.graphs.whatsapp_pre_attendance.nodes.generate_simulation.get_gateway",
]


async def _run_fixture(fixture_path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    """Carrega fixture, executa o grafo e retorna (estado_final, assertions).

    Args:
        fixture_path: Caminho para o arquivo YAML da fixture.

    Returns:
        Tupla ``(final_state_dict, assertions_dict)`` para validação pelo teste.
    """
    fixture: dict[str, Any] = _load_yaml(fixture_path)
    initial_raw: dict[str, Any] = dict(fixture["initial_state"])
    initial_state = _build_initial_state(initial_raw)
    llm_mocks: dict[str, Any] = fixture.get("llm_mocks", {})
    llm_sequence_mocks: dict[str, list[str]] | None = fixture.get("llm_sequence_mocks")
    backend_mocks: dict[str, Any] = fixture.get("backend_mocks", {})
    assertions: dict[str, Any] = fixture.get("assertions", {})

    base = _base_url()
    gw_mock = _make_llm_mock(llm_mocks, llm_sequence_mocks)
    compiled = build_graph().compile()

    # Aplica patches do gateway LLM
    patchers = [patch(target, return_value=gw_mock) for target in _GATEWAY_PATCH_TARGETS]
    for p in patchers:
        p.start()

    try:
        with respx.mock(assert_all_called=False) as router:
            _register_backend_mocks(router, backend_mocks, base, initial_raw)
            result: dict[str, Any] = await compiled.ainvoke(initial_state)  # type: ignore[arg-type]
    finally:
        for p in patchers:
            p.stop()

    return result, assertions


# ---------------------------------------------------------------------------
# Funções de asserção
# ---------------------------------------------------------------------------


def _assert_fixture_result(
    final_state: dict[str, Any],
    assertions: dict[str, Any],
    fixture_id: str,
) -> None:
    """Executa todas as asserções definidas na fixture sobre o estado final.

    Args:
        final_state: Estado retornado pelo grafo após execução.
        assertions: Dict de asserções lidas do YAML.
        fixture_id: ID da fixture para mensagens de erro legíveis.
    """
    ctx = f"[fixture={fixture_id}]"

    # handoff_required
    if "handoff_required" in assertions:
        expected: bool = bool(assertions["handoff_required"])
        actual: bool = bool(final_state.get("handoff_required", False))
        assert actual == expected, (
            f"{ctx} handoff_required esperado={expected}, obtido={actual}"
        )

    # current_stage
    if "current_stage" in assertions:
        expected_stage: str | None = assertions["current_stage"]
        actual_stage: str | None = final_state.get("current_stage")
        assert actual_stage == expected_stage, (
            f"{ctx} current_stage esperado={expected_stage!r}, obtido={actual_stage!r}"
        )

    # last_simulation_id_present
    if "last_simulation_id_present" in assertions:
        expect_present: bool = bool(assertions["last_simulation_id_present"])
        sim_id = final_state.get("last_simulation_id")
        if expect_present:
            assert sim_id is not None, (
                f"{ctx} last_simulation_id esperado presente, mas é None"
            )
        else:
            assert sim_id is None, (
                f"{ctx} last_simulation_id esperado None, mas é {sim_id!r}"
            )

    # simulation_id (valor exato)
    if "simulation_id" in assertions:
        expected_sim: str = str(assertions["simulation_id"])
        actual_sim: str | None = final_state.get("last_simulation_id")
        assert actual_sim == expected_sim, (
            f"{ctx} simulation_id esperado={expected_sim!r}, obtido={actual_sim!r}"
        )

    # city_id_null
    if "city_id_null" in assertions:
        expect_null: bool = bool(assertions["city_id_null"])
        cid = final_state.get("city_id")
        if expect_null:
            assert cid is None, f"{ctx} city_id esperado None, mas é {cid!r}"
        else:
            assert cid is not None, f"{ctx} city_id esperado presente, mas é None"

    # handoff_reason_contains
    if "handoff_reason_contains" in assertions:
        needle: str = str(assertions["handoff_reason_contains"])
        reason: str | None = final_state.get("handoff_reason")
        assert reason is not None, f"{ctx} handoff_reason é None; esperava conter {needle!r}"
        assert needle in reason, (
            f"{ctx} handoff_reason={reason!r} não contém {needle!r}"
        )

    # actions_contains_simulation_generated
    if assertions.get("actions_contains_simulation_generated"):
        actions: list[dict[str, Any]] = final_state.get("actions_emitted") or []
        sim_actions = [a for a in actions if a.get("action") == "simulation_generated"]
        assert len(sim_actions) >= 1, (
            f"{ctx} actions_emitted não contém 'simulation_generated'. "
            f"Ações encontradas: {[a.get('action') for a in actions]}"
        )

    # messages_contain_confirmation: mensagem de confirmação de cidade (baixa confiança)
    if assertions.get("messages_contain_confirmation"):
        messages: list[dict[str, Any]] = final_state.get("messages") or []
        assistant_msgs = [m["content"] for m in messages if m.get("role") == "assistant"]
        found = any(
            "cidade" in m.lower() or "reconheci" in m.lower() or "quis dizer" in m.lower()
            for m in assistant_msgs
        )
        assert found, (
            f"{ctx} Mensagem de confirmação de cidade não encontrada em messages. "
            f"Mensagens de assistente: {assistant_msgs}"
        )

    # messages_contain_out_of_service: mensagem de cidade fora de área
    if assertions.get("messages_contain_out_of_service"):
        messages = final_state.get("messages") or []
        assistant_msgs = [m["content"] for m in messages if m.get("role") == "assistant"]
        found = any(
            "banco do povo" in m.lower() or "não atende" in m.lower() or "fora" in m.lower()
            for m in assistant_msgs
        )
        assert found, (
            f"{ctx} Mensagem de out_of_service não encontrada em messages. "
            f"Mensagens de assistente: {assistant_msgs}"
        )


# ---------------------------------------------------------------------------
# Testes parametrizados por fixture
# ---------------------------------------------------------------------------


_FIXTURE_FILES = sorted(_FIXTURES_DIR.glob("*.yaml"))


@pytest.mark.parametrize(
    "fixture_path",
    _FIXTURE_FILES,
    ids=[p.stem for p in _FIXTURE_FILES],
)
async def test_conversational_fixture(fixture_path: Path) -> None:
    """Executa uma fixture conversacional ponta-a-ponta no grafo.

    Carrega o YAML, monta o estado inicial, executa o grafo com LLM e backend
    mockados e valida as asserções definidas na fixture.
    """
    final_state, assertions = await _run_fixture(fixture_path)
    fixture_id: str = fixture_path.stem
    _assert_fixture_result(final_state, assertions, fixture_id)


# ---------------------------------------------------------------------------
# Testes individuais nomeados (um por cenário — documentação + debug claro)
# ---------------------------------------------------------------------------


class TestFixture01HappyPathFull:
    """Fixture 01 — fluxo feliz completo: simulação gerada, handoff_required=False."""

    async def test_happy_path_no_handoff(self) -> None:
        """Fluxo feliz: handoff_required deve ser False ao final."""
        path = _FIXTURES_DIR / "01_happy_path_full.yaml"
        final_state, _ = await _run_fixture(path)
        assert final_state.get("handoff_required") is False

    async def test_happy_path_simulation_id_present(self) -> None:
        """Fluxo feliz: last_simulation_id deve ser gerado."""
        path = _FIXTURES_DIR / "01_happy_path_full.yaml"
        final_state, _ = await _run_fixture(path)
        assert final_state.get("last_simulation_id") == "sim-fixture-001"

    async def test_happy_path_simulation_action_emitted(self) -> None:
        """Fluxo feliz: actions_emitted deve conter simulation_generated."""
        path = _FIXTURES_DIR / "01_happy_path_full.yaml"
        final_state, _ = await _run_fixture(path)
        actions: list[dict[str, Any]] = final_state.get("actions_emitted") or []
        sim_actions = [a for a in actions if a.get("action") == "simulation_generated"]
        assert len(sim_actions) >= 1

    async def test_happy_path_city_identified(self) -> None:
        """Fluxo feliz: city_id deve ser preenchido com Porto Velho."""
        path = _FIXTURES_DIR / "01_happy_path_full.yaml"
        final_state, _ = await _run_fixture(path)
        assert final_state.get("city_id") == "city-fixture-pv"


class TestFixture02CityLowConfidence:
    """Fixture 02 — cidade com baixa confiança: pergunta de confirmação, sem simulação."""

    async def test_city_id_remains_null(self) -> None:
        """Confiança baixa: city_id deve permanecer None."""
        path = _FIXTURES_DIR / "02_city_low_confidence.yaml"
        final_state, _ = await _run_fixture(path)
        assert final_state.get("city_id") is None

    async def test_no_handoff_triggered(self) -> None:
        """Confiança baixa: não deve disparar handoff humano."""
        path = _FIXTURES_DIR / "02_city_low_confidence.yaml"
        final_state, _ = await _run_fixture(path)
        assert final_state.get("handoff_required") is False

    async def test_confirmation_message_in_messages(self) -> None:
        """Confiança baixa: mensagem de confirmação deve aparecer em messages."""
        path = _FIXTURES_DIR / "02_city_low_confidence.yaml"
        final_state, _ = await _run_fixture(path)
        msgs: list[dict[str, Any]] = final_state.get("messages") or []
        assistant_msgs = [m["content"] for m in msgs if m.get("role") == "assistant"]
        found = any(
            "cidade" in m.lower() or "reconheci" in m.lower() or "quis dizer" in m.lower()
            for m in assistant_msgs
        )
        assert found, f"Mensagem de confirmação ausente. Mensagens: {assistant_msgs}"

    async def test_no_simulation_generated(self) -> None:
        """Confiança baixa: nenhuma simulação deve ser gerada."""
        path = _FIXTURES_DIR / "02_city_low_confidence.yaml"
        final_state, _ = await _run_fixture(path)
        assert final_state.get("last_simulation_id") is None


class TestFixture03DirectHandoffRequest:
    """Fixture 03 — cliente pede atendente: handoff imediato, sem funil de crédito."""

    async def test_handoff_required_true(self) -> None:
        """Pedido de atendente: handoff_required deve ser True."""
        path = _FIXTURES_DIR / "03_direct_handoff_request.yaml"
        final_state, _ = await _run_fixture(path)
        assert final_state.get("handoff_required") is True

    async def test_current_stage_is_handoff_requested(self) -> None:
        """Pedido de atendente: current_stage deve ser handoff_requested."""
        path = _FIXTURES_DIR / "03_direct_handoff_request.yaml"
        final_state, _ = await _run_fixture(path)
        assert final_state.get("current_stage") == "handoff_requested"

    async def test_handoff_reason_contains_intent(self) -> None:
        """Pedido de atendente: handoff_reason deve conter a intenção."""
        path = _FIXTURES_DIR / "03_direct_handoff_request.yaml"
        final_state, _ = await _run_fixture(path)
        reason: str | None = final_state.get("handoff_reason")
        assert reason is not None
        assert "falar_atendente" in reason

    async def test_no_simulation_generated(self) -> None:
        """Pedido de atendente: sem simulação gerada."""
        path = _FIXTURES_DIR / "03_direct_handoff_request.yaml"
        final_state, _ = await _run_fixture(path)
        assert final_state.get("last_simulation_id") is None


class TestFixture04ExhaustionHandoff:
    """Fixture 04 — esgotamento por falha de LLM após simulação: handoff executado.

    Cenário: cliente solicita simulação (1ª intenção), simulação é gerada com
    sucesso, decide_next_step retorna "continue". Na 2ª tentativa de classificação,
    o LLM falha (simulando exaustão). classify_intent captura a exceção e
    define handoff_required=True. O grafo executa o caminho de handoff.
    """

    async def test_handoff_required_after_llm_exhaustion(self) -> None:
        """Esgotamento: handoff_required deve ser True após falha do LLM."""
        path = _FIXTURES_DIR / "04_exhaustion_handoff.yaml"
        final_state, _ = await _run_fixture(path)
        assert final_state.get("handoff_required") is True

    async def test_current_stage_is_handoff_requested(self) -> None:
        """Esgotamento: current_stage deve ser handoff_requested."""
        path = _FIXTURES_DIR / "04_exhaustion_handoff.yaml"
        final_state, _ = await _run_fixture(path)
        assert final_state.get("current_stage") == "handoff_requested"

    async def test_simulation_was_generated_before_exhaustion(self) -> None:
        """Esgotamento: simulação foi gerada com sucesso antes do handoff."""
        path = _FIXTURES_DIR / "04_exhaustion_handoff.yaml"
        final_state, _ = await _run_fixture(path)
        assert final_state.get("last_simulation_id") == "sim-fixture-004"


class TestFixture05OutOfServiceCity:
    """Fixture 05 — cidade fora de área atendida: mensagem amigável, sem handoff humano."""

    async def test_no_human_handoff(self) -> None:
        """Out-of-service: não deve disparar handoff humano."""
        path = _FIXTURES_DIR / "05_out_of_service_city.yaml"
        final_state, _ = await _run_fixture(path)
        assert final_state.get("handoff_required") is False

    async def test_city_id_remains_null(self) -> None:
        """Out-of-service: city_id deve permanecer None."""
        path = _FIXTURES_DIR / "05_out_of_service_city.yaml"
        final_state, _ = await _run_fixture(path)
        assert final_state.get("city_id") is None

    async def test_out_of_service_message_in_messages(self) -> None:
        """Out-of-service: mensagem de cidade não atendida deve aparecer."""
        path = _FIXTURES_DIR / "05_out_of_service_city.yaml"
        final_state, _ = await _run_fixture(path)
        msgs: list[dict[str, Any]] = final_state.get("messages") or []
        assistant_msgs = [m["content"] for m in msgs if m.get("role") == "assistant"]
        found = any(
            "banco do povo" in m.lower() or "não atende" in m.lower() or "fora" in m.lower()
            for m in assistant_msgs
        )
        assert found, f"Mensagem out_of_service ausente. Mensagens: {assistant_msgs}"

    async def test_no_simulation_generated(self) -> None:
        """Out-of-service: sem simulação gerada."""
        path = _FIXTURES_DIR / "05_out_of_service_city.yaml"
        final_state, _ = await _run_fixture(path)
        assert final_state.get("last_simulation_id") is None
