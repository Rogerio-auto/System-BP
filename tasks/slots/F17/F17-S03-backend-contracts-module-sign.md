---
id: F17-S03
title: Backend — módulo de contratos (CRUD + "marcar como assinado")
phase: F17
task_ref: null
status: blocked
priority: high
estimated_size: M
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F17-S01, F17-S02]
blocks: [F17-S04, F17-S05, F17-S07, F17-S09]
labels: [contracts, backend, rbac, lgpd]
source_docs:
  - docs/planejamento-2026-06-evolucao.md#épico-e--contratos-boletos-e-renovação-item-5--épico
  - docs/10-seguranca-permissoes.md
---

# F17-S03 — Backend módulo `contracts`

## Objetivo

Expor CRUD de contratos e a ação "marcar como assinado" (`status: signed`, `signed_at`), com RBAC, auditoria e escopo de cidade.

## Contexto

Item 5 / Épico E.2. Novas permissões `contracts:read`/`contracts:write`/`contracts:sign`. Escopo de cidade via `customer → lead → city_id`.

## Escopo (faz)

- Migration de seed das permissões `contracts:*` (+ vínculos a `agente`/`gestor`/`admin`).
- Módulo `apps/api/src/modules/contracts/`: `routes.ts`, `controller.ts`, `service.ts`, `repository.ts`, `schemas.ts`, `index.ts`, `__tests__/`.
- Endpoints: `GET/POST /api/contracts`, `GET /api/contracts/:id`, `POST /api/contracts/:id/sign`, `GET /api/contracts?status=`.
- `applyCityScope`; audit + idempotência nas mutações; emitir `contract.signed` via outbox.
- Registrar rota em `apps/api/src/app.ts`.

## Fora de escopo (NÃO faz)

- Saúde de boletos (F17-S04); visão cliente (F17-S07); win-back (F17-S09); UI (F17-S05).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/contracts/**`
- `apps/api/src/db/migrations/00XX_seed_contracts_permissions.sql`
- `apps/api/src/db/migrations/meta/_journal.json`
- `apps/api/src/db/seed/permissions.ts`
- `apps/api/src/app.ts`
- `apps/api/src/events/types.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/modules/billing/**`
- `apps/api/src/db/schema/**`

## Definition of Done

- [ ] CRUD + sign com transição de status válida; audit + idempotência
- [ ] RBAC + city-scope testados (positivo/negativo)
- [ ] Evento `contract.signed` no outbox (sem PII bruta)
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- contracts
```

## Notas para o agente

- `app.ts`/`events/types.ts`/`seed/permissions.ts` são compartilhados entre fases — coordene número de migration via `check-migrations`; não rode em paralelo com outro slot que toque esses arquivos.
