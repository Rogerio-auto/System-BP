---
id: F5-S08
title: Frontend cobrança + importação payment_dues + marcação manual
phase: F5
task_ref: T5.8
status: review
priority: medium
estimated_size: L
agent_id: frontend-engineer
claimed_at: 2026-05-30T00:40:31Z
completed_at: 2026-05-30T01:06:08Z
pr_url: null
depends_on: [F5-S06, F5-S07, F1-S08, F1-S17, F8-S08]
blocks: []
labels: []
source_docs:
  - docs/05-modulos-funcionais.md
  - docs/09-feature-flags.md
  - docs/18-design-system.md
---

# F5-S08 — Frontend cobrança + importação payment_dues

## Objetivo

Telas administrativas para gerir parcelas, regras de cobrança e jobs — com banner "Em desenvolvimento" enquanto flag off. Inclui importação de `payment_dues` via adapter no pipeline genérico.

## Escopo

- Backend complementar:
  - `apps/api/src/modules/billing/` — endpoints CRUD payment_dues + rules + jobs
  - Permissões: `billing:read`, `billing:write`, `billing:mark_paid`, `billing:cancel_job` (migration 0037 seed)
  - Rotas:
    ```
    GET    /api/billing/payment-dues
    POST   /api/billing/payment-dues/:id/mark-paid    (registra `paid_at`, emite outbox `billing.due_paid`)
    POST   /api/billing/payment-dues/:id/renegotiate  (status=renegotiated + audit)
    GET    /api/billing/rules
    POST   /api/billing/rules
    PATCH  /api/billing/rules/:id
    GET    /api/billing/jobs
    POST   /api/billing/jobs/:id/cancel
    ```
  - Adapter `paymentDuesAdapter.ts` no pipeline de import (F1-S17)
- Frontend:
  - `/admin/billing/dues` — lista parcelas com filtros (status, vencimento, customer)
  - `/admin/billing/rules` — réguas
  - `/admin/billing/jobs` — jobs agendados/enviados
  - Modal de marcação manual (pago/renegociado)
  - Banner global gated quando `billing.enabled=disabled`

## Fora de escopo

- Reconciliação com gateway de pagamento (slot futuro pós-MVP)
- Boleto/PIX (fora de escopo do MVP)

## Arquivos permitidos

```
apps/api/src/modules/billing/repository.ts
apps/api/src/modules/billing/service.ts
apps/api/src/modules/billing/controller.ts
apps/api/src/modules/billing/schemas.ts
apps/api/src/modules/billing/routes.ts
apps/api/src/modules/billing/index.ts
apps/api/src/modules/billing/__tests__/billing.routes.test.ts
apps/api/src/app.ts
apps/api/src/db/migrations/0037_seed_billing_permissions.sql
apps/api/src/db/migrations/meta/_journal.json
apps/api/src/db/seed/permissions.ts
apps/api/src/services/imports/adapters/paymentDuesAdapter.ts
apps/api/src/services/imports/registry.ts
apps/api/src/services/imports/__tests__/paymentDuesAdapter.test.ts
apps/web/src/features/billing/PaymentDuesPage.tsx
apps/web/src/features/billing/CollectionRulesPage.tsx
apps/web/src/features/billing/CollectionJobsPage.tsx
apps/web/src/features/billing/components/MarkPaidModal.tsx
apps/web/src/features/billing/components/BillingGatedBanner.tsx
apps/web/src/features/billing/hooks/useBilling.ts
apps/web/src/features/billing/api.ts
apps/web/src/features/billing/schemas.ts
apps/web/src/features/imports/constants.ts
apps/web/src/app/router.tsx
apps/web/src/app/navigation.ts
```

## Definition of Done

- [ ] 7 rotas backend com Zod e RBAC
- [ ] Migration 0037 com permissões, idempotente
- [ ] Adapter de import de payment_dues + fixtures (CSV BR currency, datas dd/mm/aaaa)
- [ ] 3 páginas frontend integradas no Hub
- [ ] Banner gated visível quando flag off
- [ ] Modal de marcação manual com confirmação
- [ ] Design System aplicado
- [ ] Testes de fluxo: importar 100 parcelas, marcar uma como paga, ver cancelamento de jobs futuros

## Validação

```powershell
python scripts/slot.py check-migrations
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- billing
pnpm --filter @elemento/api test -- paymentDuesAdapter
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web test -- billing
```
