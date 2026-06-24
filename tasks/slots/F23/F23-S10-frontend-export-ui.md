---
id: F23-S10
title: Frontend — UI de exportação de relatórios
phase: F23
task_ref: docs/planejamento-relatorios-metricas.md
status: in-progress
priority: medium
estimated_size: M
agent_id: null
claimed_at: 2026-06-24T17:26:10Z
completed_at: null
pr_url: null
depends_on: [F23-S08, F23-S09]
blocks: []
labels: [frontend, reports, export, design-system]
source_docs: [docs/planejamento-relatorios-metricas.md, docs/18-design-system.md]
docs_required: true
docs_artifacts: [docs/help/relatorios/exportar.mdx]
---

# F23-S10 — Frontend: UI de exportação

## Objetivo

Adicionar o fluxo de exportação à `RelatoriosPage`: botão "Exportar" com escolha de formato
(CSV/XLSX/PDF) e escopo (seção atual / relatório completo), respeitando os filtros ativos,
visível apenas para quem tem `reports:export` e com a flag ligada.

## Contexto

Plano §6. Depende do endpoint `POST /api/reports/export` (F23-S09) e das seções completas
(F23-S08). O download usa exatamente os filtros que estão na tela.

## Escopo (faz)

- Componente de exportação (botão + menu de formato/escopo) na barra da `RelatoriosPage`.
- Hook `useExportReport` (mutation) que envia `{ section, format, filters }` e baixa o arquivo.
- Visibilidade gated por `hasPermission('reports:export')` + flag `reports.export.enabled` (camada UI).
- Estados: gerando (loading), sucesso (download), erro (ex: limite de linhas → orientação).
- Doc `docs/help/relatorios/exportar.mdx`.

## Fora de escopo (NÃO faz)

- Geração do arquivo (é server-side, F23-S09).
- Export assíncrono com fila/notificação (futuro).

## Arquivos permitidos

- `apps/web/src/features/relatorios/components/`
- `apps/web/src/features/relatorios/hooks/`
- `apps/web/src/features/relatorios/api.ts`
- `apps/web/src/features/relatorios/RelatoriosPage.tsx`
- `docs/help/relatorios/exportar.mdx`

## Arquivos proibidos

- `apps/api/**`
- `apps/web/src/features/dashboard/**`
- `apps/web/src/app/App.tsx`

## Contratos de saída

- Botão "Exportar" presente só para `reports:export` + flag ligada; some caso contrário.
- Export usa os filtros ativos; CSV/XLSX/PDF baixam corretamente.
- Estados loading/sucesso/erro tratados; erro de limite orienta o usuário.
- DS respeitado; sem `any`.

## Definition of Done

- [ ] UI de exportação com formato + escopo
- [ ] Gating por permissão + flag (camada UI)
- [ ] Filtros ativos refletidos no export
- [ ] Estados loading/sucesso/erro
- [ ] Doc `docs/help/relatorios/exportar.mdx` criada
- [ ] `pnpm --filter @elemento/web typecheck` + `lint` + `test` verdes

## Validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
```

## Notas para o agente

- O front não monta a query; só envia os filtros já validados que estão na URL/estado.
- `.mdx` novo → rodar teste do WEB antes do push.
