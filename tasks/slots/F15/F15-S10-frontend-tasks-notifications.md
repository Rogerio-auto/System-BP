---
id: F15-S10
title: Frontend — painel de tarefas + badge de notificações no header
phase: F15
task_ref: null
status: blocked
priority: high
estimated_size: M
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F15-S04, F15-S05, F15-S06]
blocks: []
labels: [frontend, tasks, notifications]
source_docs:
  - docs/planejamento-2026-06-evolucao.md#f2-role-de-cobrança-dashboard-status-spc-item-9
  - docs/18-design-system.md
docs_required: true
docs_audience:
  - operador
docs_artifacts:
  - docs/help/guias/cobranca/tarefas-notificacoes.mdx
---

# F15-S10 — Frontend tarefas + notificações

## Objetivo

Entregar a UI da fundação: painel "minhas tarefas" (assumir/concluir, badge de pendências bem aparente) e o badge de notificações no header (dropdown + marcar como lida).

## Contexto

Item 9 / Épico F.2d+e. Requisito do Rogério: pendências "bem aparentes" e a tarefa não some até ser concluída. Quando alguém assume (`claimed_by`), os colegas da cidade veem "em andamento por Fulano" mas a tarefa continua compartilhada.

## Escopo (faz)

- Feature `apps/web/src/features/tasks/` (lista, filtros por status, ações assumir/concluir/cancelar) com TanStack Query + hooks lendo o contrato Zod real (F15-S04).
- Componente de notificações no header: badge de não-lidas, dropdown "minhas notificações", marcar lida/todas.
- Rota no `App.tsx` (roteador real) + link/card de acesso conforme navegação viva (`feedback_web_live_router_nav`).
- Design System: tokens de `docs/18-design-system.md`, sem hex hardcoded; estados vazio/carregando/erro.
- Doc `docs/help/guias/cobranca/tarefas-notificacoes.mdx`.

## Fora de escopo (NÃO faz)

- Dashboard de cobrança e tag SPC (F15-S11).
- Qualquer lógica de backend.

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/tasks/**`
- `apps/web/src/features/notifications/**`
- `apps/web/src/App.tsx`
- `docs/help/guias/cobranca/tarefas-notificacoes.mdx`

## Arquivos proibidos (`files_forbidden`)

- `apps/web/src/features/billing/**` (F5-S16)
- `apps/web/src/features/dashboard/**` (F15-S11)
- `apps/web/src/features/account/**` (F14-S04)

## Contratos de entrada

- API de tarefas (F15-S05), notificações (F15-S06), contratos Zod (F15-S04).

## Definition of Done

- [ ] Badge de pendências visível e correto; tarefa some só ao concluir
- [ ] "Assumir" mostra responsável; permanece compartilhada
- [ ] Notificações: badge não-lidas + marcar lida funcionam
- [ ] DS aplicado (tokens, hovers, profundidade); sem hex hardcoded
- [ ] Doc mdx criada; `<FeedbackWidget />` no rodapé
- [ ] `pnpm --filter @elemento/web typecheck && lint && test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test -- tasks
```

## Notas para o agente

- `App.tsx` é o roteador real (memória `feedback_web_live_router_nav`); `apps/web/src/app/router.tsx` é órfão.
- F14-S04 também toca `App.tsx` em paralelo (worktree) — este slot depende da fundação backend e roda depois; cuidado ao mergear (rebase em main atualizado).
- Leia o schema Zod real (F15-S04) — não invente o envelope (memória `feedback_parallel_contract_drift`).
- Rodar o teste do WEB se tocar mdx (memória `feedback_manifest_test_timeout_flake`).
