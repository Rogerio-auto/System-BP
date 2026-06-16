---
id: F18-S07
title: Frontend — avgDaysInStage no dashboard + estágio Kanban no CRM (Onda 1 item 11)
phase: F18
task_ref: docs/planejamento-2026-06-evolucao.md#épico-h--estágio-de-kanban-gestão-interna-no-dashboard-e-crm-item-11
status: done
priority: medium
estimated_size: M
agent_id: null
claimed_at: 2026-06-16T05:08:22Z
completed_at: 2026-06-16T05:18:03Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/260
depends_on: []
blocks: []
labels: [frontend, dashboard, kanban, crm]
source_docs:
  - docs/planejamento-2026-06-evolucao.md
  - docs/18-design-system.md
docs_required: false
---
# F18-S07 — Frontend: avgDaysInStage no dashboard + estágio Kanban no CRM

## Objetivo

(H.1) Exibir `avgDaysInStage` (tempo médio por estágio) no dashboard. (H.2) Mostrar e permitir mudar o estágio de Kanban diretamente da ficha do lead no CRM.

## Contexto

Item 11 (Onda 1). Backend já calcula `avgDaysInStage` e já retorna no response de dashboard (campo existe mas não é exibido em nenhum componente). No CRM, só é possível mover o estágio arrastando no KanbanPage. Decisão D18: status de atendimento e estágio de Kanban são independentes; quem edita o lead pode mover o estágio.

## Escopo (faz)

### H.1 — Dashboard

- Novo componente `AvgDaysInStageChart.tsx` em `apps/web/src/features/dashboard/`:
  - Barras horizontais por estágio com tempo médio em dias.
  - Ex: "Pré-atendimento: 1.2d | Simulação: 3.4d | Documentação: 8.1d ← gargalo".
  - Dados de `useDashboardMetrics().data?.kanban.avgDaysInStage` (já existe no response).
  - DS: barras com `var(--accent)`, tooltip com valor exato.
- Adicionar na `DashboardPage.tsx` (na seção de Kanban, após `KanbanBars`).
- Melhorar estado vazio do `KanbanBars` para não parecer "ausente" — exibir texto "Sem cards no board ainda" (não vazio sem mensagem).

### H.2 — CRM

- Na `CrmDetailPage.tsx`, exibir o estágio de Kanban atual do lead: chip `{stageName}` com badge visual.
- Select/dropdown para mudar o estágio (usa a mesma mutation que KanbanPage usa para mover card — `useMoveKanbanCard` ou equivalente).
- Deixar claro visualmente que é "Estágio de fluxo interno" (separado de "Status de atendimento").
- Gate RBAC: quem pode editar o lead pode mover o estágio.

## Fora de escopo (NÃO faz)

- Filtros de CRM por estágio de Kanban.
- KPIs extras de gestão interna no StatsRow.

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/dashboard/AvgDaysInStageChart.tsx`
- `apps/web/src/features/dashboard/DashboardPage.tsx`
- `apps/web/src/features/dashboard/KanbanBars.tsx`
- `apps/web/src/features/crm/CrmDetailPage.tsx`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/**`
- `packages/shared-schemas/**`
- `apps/web/src/features/kanban/**` (apenas importar hooks/mutations, não modificar)

## Contratos de entrada

- `useDashboardMetrics().data.kanban.avgDaysInStage: Record<string, number>` — objeto estágio → média de dias.
- Mutation de mover card do Kanban (já existe em `features/kanban/hooks.ts` ou `api.ts`) — importar sem modificar.

## Definition of Done

- [ ] `AvgDaysInStageChart` exibe barras por estágio com tempo médio.
- [ ] Adicionado na DashboardPage.
- [ ] `KanbanBars` tem mensagem no estado vazio.
- [ ] `CrmDetailPage` mostra e permite mudar estágio de Kanban.
- [ ] Gate RBAC no botão de mudança de estágio.
- [ ] DS aplicado (tokens, sem hex).
- [ ] `pnpm --filter @elemento/web typecheck && lint` verdes.

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
```

## Notas para o agente

- Leia `DashboardPage.tsx` e `KanbanBars.tsx` e `useDashboardMetrics` hook antes de editar.
- Leia `CrmDetailPage.tsx` e o hook de Kanban (`features/kanban/hooks.ts`) para importar a mutation correta.
- O `avgDaysInStage` pode não estar tipado no response — verifique o tipo de `useDashboardMetrics()` e adicione se faltando (ajuste no hook de dashboard, não no backend).
- D18: não sincronize `lead.status` com o estágio — são independentes.
