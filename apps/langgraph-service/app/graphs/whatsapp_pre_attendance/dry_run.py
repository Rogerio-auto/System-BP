"""Fábrica do DryRunInternalApiClient e contexto de execução dry-run.

Usado exclusivamente pelo endpoint ``POST /process/whatsapp/playground`` (F9-S03).

Estratégia de interceptação
----------------------------
Os nós F3 (persist_state, load_state, log_decision etc.) instanciam
``InternalApiClient()`` diretamente em seu corpo. Não podemos alterar esses
nós sem abrir um sub-slot de hardening. A solução sem tocar em F3 é
**monkey-patch de escopo limitado**: durante a execução do grafo, substituímos
temporariamente ``app.tools._base.InternalApiClient`` pela classe stub, usando
``unittest.mock.patch`` como context-manager. Todos os módulos que já importaram
``InternalApiClient`` de ``app.tools._base`` veem a substituição porque Python
resolva o nome no módulo-origem em tempo de execução (não no callsite).

Política de interceptação por método HTTP
------------------------------------------
- ``GET``  → delega ao cliente real **somente** se ``_allow_real_reads=True``
             (operador passou ``lead_id``/``city_id`` — contexto real read-only).
             Caso contrário retorna resposta sintética {"ok": true, "dry_run": true}.
- ``POST``, ``PATCH``, ``PUT``, ``DELETE`` → **nunca** faz I/O. Registra a
             chamada no sink in-memory e retorna resposta sintética válida.
             Inclui ``dry_run: true`` na resposta sintética.

F9-S10 CRÍTICO-2 fix — Stubs centralizados em _PATH_TO_STUB_FACTORY
---------------------------------------------------------------------
O stub anterior retornava um payload genérico para todo POST/PATCH/PUT.
Isso causava ``ValidationError`` nos callers que esperavam campos específicos:

- ``request_handoff`` → valida ``HandoffOutput`` (campos: handoff_id,
  chatwoot_conversation_id, assigned_agent_id, status).
- ``create_chatwoot_note`` → valida ``ChatwootNoteOutput`` (campo: note_id).
- ``get_or_create_lead`` → valida ``GetOrCreateLeadSuccess`` (campos: lead_id,
  customer_id, created, current_stage, city_id, assigned_agent_id).
- demais paths: format mínimo compatível com o consumidor.

A factory centralizada ``_PATH_TO_STUB_FACTORY`` mapeia cada path interno
ao payload correto. Paths não mapeados caem no fallback genérico existente.

LGPD / Segurança
-----------------
- Logs emitidos pelo stub carregam ``dry_run=True`` para rastreabilidade.
- O sink in-memory nunca armazena o corpo da requisição completo (pode conter PII).
  Armazena apenas: método, path, idempotency_key (se presente) e timestamp.
- Nenhuma chamada a Chatwoot ocorre — o stub responde com sintético antes que
  qualquer transport real seja aberto.
"""
from __future__ import annotations

import re
import time
import uuid
from collections.abc import Callable
from contextlib import asynccontextmanager
from typing import Any
from unittest.mock import patch

import structlog

from app.tools._base import InternalApiClient

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)


# ---------------------------------------------------------------------------
# F9-S10 CRÍTICO-2: Factory centralizada de stubs por path
# ---------------------------------------------------------------------------
# Cada factory recebe o request body (dict) e retorna um payload compatível
# com o schema Pydantic que o caller irá validar via model_validate().
#
# Convenção de matching:
#   - Paths exatos têm prioridade sobre padrões de regex.
#   - IDs de recursos (UUIDs, slugs) são normalizados para comparação.
#
# Por que Callable[[dict], dict] em vez de dict estático:
#   Algumas respostas precisam de IDs opacos únicos por chamada (uuid4).
#   A factory é chamada a cada POST — garante IDs distintos se o grafo
#   fizer a mesma chamada múltiplas vezes durante o dry-run.
# ---------------------------------------------------------------------------


def _stub_chatwoot_notes(body: dict[str, Any]) -> dict[str, Any]:
    """Stub para POST /internal/chatwoot/notes → ChatwootNoteOutput."""
    return {
        "note_id": str(uuid.uuid4()),
        "dry_run": True,
    }


