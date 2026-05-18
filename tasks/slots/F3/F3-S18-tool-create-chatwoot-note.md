---
id: F3-S18
title: Tool create_chatwoot_note (Python)
phase: F3
task_ref: T3.9
status: available
priority: medium
estimated_size: S
agent_id: python-engineer
claimed_at:
completed_at:
pr_url:
depends_on: [F3-S08, F3-S17]
blocks: [F3-S29]
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
---

# F3-S18 — Tool create_chatwoot_note

## Objetivo

Tool LangGraph que chama `POST /internal/chatwoot/notes` (F3-S08). Adiciona-se ao
`chatwoot_tools.py` criado em F3-S17.

## Escopo

- `app/tools/chatwoot_tools.py` — tool `create_chatwoot_note`:
  - Input `{ chatwoot_conversation_id, body, type: 'internal' }` (doc 06 §7.5).
  - Output `{ note_id }`.
  - Cliente HTTP `_base.py` com headers obrigatórios.
- Testes `httpx_mock`: nota criada.

## Fora de escopo

- Endpoint Node (F3-S08). Nó `request_handoff` (F3-S29).

## Arquivos permitidos

- `apps/langgraph-service/app/tools/chatwoot_tools.py`
- `apps/langgraph-service/tests/tools/test_chatwoot_tools.py`

## Definition of Done

- [ ] Tool chama o endpoint com headers obrigatórios.
- [ ] I/O Pydantic v2.
- [ ] Teste cobre criação da nota.
- [ ] `ruff check`, `mypy app`, `pytest -q` verdes.

## Validação

```powershell
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
```
