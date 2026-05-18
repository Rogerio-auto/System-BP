---
id: F3-S03
title: Estado tipado ConversationState (Python)
phase: F3
task_ref: T3.11
status: in-progress
priority: critical
estimated_size: S
agent_id: python-engineer
claimed_at: 2026-05-18T21:51:50Z
completed_at:
pr_url:
depends_on: []
blocks: [F3-S23, F3-S24, F3-S25, F3-S26, F3-S27, F3-S28, F3-S29, F3-S30]
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
---

# F3-S03 — ConversationState tipado

## Objetivo

Definir o estado tipado do grafo `whatsapp_pre_attendance` que todos os nós
compartilham, com (de)serialização compatível com o endpoint de estado (F3-S02).

## Escopo

- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/state.py`:
  - `ConversationState(TypedDict, total=False)` exatamente como doc 06 §5.1
    (conversation*id, lead_id, customer_id, phone, city_id, current_intent,
    requested_amount/term, selected_product_id, last_simulation_id, handoff*\*,
    missing_fields, messages, tool_results, errors, actions_emitted).
  - `current_intent` como `Literal[...]` com o catálogo de intenções do doc 06 §5.1.
- Funções `serialize_state(state) -> dict` e `deserialize_state(dict) -> ConversationState`
  para o contrato JSON do endpoint F3-S02 (snapshot `state` jsonb).
- Limite de histórico: `messages` truncado às últimas N (default 20, doc 06 §8).
- `pyproject.toml` só se faltar dep (justificar no PR).

## Fora de escopo

- Nós, grafo, persistência HTTP (vem nos slots de nó).
- `AssistantState` (assistente interno é F6).

## Arquivos permitidos

- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/__init__.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/state.py`
- `apps/langgraph-service/tests/graphs/test_state.py`

## Definition of Done

- [ ] `ConversationState` cobre todos os campos do doc 06 §5.1.
- [ ] `current_intent` restrito ao enum de intenções.
- [ ] Round-trip `serialize → deserialize` preserva o estado.
- [ ] Truncamento de `messages` testado.
- [ ] `ruff check`, `mypy app`, `pytest -q` verdes.

## Validação

```powershell
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
```
