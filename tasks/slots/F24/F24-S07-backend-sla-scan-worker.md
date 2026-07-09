---
id: F24-S07
title: Backend — worker notification-sla-scan (estagnação em estágios)
phase: F24
task_ref: docs/planejamento-notificacoes.md
status: review
priority: high
estimated_size: L
agent_id: null
depends_on: [F24-S04, F24-S05, F24-S06]
blocks: [F24-S14]
labels: [backend, notifications, worker, multi-tenant]
source_docs: [docs/planejamento-notificacoes.md, docs/09-feature-flags.md]
docs_required: false
claimed_at: 2026-07-09T19:03:14Z
completed_at: 2026-07-09T20:19:07Z
---

# F24-S07 — Backend: worker de estagnação

## Objetivo

Criar o worker periódico `notification-sla-scan` que varre as regras `stage_inactivity`, encontra
entidades paradas além do `threshold_hours` e dispara notificações uma vez por janela de cooldown.

## Contexto

Planejamento §3/§4.1/§4.3. Padrão de worker periódico = `workers/followup-scheduler.ts`
(loop `while + sleep`, triple-gate por flags), registrado no grupo `periodic` do `supervisor.ts`.
Gate `notifications.sla.enabled`. Reusa o dispatch e o dedup de F24-S06 e os destinatários de F24-S05.
Eixos de inatividade e timestamps mapeados no planejamento §3.

## Escopo (faz)

- `workers/notification-sla-scan.ts`: loop com tick configurável; por org, para cada regra
  `stage_inactivity` `enabled`, consultar a fonte do eixo (`kanban_cards.entered_stage_at`,
  `chatwoot_handoffs` requested, `credit_simulations.sent_at` sem inbound, `credit_analyses` pendente,
  `contracts` draft, `payment_dues` overdue, `conversations`/`ai_conversation_states`), filtrar por
  `threshold_hours`, dedup via `notification_rule_deliveries` (bucket por janela de cooldown), despachar.
- Registro no `supervisor.ts` (grupo `periodic`) + script `worker:notification-sla` em `package.json`.
- Gate `notifications.sla.enabled` via `requireFlag` antes de qualquer trabalho.
- Testes: detecção de estagnação por eixo, threshold, cooldown (disparo único).

## Fora de escopo (NÃO faz)

- Gatilhos de evento (F24-S06).
- UI / tempo real.

## Arquivos permitidos

- `apps/api/src/workers/notification-sla-scan.ts`
- `apps/api/src/workers/supervisor.ts`
- `apps/api/src/modules/notification-rules/sla-sources.ts`
- `apps/api/src/workers/__tests__/notification-sla-scan.test.ts`
- `apps/api/package.json`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/db/migrations/**`
- `apps/api/src/handlers/**`

## Definition of Done

- [ ] Worker varre regras `stage_inactivity` por org com gate `notifications.sla.enabled`
- [ ] Cada eixo de inatividade consultado pela fonte de timestamp correta
- [ ] Threshold + cooldown via `notification_rule_deliveries` (disparo único por janela)
- [ ] Registrado no supervisor (grupo `periodic`) + script npm
- [ ] Reusa dispatch/destinatários de S05/S06 (sem duplicar)
- [ ] Testes verdes; `pnpm --filter @elemento/api typecheck` + `lint` + `test` verdes

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
python scripts/slot.py validate F24-S07
```

## Notas para o agente

- Não criar agendador central — seguir o padrão tick de `followup-scheduler.ts`.
- `bucket` por janela: ex. `floor(now/cooldown_hours)` ou `YYYY-MM-DD` conforme a granularidade da regra.
- Performance: consultar só orgs com regras ativas; índices de F24-S01.
