---
id: F3-S17
title: Tool request_handoff (Python)
phase: F3
task_ref: T3.8
status: available
priority: high
estimated_size: S
agent_id: python-engineer
claimed_at:
completed_at:
pr_url:
depends_on: [F3-S07]
blocks: [F3-S18, F3-S29]
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
---

# F3-S17 — Tool request_handoff

## Objetivo

Tool LangGraph que chama `POST /internal/handoffs` (F3-S07). Cria o arquivo
`chatwoot_tools.py` (doc 06 §3) compartilhado pelas tools de Chatwoot.

## Escopo

- `app/tools/chatwoot_tools.py` — tool `request_handoff`:
  - Input `{ lead_id, conversation_id, reason, summary, simulation_id? }` (doc 06 §7.4).
  - Output `{ handoff_id, chatwoot_conversation_id, assigned_agent_id, status }`.
  - Cliente HTTP `_base.py` com `Idempotency-Key`.
- Testes `httpx_mock`: handoff criado, reenvio idempotente.

## Fora de escopo

- Endpoint Node (F3-S07). Tool `create_chatwoot_note` (F3-S18). Nó (F3-S29).

## Arquivos permitidos

- `apps/langgraph-service/app/tools/chatwoot_tools.py`
- `apps/langgraph-service/tests/tools/test_chatwoot_tools.py`

## Definition of Done

- [ ] Tool chama o endpoint com headers obrigatórios + `Idempotency-Key`.
- [ ] I/O Pydantic v2.
- [ ] Testes cobrem criação e reenvio idempotente.
- [ ] `ruff check`, `mypy app`, `pytest -q` verdes.

## Validação

```powershell
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
```
