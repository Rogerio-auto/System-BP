---
id: F1-S01
title: Schema identidade — orgs, users, roles, permissions, sessions, city scopes
phase: F1
task_ref: T1.1
status: in-progress
priority: critical
estimated_size: M
agent_id: db-schema-engineer
claimed_at: 2026-05-11T00:00:00Z
completed_at: null
pr_url: null
depends_on: [F0-S04]
blocks: [F1-S02, F1-S03, F1-S05, F1-S07, F1-S09]
source_docs:
  - docs/03-modelo-dados.md
  - docs/10-seguranca-permissoes.md
  - docs/12-tasks-tecnicas.md#T1.1
---

# F1-S01 — Schema base de identidade

## Objetivo

Schema Drizzle e migration aplicada com todas as tabelas de identidade, índices, FKs e seed inicial (org default + 1 admin com senha forte gerada e logada uma única vez).

## Escopo

- Em `apps/api/src/db/schema/`:
  - `organizations.ts` — `id, slug, name, created_at, updated_at`
  - `users.ts` — `id, organization_id, email (citext unique), password_hash, name, status, created_at, updated_at, deleted_at`
  - `roles.ts` — `id, key (unique), label`
  - `permissions.ts` — `id, key (unique), description`
  - `role_permissions.ts` — PK composta `(role_id, permission_id)`
  - `user_roles.ts` — PK composta `(user_id, role_id)`
  - `user_city_scopes.ts` — `(user_id, city_id, is_primary)` — PK composta
  - `user_sessions.ts` — `id, user_id, refresh_token_hash, user_agent, ip, created_at, last_used_at, revoked_at`
- Re-exportar em `db/schema/index.ts`.
- Migration gerada via `pnpm db:generate` e revisada manualmente.
- Seed em `apps/api/scripts/seed.ts`:
  - Org `bdp-rondonia`
  - Roles: `admin, gestor_geral, gestor_regional, agente, operador, leitura`
  - Permissões mínimas (lista em `docs/10-seguranca-permissoes.md`)
  - 1 user admin com senha forte aleatória (logada **apenas** no stdout do seed)

## Fora de escopo

- Cidades (slot F1-S05).
- Endpoints de auth (slot F1-S03).
- UI (slot F1-S08).

## Arquivos permitidos

- `apps/api/src/db/schema/organizations.ts`
- `apps/api/src/db/schema/users.ts`
- `apps/api/src/db/schema/roles.ts`
- `apps/api/src/db/schema/permissions.ts`
- `apps/api/src/db/schema/role_permissions.ts`
- `apps/api/src/db/schema/user_roles.ts`
- `apps/api/src/db/schema/user_city_scopes.ts`
- `apps/api/src/db/schema/user_sessions.ts`
- `apps/api/src/db/schema/index.ts`
- `apps/api/src/db/migrations/0001_*.sql` (gerada)
- `apps/api/scripts/seed.ts`
- `apps/api/package.json` — adicionar script `db:seed`

## Contratos de saída

- Tipos derivados disponíveis para os repositories (`InferSelectModel<typeof users>` etc).
- `pnpm db:seed` cria org + roles + admin idempotentemente.

## Definition of Done

- [ ] Migration aplica em DB limpo
- [ ] Seed idempotente (rodar 2x não duplica)
- [ ] Constraints únicas verificadas (`email`, `slug`)
- [ ] Senha admin com pelo menos 24 caracteres aleatórios
- [ ] `pnpm typecheck` verde
- [ ] PR aberto

## Validação

```powershell
docker compose up -d postgres
pnpm --filter @elemento/api db:migrate
pnpm --filter @elemento/api db:seed
```
