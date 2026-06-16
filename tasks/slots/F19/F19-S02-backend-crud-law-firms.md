---
id: F19-S02
title: Backend — CRUD law_firms + suggest por cidade
phase: F19
task_ref: docs/planejamento-2026-06-evolucao.md
status: available
priority: high
estimated_size: M
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F19-S01]
blocks: [F19-S03, F19-S04]
labels: [backend, advocacia, crud]
source_docs:
  - docs/planejamento-2026-06-evolucao.md
docs_required: false
---

# F19-S02 — Backend: CRUD escritórios de advocacia

## Objetivo

Expor endpoints de gestão de escritórios de advocacia com escopo multi-tenant e sugestão automática por cidade do cliente.

## Contexto

Item 10. CRUD base para o admin cadastrar escritórios. Também expõe `GET /api/law-firms/suggest?customer_id=` que o frontend usa para pré-selecionar o escritório da cidade do cliente (D15: padrão por cidade + ajuste manual).

## Escopo (faz)

- `GET /api/law-firms` — listagem paginada, filtra por `organization_id` + `deleted_at IS NULL`. RBAC: `law_firms:manage`. Suporta `?city_id=` para filtrar por cobertura.
- `POST /api/law-firms` — criar; Zod: `name` required, `contact_phone` optional, `coverage_city_ids` uuid[], `is_default_for_city` bool. RBAC: `law_firms:manage`. Scope: `organization_id` injetado pelo middleware.
- `PATCH /api/law-firms/:id` — atualizar; WHERE `id = ? AND organization_id = ?`. RBAC: `law_firms:manage`.
- `DELETE /api/law-firms/:id` — soft delete (`deleted_at = NOW()`). RBAC: `law_firms:manage`.
- `GET /api/law-firms/suggest?customer_id=` — retorna escritório padrão para a cidade do customer; RBAC: `law_firms:referral`. Lógica: `WHERE $customer.city_id = ANY(coverage_city_ids) AND is_default_for_city = true AND deleted_at IS NULL AND organization_id = ?`. Retorna primeiro match ou `null`.

Schema Zod (em `packages/shared-schemas/src/law-firms.ts`):

- `LawFirmCreateSchema`, `LawFirmUpdateSchema`, `LawFirmResponseSchema`
- Exportar em `packages/shared-schemas/src/index.ts`

## Fora de escopo (NÃO faz)

- Ação de encaminhamento (F19-S03)
- Frontend (F19-S04)

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/law-firms/**`
- `packages/shared-schemas/src/law-firms.ts`
- `packages/shared-schemas/src/index.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/db/schema/**` (F19-S01 é dono)
- `apps/web/**`
- `apps/api/src/modules/customers/**` (F19-S03 é dono)

## Contratos de saída

- `GET /api/law-firms` → `{ data: LawFirmResponse[], meta: PaginationMeta }`
- `POST /api/law-firms` → `LawFirmResponse` (201)
- `PATCH /api/law-firms/:id` → `LawFirmResponse`
- `DELETE /api/law-firms/:id` → `{ ok: true }`
- `GET /api/law-firms/suggest?customer_id=` → `{ data: LawFirmResponse | null }`

## Definition of Done

- [ ] CRUD completo com `organization_id` em todas as queries (multi-tenant)
- [ ] `GET /suggest` retorna escritório da cidade do cliente ou `null`
- [ ] Zod schemas exportados de `shared-schemas`
- [ ] Permissão `law_firms:manage` verificada nas rotas de admin
- [ ] Permissão `law_firms:referral` verificada no `/suggest`
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- law-firms
```

## Notas para o agente

- Estrutura de módulo: `routes.ts`, `controller.ts`, `service.ts`, `repository.ts`, `schemas.ts`.
- O módulo deve ser registrado no `apps/api/src/app.ts` (ou onde os módulos são registrados).
- `GET /suggest`: busca `customers` pelo `customer_id` para obter `city_id`, depois filtra `law_firms`. RBAC scope: org + city.
- `coverage_city_ids @> ARRAY[$cityId::uuid]` ou `$cityId = ANY(coverage_city_ids)` no SQL/Drizzle.
