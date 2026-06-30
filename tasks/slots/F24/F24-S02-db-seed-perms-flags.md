---
id: F24-S02
title: DB — seed permissão notifications:manage + feature flags notifications.*
phase: F24
task_ref: docs/planejamento-notificacoes.md
status: in-progress
priority: high
estimated_size: S
agent_id: null
depends_on: [F24-S01]
blocks: [F24-S05]
labels: [db-schema, notifications, rbac, feature-flags]
source_docs:
  [docs/planejamento-notificacoes.md, docs/09-feature-flags.md, docs/10-seguranca-permissoes.md]
docs_required: false
claimed_at: 2026-06-30T20:01:53Z
---

# F24-S02 — DB: seed de permissão + feature flags

## Objetivo

Adicionar ao catálogo a permissão `notifications:manage` (atribuída a admin/gestor_geral) e as
feature flags `notifications.rules.enabled`, `notifications.sla.enabled`,
`notifications.email.enabled`, `notifications.realtime.enabled` — todas começando **disabled**.

## Contexto

Padrão canônico de `0033_seed_credit_analyses_permissions.sql`: `INSERT ... ON CONFLICT DO NOTHING`
para permissão + bloco `INSERT INTO role_permissions SELECT ... WHERE r.key IN (...)`. **admin é
superusuário dinâmico** mas inclua o bloco admin no CROSS JOIN para garantir a perm sem re-seed
(pegadinha documentada). Atualizar também o seed TypeScript do catálogo de flags. Próxima migration = `0077`.

## Escopo (faz)

- Migration `0077_seed_notifications_permissions.sql`:
  - `INSERT INTO permissions (key, description)` para `notifications:manage` (ON CONFLICT DO NOTHING).
  - `INSERT INTO role_permissions` para `admin`, `gestor_geral`.
  - `INSERT INTO feature_flags` para as 4 flags `notifications.*` com `status='disabled'` (ON CONFLICT DO NOTHING).
- Entry no `_journal.json`.
- Refletir as 4 flags no seed de flags (`apps/api/src/db/seeds/featureFlags.ts`) e a permissão
  no `apps/api/scripts/seed.ts` (`PERMISSIONS` + `ROLE_PERMISSIONS` para gestor_geral).

## Fora de escopo (NÃO faz)

- Enforcement das flags (slots de backend).
- Mudança de schema (F24-S01).

## Arquivos permitidos

- `apps/api/src/db/migrations/0077_seed_notifications_permissions.sql`
- `apps/api/src/db/migrations/meta/_journal.json`
- `apps/api/src/db/seeds/featureFlags.ts`
- `apps/api/scripts/seed.ts`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/modules/**`

## Definition of Done

- [ ] Permissão `notifications:manage` no catálogo + atribuída a admin/gestor_geral
- [ ] 4 feature flags `notifications.*` semeadas como `disabled`
- [ ] Migration `0077` + entry em `_journal.json`; `db:migrate` aplica limpo
- [ ] Seed TS atualizado (flags + permissão) — consistente com a migration
- [ ] `pnpm --filter @elemento/api typecheck` verde

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
python scripts/slot.py validate F24-S02
```

## Notas para o agente

- Incluir bloco `WHERE r.key='admin'` no CROSS JOIN para evitar admin sem a perm (pegadinha §RBAC).
- Flags seguem o shape de `docs/09-feature-flags.md` (status + audience).
