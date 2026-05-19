---
id: F3-S28
title: Nós generate_simulation + save_simulation
phase: F3
task_ref: T3.15
status: in-progress
priority: high
estimated_size: M
agent_id: python-engineer
claimed_at: 2026-05-19T03:21:15Z
completed_at:
pr_url:
depends_on: [F3-S00, F3-S03, F3-S15, F3-S16, F3-S21]
blocks: [F3-S31]
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
---

# F3-S28 — Nós generate_simulation + save_simulation

## Objetivo

Listar produtos compatíveis, gerar a simulação de crédito e marcá-la como enviada.

## Escopo

- `app/graphs/whatsapp_pre_attendance/nodes/generate_simulation.py`:
  - Chama `list_credit_products` (F3-S15), seleciona produto compatível.
  - Chama `generate_credit_simulation` (F3-S16); grava `last_simulation_id`.
  - Compõe a resposta com a simulação (LLM `for_role("reasoner")` para o texto).
  - Erros de range (`AMOUNT_OUT_OF_RANGE` etc.) → mensagem clara, sem inventar taxa.
- `app/graphs/whatsapp_pre_attendance/nodes/save_simulation.py`:
  - Chama `mark_simulation_sent` (F3-S21) após o envio.
- Funções puras `(state) -> state`.

## Fora de escopo

- Edges (F3-S31). Cálculo da simulação (é do backend — doc 06 §1.6).

## Arquivos permitidos

- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/generate_simulation.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/save_simulation.py`
- `apps/langgraph-service/tests/graphs/test_node_simulation.py`

## Definition of Done

- [ ] Produto compatível selecionado a partir da lista.
- [ ] `last_simulation_id` gravado no estado.
- [ ] Erro de range tratado sem inventar taxa/prazo.
- [ ] `save_simulation` marca a simulação como enviada.
- [ ] Testes com fixtures (sucesso, erro de range).
- [ ] `ruff check`, `mypy app`, `pytest -q` verdes.

## Validação

```powershell
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
```
