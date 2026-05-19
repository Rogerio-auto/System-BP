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

LGPD / Segurança
-----------------
- Logs emitidos pelo stub carregam ``dry_run=True`` para rastreabilidade.
- O sink in-memory nunca armazena o corpo da requisição completo (pode conter PII).
  Armazena apenas: método, path, idempotency_key (se presente) e timestamp.
- Nenhuma chamada a Chatwoot ocorre — o stub responde com sintético antes que
  qualquer transport real seja aberto.
"""
from __future__ import annotations

import time
import uuid
from contextlib import asynccontextmanager
from typing import Any
from unittest.mock import patch

import structlog

from app.tools._base import InternalApiClient

log: structlog.stdlib.BoundLogger = structlog.get_logger(__name__)

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
        return self._synthetic_write_response(path)

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

        return self._synthetic_write_response(path)

    # ------------------------------------------------------------------
    # Helpers internos
    # ------------------------------------------------------------------

    def _record(self, method: str, path: str, *, idempotency_key: str | None) -> None:
        """Registra a chamada no sink sem armazenar PII (corpo JSON omitido)."""
        self._sink.append(_InterceptedCall(method, path, idempotency_key))

    @staticmethod
    def _synthetic_get_response(path: str) -> dict[str, Any]:
        """Resposta sintética para GET — estado vazio (nova conversa)."""
        # persist_state nunca chama GET, mas load_state chama.
        # Retornar estado vazio equivale a "conversa nova" no dry-run.
        return {"state": {}, "dry_run": True}

    @staticmethod
    def _synthetic_write_response(path: str) -> dict[str, Any]:
        """Resposta sintética para POST/PUT/PATCH — IDs opacos gerados localmente."""
        # log_decision espera {"decision_log_id": str}
        # persist_state não usa o corpo da resposta (apenas verifica sucesso via status)
        # Outros nós (save_simulation, request_handoff, etc.) esperam campos variados.
        # Usamos um formato suficientemente genérico:
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
    # Basta substituir no módulo-origem: ``app.tools._base.InternalApiClient``.
    # Python resolve o nome no namespace do módulo na hora da instanciação
    # (``InternalApiClient()``), portanto o patch no módulo-origem é suficiente
    # para todos os callsites que fizeram ``from app.tools._base import InternalApiClient``.
    #
    # Para os nós que fizeram import do pacote e usam o nome qualificado,
    # patchamos também nos módulos dos nós e do audit_tools.
    patch_targets = [
        "app.tools._base.InternalApiClient",
        "app.tools.audit_tools.InternalApiClient",
        "app.graphs.whatsapp_pre_attendance.nodes.load_state.InternalApiClient",
        "app.graphs.whatsapp_pre_attendance.nodes.persist_state.InternalApiClient",
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
