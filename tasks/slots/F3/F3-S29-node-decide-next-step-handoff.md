---
id: F3-S29
title: Nós decide_next_step + request_handoff
phase: F3
task_ref: T3.16
status: in-progress
priority: high
estimated_size: S
agent_id: python-engineer
claimed_at: 2026-05-19T03:21:00Z
completed_at:
pr_url:
depends_on: [F3-S03, F3-S17, F3-S18]
blocks: [F3-S31]
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
---

# F3-S29 — Nós decide_next_step + request_handoff

## Objetivo

Decidir o próximo passo da conversa (continuar / handoff / encerrar) e, quando for
handoff, criar a transferência com nota interna.

## Escopo

- `app/graphs/whatsapp_pre_attendance/nodes/decide_next_step.py`:
  - Avalia o estado e define rota: `continue` (volta a classify), `handoff`, `end`.
  - Conta tentativas de `nao_entendi`; após 3 → handoff (doc 06 §5.3).
- `app/graphs/whatsapp_pre_attendance/nodes/request_handoff.py`:
  - Chama as tools `request_handoff` (F3-S17) e `create_chatwoot_note` (F3-S18).
  - Gera o `summary` no formato do doc 06 §7.4; grava `handoff_required`/`handoff_reason`.
- Funções puras `(state) -> state`.

## Fora de escopo

- Edges (F3-S31). Fallback de falha da IA (F3-S34).

## Arquivos permitidos

- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/decide_next_step.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/request_handoff.py`
- `apps/langgraph-service/tests/graphs/test_node_decide_handoff.py`

## Definition of Done

- [ ] `decide_next_step` roteia corretamente conforme o estado.
- [ ] 3 tentativas de `nao_entendi` disparam handoff.
- [ ] `request_handoff` cria handoff + nota com `summary` formatado.
- [ ] Testes com fixtures (continue, handoff, end, contador de nao_entendi).
- [ ] `ruff check`, `mypy app`, `pytest -q` verdes.

## Validação

```powershell
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
```
