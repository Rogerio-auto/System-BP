---
id: F3-S35
title: 5 fixtures conversacionais
phase: F3
task_ref: T3.20
status: done
priority: high
estimated_size: M
agent_id: qa-tester
claimed_at: 2026-05-19T14:08:23Z
completed_at: 2026-05-19T15:04:57Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/107
depends_on: [F3-S31]
blocks: []
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
---

# F3-S35 — Fixtures conversacionais

## Objetivo

Testar o grafo `whatsapp_pre_attendance` ponta a ponta com 5 conversas
representativas, em CI, com LLM determinístico/mockado (doc 06 §10.2).

## Escopo

- `tests/fixtures/conversations/*.yaml` — 5 fixtures cobrindo:
  1. Fluxo feliz completo: saudação → cidade → valor/prazo → simulação → encerrar.
  2. Cidade incerta → confirmação do cliente.
  3. Cliente pede atendente humano (handoff direto).
  4. `nao_entendi` 3× → handoff por esgotamento.
  5. Cidade fora de área atendida (`out_of_service`).
- Runner pytest que carrega cada YAML, roda o grafo e faz asserções em
  `current_node`, `actions` emitidas, `handoff.required`, presença de simulação.
- Roda em CI.

## Fora de escopo

- Testes de prompt injection (F3-S36).

## Arquivos permitidos

- `apps/langgraph-service/tests/fixtures/conversations/`
- `apps/langgraph-service/tests/test_pre_attendance_graph.py`
- `apps/langgraph-service/tests/conftest.py`

## Definition of Done

- [ ] 5 fixtures YAML cobrindo os fluxos acima.
- [ ] Runner faz asserções em nó, ações, handoff e simulação.
- [ ] Suíte roda em CI (LLM determinístico/mockado).
- [ ] `ruff check`, `mypy app`, `pytest -q` verdes.

## Validação

```powershell
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
```
