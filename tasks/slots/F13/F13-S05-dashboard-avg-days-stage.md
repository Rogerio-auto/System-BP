---
id: F13-S05
title: Dashboard — tempo médio por estágio de Kanban
phase: F13
task_ref: null
status: done
priority: medium
estimated_size: S
agent_id: null
claimed_at: null
completed_at: 2026-06-11T19:32:35Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/213
depends_on: []
blocks: []
labels: []
source_docs:
  - docs/planejamento-2026-06-evolucao.md#épico-h-estágio-de-kanban-gestão-interna-no-dashboard-e-crm-item-11
  - docs/18-design-system.md
docs_required: false # incremento a métrica de dashboard existente
docs_audience: []
docs_artifacts: []
---

# F13-S05 — Dashboard: tempo médio por estágio de Kanban

## Objetivo

Exibir no dashboard o **tempo médio por estágio** (`kanban.avgDaysInStage`), métrica de gargalo de gestão interna que o backend já calcula e devolve no response mas **nenhum componente mostra**.

## Contexto

Item 11 do planejamento. O backend (`dashboard/repository.ts`) já agrega `countKanbanCardsByStage` (exibido em `KanbanBars`) **e** `avgDaysInStage` (no tipo `kanban.avgDaysInStage`, porém sem componente). Este slot aproveita o dado já existente. Também melhora o estado vazio do `KanbanBars` (o Rogério achou que "sumiu" porque o board estava vazio).

## Escopo (faz)

- Novo componente `features/dashboard/components/KanbanAvgDays.tsx` exibindo dias médios por estágio (barras/lista, SVG manual no padrão dos componentes vizinhos).
- Montar o componente na `DashboardPage` (grid de gráficos).
- Melhorar o estado vazio do `KanbanBars` para não dar impressão de funcionalidade inexistente (texto claro + dica).
- Skeleton de loading consistente com os demais.

## Fora de escopo (NÃO faz)

- Qualquer mudança no backend do dashboard (dado já existe).
- CRM / estágio no CRM (F13-S03).

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/dashboard/DashboardPage.tsx`
- `apps/web/src/features/dashboard/components/KanbanAvgDays.tsx`
- `apps/web/src/features/dashboard/components/KanbanBars.tsx`
- `apps/web/src/features/dashboard/components/__tests__/**`
- `apps/web/src/hooks/dashboard/types.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/modules/dashboard/**` (backend não muda)
- `apps/web/src/features/crm/**` (dono é F13-S03)

## Contratos de entrada

- `DashboardMetricsResponse.kanban.avgDaysInStage` já disponível no response e no tipo do hook.

## Definition of Done

- [ ] `KanbanAvgDays` montado na `DashboardPage` exibindo dias médios por estágio
- [ ] Estado vazio do `KanbanBars` melhorado
- [ ] Skeleton consistente com os demais gráficos
- [ ] `pnpm --filter @elemento/web typecheck` verde
- [ ] `pnpm --filter @elemento/web lint` verde
- [ ] `pnpm --filter @elemento/web test -- dashboard` verde

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test -- dashboard
```

## Notas para o agente

- O `avgDaysInStage` já vem no response — não tocar no backend. Só consumir `data.kanban.avgDaysInStage`.
- Espelhar o estilo SVG/tokens de `KanbanBars.tsx` e `ChannelBars.tsx`.
