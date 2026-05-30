---
id: F5-S05
title: Frontend — réguas de followup, jobs agendados e pausa manual
phase: F5
task_ref: T5.5
status: review
priority: medium
estimated_size: L
agent_id: frontend-engineer
claimed_at: 2026-05-29T23:46:27Z
completed_at: 2026-05-30T00:05:43Z
pr_url: null
depends_on: [F5-S01, F5-S02, F5-S03, F1-S08, F1-S23, F8-S08]
blocks: []
labels: []
source_docs:
  - docs/05-modulos-funcionais.md
  - docs/09-feature-flags.md
  - docs/18-design-system.md
---

# F5-S05 — Frontend de followup

## Objetivo

UI administrativa para gerir réguas de follow-up, ver jobs agendados/enviados e pausar/cancelar manualmente — visível mesmo com a feature gated, exibindo banner "Em desenvolvimento — envios desligados" enquanto a flag estiver off.

## Escopo

- Backend complementar:
  - `apps/api/src/modules/followup/` — endpoints CRUD de rules + GET de jobs com filtros (`status`, `rule_id`, `lead_id`, período)
  - Permissões: `followup:read`, `followup:write`, `followup:cancel_job` — seedadas via migration `0035_seed_followup_permissions.sql`
  - Rotas:
    ```
    GET    /api/followup/rules
    POST   /api/followup/rules
    PATCH  /api/followup/rules/:id
    GET    /api/followup/jobs
    POST   /api/followup/jobs/:id/cancel
    ```
- Frontend:
  - Página `/admin/followup/rules` — lista + form (template select, gatilho, espera, ativa)
  - Página `/admin/followup/jobs` — lista paginada com filtros + ação "Cancelar"
  - Banner global se `followup.enabled=disabled`: "Régua de follow-up em desenvolvimento — envios estão desligados"
  - Hook `useFollowupRules`, `useFollowupJobs`, `useCancelFollowupJob`
  - Entrar como tab dentro do Hub de Configurações (F8-S08)

## Fora de escopo

- Métricas no dashboard (slot futuro, gated por flag `dashboard.followup_metrics.enabled`)
- Editor de template Meta (slot futuro — templates entram via seed por enquanto)

## Arquivos permitidos

```
apps/api/src/modules/followup/repository.ts
apps/api/src/modules/followup/service.ts
apps/api/src/modules/followup/controller.ts
apps/api/src/modules/followup/schemas.ts
apps/api/src/modules/followup/routes.ts
apps/api/src/modules/followup/index.ts
apps/api/src/modules/followup/__tests__/followup.routes.test.ts
apps/api/src/app.ts
apps/api/src/db/migrations/0035_seed_followup_permissions.sql
apps/api/src/db/migrations/meta/_journal.json
apps/api/src/db/seed/permissions.ts
apps/web/src/features/followup/FollowupRulesPage.tsx
apps/web/src/features/followup/FollowupJobsPage.tsx
apps/web/src/features/followup/components/FollowupRuleForm.tsx
apps/web/src/features/followup/components/FollowupGatedBanner.tsx
apps/web/src/features/followup/hooks/useFollowup.ts
apps/web/src/features/followup/api.ts
apps/web/src/features/followup/schemas.ts
apps/web/src/app/router.tsx
apps/web/src/app/navigation.ts
```

## Definition of Done

- [ ] 5 rotas backend implementadas com Zod e RBAC
- [ ] Migration 0035 com 3 permissões + atribuições, idempotente
- [ ] 2 páginas frontend integradas no Hub
- [ ] Banner gated visível quando flag off
- [ ] Filtros + paginação funcionais
- [ ] Design System aplicado (tokens, sem hex hardcoded)
- [ ] Testes backend (CRUD + RBAC) + componentes (form, lista)

## Validação

```powershell
python scripts/slot.py check-migrations
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- followup
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test -- followup
```
