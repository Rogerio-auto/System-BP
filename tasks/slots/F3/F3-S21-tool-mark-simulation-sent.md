---
id: F3-S21
title: Tool mark_simulation_sent (Python)
phase: F3
task_ref: T3.7
status: review
priority: medium
estimated_size: S
agent_id: python-engineer
claimed_at: 2026-05-19T02:32:37Z
completed_at: 2026-05-19T02:40:15Z
pr_url:
depends_on: [F3-S11, F3-S15]
blocks: [F3-S28]
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
---

# F3-S21 — Tool mark_simulation_sent

## Objetivo

Tool LangGraph que chama `POST /internal/simulations/:id/sent` (F3-S11). Adiciona-se
ao `simulation_tools.py` criado em F3-S15.

## Escopo

- `app/tools/simulation_tools.py` — tool `mark_simulation_sent`:
  - Input `{ simulation_id }`, output confirmação.
  - Cliente HTTP `_base.py` com headers obrigatórios.
  - Operação idempotente (o backend garante).
- Testes `httpx_mock`: marcação, reenvio idempotente, 404.

## Fora de escopo

- Endpoint Node (F3-S11). Nó `save_simulation` (F3-S28).

## Arquivos permitidos

- `apps/langgraph-service/app/tools/simulation_tools.py`
- `apps/langgraph-service/tests/tools/test_simulation_tools.py`

## Definition of Done

- [ ] Tool chama o endpoint com headers obrigatórios.
- [ ] I/O Pydantic v2.
- [ ] Testes cobrem marcação, reenvio e 404.
- [ ] `ruff check`, `mypy app`, `pytest -q` verdes.

## Validação

```powershell
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
```
