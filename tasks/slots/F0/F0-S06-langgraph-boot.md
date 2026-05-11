---
id: F0-S06
title: LangGraph service — boot + health + cliente HTTP base
phase: F0
task_ref: T0.6
status: in-progress
priority: high
estimated_size: S
agent_id: python-engineer
claimed_at: 2026-05-11T00:00:00Z
completed_at: null
pr_url: null
depends_on: [F0-S01]
blocks: [F3-S01]
source_docs:
  - docs/12-tasks-tecnicas.md#T0.6
  - apps/langgraph-service/app/main.py
---

# F0-S06 — LangGraph service boot + cliente HTTP base

## Objetivo
`uvicorn app.main:app` sobe na 8000, `/health` responde 200 com check do backend, e existe um cliente HTTP base (`app/tools/_base.py`) pronto para tools futuras consumirem.

## Escopo
- `app/tools/_base.py` com classe `InternalApiClient` que:
  - Lê `BACKEND_INTERNAL_URL` e `LANGGRAPH_INTERNAL_TOKEN` de `settings`.
  - Adiciona `X-Internal-Token` em todas as chamadas.
  - Adiciona `X-Correlation-Id` se presente em context.
  - Retry com backoff (1 retry em 5xx).
  - Timeout 8s por padrão.
- Teste com `respx` mockando o backend.
- Atualizar `pyproject.toml` se faltar `respx`.

## Fora de escopo
- Tools de domínio (vêm em F3).
- Grafos.

## Arquivos permitidos
- `apps/langgraph-service/app/tools/_base.py`
- `apps/langgraph-service/tests/test_internal_client.py`
- `apps/langgraph-service/tests/conftest.py`

## Contratos de saída
```python
class InternalApiClient:
    async def post(self, path: str, json: dict, *, idempotency_key: str | None = None) -> dict: ...
    async def get(self, path: str, *, params: dict | None = None) -> dict: ...
```

## Definition of Done
- [ ] `pytest -q` verde
- [ ] `ruff check .` verde
- [ ] `mypy app` verde
- [ ] PR aberto

## Validação
```powershell
cd apps/langgraph-service
ruff check .
mypy app
pytest -q
```
