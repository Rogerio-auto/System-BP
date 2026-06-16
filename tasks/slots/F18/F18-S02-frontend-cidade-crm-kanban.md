---
id: F18-S02
title: Frontend — cidade visível no CRM e no Kanban (Onda 1 item 1)
phase: F18
task_ref: docs/planejamento-2026-06-evolucao.md#a1--cidade-do-lead-visível-no-crm-e-no-kanban-item-1
status: review
priority: high
estimated_size: S
agent_id: null
claimed_at: 2026-06-16T13:07:54Z
completed_at: 2026-06-16T13:14:05Z
pr_url: null
depends_on: [F18-S01]
blocks: []
labels: [frontend, crm, kanban]
source_docs:
  - docs/planejamento-2026-06-evolucao.md
  - docs/18-design-system.md
docs_required: false
---

# F18-S02 — Frontend: cidade visível no CRM e no Kanban

## Objetivo

Exibir `city_name` em três pontos: coluna na lista do CRM, campo na ficha do lead, e chip discreto no card do Kanban.

## Contexto

Item 1 (Onda 1 quick win). Backend expõe `city_name` após F18-S01. O gap é puramente de exibição: CrmListPage, CrmDetailPage e KanbanCard não mostram a cidade.

## Escopo (faz)

- `CrmListPage.tsx`: adicionar coluna "Cidade" (ou `city_name` como dado na linha/card).
- `CrmDetailPage.tsx`: exibir `city_name` na seção de informações básicas do lead.
- `KanbanCard.tsx`: chip discreto com a cidade (ex: `Porto Velho`), abaixo do nome, usando tokens `var(--text-muted)` + `text-xs`.
- Usar `lead.city_name` diretamente do response (sem lookup extra).

## Fora de escopo (NÃO faz)

- Filtro por cidade na lista (já existe via `city_id`).
- Edição da cidade na ficha.

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/crm/CrmListPage.tsx`
- `apps/web/src/features/crm/CrmDetailPage.tsx`
- `apps/web/src/features/kanban/KanbanCard.tsx`

## Arquivos proibidos (`files_forbidden`)

- `packages/shared-schemas/**`
- `apps/api/**`

## Contratos de entrada

- `LeadResponse.city_name: string | null` (F18-S01).
- Design System (`docs/18-design-system.md`): chips usam `elev-1`, tokens `var(--text-muted)`.

## Definition of Done

- [ ] Cidade aparece na lista do CRM (como coluna ou dado inline).
- [ ] Cidade aparece na ficha do lead.
- [ ] Chip de cidade no card do Kanban.
- [ ] DS aplicado (tokens, sem hex).
- [ ] `pnpm --filter @elemento/web typecheck && lint` verdes.

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
```

## Notas para o agente

- Leia os 3 arquivos completos antes de editar.
- No Kanban card, mantenha o visual leve — o chip de cidade é informativo, não deve competir com o nome e o status.
- Se `city_name` for null, não renderize nada (null check antes do chip).
