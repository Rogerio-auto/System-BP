---
id: F15-S11
title: Frontend — dashboard de cobrança + tag/ação de SPC
phase: F15
task_ref: null
status: review
priority: medium
estimated_size: M
agent_id: null
claimed_at: 2026-06-15T20:41:07Z
completed_at: 2026-06-15T20:52:41Z
pr_url: null
depends_on: [F15-S04, F15-S07, F15-S09]
blocks: []
labels: [frontend, dashboard, cobranca, spc]
source_docs:
  - docs/planejamento-2026-06-evolucao.md#f2-role-de-cobrança-dashboard-status-spc-item-9
  - docs/18-design-system.md
docs_required: true
docs_audience:
  - operador
  - gestor
docs_artifacts:
  - docs/help/guias/cobranca/dashboard-cobranca.mdx
---

# F15-S11 — Frontend dashboard de cobrança + SPC

## Objetivo

Entregar a visão do role `cobranca`: cards de carteira (vencendo, vencidos não cobrados, cobrados, inadimplentes 15+, no SPC), régua de cobrança do cliente e a tag/ação de SPC.

## Contexto

Item 9 / Épico F.2b+c. A tag SPC no CRM/cobrança é **derivada** de `customers.spc_status`; a ação de avançar o status usa o endpoint de F15-S07. As métricas vêm de F15-S09.

## Escopo (faz)

- View dedicada de cobrança em `apps/web/src/features/dashboard/` (consome `GET /api/dashboard/collection`), visível para o role `cobranca`.
- Tag de SPC (badge derivado do status) + ação "avançar SPC" (modal de confirmação) chamando F15-S07.
- Régua de cobrança do cliente (reaproveita dados de `collection_rules`/`collection_jobs`).
- Gate por permissão (`billing:read`/`spc:manage`) — esconder ações sem permissão.
- DS aplicado; doc `docs/help/guias/cobranca/dashboard-cobranca.mdx`.

## Fora de escopo (NÃO faz)

- Painel de tarefas/notificações (F15-S10).
- Backend de métricas/SPC.

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/dashboard/**`
- `docs/help/guias/cobranca/dashboard-cobranca.mdx`

## Arquivos proibidos (`files_forbidden`)

- `apps/web/src/features/tasks/**` (F15-S10)
- `apps/web/src/features/notifications/**` (F15-S10)
- `apps/web/src/App.tsx` (F15-S10 é dono nesta fase)

## Contratos de entrada

- `CollectionDashboardResponse` (F15-S04), endpoints SPC (F15-S07) e métricas (F15-S09).

## Definition of Done

- [ ] Cards corretos vs. seed; estados vazio/erro tratados
- [ ] Tag SPC derivada do status; ação de avançar com confirmação e gate de permissão
- [ ] DS aplicado (tokens, sem hex hardcoded)
- [ ] Doc mdx criada; `<FeedbackWidget />` no rodapé
- [ ] `pnpm --filter @elemento/web typecheck && lint && test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test -- dashboard
```

## Notas para o agente

- Não toque em `App.tsx` nesta fase — a rota de cobrança pode ser adicionada por F15-S10; se precisar de rota nova, coordene (evita colisão no roteador real).
- Leia o contrato Zod real (F15-S04). Rodar teste WEB ao tocar mdx (memória `feedback_manifest_test_timeout_flake`).
