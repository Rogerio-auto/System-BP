---
id: F15-S07
title: Backend — service de status SPC (transições + auditoria)
phase: F15
task_ref: null
status: review
priority: medium
estimated_size: S
agent_id: null
claimed_at: 2026-06-15T20:09:32Z
completed_at: 2026-06-15T20:20:18Z
pr_url: null
depends_on: [F15-S01, F15-S02, F15-S04]
blocks: [F15-S11]
labels: [spc, backend, rbac, lgpd]
source_docs:
  - docs/planejamento-2026-06-evolucao.md#f2-role-de-cobrança-dashboard-status-spc-item-9
  - docs/10-seguranca-permissoes.md
  - docs/17-lgpd-protecao-dados.md
---

# F15-S07 — Backend service de status SPC

## Objetivo

Permitir que a cobrança avance o ciclo de vida do SPC do cliente (`none` → `pending_inclusion` → `included` → `removed`) com validação de transição, auditoria e datas.

## Contexto

Item 9 / Épico F.2b. O sistema não automatiza a inclusão real no Serasa/SPC — apenas rastreia a decisão humana. Endpoints ficam no módulo `billing` (já registrado em `app.ts`), evitando colisão de wiring.

## Escopo (faz)

- Estender `apps/api/src/modules/billing/` com endpoints SPC: `GET /api/billing/customers/:id/spc`, `POST /api/billing/customers/:id/spc` (muda status, valida transição válida, seta `spc_changed_at`).
- RBAC `spc:read`/`spc:manage`; `applyCityScope` via `customer → lead → city_id`.
- Audit log de cada transição (quem, de→para, quando); idempotência.

## Fora de escopo (NÃO faz)

- Criação automática de tarefa/notificação ao passar 15d (F15-S08).
- UI de tag/badge SPC (F15-S11).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/billing/service.ts`
- `apps/api/src/modules/billing/repository.ts`
- `apps/api/src/modules/billing/routes.ts`
- `apps/api/src/modules/billing/controller.ts`
- `apps/api/src/modules/billing/schemas.ts`
- `apps/api/src/modules/billing/__tests__/**`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/app.ts` (billing já registrado — não tocar)
- `apps/web/**` (F5-S16 atua aqui em paralelo)
- `apps/api/src/db/schema/**`

## Contratos de entrada

- `customers.spc_status` (F15-S02), `SpcStatusSchema`/`SpcUpdateSchema` (F15-S04), permissões (F15-S01).

## Contratos de saída

- Endpoints SPC consumíveis pelo dashboard de cobrança (F15-S11).

## Definition of Done

- [ ] Transições inválidas rejeitadas (ex.: `none` → `removed`)
- [ ] Audit log + idempotência aplicados
- [ ] RBAC + city-scope testados (positivo/negativo)
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- billing
```

## Notas para o agente

- Não toque em `apps/web/**`: F5-S16 mexe na UI de billing em paralelo (worktrees diferentes, mas evite confusão de contrato — siga F15-S04).
- A tag visual no CRM é **derivada** deste status; não crie coluna nova.
