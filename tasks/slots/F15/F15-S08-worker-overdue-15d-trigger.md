---
id: F15-S08
title: Backend — worker de inadimplência 15d → cria tarefa SPC + evento de notificação
phase: F15
task_ref: null
status: available
priority: medium
estimated_size: M
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F15-S05, F15-S06, F15-S07]
blocks: []
labels: [worker, outbox, cobranca, spc]
source_docs:
  - docs/planejamento-2026-06-evolucao.md#f2-role-de-cobrança-dashboard-status-spc-item-9
  - docs/04-eventos.md
---

# F15-S08 — Worker inadimplência 15d → tarefa + notificação

## Objetivo

Detectar parcelas com 15+ dias de atraso de clientes ainda `spc_status='none'` e, de forma idempotente, criar uma tarefa `spc_inclusion` (role `cobranca`, escopo da cidade do cliente) + emitir evento de notificação.

## Contexto

Item 9 / Épico F.2b+d. A regra dos "15 dias" não automatiza a inclusão no SPC — gera a **tarefa** e **notifica** o time. Reaproveita o padrão dos workers existentes (`collection-scheduler`) e o outbox.

## Escopo (faz)

- Worker `apps/api/src/workers/spc-overdue-scan.ts` (cron, no padrão de `collection-scheduler.ts`): varre `payment_dues` vencidas 15+ dias com cliente `none`, cria `task` (via service de F15-S05) idempotentemente (1 tarefa aberta por cliente/parcela), marca `spc_status='pending_inclusion'` opcionalmente ou deixa para a ação humana (seguir doc).
- Definir o evento `payment_due.overdue_15d` em `apps/api/src/events/types.ts` e emiti-lo via outbox (consumido pelo fan-out de F15-S06).
- Registrar o worker em `apps/api/src/workers/index.ts`.

## Fora de escopo (NÃO faz)

- Inclusão real no SPC (ação externa humana).
- Fan-out de notificação em si (F15-S06 já implementa o handler).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/workers/spc-overdue-scan.ts`
- `apps/api/src/workers/index.ts`
- `apps/api/src/workers/__tests__/**`
- `apps/api/src/events/types.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/modules/**` (consome services via import, não edita)
- `apps/api/src/handlers/**`

## Contratos de entrada

- Service de tarefas (F15-S05), fan-out de notificação (F15-S06), `spc_status` (F15-S02/S07).

## Contratos de saída

- Tarefas `spc_inclusion` criadas + evento `payment_due.overdue_15d` no outbox.

## Definition of Done

- [ ] Idempotência: rodar 2x não cria tarefas duplicadas nem reabre cliente já incluído
- [ ] Tarefa criada com `assignee_role='cobranca'` e `city_id` do cliente
- [ ] Evento emitido sem PII bruta
- [ ] Teste de cenário (parcela 14d não dispara; 15d dispara; cliente já `included` ignora)
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- spc-overdue
```

## Notas para o agente

- `events/types.ts` é compartilhado com F15-S05 (que roda antes); adicione o novo evento sem remover os existentes.
- Espelhe o agendamento/locking do `collection-scheduler.ts` (sem Redis no MVP — outbox).