def _stub_handoffs(body: dict[str, Any]) -> dict[str, Any]:
    """Stub para POST /internal/handoffs → HandoffOutput.

    F7-S03 item 10: ``chatwoot_conversation_id`` usa uuid4() opaco em vez de
    ``body.get("conversation_id")`` — o body pode conter PII (phone, lead_id)
    e o campo ``conversation_id`` no body é o ID do LangGraph, não do Chatwoot.
    Em produção o backend atribui um ID Chatwoot real; no dry-run usamos um UUID
    sintético para satisfazer o schema ``HandoffOutput`` sem vazar dados do body.
    """
    _ = body  # body não é usado — resposta é sempre sintética
    return {
        "handoff_id": str(uuid.uuid4()),
        "chatwoot_conversation_id": str(uuid.uuid4()),
        "assigned_agent_id": None,
        "status": "requested",  # HandoffOutput.status is Literal["requested"]
        "dry_run": True,
    }


def _stub_leads_get_or_create(body: dict[str, Any]) -> dict[str, Any]:
    """Stub para POST /internal/leads/get-or-create → GetOrCreateLeadSuccess."""
    return {
        "ok": True,
        "lead_id": str(uuid.uuid4()),
        "customer_id": None,
        "created": True,
        "current_stage": "pre_attendance",
        "city_id": None,
        "assigned_agent_id": None,
        "dry_run": True,
    }


def _stub_leads_patch(body: dict[str, Any]) -> dict[str, Any]:
    """Stub para PATCH /internal/leads/:id/profile → UpdateLeadProfileSuccess."""
    return {
        "ok": True,
        "lead_id": body.get("lead_id", str(uuid.uuid4())),
        "current_stage": None,
        "city_id": body.get("city_id"),
        "name": None,
        "dry_run": True,
    }


def _stub_simulations(body: dict[str, Any]) -> dict[str, Any]:
    """Stub para POST /internal/simulations → GenerateCreditSimulationOutput (ok=True)."""
    return {
        "ok": True,
        "simulation_id": str(uuid.uuid4()),
        "installment": "462.50",
        "total": "5550.00",
        "interest": "550.00",
        "rate": "0.025000",
        "rule_version": "dry-run-v1",
        "dry_run": True,
    }


def _stub_ai_decisions(body: dict[str, Any]) -> dict[str, Any]:
    """Stub para POST /internal/ai/decisions → LogAiDecisionOutput."""
    return {
        "decision_log_id": str(uuid.uuid4()),
        "dry_run": True,
    }


def _stub_conversation_state(body: dict[str, Any]) -> dict[str, Any]:
    """Stub para POST/PUT /internal/conversations/:id/state → idempotente."""
    return {
        "ok": True,
        "dry_run": True,
    }


def _stub_customers_credit_analyses(body: dict[str, Any]) -> dict[str, Any]:
    """Stub para GET /internal/customers/:id/credit-analyses → AnalysisHistoryOutput.

    F4-S04: Tool get_credit_analysis_history usa GET, portanto este stub é
    relevante apenas quando _allow_real_reads=False (modo 100% sintético).

    Retorna payload compatível com AnalysisHistoryOutput:
      - lead_id: UUID sintético opaco.
      - items: lista com 1 análise em curso (status=em_analise, version=1).

    Justificativa de retornar 1 item (não vazio):
      O dry-run deve exercitar o caminho de código do grafo com análise existente.
      Retornar vazio seria menos informativo para quem testa o playground.
    """
    _ = body  # GET não tem body — argumento presente por contrato da factory
    return {
        "lead_id": str(uuid.uuid4()),
        "items": [
            {
                "analysis_id": str(uuid.uuid4()),
                "status": "em_analise",
                "current_version_number": 1,
                "created_at": "2026-05-01T08:00:00.000Z",
                "updated_at": "2026-05-01T08:00:00.000Z",
            }
        ],
        "dry_run": True,
    }


def _stub_cities_identify(body: dict[str, Any]) -> dict[str, Any]:
    """Stub para POST /internal/cities/identify.

    Tool consumidor: ``identify_city`` em ``app/tools/city_tools.py`` faz
    ``IdentifyCityResult.model_validate(raw)`` — exige ``matched: bool`` e
    ``confidence: float``. Sem isso vira 2 ValidationErrors → 422 no playground.

    Estratégia no dry-run sintético: o operador apenas digita texto livre, sem
    contexto pra saber se é nome de cidade. Retornamos ``matched=False`` +
    ``alternatives=[]`` — o grafo cai em fluxo de pedir confirmação ou
    out-of-service, o que é mais informativo que erro silencioso para quem
    está testando.
    """
    _ = body  # body de input não influencia a resposta sintética
    return {
        "city_id": None,
        "city_name": None,
        "matched": False,
        "confidence": 0.0,
        "out_of_service": False,
        "alternatives": [],
        "dry_run": True,
    }


