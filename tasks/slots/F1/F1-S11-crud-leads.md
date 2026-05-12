---
id: F1-S11
title: CRUD leads (manual) com escopo de cidade + dedupe + eventos
phase: F1
task_ref: T1.11
status: done
priority: critical
estimated_size: L
agent_id: backend-engineer
claimed_at: 2026-05-12T15:55:00Z
completed_at: 2026-05-12T16:11:00Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/28
depends_on: [F1-S04, F1-S09, F1-S10, F1-S15]
blocks: [F1-S12, F1-S17, F1-S22]
source_docs:
  - docs/12-tasks-tecnicas.md#T1.11
---

# F1-S11 — CRUD leads

## Objetivo

Endpoints completos de leads protegidos por RBAC + escopo de cidade, dedupe por telefone, eventos `leads.created`/`leads.updated` via outbox.

## Escopo

- Módulo `modules/leads/` completo (routes/controller/service/repository/schemas/events).
- `service.create` checa duplicata por `phone_normalized` no escopo da org → 409.
- `repository` aplica `applyCityScope` automaticamente.
- Eventos via outbox (depende de F1-S15).
- Audit log em create/update/delete.
- Testes:
  - CRUD básico
  - Dedupe (409)
  - Cross-cidade negado
  - Outbox grava eventos

## Arquivos permitidos

- `apps/api/src/modules/leads/**`
- `packages/shared-schemas/src/leads.ts`

## Definition of Done

- [x] Testes positivos + negativos verdes
- [x] Eventos chegam ao outbox
- [x] Dedupe e RBAC validados em testes
- [ ] PR aberto
