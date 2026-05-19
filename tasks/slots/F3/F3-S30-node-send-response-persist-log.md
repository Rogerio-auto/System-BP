---
id: F3-S30
title: Nós send_response + persist_state + log_decision
phase: F3
task_ref: T3.16
status: done
priority: high
estimated_size: M
agent_id: python-engineer
claimed_at: 2026-05-19T03:21:16Z
completed_at: 2026-05-19T03:31:53Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/105
depends_on: [F3-S00, F3-S02, F3-S03, F3-S19]
blocks: [F3-S31]
labels: [lgpd-impact]
source_docs:
  - docs/06-langgraph-agentes.md
---

# F3-S30 — Nós send_response + persist_state + log_decision

## Objetivo

Nós finais do grafo: compor a resposta ao cliente, persistir o estado e registrar
a decisão do turno.

## Escopo

- `app/graphs/whatsapp_pre_attendance/nodes/send_response.py`:
  - Compõe o objeto `reply` do contrato (doc 06 §4.2): `type`, `content`,
    `template_name?`, `template_variables?`.
- `app/graphs/whatsapp_pre_attendance/nodes/persist_state.py`:
  - Chama `PUT /internal/conversations/:id/state` (F3-S02) com o snapshot do estado.
- `app/graphs/whatsapp_pre_attendance/nodes/log_decision.py`:
  - Agrega dados do turno e chama a tool `log_ai_decision` (F3-S19): `node_name`,
    `intent`, `prompt_key/version`, `model`, tokens, latência.
- Funções puras `(state) -> state`.

## LGPD

- `reply.content` e o estado persistido não vazam PII sensível.
- `log_decision` envia `decision` sem PII bruta (doc 17 §3.4).

## Fora de escopo

- Edges/montagem (F3-S31).

## Arquivos permitidos

- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/send_response.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/persist_state.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/log_decision.py`
- `apps/langgraph-service/tests/graphs/test_node_send_persist_log.py`

## Definition of Done

- [ ] `send_response` produz `reply` válido conforme o contrato.
- [ ] `persist_state` salva o estado via endpoint.
- [ ] `log_decision` registra o turno com prompt_version e métricas.
- [ ] Testes com fixtures cobrem os 3 nós.
- [ ] `ruff check`, `mypy app`, `pytest -q` verdes.
- [ ] PR com label `lgpd-impact`.

## Validação

```powershell
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
```
