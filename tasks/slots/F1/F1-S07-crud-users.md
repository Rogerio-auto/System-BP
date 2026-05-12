---
id: F1-S07
title: CRUD users + assign roles + city scopes
phase: F1
task_ref: T1.8
status: done
priority: high
estimated_size: M
agent_id: backend-engineer
claimed_at: '2026-05-12T15:25:00Z'
completed_at: '2026-05-12T15:35:00Z'
pr_url: https://github.com/Rogerio-auto/System-BP/pull/25
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
