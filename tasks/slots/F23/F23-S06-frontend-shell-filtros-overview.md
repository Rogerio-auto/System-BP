---
id: F23-S06
title: Frontend — shell de /relatorios, filtros adaptativos e Visão Geral
phase: F23
task_ref: docs/planejamento-relatorios-metricas.md
status: review
priority: high
estimated_size: L
agent_id: null
claimed_at: 2026-06-24T15:23:50Z
completed_at: 2026-06-24T15:44:13Z
pr_url: null
depends_on: [F23-S03]
blocks: []
labels: [frontend, reports, rbac, design-system]
source_docs: [docs/planejamento-relatorios-metricas.md, docs/18-design-system.md]
docs_required: true
docs_artifacts: [docs/help/relatorios/visao-geral.mdx]
---

# F23-S06 — Frontend: shell + filtros adaptativos + Visão Geral

## Objetivo

Substituir o `PlaceholderPage` de `/relatorios` por uma `RelatoriosPage` real: shell que monta
seções por `hasPermission`, barra de filtros adaptativa ao papel (com scope toggle) e a seção
Visão Geral (KPIs de topo). Base para as demais seções (F23-S07/S08).

## Contexto

Plano §3 (visibilidade por papel), §4-A (Visão Geral), §5 (filtros). Rota já existe em
`App.tsx` (hoje placeholder) e no nav. Reusar componentes SVG existentes do dashboard
(`StatsRow`, `StatusDonut`, etc.) e os tokens do DS (doc 18, light-first + dark). Consumir o
schema Zod compartilhado (`@elemento/shared-schemas`) — não reescrever tipos.

## Escopo (faz)

- `apps/web/src/features/relatorios/RelatoriosPage.tsx` + subcomponentes (filtros, scope toggle,
  seção overview). Trocar o `PlaceholderPage` da rota `/relatorios` em `App.tsx`.
- Barra de filtros adaptativa (§5): período (presets + range custom), escopo (Meus dados /
  Cidade / Consolidado — só aparece quando o papel tem >1 escopo), cidade (multi-select se >1),
  agente (se `dashboard:read_by_agent`), "vs período anterior". Estado serializado na URL
  (searchParams) — deep-link e reload-safe.
- Hook `useReportsOverview` (TanStack Query, staleTime ~3min, query-key inclui filtros).
- Renderização condicional de seções por permissão; estados loading (skeleton com profundidade
  do DS) / empty (escopo sem dados) / error.
- Doc de ajuda `docs/help/relatorios/visao-geral.mdx`.

## Fora de escopo (NÃO faz)

- Seções Atendimentos/IA/Funil (F23-S07), Crédito/Cobrança/Produtividade/Auditoria (F23-S08).
- Botão/UI de exportação (F23-S10).
- Endpoints (já entregues em F23-S03).

## Arquivos permitidos

- `apps/web/src/features/relatorios/RelatoriosPage.tsx`
- `apps/web/src/features/relatorios/components/`
- `apps/web/src/features/relatorios/hooks/`
- `apps/web/src/features/relatorios/api.ts`
- `apps/web/src/app/App.tsx`
- `docs/help/relatorios/visao-geral.mdx`

## Arquivos proibidos

- `apps/api/**`
- `apps/langgraph-service/**`
- `apps/web/src/features/dashboard/**`
- `apps/web/src/app/navigation.ts`

## Contratos de saída

- `/relatorios` renderiza página real (sem placeholder), com filtros adaptativos e Visão Geral.
- Scope toggle aparece só quando o papel tem mais de um escopo; agente sempre "Meus dados".
- Filtros refletidos na URL; reload preserva estado.
- Tipos vêm de `@elemento/shared-schemas` (sem drift).
- DS respeitado (tokens, profundidade, hovers, tipografia).
- `pnpm --filter @elemento/web typecheck` + `lint` + `test` verdes.

## Definition of Done

- [ ] `RelatoriosPage` substitui o placeholder na rota
- [ ] Filtros adaptativos por papel + scope toggle + estado na URL
- [ ] Seção Visão Geral consumindo `/api/reports/overview`
- [ ] Seções montadas por `hasPermission`; estados loading/empty/error
- [ ] Tipos do schema compartilhado; sem `any`
- [ ] Doc `docs/help/relatorios/visao-geral.mdx` criada
- [ ] `pnpm --filter @elemento/web typecheck` + `lint` + `test` verdes

## Validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
```

## Notas para o agente

- App.tsx é o roteador real (não `app/router.tsx`/`navigation.ts` órfãos — ver memória do web router).
- Reusar charts SVG do dashboard como referência de estilo, mas NÃO editar os arquivos do dashboard.
- Tocar `.mdx` → rodar o teste do WEB antes do push (manifest/acorn pega sintaxe inválida).
- Light-first + dark toggle; nada de cor hardcoded fora dos tokens do DS.
