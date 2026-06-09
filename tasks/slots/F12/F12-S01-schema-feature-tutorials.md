---
id: F12-S01
title: Schema feature_tutorials + migration + catálogo de feature_key
phase: F12
task_ref: docs/21-tutoriais-em-video.md#4
status: in-progress
priority: medium
estimated_size: S
agent_id: null
claimed_at: 2026-06-09T15:00:44Z
completed_at: null
pr_url: null
depends_on: []
blocks: [F12-S02]
source_docs:
  - docs/21-tutoriais-em-video.md#4
  - docs/21-tutoriais-em-video.md#9
  - docs/21-tutoriais-em-video.md#11
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F12-S01 — Schema feature_tutorials + catálogo de feature_key

## Objetivo

Criar a tabela `feature_tutorials` (registro global funcionalidade→vídeo+artigo), a permissão `tutorials:manage`, e o catálogo fechado de `feature_key` em `packages/shared-types` — a base de dados para toda a fase F12.

## Contexto

Norma 21 §4 define o modelo de dados. O registro é global de produto (`organization_id` nullable, NULL = vale para todos). A `feature_key` vem de um catálogo fechado (§4.1), nunca texto livre. Este slot só entrega schema + migration + catálogo + permissão; API é F12-S02.

## Escopo (faz)

- `apps/api/src/db/schema/featureTutorials.ts`: tabela conforme §4 (colunas, soft-delete `deleted_at`, `created_at`/`updated_at` com trigger, FKs com `on delete` explícito).
- Índices: unique parcial em `feature_key` onde `deleted_at IS NULL`; índice em `is_active`.
- Registrar o export em `apps/api/src/db/schema/index.ts`.
- Migration `0047_feature_tutorials.sql` (preferir `drizzle-kit generate`; se manual, **adicionar entry em `meta/_journal.json` no mesmo commit** — PROTOCOL §3).
- A mesma migration semeia a permissão `tutorials:manage` e a concede ao papel `admin` (seguir padrão das seeds de permissão existentes, ex. `0044_seed_billing_permissions.sql`).
- `packages/shared-types/src/featureKeys.ts`: constante TS com o catálogo (§4.1) + tipo `FeatureKey` derivado; exportar em `packages/shared-types/src/index.ts`.

## Fora de escopo (NÃO faz)

- Qualquer rota/módulo de API (F12-S02).
- Qualquer componente web.
- Corrigir o débito pré-existente `0046_doc_telemetry.sql` órfão no journal (slot separado — apenas não piorar).
- Seed de registros de tutorial (conteúdo é cadastrado pelo admin via UI).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/db/schema/featureTutorials.ts` (criar)
- `apps/api/src/db/schema/index.ts` (apenas adicionar export)
- `apps/api/src/db/migrations/0047_feature_tutorials.sql` (criar)
- `apps/api/src/db/migrations/meta/_journal.json` (entry da migration)
- `packages/shared-types/src/featureKeys.ts` (criar)
- `packages/shared-types/src/index.ts` (apenas adicionar export)
- `apps/api/src/db/schema/__tests__/featureTutorials.test.ts` (criar, se houver estrutura)
- `tasks/slots/F12/F12-S01-schema-feature-tutorials.md`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/modules/**`
- `apps/web/**`
- `apps/langgraph-service/**`
- Outras migrations e schemas não listados
- `tasks/STATUS.md`

## Contratos de entrada

- Postgres 16 com `pgcrypto`. Tabelas `organizations`, `users`, `permissions`, `role_permissions` existentes.

## Contratos de saída

- `feature_tutorials` migrável e tipada via Drizzle, importável por F12-S02.
- Permissão `tutorials:manage` semeada e concedida ao `admin`.
- Catálogo `featureKeys` exportado de `@elemento/shared-types`.

## Definition of Done

- [ ] Schema + migration conforme §4
- [ ] Permissão `tutorials:manage` semeada + concedida ao admin
- [ ] Catálogo `featureKeys` em shared-types
- [ ] `python scripts/slot.py check-migrations` sem **novos** erros (0047 com entry no journal)
- [ ] `pnpm --filter @elemento/api typecheck` verde
- [ ] `pnpm --filter @elemento/api test` verde

## Comandos de validação

```powershell
python scripts/slot.py check-migrations
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api test
```

## Notas para o agente

- `feature_key` é `unique` global (parcial em `deleted_at IS NULL`).
- FKs: `organization_id` ON DELETE CASCADE; `created_by` ON DELETE SET NULL.
- Não use `any`/`as`. Siga o padrão de schema dos arquivos vizinhos em `db/schema/`.
