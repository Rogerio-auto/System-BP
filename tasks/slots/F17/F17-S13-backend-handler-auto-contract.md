---
id: F17-S13
title: Backend — handler auto-contrato por análise aprovada/recusada
phase: F17
task_ref: null
status: review
priority: high
estimated_size: M
agent_id: null
claimed_at: 2026-06-16T05:20:56Z
completed_at: 2026-06-16T05:31:13Z
pr_url: null
depends_on: [F17-S12, F17-S03]
blocks: [F17-S14]
labels: [contracts, backend, handler, outbox]
source_docs:
  - docs/planejamento-2026-06-evolucao.md#épico-e--contratos-boletos-e-renovação-item-5--épico
  - docs/04-eventos.md
docs_required: false
---

# F17-S13 — Backend handler auto-contrato por análise

## Objetivo

Quando uma análise de crédito é aprovada, criar automaticamente um contrato draft vinculado. Quando re-aprovada com valores diferentes, atualizar o contrato draft. Quando recusada, cancelar o contrato draft vinculado.

## Contexto

Decisão do produto (2026-06-16): contrato nasce como `draft` (assinatura manual posterior), análise recusada cancela o draft automaticamente. O vínculo é rastreado por `contracts.analysis_id` (F17-S12).

## Escopo (faz)

### Handler `apps/api/src/handlers/auto-contract-from-analysis.ts`

Escuta `credit_analysis.status_changed`. Lógica por `to_status`:

**`aprovado`:**

1. Fetch da análise completa via `creditAnalysesRepository.findById(analysis_id)` — precisa de `customer_id`, `approved_amount`, `approved_term_months`, `approved_rate_monthly`, `organization_id`
2. Se `customer_id` for null → log warning e skip (não dá para criar contrato sem cliente)
3. Upsert idempotente: `SELECT` por `organization_id + analysis_id`
   - Se não existe → `INSERT` contrato `draft` com:
     - `contract_reference`: `ANA-{ano}-{analysis_id[:8].upper()}` (ex: `ANA-2026-A3F7D63D`)
     - `customer_id`, `organization_id` da análise
     - `principal_amount`: `approved_amount` (já string numeric)
     - `term_months`: `approved_term_months`
     - `monthly_rate_snapshot`: `approved_rate_monthly` (já string numeric)
     - `analysis_id`: `analysis_id` do evento
     - `status`: `'draft'`
   - Se existe e `status === 'draft'` → `UPDATE` com os novos valores aprovados
   - Se existe e `status !== 'draft'` (já assinado/ativo/cancelado) → log info e skip (não sobrescreve)
4. Audit log: `action: 'contract.auto_created'` ou `'contract.auto_updated'`, `actor: { kind: 'handler', id: 'auto-contract-from-analysis' }`
5. Emite evento `contract.auto_created` ou `contract.auto_updated` (sem PII) para notificações futuras

**`recusado`:**

1. `SELECT` contrato por `organization_id + analysis_id`
2. Se existe e `status === 'draft'` → `UPDATE SET status='cancelled'` + audit log `action: 'contract.auto_cancelled'`
3. Se não existe ou status !== 'draft' → skip silencioso

### Filtro `analysis_id` nos endpoints de contratos

Adicionar `analysis_id` como query param opcional em `GET /api/contracts`:

- `apps/api/src/modules/contracts/routes.ts` — adicionar `analysis_id?: z.string().uuid()` no query schema
- `apps/api/src/modules/contracts/repository.ts` — adicionar `.where(eq(contracts.analysisId, query.analysis_id))` quando presente
- `apps/api/src/modules/contracts/controller.ts` / `service.ts` — passar o filtro

### Registro do handler

- `apps/api/src/handlers/index.ts`: registrar `autoContractFromAnalysisHandler` para `credit_analysis.status_changed`

### Testes

- `apps/api/src/handlers/__tests__/auto-contract-from-analysis.test.ts`
  - `aprovado` sem contrato existente → INSERT
  - `aprovado` com draft existente → UPDATE
  - `aprovado` com contrato assinado → skip
  - `aprovado` sem `customer_id` → skip com warning
  - `recusado` com draft existente → cancel
  - `recusado` sem contrato → skip
  - Idempotência: rodar 2x → sem duplicata

## Fora de escopo (NÃO faz)

- Criação de `payment_dues` (parcelas) — são geradas pela simulação de crédito
- UI de badge (F17-S14)
- Geração de `first_due_date`/`last_due_date` — ficam null (agente preenche depois)

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/handlers/auto-contract-from-analysis.ts`
- `apps/api/src/handlers/index.ts`
- `apps/api/src/handlers/__tests__/auto-contract-from-analysis.test.ts`
- `apps/api/src/modules/contracts/routes.ts`
- `apps/api/src/modules/contracts/controller.ts`
- `apps/api/src/modules/contracts/service.ts`
- `apps/api/src/modules/contracts/repository.ts`
- `apps/api/src/modules/contracts/schemas.ts`
- `apps/api/src/events/types.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/db/schema/**` (F17-S12 já fez)
- `packages/shared-schemas/**` (F17-S12 já fez)
- `apps/api/src/modules/credit-analyses/**` (somente leitura via repository import)
- `apps/api/src/app.ts`

## Contratos de entrada

- `contracts.analysis_id` (F17-S12) — coluna disponível no DB e no Drizzle schema
- `credit_analysis.status_changed` event no outbox (já tipado em `events/types.ts`)
- `creditAnalysesRepository.findById` (já existe em `apps/api/src/modules/credit-analyses/repository.ts`)
- `contractsRepository` do módulo contracts (F17-S03) — importar sem editar

## Contratos de saída

- Contratos draft criados/atualizados/cancelados automaticamente
- `GET /api/contracts?analysis_id=:uuid` funcionando (para F17-S14)

## Definition of Done

- [ ] Handler cobre os 3 casos: criar, atualizar, cancelar
- [ ] Idempotência: rodar 2x não duplica contrato
- [ ] `customer_id` null → skip com log warning (sem crash)
- [ ] Contrato já assinado/ativo → skip (não destrói estado)
- [ ] Audit log em todas as mutações
- [ ] `GET /api/contracts?analysis_id=` filtra corretamente
- [ ] Testes: 7+ cenários cobertos
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- contracts
pnpm --filter @elemento/api test -- auto-contract
```

## Notas para o agente

- O `credit_analysis.status_changed` **não carrega os campos financeiros** — apenas IDs e status. Você PRECISA fazer fetch da análise completa via repository.
- `approved_amount` e `approved_rate_monthly` chegam do DB como string (numeric); passe direto para `principal_amount` e `monthly_rate_snapshot` no contrato (ambos também são string/numeric).
- `contract_reference` gerado: `ANA-${new Date().getFullYear()}-${analysis_id.replace(/-/g,'').slice(0,8).toUpperCase()}`. Exemplo: `ANA-2026-A3F7D63D`.
- Leia `apps/api/src/handlers/fanout-notification.ts` como referência de padrão de handler.
- Eventos `contract.auto_created` / `contract.auto_updated` são informativos (sem PII no payload — apenas IDs).
