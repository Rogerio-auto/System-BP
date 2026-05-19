---
id: F3-S13
title: Tool get_or_create_lead (Python)
phase: F3
task_ref: T3.4
status: in-progress
priority: high
estimated_size: S
agent_id: python-engineer
claimed_at: 2026-05-19T01:46:26Z
completed_at:
pr_url:
depends_on: [F3-S04]
blocks: [F3-S20, F3-S22, F3-S25]
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
---

# F3-S13 — Tool get_or_create_lead

## Objetivo

Tool LangGraph que chama `POST /internal/leads/get-or-create` (F3-S04). Cria o
arquivo `leads_tools.py` (doc 06 §3) compartilhado pelas tools de lead.

## Escopo

- `app/tools/leads_tools.py` — tool `get_or_create_lead`:
  - Input/output Pydantic v2 conforme doc 06 §7.1.
  - Usa o cliente HTTP autenticado `_base.py` (já existe): `X-Internal-Token`,
    `X-Correlation-Id`, `Idempotency-Key`.
  - Mapeia erros do backend (`INVALID_PHONE`, `LEAD_MERGE_REQUIRED`,
    `BACKEND_UNAVAILABLE`) para exceções/retornos tipados.
- Tool exposta no formato consumível pelo grafo (LangChain `@tool` ou equivalente).
- Testes com `httpx_mock`: sucesso (`created` true/false) e cada erro.

## Fora de escopo

- Endpoint Node (F3-S04). Nó `identify_or_create_lead` (F3-S25).

## Arquivos permitidos

- `apps/langgraph-service/app/tools/leads_tools.py`
- `apps/langgraph-service/tests/tools/__init__.py`
- `apps/langgraph-service/tests/tools/test_leads_tools.py`

## Definition of Done

- [ ] Tool chama o endpoint com os 3 headers obrigatórios.
- [ ] I/O validado com Pydantic v2.
- [ ] Erros do backend mapeados para retorno tipado.
- [ ] Testes cobrem sucesso + cada erro (httpx mock).
- [ ] `ruff check`, `mypy app`, `pytest -q` verdes.

## Validação

```powershell
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
```
