---
id: F12-S08
title: Completar data model — duration_seconds (schema + migration + API)
phase: F12
task_ref: docs/21-tutoriais-em-video.md#4
status: available
priority: low
estimated_size: XS
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F12-S01, F12-S02]
blocks: []
source_docs:
  - docs/21-tutoriais-em-video.md#4
  - docs/21-tutoriais-em-video.md#9
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F12-S08 — duration_seconds (gap do data model)

## Objetivo

Adicionar a coluna `duration_seconds` (nullable) que a norma §4 especifica mas o F12-S01 omitiu, e expô-la na API de tutoriais (criada em F12-S02). É o badge de duração exibido no ⓘ/drawer (F12-S04).

## Contexto

A norma 21 §4 lista `duration_seconds int null` na tabela `feature_tutorials`. O F12-S01 não criou a coluna; o F12-S02 omitiu o campo dos payloads como consequência. Este micro-slot fecha o gap. Não bloqueia S04/S05 (campo é opcional no front até existir).

## Escopo (faz)

- `apps/api/src/db/schema/featureTutorials.ts`: adicionar coluna `duration_seconds integer` (nullable).
- Migration `0048_feature_tutorials_duration.sql` (`ALTER TABLE feature_tutorials ADD COLUMN duration_seconds integer`); **adicionar entry em `meta/_journal.json` no mesmo commit**.
- `apps/api/src/modules/tutorials/schemas.ts`: incluir `durationSeconds` (optional, positive int) no create/update e na resposta.
- `apps/api/src/modules/tutorials/repository.ts` + `routes.ts`: persistir e devolver o campo.
- Atualizar/estender os testes do módulo para cobrir `durationSeconds`.

## Fora de escopo (NÃO faz)

- UI (badge de duração é F12-S04/S05).
- Qualquer outra coluna ou mudança de schema.
- Seed da flag `tutorials.enabled` (tarefa de go-live, fora daqui).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/db/schema/featureTutorials.ts`
- `apps/api/src/db/migrations/0048_feature_tutorials_duration.sql` (criar)
- `apps/api/src/db/migrations/meta/_journal.json` (entry)
- `apps/api/src/modules/tutorials/schemas.ts`
- `apps/api/src/modules/tutorials/repository.ts`
- `apps/api/src/modules/tutorials/routes.ts`
- `apps/api/src/modules/tutorials/__tests__/tutorials.test.ts`
- `tasks/slots/F12/F12-S08-duration-seconds.md`

## Arquivos proibidos (`files_forbidden`)

- `apps/web/**`, `packages/**`, `apps/langgraph-service/**`
- outras tabelas/migrations/módulos
- `tasks/STATUS.md`

## Contratos de entrada

- F12-S01 (`feature_tutorials`) e F12-S02 (módulo `tutorials`) mergeados.

## Contratos de saída

- `feature_tutorials.duration_seconds` existe; API aceita e devolve `durationSeconds`.

## Definition of Done

- [ ] Coluna + migration (journal sincronizado)
- [ ] `durationSeconds` no create/update/response com Zod + OpenAPI
- [ ] Testes cobrindo o campo
- [ ] `python scripts/slot.py check-migrations` sem novos erros
- [ ] `pnpm --filter @elemento/api typecheck` / `lint` / `test` verdes

## Comandos de validação

```powershell
python scripts/slot.py check-migrations
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api test
```

## Notas para o agente

- Coluna **nullable** — tutoriais existentes não têm duração. Sem default.
- `durationSeconds` no Zod: `z.number().int().positive().optional()`.
- Migration manual → entry no `_journal.json` obrigatória (PROTOCOL §3).
