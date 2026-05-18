---
id: F3-S25
title: Nó identify_or_create_lead + collect_missing_profile_data
phase: F3
task_ref: T3.14
status: available
priority: high
estimated_size: S
agent_id: python-engineer
claimed_at:
completed_at:
pr_url:
depends_on: [F3-S03, F3-S13]
blocks: [F3-S31]
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
---

# F3-S25 — Nós identify_or_create_lead + collect_missing_profile_data

## Objetivo

Garantir um `lead_id` na conversa e pedir o nome quando faltar.

## Escopo

- `app/graphs/whatsapp_pre_attendance/nodes/identify_or_create_lead.py`:
  - Chama a tool `get_or_create_lead` (F3-S13), grava `lead_id`/`current_stage`
    no estado, registra ação em `actions_emitted`.
- `app/graphs/whatsapp_pre_attendance/nodes/collect_missing_profile_data.py`:
  - Se `customer_name` ausente, marca `missing_fields` e compõe pergunta de nome.
- Funções puras `(state) -> state`.

## Fora de escopo

- Edges (F3-S31). Atualização de cidade no lead (nó identify_city — F3-S26).

## Arquivos permitidos

- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/identify_or_create_lead.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/collect_missing_profile_data.py`
- `apps/langgraph-service/tests/graphs/test_node_identify_lead.py`

## Definition of Done

- [ ] `lead_id` garantido no estado após o nó.
- [ ] Falta de nome marca `missing_fields` e gera pergunta.
- [ ] Ação registrada em `actions_emitted`.
- [ ] Testes com fixtures (lead novo, lead existente, sem nome).
- [ ] `ruff check`, `mypy app`, `pytest -q` verdes.

## Validação

```powershell
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
```
