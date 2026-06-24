---
id: F23-S07
title: Frontend — seções Atendimentos, IA e Funil/CRM
phase: F23
task_ref: docs/planejamento-relatorios-metricas.md
status: available
priority: medium
estimated_size: L
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F23-S05, F23-S06]
blocks: []
labels: [frontend, reports, design-system]
source_docs: [docs/planejamento-relatorios-metricas.md, docs/18-design-system.md]
docs_required: true
docs_artifacts: [docs/help/relatorios/atendimentos-ia-funil.mdx]
---

# F23-S07 — Frontend: seções Atendimentos, IA e Funil/CRM

## Objetivo

Adicionar à `RelatoriosPage` as seções Atendimentos & Conversas (§4-B), IA/Pré-atendimento
(§4-C) e Funil & CRM (§4-D), consumindo os endpoints já entregues.

## Contexto

Plano §4-B/C/D. Depende do shell + filtros (F23-S06) e dos endpoints `/api/reports/attendance`
(F23-S03), `/api/reports/ai` (F23-S05) e `/api/reports/funnel` (F23-S03). Reusar charts SVG
(ChannelBars, AvgDaysInStageChart, KanbanBars, StatusDonut) como referência; criar série
temporal (line/area) própria se necessário (decisão D5: SVG próprio).

## Escopo (faz)

- Componentes de seção + hooks (`useReportsAttendance`, `useReportsAi`, `useReportsFunnel`).
- Seção Atendimentos: volume por canal/status, 1ª resposta, resolução, inbound/outbound, série/dia.
- Seção IA: conversas IA, taxa/motivos de handoff, distribuição por nó/intenção; bloco de
  custo/latência/erro de LLM visível só para quem tem a permissão (admin/gestor_geral).
- Seção Funil/CRM: leads por estágio, conversão etapa→etapa, tempo por estágio (gargalo em
  vermelho), origem, aging/stale.
- Respeitar filtros globais da página; estados loading/empty/error; renderização por permissão.
- Doc `docs/help/relatorios/atendimentos-ia-funil.mdx`.

## Fora de escopo (NÃO faz)

- Seções Crédito/Cobrança/Produtividade/Auditoria (F23-S08).
- Exportação (F23-S10).
- Endpoints (já entregues).

## Arquivos permitidos

- `apps/web/src/features/relatorios/components/`
- `apps/web/src/features/relatorios/hooks/`
- `apps/web/src/features/relatorios/api.ts`
- `apps/web/src/features/relatorios/RelatoriosPage.tsx`
- `docs/help/relatorios/atendimentos-ia-funil.mdx`

## Arquivos proibidos

- `apps/api/**`
- `apps/web/src/features/dashboard/**`
- `apps/web/src/app/App.tsx`

## Contratos de saída

- 3 seções renderizam dados reais, respeitando filtros e permissões.
- Bloco de custo/latência de LLM oculto para quem não tem permissão.
- DS respeitado; tipos do schema compartilhado; sem `any`.
- `pnpm --filter @elemento/web typecheck` + `lint` + `test` verdes.

## Definition of Done

- [ ] Seções Atendimentos, IA e Funil/CRM funcionais
- [ ] Hooks consumindo attendance/ai/funnel
- [ ] Gating do bloco LLM por permissão
- [ ] Estados loading/empty/error; filtros globais respeitados
- [ ] Doc de ajuda criada
- [ ] `pnpm --filter @elemento/web typecheck` + `lint` + `test` verdes

## Validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
```

## Notas para o agente

- Não editar os charts do dashboard; reusar como referência de estilo.
- `.mdx` novo → rodar teste do WEB antes do push.
- Coordenar com F23-S08 para não colidir em `RelatoriosPage.tsx`/`api.ts` (slots irmãos; rodar em sequência ou worktree isolada).
