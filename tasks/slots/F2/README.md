# Fase 2 — Crédito e simulação

> Materializa o roadmap descrito em [docs/11-roadmap-executavel.md](../../../docs/11-roadmap-executavel.md)
> §"Fase 2" e tasks T2.1–T2.8 de [docs/12-tasks-tecnicas.md](../../../docs/12-tasks-tecnicas.md).
> Schema/cálculo/CRUD/endpoints/UI/worker para produtos de crédito, regras versionadas e
> simulações (Price + SAC). Bloqueia a Fase 3 (a tool `generate_credit_simulation` do agente
> IA depende do endpoint `/internal/simulations`).

Slots concretos (9 — Price + SAC unidos em único calculator puro):

| ID     | Título                                                        | Specialist         | Depende de                     | Task |
| ------ | ------------------------------------------------------------- | ------------------ | ------------------------------ | ---- |
| F2-S01 | Schema credit_products + product_rules + simulations + seed   | db-schema-engineer | F0-S04, F1-S09, F1-S13, F1-S15 | T2.1 |
| F2-S02 | Service de cálculo Price + SAC (puro, testável)               | backend-engineer   | —                              | T2.2 |
| F2-S03 | CRUD credit-products + publicação versionada de regras        | backend-engineer   | F2-S01, F1-S04, F1-S15         | T2.3 |
| F2-S04 | Endpoint POST /api/simulations (UI)                           | backend-engineer   | F2-S01, F2-S02, F2-S03, F1-S15 | T2.4 |
| F2-S05 | Endpoint POST /internal/simulations (para IA, idempotente)    | backend-engineer   | F2-S04                         | T2.5 |
| F2-S06 | Frontend simulador interno (form + resultado + amortização)   | frontend-engineer  | F2-S04, F1-S08                 | T2.6 |
| F2-S07 | Frontend gestão de produtos + timeline de versões             | frontend-engineer  | F2-S03, F1-S08                 | T2.3 |
| F2-S08 | Frontend histórico de simulações na ficha do lead             | frontend-engineer  | F2-S04, F1-S12                 | T2.7 |
| F2-S09 | Worker kanban-on-simulation (consome `simulations.generated`) | backend-engineer   | F2-S04, F1-S13, F1-S15         | T2.8 |

## Ordem e paralelismo

Batches sequenciais (sempre com `isolation: "worktree"` quando paralelo):

```
Batch 1 (paralelo, arquivos disjuntos):
   F2-S01   apps/api/src/db/schema/credit/*.ts + migration 0016
   F2-S02   apps/api/src/modules/simulations/calculator.ts (puro, sem app.ts)

Batch 2 (sequencial — app.ts):
   F2-S03   apps/api/src/modules/credit-products/**  (registra plugin)

Batch 3 (sequencial — app.ts):
   F2-S04   apps/api/src/modules/simulations/** + seed permissão (migration 0017)

Batch 4 (paralelo, arquivos disjuntos):
   F2-S05   apps/api/src/modules/simulations/internal-routes.ts (reusa service de F2-S04)
   F2-S07   apps/web/src/{pages,features}/admin/products/**

Batch 5 (paralelo, arquivos disjuntos):
   F2-S06   apps/web/src/features/simulator/**
   F2-S08   apps/web/src/features/crm/components/SimulationHistory.tsx (toca CrmDetail)
   F2-S09   apps/api/src/workers/kanban-on-simulation.ts (toca workers/index.ts)
```

## Feature flag

`credit_simulation.enabled` (doc 09 §3, default `enabled`). UI/API/worker/tool todas
respeitam — gate em 4 camadas (PROTOCOL §1.11).

## Eventos novos (registrar em docs/04-eventos.md)

- `credit.product_created`
- `credit.product_updated`
- `credit.rule_published` (snapshot da regra no payload)
- `simulations.generated` (consumido por kanban + chatwoot-sync; dedupe `unique(simulation_id)`)

## LGPD

Simulações não carregam CPF/email/telefone. `lead_id` aponta para entidade PII — mas o
payload de eventos só carrega IDs + números financeiros. Slots F2-S04/F2-S05 recebem
label `lgpd-impact` por precaução (rotas que recebem dados do titular via referência).
Checklist do doc 17 §14.2 obrigatório nesses 2 PRs.

## Definição da próxima migration

F8-S01 reservou `0014_seed_agents_permission.sql`; F8-S03 reservou `0015_seed_dashboard_permission.sql`.
Logo F2-S01 usa `0016_credit_core.sql` e F2-S04 usa `0017_seed_simulations_permission.sql`.
