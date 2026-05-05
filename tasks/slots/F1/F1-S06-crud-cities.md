---
id: F1-S06
title: CRUD cities (admin)
phase: F1
task_ref: T1.6
status: blocked
priority: medium
estimated_size: M
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F1-S04, F1-S05]
blocks: []
source_docs:
  - docs/12-tasks-tecnicas.md#T1.6
---

# F1-S06 — CRUD cities

## Objetivo
Endpoints `/api/admin/cities` (list, create, update, delete) protegidos por `permissions: ['admin:cities:write']`. UI virá em outro slot.

## Escopo
- Módulo `modules/cities/` (routes/controller/service/repository/schemas).
- Validação Zod com `aliases` opcional.
- Audit log em mutações.
- Testes integração + permissão.

## Arquivos permitidos
- `apps/api/src/modules/cities/**`
- `packages/shared-schemas/src/cities.ts`

## Definition of Done
- [ ] Endpoints com testes (200/400/401/403/404/409)
- [ ] Audit log presente
- [ ] PR aberto
