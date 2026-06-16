---
id: F18-S05
title: Frontend — "Usar esta versão" na RuleTimeline (Onda 1 item 6)
phase: F18
task_ref: docs/planejamento-2026-06-evolucao.md#épico-d--versão-do-produto-de-crédito-a-usar-item-6
status: review
priority: medium
estimated_size: S
agent_id: null
claimed_at: 2026-06-16T13:09:58Z
completed_at: 2026-06-16T13:22:36Z
pr_url: null
depends_on: [F18-S04]
blocks: []
labels: [frontend, products]
source_docs:
  - docs/planejamento-2026-06-evolucao.md
  - docs/18-design-system.md
docs_required: false
---

# F18-S05 — Frontend: "Usar esta versão" na RuleTimeline

## Objetivo

Adicionar botão "Usar esta versão" em cada versão histórica da `RuleTimeline`, com badge de "versão vigente" na versão ativa.

## Contexto

Item 6 (Onda 1). O backend (`F18-S04`) expõe o endpoint de ativação. A UI apenas precisa de um botão por versão histórica e feedback visual de qual é a versão ativa.

## Escopo (faz)

- Na `RuleTimeline.tsx` (ou `RuleTimelineItem` se existir): badge `VERSÃO VIGENTE` na versão com `is_active = true`.
- Botão "Usar esta versão" nas versões não-ativas (RBAC: apenas para quem tem `products:write`).
- Ao clicar: modal de confirmação (`elev-4`) — "Isso criará uma cópia da versão X como nova versão ativa. Confirmar?" + botão Confirmar/Cancelar.
- Ao confirmar: `POST /api/products/:productId/rules/:version/activate` → invalidar query do produto → exibir toast de sucesso.
- Loading/disabled no botão durante mutation.

## Fora de escopo (NÃO faz)

- Edição dos campos da versão copiada.
- Filtros de timeline.

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/products/**`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/**`
- `packages/shared-schemas/**`

## Definition of Done

- [ ] Badge "VERSÃO VIGENTE" visível na versão ativa.
- [ ] Botão "Usar esta versão" nas versões não-ativas (gate `products:write`).
- [ ] Modal de confirmação antes de ativar.
- [ ] Toast de sucesso após ativação.
- [ ] `pnpm --filter @elemento/web typecheck && lint` verdes.

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
```

## Notas para o agente

- Leia `apps/web/src/features/products/` completo (RuleTimeline, PublishRuleDrawer, hooks, api).
- O hook de mutation segue o mesmo padrão dos hooks existentes (`useMutation` do TanStack Query).
- DS: badge usa `var(--success)` + `text-xs font-semibold`; botão secundário pequeno.
