---
id: F3-S15
title: Tool list_credit_products (Python)
phase: F3
task_ref: T3.6
status: review
priority: high
estimated_size: S
agent_id: python-engineer
claimed_at: 2026-05-19T01:46:20Z
completed_at: 2026-05-19T01:56:11Z
pr_url:
depends_on: [F3-S06]
blocks: [F3-S16, F3-S21, F3-S28]
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
---
# F3-S15 — Tool list_credit_products

## Objetivo

Tool LangGraph que chama `GET /internal/credit-products` (F3-S06). Cria o
arquivo `simulation_tools.py` (doc 06 §3) compartilhado pelas tools de simulação.

## Escopo

- `app/tools/simulation_tools.py` — tool `list_credit_products`:
  - Input opcional `{ city_id? }`, output lista de produtos ativos.
  - Cliente HTTP `_base.py` com headers obrigatórios.
- Testes `httpx_mock`: lista com produtos, lista vazia.

## Fora de escopo

- Endpoint Node (F3-S06). Tools `generate_credit_simulation` (F3-S16) e
  `mark_simulation_sent` (F3-S21) — mesmo arquivo, slots separados.

## Arquivos permitidos

- `apps/langgraph-service/app/tools/simulation_tools.py`
- `apps/langgraph-service/tests/tools/test_simulation_tools.py`

## Definition of Done

- [ ] Tool chama o endpoint com headers obrigatórios.
- [ ] I/O Pydantic v2.
- [ ] Testes cobrem lista preenchida e vazia.
- [ ] `ruff check`, `mypy app`, `pytest -q` verdes.

## Validação

```powershell
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
```
