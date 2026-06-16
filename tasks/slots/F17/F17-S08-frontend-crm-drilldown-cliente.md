---
id: F17-S08
title: Frontend — CRM drill-down do cliente (ficha com contratos e boletos)
phase: F17
task_ref: null
status: review
priority: medium
estimated_size: M
agent_id: null
claimed_at: 2026-06-15T22:09:32Z
completed_at: 2026-06-15T22:22:07Z
pr_url: null
depends_on: [F17-S02, F17-S07]
blocks: []
labels: [crm, contracts, frontend]
source_docs:
  - docs/planejamento-2026-06-evolucao.md#épico-e--contratos-boletos-e-renovação-item-5--épico
  - docs/18-design-system.md
docs_required: true
docs_audience:
  - operador
docs_artifacts:
  - docs/help/guias/crm/ficha-cliente-contratos.mdx
---

# F17-S08 — CRM drill-down do cliente

## Objetivo

Ao clicar na linha do cliente no CRM, abrir a ficha com dados, histórico, contratos e **boletos** (consome `GET /api/customers/:id/overview`).

## Contexto

Item 5 / Épico E.4. Conecta a visão lead à visão cliente pós-conversão.

## Escopo (faz)

- Estender `apps/web/src/features/crm/` com a ficha/drawer de cliente: abas dados, histórico, contratos (com saúde), boletos.
- TanStack Query lendo o contrato Zod real (F17-S02); DS aplicado; estados vazio/erro.
- Doc `docs/help/guias/crm/ficha-cliente-contratos.mdx`.

## Fora de escopo (NÃO faz)

- Backend (F17-S07); aba global de contratos (F17-S05).

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/crm/**`
- `docs/help/guias/crm/ficha-cliente-contratos.mdx`

## Arquivos proibidos (`files_forbidden`)

- `apps/web/src/features/contracts/**`
- `apps/web/src/App.tsx`

## Definition of Done

- [ ] Drill-down abre ficha com contratos + boletos + histórico
- [ ] Reaproveita componentes de contrato/boleto por import (sem duplicar)
- [ ] DS aplicado; doc mdx + `<FeedbackWidget />`
- [ ] `pnpm --filter @elemento/web typecheck && lint && test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web test -- crm
```

## Notas para o agente

- Memória `regression-guard`: o CRM teve fixes históricos — rode o teste do CRM antes/depois e não reverta correções de rota/modal.
- `feedback_web_live_router_nav`: navegação real via `App.tsx` (dono é outro slot) — abra a ficha como drawer/rota dentro de `features/crm` sem editar o roteador.
