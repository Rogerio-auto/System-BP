---
id: F17-S12
title: Schema — analysis_id em contracts (migration + Drizzle + shared)
phase: F17
task_ref: null
status: available
priority: high
estimated_size: S
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F17-S01, F17-S02]
blocks: [F17-S13, F17-S14]
labels: [contracts, db, schema, migration]
source_docs:
  - docs/planejamento-2026-06-evolucao.md#épico-e--contratos-boletos-e-renovação-item-5--épico
docs_required: false
---

# F17-S12 — Schema: analysis_id em contracts

## Objetivo

Adicionar `analysis_id` à tabela `contracts` para rastrear qual análise de crédito originou o contrato, viabilizando a sincronia automática análise → contrato.

## Contexto

Decisão do produto: quando uma análise é aprovada, o sistema cria um contrato draft automaticamente (F17-S13). Precisamos de um campo `analysis_id` (nullable FK) para vincular os dois registros e garantir idempotência (1 análise = 1 contrato).

## Escopo (faz)

- Migration `0061_contracts_analysis_id.sql`:

  ```sql
  ALTER TABLE contracts
    ADD COLUMN analysis_id UUID REFERENCES credit_analyses(id) ON DELETE SET NULL;

  CREATE UNIQUE INDEX contracts_org_analysis_unique
    ON contracts(organization_id, analysis_id)
    WHERE analysis_id IS NOT NULL;
  ```

- Drizzle `apps/api/src/db/schema/contracts.ts`: adicionar `analysisId uuid('analysis_id').references(() => creditAnalyses.id, { onDelete: 'set null' })` — nullable, sem default.
- `packages/shared-schemas/src/contracts.ts`:
  - `ContractSchema`: adicionar `analysis_id: z.string().uuid().nullable()`
  - `ContractCreateSchema`: adicionar `analysis_id: z.string().uuid().optional().nullable()`

## Fora de escopo (NÃO faz)

- Handler de criação automática do contrato (F17-S13)
- UI de badge/link análise → contrato (F17-S14)

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/db/migrations/0061_contracts_analysis_id.sql`
- `apps/api/src/db/migrations/meta/_journal.json`
- `apps/api/src/db/schema/contracts.ts`
- `packages/shared-schemas/src/contracts.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/modules/**`
- `apps/api/src/handlers/**`
- `apps/web/**`

## Contratos de entrada

- Tabela `credit_analyses` existe (F4-S01).
- Tabela `contracts` existe (F17-S01, migration 0059).

## Contratos de saída

- `contracts.analysis_id` disponível no banco e tipado no Drizzle + Zod.
- `ContractSchema.analysis_id` disponível para F17-S13 (handler) e F17-S14 (frontend).

## Definition of Done

- [ ] Migration SQL cria coluna + índice único parcial
- [ ] Drizzle schema tipado (nullable FK para credit_analyses)
- [ ] `ContractSchema` e `ContractCreateSchema` atualizados em shared-schemas
- [ ] `pnpm --filter @elemento/api typecheck` verde
- [ ] E2E Smoke deve passar (migration aplicada no CI)

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
```

## Notas para o agente

- Confirme o próximo número disponível com `python scripts/slot.py check-migrations` antes de criar o arquivo SQL — deve ser 0061.
- O índice único é **parcial** (`WHERE analysis_id IS NOT NULL`) — permite múltiplos contratos sem análise vinculada.
- `ON DELETE SET NULL`: se uma análise for deletada, o contrato perde o vínculo mas não é deletado.
- Este slot **tem migration** → E2E Smoke deve ficar verde antes do merge (gate obrigatório).
