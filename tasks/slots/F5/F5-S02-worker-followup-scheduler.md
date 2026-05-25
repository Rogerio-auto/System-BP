---
id: F5-S02
title: Worker followup-scheduler (gated)
phase: F5
task_ref: T5.2
status: done
priority: high
estimated_size: M
agent_id: backend-engineer
claimed_at: 2026-05-25T19:05:06Z
completed_at: 2026-05-25T19:20:08Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/152
depends_on: [F5-S01, F1-S15, F1-S23]
blocks: [F5-S03]
labels: []
source_docs:
  - docs/05-modulos-funcionais.md
  - docs/09-feature-flags.md
---

# F5-S02 — Worker followup-scheduler

## Objetivo

Worker periódico que materializa `followup_jobs` a partir de `followup_rules` quando o critério da regra é satisfeito — **respeita flag `followup.scheduler.enabled`**. Com flag desligada, worker roda dry-run logando o que seria criado, sem inserir.

## Escopo

- Worker `apps/api/src/workers/followup-scheduler.ts`:
  - Tick configurável (default 60s via env `FOLLOWUP_SCHEDULER_TICK_MS`)
  - Para cada `rule WHERE is_active = true`:
    - Identifica leads que atendem `trigger_type`:
      - `stage_inactivity`: `kanban_cards.stage_entered_at < now() - wait_hours` e `applies_to_stage` bate
      - `event_based`: outbox event `lead.last_interaction` mais antigo que `wait_hours` (consumer separado registra timestamp)
    - Calcula `idempotency_key`: `<rule_id>:<lead_id>:<day_bucket>` (1 job por regra/lead/dia)
    - Tenta INSERT em `followup_jobs` — ON CONFLICT por idempotency_key DO NOTHING
    - Log estruturado: `rule_key`, `leads_matched`, `jobs_created`, `dry_run`
  - **Flag-gating em 2 camadas:**
    1. Se `followup.enabled=disabled` → worker não roda (sai cedo, dorme próximo tick)
    2. Se `followup.scheduler.enabled=disabled` → roda lógica mas com `dry_run=true` (apenas loga, não INSERT)
  - Registrar em `apps/api/src/workers/index.ts`
- Testes:
  - Flag off → 0 inserts
  - Flag dry-run → log emitido mas 0 inserts
  - Flag on → inserts criados; tick novamente → 0 novos (idempotência)
  - `applies_to_stage`/`applies_to_outcome` filtra corretamente

## Fora de escopo

- Envio real (F5-S03)
- Cancelamento por resposta (F5-S04)
- UI (F5-S05)

## Arquivos permitidos

```
apps/api/src/workers/followup-scheduler.ts
apps/api/src/workers/index.ts
apps/api/src/workers/__tests__/followup-scheduler.test.ts
apps/api/src/env.ts
.env.example
```

## Definition of Done

- [ ] Worker registrado e sobe junto com `pnpm dev`
- [ ] Flag gating 2 camadas implementado e testado
- [ ] Idempotência por `(rule_id, lead_id, day_bucket)` testada
- [ ] `applies_to_stage`/`applies_to_outcome` filtra corretamente
- [ ] Log estruturado por tick com contadores
- [ ] Env var `FOLLOWUP_SCHEDULER_TICK_MS` documentada em `.env.example`

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- followup-scheduler
```
