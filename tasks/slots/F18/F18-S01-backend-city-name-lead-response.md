---
id: F18-S01
title: Backend — city_name em LeadResponse (Onda 1 item 1)
phase: F18
task_ref: docs/planejamento-2026-06-evolucao.md#a1--cidade-do-lead-visível-no-crm-e-no-kanban-item-1
status: review
priority: high
estimated_size: S
agent_id: null
claimed_at: 2026-06-16T05:06:41Z
completed_at: 2026-06-16T05:12:00Z
pr_url: null
depends_on: []
blocks: [F18-S02]
labels: [backend, crm, leads]
source_docs:
  - docs/planejamento-2026-06-evolucao.md
docs_required: false
---
# F18-S01 — Backend: city_name em LeadResponse

## Objetivo

Expor `city_name` (string) no `LeadResponse` e `LeadListItemResponse` para que o frontend exiba a cidade sem fazer lookup extra.

## Contexto

Item 1 do planejamento (Onda 1 quick win). O `leads.city_id` existe e é populado, mas `LeadResponse` só retorna o UUID. O frontend precisa do nome para exibir na lista do CRM, na ficha e no card do Kanban.

## Escopo (faz)

- JOIN `cities` em `listLeads` e `getLeadById` do repository.
- Adicionar `city_name: z.string().nullable()` em `LeadResponseSchema` (`packages/shared-schemas/src/leads.ts`).
- Retornar `city_name` no mapper de lead (tanto na listagem quanto no detalhe).
- Nenhuma migration.

## Fora de escopo (NÃO faz)

- Frontend (F18-S02).
- Filtros de busca por cidade na listagem (já existe `city_id`).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/leads/repository.ts`
- `apps/api/src/modules/leads/service.ts`
- `apps/api/src/modules/leads/schemas.ts`
- `packages/shared-schemas/src/leads.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/modules/leads/routes.ts`
- `apps/web/**`
- `apps/api/src/db/schema/**`

## Contratos de entrada

- Tabela `cities` existe com coluna `name`.
- `LeadResponseSchema` em `packages/shared-schemas/src/leads.ts` — já expõe `city_id`.

## Contratos de saída

- `LeadResponse.city_name: string | null` disponível para F18-S02.

## Definition of Done

- [ ] `GET /api/leads` retorna `city_name` em cada item.
- [ ] `GET /api/leads/:id` retorna `city_name`.
- [ ] `pnpm --filter @elemento/api typecheck && lint && test -- leads` verdes.

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- leads
```

## Notas para o agente

- Leia `apps/api/src/modules/leads/repository.ts` completo antes de editar — siga o padrão do JOIN já usado (ex: join com `cities` em outros módulos).
- `city_name` pode ser null se o lead foi criado antes das cidades serem configuradas — use `city_name: row.cities?.name ?? null`.
- Confirme que o schema de listagem também retorna o campo (às vezes a listagem usa um tipo diferente do detalhe).
