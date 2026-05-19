---
id: F3-S20
title: Tool get_customer_context (Python)
phase: F3
task_ref: T3.4
status: in-progress
priority: medium
estimated_size: S
agent_id: python-engineer
claimed_at: 2026-05-19T02:18:01Z
completed_at:
pr_url:
depends_on: [F3-S10, F3-S13]
blocks: []
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
---

# F3-S20 — Tool get_customer_context

## Objetivo

Tool LangGraph que chama `GET /internal/customers/:id/context` (F3-S10). Adiciona-se
ao `leads_tools.py` criado em F3-S13.

## Escopo

- `app/tools/leads_tools.py` — tool `get_customer_context`:
  - Input `{ lead_id }` ou `{ customer_id }` (doc 06 §7.6).
  - Output: ficha resumida **sem dados sensíveis** (sem CPF/RG/documentos).
  - Cliente HTTP `_base.py` com headers obrigatórios.
- Testes `httpx_mock`: ficha de lead, ficha de customer, 404.

## Fora de escopo

- Endpoint Node (F3-S10).

## Arquivos permitidos

- `apps/langgraph-service/app/tools/leads_tools.py`
- `apps/langgraph-service/tests/tools/test_leads_tools.py`

## Definition of Done

- [ ] Tool chama o endpoint com headers obrigatórios.
- [ ] I/O Pydantic v2; teste afirma ausência de PII sensível no output.
- [ ] Testes cobrem lead, customer e 404.
- [ ] `ruff check`, `mypy app`, `pytest -q` verdes.

## Validação

```powershell
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
```
