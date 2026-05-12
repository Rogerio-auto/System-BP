---
id: F1-S07
title: CRUD users + assign roles + city scopes
phase: F1
task_ref: T1.8
status: blocked
priority: high
estimated_size: M
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F1-S04, F1-S05]
blocks: []
source_docs:
  - docs/12-tasks-tecnicas.md#T1.8
---

# F1-S07 — CRUD users + roles + scopes

## Objetivo

Admin pode criar/editar usuário, atribuir role e cidades de escopo.

## Escopo

- Módulo `modules/users/`.
- Endpoints: list, create, update, deactivate, set-roles, set-city-scopes.
- Senha temporária no create + flag `must_change_password` (a aplicação real virá em outro slot, mas o campo já existe).
- Audit log.
- Testes positivos e negativos.

## Definition of Done

- [ ] Testes verdes
- [ ] Não permite admin se auto-removendo última role admin
- [ ] PR aberto
