---
id: F3-S31
title: Edges + montagem do grafo whatsapp_pre_attendance
phase: F3
task_ref: T3.16
status: review
priority: critical
estimated_size: M
agent_id: python-engineer
claimed_at: 2026-05-19T13:44:24Z
completed_at: 2026-05-19T13:54:10Z
pr_url:
depends_on: [F3-S23, F3-S24, F3-S25, F3-S26, F3-S27, F3-S28, F3-S29, F3-S30]
blocks: [F3-S32, F3-S35, F3-S36]
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
---

# F3-S31 — Montagem do grafo whatsapp_pre_attendance

## Objetivo

Conectar todos os nós de F3-S23…S30 com as edges condicionais do doc 06 §5.3 e
expor `build_graph()`.

## Escopo

- `app/graphs/whatsapp_pre_attendance/routes.py` — funções de roteamento condicional:
  - Roteamento por `current_intent` (saudação, quer_simular, falar_atendente,
    consultar_andamento, cobranca/reclamacao, nao_entendi, fora_de_escopo).
  - `identify_city` com `confidence < 0.85` → pergunta confirmação.
  - `decide_next_step` → `handoff` | `continue` | `end`.
- `app/graphs/whatsapp_pre_attendance/graph.py`:
  - `build_graph()` monta o `StateGraph` com `ConversationState`, todos os nós e
    as edges do doc 06 §5.3.
  - Todo caminho termina em `persist_state → log_decision → END`.
  - `graph_version` (SemVer) exposto.
- Teste de fumaça: grafo compila e tem os nós/edges esperados.

## Fora de escopo

- Endpoint HTTP (F3-S32). Fixtures conversacionais (F3-S35).

## Arquivos permitidos

- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/routes.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/graph.py`
- `apps/langgraph-service/tests/graphs/test_graph_build.py`

## Definition of Done

- [ ] `build_graph()` compila sem erro.
- [ ] Edges conforme doc 06 §5.3 (todas as intenções roteadas).
- [ ] Todo caminho passa por `persist_state → log_decision → END`.
- [ ] `graph_version` exposto.
- [ ] `ruff check`, `mypy app`, `pytest -q` verdes.

## Validação

```powershell
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
```
