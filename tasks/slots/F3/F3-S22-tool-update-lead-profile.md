---
id: F3-S22
title: Tool update_lead_profile (Python)
phase: F3
task_ref: T3.4
status: available
priority: medium
estimated_size: S
agent_id: python-engineer
claimed_at:
completed_at:
pr_url:
depends_on: [F3-S12, F3-S13]
blocks: [F3-S26]
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
---

# F3-S22 — Tool update_lead_profile

## Objetivo

Tool LangGraph que chama `PATCH /internal/leads/:id` (F3-S12). Adiciona-se ao
`leads_tools.py` criado em F3-S13.

## Escopo

- `app/tools/leads_tools.py` — tool `update_lead_profile`:
  - Input `{ lead_id, name?, city_id?, requested_amount?, requested_term_months? }`.
  - Output: lead atualizado.
  - Cliente HTTP `_base.py` com headers obrigatórios.
- Testes `httpx_mock`: atualização parcial, 404.

## Fora de escopo

- Endpoint Node (F3-S12). Nó `identify_city` (F3-S26).

## Arquivos permitidos

- `apps/langgraph-service/app/tools/leads_tools.py`
- `apps/langgraph-service/tests/tools/test_leads_tools.py`

## Definition of Done

- [ ] Tool chama o endpoint com headers obrigatórios.
- [ ] I/O Pydantic v2.
- [ ] Testes cobrem atualização parcial e 404.
- [ ] `ruff check`, `mypy app`, `pytest -q` verdes.

## Validação

```powershell
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
```
