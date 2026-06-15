---
id: F17-S06
title: Frontend — ficha do contrato com gestão e saúde de boletos
phase: F17
task_ref: null
status: available
priority: medium
estimated_size: M
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F17-S04, F17-S05, F5-S16]
blocks: []
labels: [contracts, billing, frontend]
source_docs:
  - docs/planejamento-2026-06-evolucao.md#épico-e--contratos-boletos-e-renovação-item-5--épico
  - docs/18-design-system.md
docs_required: true
docs_audience:
  - operador
docs_artifacts:
  - docs/help/guias/contratos/ficha-contrato-boletos.mdx
---

# F17-S06 — Ficha do contrato + saúde de boletos

## Objetivo

Na ficha do contrato, listar as parcelas com anexar/editar boleto (reaproveita o componente de F5-S16) e exibir o indicador de saúde (F17-S04).

## Contexto

Item 5 / Épico E.3. Reaproveita os campos de boleto (F5-S10) e o `BoletoModal` (F5-S16). Saúde derivada de `GET /api/contracts/:id/health`.

## Escopo (faz)

- Tela de ficha do contrato em `apps/web/src/features/contracts/` (detalhe): lista de parcelas + indicador de saúde (badge em dia/a vencer/vencido/inadimplente + % pago).
- Reutilizar o `BoletoModal`/componentes de boleto de `features/billing` por **import** (não editar billing).

## Fora de escopo (NÃO faz)

- Backend de saúde (F17-S04); CRM drill-down (F17-S08).

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/contracts/**`
- `docs/help/guias/contratos/ficha-contrato-boletos.mdx`

## Arquivos proibidos (`files_forbidden`)

- `apps/web/src/features/billing/**` (importar, não editar — F5-S16 é dono)
- `apps/web/src/App.tsx`

## Definition of Done

- [ ] Parcelas + anexar/editar boleto (componente reutilizado) + saúde exibida
- [ ] DS aplicado; doc mdx + `<FeedbackWidget />`
- [ ] `pnpm --filter @elemento/web typecheck && lint && test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web test -- contracts
```

## Notas para o agente

- Depende de F5-S16 (componente de boleto) já mergeado — importe-o, não duplique.
