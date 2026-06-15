---
id: F17-S04
title: Backend — saúde de boletos do contrato (agregação)
phase: F17
task_ref: null
status: blocked
priority: medium
estimated_size: S
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F17-S01, F17-S02, F17-S03]
blocks: [F17-S06]
labels: [contracts, billing, backend]
source_docs:
  - docs/planejamento-2026-06-evolucao.md#épico-e--contratos-boletos-e-renovação-item-5--épico
---

# F17-S04 — Saúde de boletos do contrato

## Objetivo

Calcular o indicador de saúde do contrato (em dia / a vencer / vencido / inadimplente, % pago) a partir de `payment_dues.status` + `due_date`.

## Contexto

Item 5 / Épico E.3. Agregação sobre as parcelas do contrato; alimenta a ficha do contrato na UI (F17-S06).

## Escopo (faz)

- Endpoint `GET /api/contracts/:id/health` no módulo `contracts` (já registrado em `app.ts`).
- Repository com a agregação por contrato (usa `payment_dues.contract_id` de F17-S01); retorna `BoletoHealthSchema` (F17-S02).
- RBAC `contracts:read`; city-scope herdado.

## Fora de escopo (NÃO faz)

- Anexar/editar boleto (já existe via F5-S13/S16); UI (F17-S06).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/contracts/service.ts`
- `apps/api/src/modules/contracts/repository.ts`
- `apps/api/src/modules/contracts/routes.ts`
- `apps/api/src/modules/contracts/controller.ts`
- `apps/api/src/modules/contracts/schemas.ts`
- `apps/api/src/modules/contracts/__tests__/**`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/app.ts` (contracts já registrado em F17-S03)
- `apps/api/src/modules/billing/**`

## Definition of Done

- [ ] Saúde correta para cenários (em dia, 1 vencida, inadimplente, quitado)
- [ ] Sem N+1; usa índices de `payment_dues`
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api test -- contracts
```

## Notas para o agente

- Este slot estende o mesmo módulo de F17-S03; roda **depois** dele (mesmos arquivos) — não em paralelo.