def _stub_simulations_sent(body: dict[str, Any]) -> dict[str, Any]:
    """Stub para POST /internal/simulations/:id/sent → MarkSimulationSentOutput."""
    return {
        "ok": True,
        "dry_run": True,
    }


# ---------------------------------------------------------------------------
# Mapas canônicos de path → factory de stub (F9-S11: separados por método)
# ---------------------------------------------------------------------------
# Separar GET de WRITE é necessário porque alguns paths têm semânticas
# completamente diferentes dependendo do método HTTP:
#
#   GET  /internal/conversations/:id/state  → {"state": {}, "dry_run": True}
#   POST /internal/conversations/:id/state  → {"ok": True,  "dry_run": True}
#   PUT  /internal/conversations/:id/state  → {"ok": True,  "dry_run": True}
#
# Usar um único mapa compartilhado fazia _synthetic_get_response capturar o
# factory de POST/PUT e retornar {"ok", dry_run} para GET — shape errado para
# o nó load_state (que valida a chave "state"). Regressão introduzida em F7-S03.
#
# Ordem importa: padrões mais específicos devem vir antes dos mais genéricos.

# Paths exclusivos de GET → cada factory retorna o payload esperado pelo caller.
_GET_STUB_FACTORY: dict[re.Pattern[str], Callable[[dict[str, Any]], dict[str, Any]]] = {
    # F4-S04: GET /internal/customers/:id/credit-analyses → AnalysisHistoryOutput.
    re.compile(r"^/internal/customers/[^/]+/credit-analyses$"): _stub_customers_credit_analyses,
}

# Paths de escrita (POST / PUT / PATCH / DELETE) → cada factory retorna o
# payload esperado pelo caller (schema Pydantic do nó correspondente).
_WRITE_STUB_FACTORY: dict[re.Pattern[str], Callable[[dict[str, Any]], dict[str, Any]]] = {
    re.compile(r"^/internal/chatwoot/notes$"): _stub_chatwoot_notes,
    re.compile(r"^/internal/handoffs$"): _stub_handoffs,
    re.compile(r"^/internal/leads/get-or-create$"): _stub_leads_get_or_create,
    re.compile(r"^/internal/leads/[^/]+/profile$"): _stub_leads_patch,
    re.compile(r"^/internal/leads/[^/]+$"): _stub_leads_patch,
    re.compile(r"^/internal/cities/identify$"): _stub_cities_identify,
    re.compile(r"^/internal/simulations/[^/]+/sent$"): _stub_simulations_sent,
    re.compile(r"^/internal/simulations$"): _stub_simulations,
    re.compile(r"^/internal/ai/decisions$"): _stub_ai_decisions,
    # POST/PUT /internal/conversations/:id/state → idempotente (ok + dry_run).
    # GET no mesmo path NÃO está aqui — cai no fallback {"state": {}, "dry_run": True}
    # em _synthetic_get_response, que é o contrato esperado pelo nó load_state.
    re.compile(r"^/internal/conversations/[^/]+/state$"): _stub_conversation_state,
    # F4-S04: também aceita POST/PUT de credit-analyses (improvável, mas seguro).
    re.compile(r"^/internal/customers/[^/]+/credit-analyses$"): _stub_customers_credit_analyses,
}

# Alias de retrocompatibilidade — código externo que possa referenciar o nome
# antigo continua funcionando; aponta para o mapa de escrita (comportamento
# original para mutações).
_PATH_TO_STUB_FACTORY = _WRITE_STUB_FACTORY

# ---------------------------------------------------------------------------
# Entrada do sink de chamadas interceptadas (para compor o trace)
# ---------------------------------------------------------------------------


class _InterceptedCall:
    """Registro imutável de uma chamada interceptada durante dry-run.

    Armazenamos apenas os dados que NÃO são PII: método, path, chave de
    idempotência (opaca) e timestamp monotônico. O corpo JSON NÃO é armazenado.
    """

    __slots__ = ("idempotency_key", "method", "path", "timestamp_ms")

    def __init__(self, method: str, path: str, idempotency_key: str | None) -> None:
        self.method = method
        self.path = path
        self.idempotency_key = idempotency_key
        # Timestamp relativo ao início do processo (não epoch — evita PII temporal)
        self.timestamp_ms: int = int(time.monotonic() * 1_000)

    def to_trace_entry(self) -> dict[str, Any]:
        """Converte para dict compatível com o campo ``trace`` do PlaygroundResponse."""
        entry: dict[str, Any] = {
            "node": "dry_run_sink",
            "dry_run": True,
            "intercepted_method": self.method,
            "intercepted_path": self.path,
        }
        if self.idempotency_key is not None:
            entry["idempotency_key"] = self.idempotency_key
        return entry


