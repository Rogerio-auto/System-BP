---
id: F28-S01
title: DB — tabela quick_replies (0094) + permissões e flag (0095)
phase: F28
task_ref: docs/25-respostas-rapidas.md
status: in-progress
priority: critical
estimated_size: M
agent_id: null
depends_on: []
blocks: [F28-S03, F28-S04]
labels: [db-schema, livechat, quick-replies]
source_docs:
  [docs/25-respostas-rapidas.md, docs/09-feature-flags.md, docs/10-seguranca-permissoes.md]
docs_required: false
claimed_at: 2026-07-22T20:12:38Z
completed_at: null
pr_url: null
---

# F28-S01 — Schema quick_replies + permissões + flag

## Objetivo

Criar a tabela `quick_replies` com todas as constraints de integridade, seedar as três permissões
de RBAC e a feature flag `livechat.quick_replies.enabled` (disabled). Base de tudo em F28.

## Contexto

Doc 25 §4 e §5. Última migration no disco é `0093_push_subscriptions.sql` — esta fase usa **0094**
(tabela) e **0095** (permissões + flag). Migration à mão exige entry correspondente em
`meta/_journal.json` **no mesmo commit** (PROTOCOL §3; incidente 2026-05-15 derrubou
`GET /api/credit-products` com 403).

O modelo tem duas visibilidades (`organization` / `personal`) e a coerência entre `visibility` e
`owner_user_id` é garantida por CHECK — não por convenção de aplicação.

## Escopo (faz)

- Migration `0094_quick_replies.sql` conforme doc 25 §4:
  - Tabela `quick_replies` com todas as colunas da tabela do §4 (tipos e defaults exatos).
  - `citext` em `shortcut` (extensão já habilitada no projeto).
  - CHECKs do §4.1: coerência `visibility`×`owner_user_id`; `body OR media_url` não-nulos;
    mídia tudo-ou-nada; `visibility in ('organization','personal')`;
    `media_kind in ('image','video','audio','document')`; formato do `shortcut`.
  - Dois índices únicos parciais de `shortcut` (org-wide e por dono), ambos `WHERE deleted_at IS NULL`.
  - Índices `(organization_id, is_active)`, `(organization_id, owner_user_id)` e GIN `pg_trgm` em `title`.
  - FKs com `ON DELETE` explícito: `organization_id` RESTRICT, `owner_user_id` CASCADE,
    `created_by` SET NULL.
  - Trigger de `updated_at` no padrão já usado no repo.
- Migration `0095_seed_quick_replies_permissions.sql`:
  - INSERT das permissões `livechat:quick_reply:read` / `:write` / `:manage` + CROSS JOIN em
    `role_permissions` conforme a matriz do doc 25 §5, tudo `ON CONFLICT DO NOTHING`.
  - Seed idempotente da flag `livechat.quick_replies.enabled` (status `disabled`, `visible` false)
    no molde de `0090_seed_assistant_history_flag.sql`.
- Entries correspondentes em `apps/api/src/db/migrations/meta/_journal.json` no mesmo commit.
- `apps/api/src/db/schema/quickReplies.ts` refletindo a tabela + exports `QuickReply` / `NewQuickReply`;
  export no barrel `db/schema/index.ts`.
- Registro da flag em `apps/api/src/db/seeds/featureFlags.ts` (array `FLAGS`).
- Teste de schema exercitando os CHECKs e os dois únicos parciais (positivo + negativo).

## Fora de escopo (NÃO faz)

- Qualquer rota, service ou repository (F28-S03).
- Schemas Zod compartilhados (F28-S02).
- Qualquer frontend.
- Coluna/tabela de mídia separada — mídia é inline, como em `messages`.

## Arquivos permitidos

- `apps/api/src/db/migrations/0094_quick_replies.sql`
- `apps/api/src/db/migrations/0095_seed_quick_replies_permissions.sql`
- `apps/api/src/db/migrations/meta/_journal.json`
- `apps/api/src/db/schema/quickReplies.ts`
- `apps/api/src/db/schema/index.ts`
- `apps/api/src/db/seeds/featureFlags.ts`
- `apps/api/src/db/**/*.test.ts`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/modules/**`
- `apps/api/src/workers/**`
- `packages/**`

## Contratos de entrada

Nenhum. Slot raiz da fase.

## Contratos de saída

- Tabela `quick_replies` migrada e schema Drizzle exportado no barrel.
- Permissões `livechat:quick_reply:{read,write,manage}` existentes em `permissions` e ligadas aos papéis.
- Flag `livechat.quick_replies.enabled` presente e `disabled`.

## Definition of Done

- [ ] Migrations `0094` e `0095` + entries no `_journal.json` no mesmo commit
- [ ] Todos os CHECKs do doc 25 §4.1 presentes e testados (positivo + negativo)
- [ ] Dois únicos parciais de `shortcut` testados (pessoal pode sombrear o da org)
- [ ] Seed de permissões e flag idempotente (rodar duas vezes não duplica)
- [ ] Schema Drizzle reflete a tabela e está no barrel
- [ ] `python scripts/slot.py check-migrations` verde
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` + `test` + `build` verdes

## Validação

```powershell
python scripts/slot.py check-migrations
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
pnpm --filter @elemento/api build
```

## Notas para o agente

- Migration à mão → entry no `_journal.json` **no mesmo commit**. O E2E Smoke é o gate real de
  migrations; os required checks não rodam `db:migrate`.
- `organization_id` obrigatório desde o dia 1 (PROTOCOL §8, multi-tenant).
- Não adicionar `city_id` escalar: o campo é `city_ids uuid[]` e é **filtro**, não fronteira de
  segurança (doc 25 §D6). Não replicar a semântica de `applyCityScope` aqui.
- Confira o nome real dos papéis na tabela `roles` antes do CROSS JOIN — `roles` tem coluna `label`,
  não `name`.
- Padrão de tabela a espelhar: `apps/api/src/db/schema/creditProducts.ts`.
