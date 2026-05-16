---
id: F8-S05
title: Frontend dashboard real com KPIs e gráficos
phase: F8
task_ref: F8.5
status: done
priority: medium
estimated_size: M
agent_id: frontend-engineer
claimed_at: 2026-05-16T15:06:47Z
completed_at: 2026-05-16T15:17:58Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/70
depends_on: [F8-S03, F1-S08]
blocks: []
labels: []
source_docs:
  - docs/18-design-system.md
  - docs/design-system/index.html
---

# F8-S05 — Frontend dashboard real

## Objetivo

Substituir o placeholder em `apps/web/src/features/dashboard/DashboardPage.tsx` por uma
dashboard real com KPIs e gráficos consumindo `GET /api/dashboard/metrics` (F8-S03).
Tela é a primeira coisa que o agente/admin vê após login — qualidade visual é crítica.

## Escopo

### Layout

Grid responsivo em 3 zonas verticais:

1. **Topo — Stats Row (4 KPIs principais).**
   Stat cards do DS (§9.1), profundidade `--elev-2`, hover Spotlight.

   - Total de leads (no range selecionado)
   - Novos no range
   - Em qualificação/simulação (soma dos status ativos)
   - Conversão (closed_won / total terminado)

2. **Meio — Gráficos (2 colunas em desktop, 1 coluna em mobile).**

   - Distribuição por status (donut chart, cores do DS por status).
   - Volume de interações por canal (bar chart horizontal).
   - Leads por cidade (lista com barras inline, top 5).
   - Cards no Kanban por estágio (barras verticais).

3. **Base — Tabela "Top agentes".**
   Tabela compacta com avatar + nome + closed_won. Hover de linha.

### Filtros (header da página)

- Select de range (today / 7d / 30d / MTD / YTD). Default 30d.
- Select de cidade (se usuário tem >1 cidade no escopo). "Todas" agrega.

### Stale alert

Se `staleCount > 0`, exibir um banner colapsável no topo: "X leads sem interação há mais
de 7 dias. Ver →" link para `/crm?stale=true` (filtro a ser adicionado pelo CRM em slot
futuro — link já preparado, sem implementar do lado CRM agora).

### Gráficos

- Usar `recharts` (~80kb) ou SVG manual. Decisão registrada no PR. Critério: se já
  houver dep de chart no `package.json` do web, usar; senão, SVG manual é preferível
  (sem nova dep para um único uso).
- Cores: tokens do DS (`--state-success`, `--state-info`, `--state-warn`, `--state-error`).
- Tooltip e legend acessíveis.

### Estados

- Loading: skeleton respeitando o layout (4 cards + 2 gráficos + tabela).
- Erro: card de erro com Retry. Não derrubar a tela inteira.
- Empty (range sem dados): mensagem amigável por bloco, não bloqueia.

### Acesso

- Visível a qualquer usuário autenticado com `dashboard:read`.
- Se erro 403 (sem permissão), mostrar fallback amigável.

## Arquivos permitidos

- `apps/web/src/features/dashboard/DashboardPage.tsx` (rewrite)
- `apps/web/src/features/dashboard/components/StatsRow.tsx`
- `apps/web/src/features/dashboard/components/StatusDonut.tsx`
- `apps/web/src/features/dashboard/components/ChannelBars.tsx`
- `apps/web/src/features/dashboard/components/CityList.tsx`
- `apps/web/src/features/dashboard/components/KanbanBars.tsx`
- `apps/web/src/features/dashboard/components/TopAgentsTable.tsx`
- `apps/web/src/features/dashboard/components/StaleBanner.tsx`
- `apps/web/src/features/dashboard/components/__tests__/StatsRow.test.tsx`
- `apps/web/src/features/dashboard/components/__tests__/StatusDonut.test.tsx`
- `apps/web/src/hooks/dashboard/useDashboardMetrics.ts`
- `apps/web/src/hooks/dashboard/types.ts`

## Definition of Done

- [ ] Stats row renderiza 4 KPIs com formatação numérica BR.
- [ ] Filtros (range + cidade) refetcham dados via TanStack Query.
- [ ] Gráficos respeitam cores do DS e funcionam em light + dark.
- [ ] Stale banner aparece só quando `staleCount > 0` e link aponta para `/crm?stale=true`.
- [ ] Mobile: layout colapsa pra 1 coluna; gráficos continuam legíveis.
- [ ] Loading skeleton respeita o layout final (sem layout shift).
- [ ] Empty state por bloco (não derruba página inteira se 1 dado vier vazio).
- [ ] Sem nova dep pesada sem justificativa no PR.
- [ ] Tests: cada componente renderiza dado mock corretamente; filtros disparam refetch.
- [ ] PR com screenshots (light + dark, desktop + mobile).

## Validação

```powershell
pnpm --filter @elemento/web test -- dashboard
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web build
```
