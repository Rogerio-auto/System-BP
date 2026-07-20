---
id: F27-S05
title: DB — tabela push_subscriptions (migration 0093) + seed flag pwa.enabled
phase: F27
task_ref: docs/24-pwa.md
status: review
priority: high
estimated_size: S
agent_id: null
depends_on: []
blocks: []
labels: [db-schema, pwa, notifications]
source_docs: [docs/24-pwa.md, docs/09-feature-flags.md]
docs_required: false
claimed_at: 2026-07-19T23:48:05Z
completed_at: 2026-07-20T12:03:39Z
---

# F27-S05 — Schema push_subscriptions + seed da flag

## Objetivo

Criar a tabela `push_subscriptions` (destino do Web Push) e garantir a linha da flag `pwa.enabled`
no catálogo. Base do backend de push (F27-S06).

## Contexto

Doc 24 §8. Última migration no disco é `0092` — esta é a **`0093`**. Migration à mão exige entry
correspondente em `meta/_journal.json` no mesmo commit (PROTOCOL §3; incidente 2026-05-15).
Schema files são camelCase (`db/schema/*.ts`) com barrel em `db/schema/index.ts`. A flag
`pwa.enabled` consta do catálogo (doc 09) mas pode não estar seedada — o seed é idempotente
(`ON CONFLICT DO NOTHING`).

## Escopo (faz)

- Migration `0093_push_subscriptions.sql`:
  - Tabela `push_subscriptions` conforme doc 24 §8: `id uuid pk`, `organization_id uuid NOT NULL FK`,
    `user_id uuid NOT NULL FK → users ON DELETE CASCADE`, `endpoint text NOT NULL`, `p256dh text NOT NULL`,
    `auth text NOT NULL`, `user_agent text NULL`, `created_at`/`updated_at timestamptz` + trigger de
    updated_at, `deleted_at timestamptz NULL`.
  - Índice único parcial em `endpoint` `WHERE deleted_at IS NULL` (upsert idempotente).
  - Índice em `user_id`.
  - Seed idempotente da flag `pwa.enabled` (default disabled) se ausente.
- Entry correspondente em `apps/api/src/db/migrations/meta/_journal.json` no mesmo commit.
- `apps/api/src/db/schema/pushSubscriptions.ts` refletindo a tabela; export no barrel `index.ts`.
- Teste: schema compila; constraints (único parcial em endpoint) exercitadas.

## Fora de escopo (NÃO faz)

- Endpoints, sender, VAPID, fan-out (F27-S06).
- Qualquer frontend.

## Arquivos permitidos

- `apps/api/src/db/migrations/0093_push_subscriptions.sql`
- `apps/api/src/db/migrations/meta/_journal.json`
- `apps/api/src/db/schema/pushSubscriptions.ts`
- `apps/api/src/db/schema/index.ts`
- `apps/api/src/db/**/*.test.ts`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/modules/**`
- `apps/api/src/handlers/**`
- `apps/api/src/config/**`
- `packages/**`

## Definition of Done

- [ ] Migration `0093` + entry no `_journal.json` no mesmo commit; `slot.py check-migrations` verde
- [ ] `push_subscriptions` com FKs (`on delete` explícito), único parcial em `endpoint`, índice em `user_id`, soft-delete
- [ ] Seed idempotente da flag `pwa.enabled` (não duplica se já existir)
- [ ] Schema Drizzle reflete a tabela; exportado no barrel
- [ ] `python scripts/slot.py check-migrations` + `pnpm --filter @elemento/api typecheck` + `lint` + `test` + `build` verdes

## Validação

```powershell
python scripts/slot.py check-migrations
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
pnpm --filter @elemento/api build
```

## Notas para o agente

- Migration à mão → entry no `_journal.json` no mesmo commit (incidente 2026-05-15; E2E é o gate
  real de migrations).
- `organization_id` obrigatório desde o dia 1 (multi-tenant — PROTOCOL §8).
- `endpoint`/`p256dh`/`auth` são dado pessoal (doc 17) — o redact e a retenção são do F27-S06;
  aqui, só o soft-delete e o único parcial que permite limpeza.
  </content>
