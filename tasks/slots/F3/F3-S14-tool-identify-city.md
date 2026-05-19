---
id: F3-S14
title: Tool identify_city (Python)
phase: F3
task_ref: T3.5
status: review
priority: high
estimated_size: S
agent_id: python-engineer
claimed_at: 2026-05-19T01:45:51Z
completed_at: 2026-05-19T01:56:30Z
pr_url:
depends_on: [F3-S05]
blocks: [F3-S26]
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
---

# F3-S14 — Tool identify_city

## Objetivo

Tool LangGraph que chama `POST /internal/cities/identify` (F3-S05).

## Escopo

- `app/tools/city_tools.py` — tool `identify_city`:
  - Input `{ lead_id?, city_text }`, output `{ city_id, city_name, matched,
confidence, out_of_service, alternatives[] }` (doc 06 §7.2).
  - Cliente HTTP `_base.py` com headers obrigatórios.
  - `matched: false` é retorno normal (não erro) — o nó decide pedir confirmação.
- Testes `httpx_mock`: match alto, match baixo (com alternativas), `out_of_service`.

## Fora de escopo

- Endpoint Node (F3-S05). Nó `identify_city` (F3-S26).

## Arquivos permitidos

- `apps/langgraph-service/app/tools/city_tools.py`
- `apps/langgraph-service/tests/tools/test_city_tools.py`

## Definition of Done

- [ ] Tool chama o endpoint com headers obrigatórios.
- [ ] I/O Pydantic v2; `matched: false` tratado como retorno válido.
- [ ] Testes cobrem os 3 cenários de confidence.
- [ ] `ruff check`, `mypy app`, `pytest -q` verdes.

## Validação

```powershell
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
```