# ---------------------------------------------------------------------------
# Cliente stub
# ---------------------------------------------------------------------------


class DryRunInternalApiClient(InternalApiClient):
    """Substituto de InternalApiClient para execução dry-run do grafo.

    Compartilha o sink com o contexto de execução via instância de ``_DryRunContext``.
    Não deve ser instanciado fora do context-manager ``dry_run_context()``.
    """

    def __init__(
        self,
        sink: list[_InterceptedCall],
        allow_real_reads: bool = False,
        *,
        timeout: float = 8.0,
    ) -> None:
        # Não chama super().__init__() — não precisa montar base_url real.
        # Guardamos apenas o que o stub precisa.
        self._sink = sink
        self._allow_real_reads = allow_real_reads
        # Guarda timeout para compatibilidade, mas sem conexão real em mutações.
        self._timeout = timeout

    # ------------------------------------------------------------------
    # Interface pública (espelha InternalApiClient)
    # ------------------------------------------------------------------

    async def get(
        self,
        path: str,
        *,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """GET: delega ao cliente real se reads reais permitidos; caso contrário sintético."""
        self._record("GET", path, idempotency_key=None)

        if self._allow_real_reads:
            log.debug(
                "dry_run_get_delegating",
                path=path,
                dry_run=True,
            )
            # Instancia o cliente real (não o stub) para fazer a leitura.
            real_client = InternalApiClient.__new__(InternalApiClient)
            InternalApiClient.__init__(real_client, self._timeout)
            return await real_client.get(path, params=params)

        log.debug("dry_run_get_synthetic", path=path, dry_run=True)
        return self._synthetic_get_response(path)

    async def post(
        self,
        path: str,
        json: dict[str, Any],
        *,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """POST: nunca faz I/O — registra no sink e retorna sintético."""
        self._record("POST", path, idempotency_key=idempotency_key)
        log.info(
            "dry_run_post_intercepted",
            path=path,
            idempotency_key=idempotency_key,
            dry_run=True,
        )
        return self._synthetic_write_response(path, json)

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        """Intercepta chamadas diretas a _request (ex.: PUT do persist_state)."""
        method_upper = method.upper()
        idempotency_key: str | None = None
        if extra_headers:
            idempotency_key = extra_headers.get("Idempotency-Key")

        self._record(method_upper, path, idempotency_key=idempotency_key)
        log.info(
            "dry_run_request_intercepted",
            method=method_upper,
            path=path,
            dry_run=True,
        )

        if method_upper == "GET" and self._allow_real_reads:
            real_client = InternalApiClient.__new__(InternalApiClient)
            InternalApiClient.__init__(real_client, self._timeout)
            return await real_client._request(
                method, path, json=json, params=params, extra_headers=extra_headers
            )

        if method_upper == "GET":
            return self._synthetic_get_response(path)

        return self._synthetic_write_response(path, json or {})

    # ------------------------------------------------------------------
    # Helpers internos
    # ------------------------------------------------------------------

    def _record(self, method: str, path: str, *, idempotency_key: str | None) -> None:
        """Registra a chamada no sink sem armazenar PII (corpo JSON omitido)."""
        self._sink.append(_InterceptedCall(method, path, idempotency_key))

    @staticmethod
    def _synthetic_get_response(path: str) -> dict[str, Any]:
        """Resposta sintética para GET.

        Consulta _GET_STUB_FACTORY para retornar payload compatível com o
        schema esperado pelo caller. Isso garante que tools GET (como
        get_credit_analysis_history — F4-S04) recebam respostas válidas no dry-run.

        Deliberadamente NÃO consulta _WRITE_STUB_FACTORY: paths como
        /internal/conversations/:id/state têm semântica diferente em GET
        (retorna estado salvo) vs POST/PUT (confirma persistência).
        Usar o factory de escrita causava o bug F9-S11: GET retornava
        {"ok", dry_run} em vez de {"state", dry_run}, rejeitado pelo load_state.

        Fallback: estado vazio (equivale a "conversa nova") — compatível com
        load_state que espera {"state": {}, ...}.
        """
        # Verificar se há factory específica para este path GET.
        # A factory recebe {} como body (GET não tem body).
        for pattern, factory in _GET_STUB_FACTORY.items():
            if pattern.search(path):
                return factory({})

        # Fallback: load_state e outros GET genéricos retornam estado vazio.
        # persist_state nunca chama GET — load_state sim.
        # Retornar estado vazio equivale a "conversa nova" no dry-run.
        return {"state": {}, "dry_run": True}

    def _synthetic_write_response(
        self, path: str, body: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """Resposta sintética para POST/PUT/PATCH — usa factory por path (F9-S10).

        Procura o path no ``_WRITE_STUB_FACTORY`` canônico. Se encontrado,
        delega à factory correspondente que retorna um payload compatível com
        o schema Pydantic esperado pelo caller.

        Para paths não mapeados, retorna um payload genérico suficientemente
        compatível com a maioria dos consumidores (fallback de segurança).
        """
        body = body or {}
        for pattern, factory in _WRITE_STUB_FACTORY.items():
            if pattern.search(path):
                return factory(body)

        # Fallback genérico: nenhum path mapeado na factory.
        # Mantém compatibilidade com nós que não validam o corpo da resposta.
        synthetic_id = str(uuid.uuid4())
        return {
            "id": synthetic_id,
            "decision_log_id": synthetic_id,
            "simulation_id": synthetic_id,
            "handoff_id": synthetic_id,
            "status": "ok",
            "dry_run": True,
        }


# ---------------------------------------------------------------------------
# Context-manager de execução dry-run
# ---------------------------------------------------------------------------


@asynccontextmanager
async def dry_run_context(
    *,
    allow_real_reads: bool = False,
) -> Any:
    """Context-manager que ativa o modo dry-run para o grafo.

    Substitui ``InternalApiClient`` pelo ``DryRunInternalApiClient`` em todos
    os módulos que o importam de ``app.tools._base``. Também substitui a
    referência no módulo ``app.tools.audit_tools`` (usado por log_decision) e
    nos módulos de nós F3 que importam diretamente.

    Yields:
        ``list[_InterceptedCall]`` — sink de chamadas interceptadas, preenchido
        durante a execução do grafo. Pode ser consultado após ``ainvoke()``.

    Exemplo::

        async with dry_run_context(allow_real_reads=False) as sink:
            compiled = build_graph().compile()
            final_state = await compiled.ainvoke(initial_state)
        trace_entries = [c.to_trace_entry() for c in sink]
    """
    sink: list[_InterceptedCall] = []

    # Fábrica: cada nó que instancia InternalApiClient() receberá o stub.
    def _stub_factory(*args: Any, **kwargs: Any) -> DryRunInternalApiClient:
        return DryRunInternalApiClient(
            sink=sink,
            allow_real_reads=allow_real_reads,
        )

    # Módulos que instanciam InternalApiClient diretamente:
    # - app.tools._base (importado por todos os nós via InternalApiClient())
    # - app.tools.audit_tools (log_ai_decision cria seu próprio cliente)
    # - nós individuais que importam de app.tools._base
    #
    # IMPORTANTE: ``from app.tools._base import InternalApiClient`` cria um binding
    # LOCAL no namespace de cada módulo importador. O Python NÃO consulta o módulo-
    # origem em tempo de execução para esses bindings locais — a referência já foi
    # copiada no momento do import. Portanto, patchear apenas ``app.tools._base``
    # NÃO afeta módulos que fizeram ``from ... import InternalApiClient``.
    #
    # Cada módulo que faz esse import precisa ser patchado individualmente em seu
    # próprio namespace. Os alvos abaixo cobrem TODOS os módulos que executam
    # ``InternalApiClient()`` dentro do caminho de execução do grafo.
    #
    # Confirmado via: grep -r "from app.tools._base import InternalApiClient" app/
    patch_targets = [
        # Módulo-origem (garante que qualquer import futuro também use o stub)
        "app.tools._base.InternalApiClient",
        # Tools que criam InternalApiClient() localmente — bindings independentes
        "app.tools.audit_tools.InternalApiClient",
        "app.tools.leads_tools.InternalApiClient",
        "app.tools.simulation_tools.InternalApiClient",
        "app.tools.chatwoot_tools.InternalApiClient",
        "app.tools.city_tools.InternalApiClient",
        # F4-S04: tool get_credit_analysis_history — binding independente
        "app.tools.analysis_tools.InternalApiClient",
        # Nós do grafo que criam InternalApiClient() localmente
        "app.graphs.whatsapp_pre_attendance.nodes.load_state.InternalApiClient",
        "app.graphs.whatsapp_pre_attendance.nodes.persist_state.InternalApiClient",
        "app.graphs.whatsapp_pre_attendance.nodes.request_handoff.InternalApiClient",
    ]

    patches = [patch(target, side_effect=_stub_factory) for target in patch_targets]

    for p in patches:
        p.start()

    try:
        yield sink
    finally:
        for p in reversed(patches):
            p.stop()


__all__ = [
    "DryRunInternalApiClient",
    "dry_run_context",
]
