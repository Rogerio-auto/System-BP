---
id: F14-S01
title: Schema — lead PJ (CNPJ/razão social) + índice único de email
phase: F14
task_ref: null
status: done
priority: high
estimated_size: S
agent_id: null
claimed_at: 2026-06-11T19:57:04Z
completed_at: 2026-06-11T20:02:15Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/215
depends_on: []
blocks: [F14-S02]
labels: []
source_docs:
  - docs/planejamento-2026-06-evolucao.md#a2-lead-pj-email-obrigatório-no-manual-unicidade-e-bloqueio-do-email-do-agente-item-4
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F14-S01 — Schema: lead PJ + índice único de email

## Objetivo

Adicionar à tabela `leads` os campos de pessoa jurídica (CNPJ + razão social) e um índice único parcial de email por organização — a base para o cadastro PJ e a unicidade de email (item 4).

## Contexto

Item 4 / Épico A.2 do planejamento. Decisões travadas: **D1 — CNPJ em texto claro** (não cifrado); **D2 — email único por organização**. Hoje `leads.email` é `citext` opcional sem unicidade; não há colunas de PJ.

## Escopo (faz)

- Migration (`apps/api/src/db/migrations/0051_*.sql`) — confirmar o próximo número livre no momento (ver `db:check-migrations`):
  - `ALTER TABLE leads ADD COLUMN cnpj text;` (texto claro — D1; CNPJ de PJ, validação de formato na borda Zod).
  - `ALTER TABLE leads ADD COLUMN legal_name text;` (razão social).
  - Índice **único parcial** `CREATE UNIQUE INDEX uq_leads_org_email_active ON leads (organization_id, lower(email)) WHERE email IS NOT NULL AND deleted_at IS NULL;` (D2 — unicidade por org, ignora deletados/sem email). Usar `CONCURRENTLY` + marker `-- no-transaction` se seguir o padrão do runner.
- Atualizar o schema Drizzle `apps/api/src/db/schema/leads.ts`: colunas `cnpj`, `legalName` + a declaração do índice único parcial.
- Atualizar `meta/_journal.json`.

## Fora de escopo (NÃO faz)

- Validação/serviço de criação (é o F14-S02).
- `users.personal_email` / bloqueio de email interno (F14-S02/S04).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/db/schema/leads.ts`
- `apps/api/src/db/migrations/0051_lead_pj_email_unique.sql`
- `apps/api/src/db/migrations/meta/_journal.json`
- `apps/api/src/db/schema/__tests__/**`

## Arquivos proibidos (`files_forbidden`)

- `packages/shared-schemas/src/leads.ts` (dono é F14-S02)
- `apps/api/src/modules/leads/**` (dono é F14-S02)

## Contratos de saída

- `leads.cnpj` (text nullable), `leads.legal_name` (text nullable), índice `uq_leads_org_email_active` disponíveis para o service consumir.

## Definition of Done

- [ ] Migration idempotente aplicada (colunas + índice único parcial)
- [ ] `_journal.json` consistente (`python scripts/slot.py check-migrations` ok)
- [ ] Schema Drizzle reflete as colunas e o índice
- [ ] `pnpm --filter @elemento/api typecheck` verde

## Comandos de validação

```powershell
python scripts/slot.py check-migrations
pnpm --filter @elemento/api typecheck
```

## Notas para o agente

- ⚠️ Bug conhecido do runner de migrations (memória `project_migration_runner_bug`): confirmar o próximo número de migration livre e não confiar só no journal.
- Índice em `lower(email)` mesmo com `citext` para garantir case-insensitive determinístico.
- CNPJ é texto claro (D1) — diferente do CPF, que é cifrado. Não reutilizar o caminho de `cpf_encrypted`.
