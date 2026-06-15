---
id: F17-S05
title: Frontend — aba Contratos + ação "marcar como assinado"
phase: F17
task_ref: null
status: blocked
priority: high
estimated_size: M
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F17-S02, F17-S03]
blocks: [F17-S06]
labels: [contracts, frontend]
source_docs:
  - docs/planejamento-2026-06-evolucao.md#épico-e--contratos-boletos-e-renovação-item-5--épico
  - docs/18-design-system.md
docs_required: true
docs_audience:
  - operador
docs_artifacts:
  - docs/help/guias/contratos/aba-contratos.mdx
---

# F17-S05 — Frontend aba Contratos

## Objetivo

Criar a aba **Contratos** (lista por status) e a ação "marcar como assinado", consumindo a API de F17-S03.

## Contexto

Item 5 / Épico E.2. Quando o cliente assina, o agente aciona no sistema → aparece na aba de contratos.

## Escopo (faz)

- Feature `apps/web/src/features/contracts/` (lista filtrável por status, ficha resumida, ação "marcar assinado" com confirmação) — TanStack Query lendo o contrato Zod real (F17-S02).
- Rota no `App.tsx` (roteador real) + acesso pela navegação viva.
- DS aplicado; estados vazio/carregando/erro. Doc `docs/help/guias/contratos/aba-contratos.mdx`.

## Fora de escopo (NÃO faz)

- Ficha detalhada com saúde de boletos (F17-S06); drill-down do cliente no CRM (F17-S08).

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/contracts/**`
- `apps/web/src/App.tsx`
- `docs/help/guias/contratos/aba-contratos.mdx`

## Arquivos proibidos (`files_forbidden`)

- `apps/web/src/features/crm/**`
- `apps/web/src/features/billing/**`

## Definition of Done

- [ ] Lista por status; ação assinar com confirmação e gate `contracts:sign`
- [ ] DS aplicado (tokens, sem hex hardcoded); doc mdx + `<FeedbackWidget />`
- [ ] `pnpm --filter @elemento/web typecheck && lint && test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test -- contracts
```

## Notas para o agente

- `App.tsx` é o roteador real e é tocado por outros slots de front (F15-S10) em fases paralelas — rebase em main atualizado ao mergear.
- Ler contrato Zod real (F17-S02) — evitar drift. Rodar teste WEB ao tocar mdx.
