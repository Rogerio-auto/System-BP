---
id: F17-S10
title: Frontend — oportunidade de win-back (card/tarefa + simulação pré-preenchida)
phase: F17
task_ref: null
status: blocked
priority: low
estimated_size: S
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F17-S09, F15-S10]
blocks: []
labels: [contracts, winback, frontend]
source_docs:
  - docs/planejamento-2026-06-evolucao.md#épico-e--contratos-boletos-e-renovação-item-5--épico
  - docs/18-design-system.md
docs_required: true
docs_audience:
  - operador
docs_artifacts:
  - docs/help/guias/contratos/winback.mdx
---

# F17-S10 — Frontend win-back

## Objetivo

Apresentar a oportunidade de win-back ao agente (a partir da tarefa criada por F17-S09) com atalho para nova simulação pré-preenchida.

## Contexto

Item 5 / Épico E.5. A oportunidade chega como **tarefa** `winback` (painel de F15-S10). Este slot adiciona a apresentação específica + CTA de simulação.

## Escopo (faz)

- Apresentação da tarefa `winback` (card/oportunidade) reaproveitando o painel de tarefas (F15-S10) por import.
- CTA "Nova simulação" pré-preenchendo dados do cliente (rota de simulação existente).
- DS aplicado; doc `docs/help/guias/contratos/winback.mdx`.

## Fora de escopo (NÃO faz)

- Backend (F17-S09); painel genérico de tarefas (F15-S10).

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/contracts/**`
- `docs/help/guias/contratos/winback.mdx`

## Arquivos proibidos (`files_forbidden`)

- `apps/web/src/features/tasks/**` (F15-S10 — importar, não editar)
- `apps/web/src/App.tsx`

## Definition of Done

- [ ] Oportunidade de win-back visível com CTA de simulação pré-preenchida
- [ ] DS aplicado; doc mdx + `<FeedbackWidget />`
- [ ] `pnpm --filter @elemento/web typecheck && lint && test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web test -- contracts
```

## Notas para o agente

- Depende do painel de tarefas (F15-S10) e do worker (F17-S09) já mergeados.
