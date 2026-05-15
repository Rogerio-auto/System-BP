---
id: F2-S09
title: Worker kanban-on-simulation (consome simulations.generated)
phase: F2
task_ref: T2.8
status: done
priority: medium
estimated_size: S
agent_id: backend-engineer
claimed_at:
completed_at: 2026-05-15T12:51:13Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/60
depends_on: [F2-S04, F1-S13, F1-S15]
blocks: []
labels: []
source_docs:
  - docs/05-modulos-funcionais.md
  - docs/04-eventos.md
---

# F2-S09 — Worker kanban-on-simulation

## Objetivo

Worker que consome o evento `simulations.generated` do outbox (F1-S15) e atualiza o card
do Kanban do lead:

1. Seta `kanban_cards.last_simulation_id` (redundante com F2-S04 que já faz isso na
   mesma transação — mas garante consistência se o evento vier de fonte externa no
   futuro).
2. Move o card para o estágio `simulacao` **se ainda estiver em `pre_atendimento`**.
   Respeita máquina de transições válidas de F1-S13.
3. Emite `kanban.stage_updated` (já existe em F1-S13).

Fecha o ciclo: simulação criada → card move → analytics/UI refletem.

## Escopo

### Worker `apps/api/src/workers/kanban-on-simulation.ts`

- Polling do outbox por eventos `simulations.generated` não processados (`processed_at IS NULL`).
- Batch de 50 por ciclo, intervalo 1s (ou configurável via env).
- Para cada evento:
  1. Carregar `kanban_card` do lead (via `simulation.lead_id`).
  2. Se card já está em `simulacao`, `documentacao` ou `concluido` → apenas marcar evento como processado (idempotente; nada a fazer).
  3. Se card está em `pre_atendimento` → mover para `simulacao` via `kanban.moveCard()`
     do service existente (F1-S13). Service já valida transição + cria `kanban_stage_history`
     - emite `kanban.stage_updated` em transação.
  4. Marcar evento como `processed_at=now()`.
- Erro em um evento NÃO bloqueia os outros (try/catch por item; loga + incrementa contador
  de falha no payload do evento; após 3 falhas, marca `dead_letter=true`).

### Registrar no boot

- Adicionar worker em `apps/api/src/workers/index.ts` (ou onde os workers vivem).
- Logs `pino` com `correlation_id` = `event_id`.

### LGPD

- Worker só lida com IDs (lead_id, card_id, stage_id). Sem PII.

## Arquivos permitidos

- `apps/api/src/workers/kanban-on-simulation.ts`
- `apps/api/src/workers/__tests__/kanban-on-simulation.test.ts`
- `apps/api/src/workers/index.ts` (registrar)
- (Eventualmente) `apps/api/src/modules/kanban/service.ts` — **apenas** se for necessário
  expor um método `moveCardOnSimulation()` para reuso. Se já existe `moveCard()` público,
  não tocar.

## Definition of Done

- [ ] Worker processa evento e move card de `pre_atendimento` → `simulacao`.
- [ ] Idempotente: rodar 2x sobre o mesmo evento não cria histórico duplicado.
- [ ] Cards em estágios pós-`simulacao` não regridem.
- [ ] Falha em um evento não trava os outros do batch.
- [ ] `kanban.stage_updated` emitido pelo service (F1-S13 já cobre).
- [ ] Tests: evento → card move; reprocess → no-op; card em estágio errado → no-op.
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes.
- [ ] PR aberto.

## Validação

```powershell
pnpm --filter @elemento/api test -- kanban-on-simulation
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api typecheck
```
