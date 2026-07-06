---
id: F25-S01
title: DB — canonical_role em kanban_stages + ator 'ai' no audit + event types do funil
phase: F25
task_ref: docs/22-agente-interno-acoes.md
status: in-progress
priority: high
estimated_size: M
agent_id: null
depends_on: []
blocks: [F25-S02, F25-S03, F25-S05]
labels: [db-schema, ai-agent, multi-tenant]
source_docs: [docs/22-agente-interno-acoes.md, docs/03-modelo-dados.md, docs/04-eventos.md]
docs_required: false
claimed_at: 2026-07-06T23:48:50Z
---

# F25-S01 — DB: máquina de estados canônica do funil + ator de IA no audit

## Objetivo

Resolver o drift doc×código dos stages (doc 22 §3.3) e dar identidade de ator à IA (§8.A),
criando a fundação de dados para as ações do agente no funil.

## Contexto

Hoje os workers de Kanban resolvem stage por `orderIndex` mágico (0/1/3) e heurística de nome
(`apps/api/src/workers/kanban-on-simulation.ts:85-88`, `kanban-on-analysis.ts:101`). Doc 22 §3
exige um mapa de estágios canônico explícito. E o audit hoje registra ações de sistema como
`actor: null` — insuficiente para distinguir decisão de IA (LGPD Art. 20, doc 22 §8.A).

## Escopo (faz)

- Coluna `canonical_role` em `kanban_stages` — enum textual:
  `pre_atendimento | simulacao | documentacao | analise_credito | concluido_ganho | concluido_perdido`
  (nullable para stages custom de orgs futuras). Índice `(organization_id, canonical_role)`.
- Backfill dos stages existentes do Banco do Povo por `orderIndex`/flags terminais (data migration
  idempotente no mesmo `.sql`).
- Suporte a `actor_type='ai'` no audit: se `audit_logs` já tem coluna de tipo de ator, adicionar o
  valor `ai` ao domínio; se não, adicionar coluna `actor_type` (`user | system | ai`, default `user`)
  sem quebrar linhas existentes. Verificar `apps/api/src/db/schema/auditLogs.ts` antes.
- Registrar os event types novos (contrato de payload, sem PII) em `apps/api/src/events/types.ts`:
  `leads.qualified`, `leads.stagnant`, `leads.abandoned` (aggregate `lead`, IDs opacos + reason/status).
- Schemas Drizzle + migration `.sql` + entry em `meta/_journal.json`.

## Fora de escopo (NÃO faz)

- Qualquer worker, rota, tool ou lógica de aplicação (F25-S03/S05).
- Seed de permissões/flags (F25-S02).
- Refactor dos workers existentes p/ usar `canonical_role` (F25-S03).

## Arquivos permitidos

- `apps/api/src/db/schema/kanbanStages.ts`
- `apps/api/src/db/schema/auditLogs.ts`
- `apps/api/src/db/schema/index.ts`
- `apps/api/src/events/types.ts`
- `apps/api/src/db/migrations/0080_funnel_state_machine.sql`
- `apps/api/src/db/migrations/meta/_journal.json`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/modules/**`
- `apps/api/src/workers/**`

## Definition of Done

- [ ] `canonical_role` em `kanban_stages` + índice + backfill idempotente dos stages BdP
- [ ] `actor_type='ai'` suportado em `audit_logs` sem quebrar linhas existentes
- [ ] Event types `leads.qualified`/`leads.stagnant`/`leads.abandoned` tipados (sem PII)
- [ ] Migration aplica limpo em DB existente e novo; entry no `_journal.json`
- [ ] `pnpm --filter @elemento/api typecheck` verde

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
python scripts/slot.py validate F25-S01
```

## Notas para o agente

- **Migration:** `0080` é sugestão; se F24 em voo tiver consumido, use a próxima livre e atualize o journal.
- Backfill: `pre_atendimento`←orderIndex 0; `simulacao`←1; `documentacao`←2; `analise_credito`←3;
  `concluido_ganho`←`isTerminalWon`; `concluido_perdido`←`isTerminalLost`. Idempotente (WHERE canonical_role IS NULL).
- Sem `any`. Não carregar PII em nenhum payload de evento (doc 17 §8.5).
