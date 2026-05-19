---
id: F3-S23
title: Nó receive_message + load_conversation_state
phase: F3
task_ref: T3.12
status: review
priority: high
estimated_size: S
agent_id: python-engineer
claimed_at: 2026-05-19T02:57:12Z
completed_at: 2026-05-19T03:06:45Z
pr_url:
depends_on: [F3-S02, F3-S03]
blocks: [F3-S31]
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
---
# F3-S23 — Nós receive_message + load_conversation_state

## Objetivo

Primeiros nós do grafo `whatsapp_pre_attendance`: normaliza o payload de entrada
e carrega/inicializa o `ConversationState`. Cria o pacote `nodes/`.

## Escopo

- `app/graphs/whatsapp_pre_attendance/nodes/__init__.py` (pacote vazio).
- `app/graphs/whatsapp_pre_attendance/nodes/receive_message.py`:
  - Normaliza o payload inbound (doc 06 §4.1), faz append em `state.messages`.
- `app/graphs/whatsapp_pre_attendance/nodes/load_state.py`:
  - Chama `GET /internal/conversations/:id/state` (F3-S02) via cliente HTTP.
  - Estado inexistente → inicializa `ConversationState` novo.
- Cada nó é função pura `(state) -> state` compatível com LangGraph.

## Fora de escopo

- Demais nós, edges, montagem do grafo (F3-S31).

## Arquivos permitidos

- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/__init__.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/receive_message.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/load_state.py`
- `apps/langgraph-service/tests/graphs/test_node_receive_load.py`

## Definition of Done

- [ ] `receive_message` normaliza payload e faz append em `messages`.
- [ ] `load_state` carrega estado existente ou inicializa novo.
- [ ] Testes com fixtures de estado (estado novo + estado existente).
- [ ] `ruff check`, `mypy app`, `pytest -q` verdes.

## Validação

```powershell
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
```
