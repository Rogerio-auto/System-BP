---
id: F15-S02
title: Schema — status SPC dedicado em `customers`
phase: F15
task_ref: null
status: available
priority: high
estimated_size: S
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: []
blocks: [F15-S07, F15-S09, F15-S11]
labels: [spc, cobranca, schema, lgpd]
source_docs:
  - docs/planejamento-2026-06-evolucao.md#f2-role-de-cobrança-dashboard-status-spc-item-9
  - docs/17-lgpd-protecao-dados.md
---

# F15-S02 — Status SPC em `customers`

## Objetivo

Adicionar um ciclo de vida de SPC dedicado ao cliente (decisão D13 — status, não tag livre), com datas auditáveis de inclusão/remoção.

## Contexto

Item 9 / Épico F.2b. A cobrança insere o cliente no SPC após 15 dias de atraso; o sistema **auxilia e rastreia** (não automatiza a inclusão real no Serasa/SPC). O status precisa de datas (incluído em / removido em) que uma tag não modela. A "tag" visual no CRM será derivada deste status.

## Escopo (faz)

- Migration (`0057_customer_spc_status.sql`):
  - `spc_status` (enum/text com check: `none` → `pending_inclusion` → `included` → `removed`, default `none`).
  - `spc_changed_at` (timestamptz, nullable).
  - Índice parcial para consulta de "no SPC" / "pendente de inclusão".
- Atualizar `apps/api/src/db/schema/customers.ts` (coluna + enum Drizzle), mantendo `organization_id` e o padrão multi-tenant.

## Fora de escopo (NÃO faz)

- Service/endpoints de mudança de status (F15-S07).
- Worker que detecta 15 dias e cria tarefa (F15-S08).
- UI de tag SPC (F15-S11).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/db/migrations/0057_customer_spc_status.sql`
- `apps/api/src/db/migrations/meta/_journal.json`
- `apps/api/src/db/schema/customers.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/db/schema/index.ts` (`customers` já está exportado — não tocar)
- `apps/api/src/modules/**`

## Contratos de saída

- `customers.spc_status` + `spc_changed_at` disponíveis para service (F15-S07), worker (F15-S08), métricas (F15-S09) e UI (F15-S11).

## Definition of Done

- [ ] Coluna + enum + índice criados; default `none`
- [ ] Schema Drizzle reflete a coluna com tipo correto (sem `any`)
- [ ] Migration aplica limpo em DB existente
- [ ] `check-migrations` OK; `pnpm --filter @elemento/api typecheck` verde

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
python scripts/slot.py check-migrations
```

## Notas para o agente

- LGPD: `spc_status` é dado de cobrança vinculado a titular — sem PII bruta nova, mas registre a transição via audit log no slot de service (F15-S07), não aqui.
- Use o primeiro número de migration livre ≥ o do F15-S01 (coordene com `check-migrations`).
