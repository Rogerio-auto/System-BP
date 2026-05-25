---
id: F5-S06
title: Schema payment_dues + collection_rules + collection_jobs
phase: F5
task_ref: T5.6
status: in-progress
priority: medium
estimated_size: M
agent_id: db-schema-engineer
claimed_at: 2026-05-25T16:34:30Z
completed_at: null
pr_url: null
depends_on: [F5-S01, F1-S09, F1-S15, F1-S23, F1-S24]
blocks: [F5-S07, F5-S08]
labels: [lgpd-impact]
source_docs:
  - docs/03-modelo-dados.md
  - docs/05-modulos-funcionais.md
  - docs/17-lgpd-protecao-dados.md
---

# F5-S06 — Schema payment_dues + collection_rules + collection_jobs

## Objetivo

Materializar a régua de cobrança escalonada (D-3, D+0, D+7, D+15, …) para inadimplência. **Visível mas desligada por flag** (`billing.enabled=disabled`). Sem este slot, há intent `cobranca` no LangGraph apontando para o nada.

## Escopo

- Migration `0036_collection.sql` cria:
  - `payment_dues` — parcelas a vencer/vencidas por customer
  - `collection_rules` — regras temporais (espelho de `followup_rules`)
  - `collection_jobs` — instâncias agendadas (espelho de `followup_jobs`)
- Schemas Drizzle em `apps/api/src/db/schema/`
- Entry no `meta/_journal.json` no mesmo commit
- Seed de flags: `billing.enabled=disabled`, `billing.scheduler.enabled=disabled`, `billing.sender.enabled=disabled`

### Tabela `payment_dues`

| Coluna                 | Tipo                                                                               | Notas              |
| ---------------------- | ---------------------------------------------------------------------------------- | ------------------ |
| id                     | uuid PK                                                                            |                    |
| organization_id        | uuid NOT NULL FK                                                                   |                    |
| customer_id            | uuid NOT NULL FK customers ON DELETE RESTRICT                                      |                    |
| contract_reference     | text NOT NULL                                                                      | número do contrato |
| installment_number     | int NOT NULL                                                                       |                    |
| due_date               | date NOT NULL                                                                      |                    |
| amount                 | numeric(14,2) NOT NULL                                                             |                    |
| status                 | text NOT NULL CHECK IN (`pending`, `paid`, `overdue`, `renegotiated`, `cancelled`) |                    |
| paid_at                | timestamptz NULL                                                                   |                    |
| origin                 | text NOT NULL CHECK IN (`manual`, `import`)                                        |                    |
| created_by             | uuid NULL FK users                                                                 |                    |
| created_at, updated_at | timestamptz                                                                        |                    |

Índices:

- `unique (contract_reference, installment_number)` — dedupe
- `idx_payment_dues_status_due (status, due_date) WHERE status IN ('pending','overdue')` (parcial)
- `idx_payment_dues_customer (customer_id, due_date DESC)`

### Tabela `collection_rules`

Estrutura idêntica a `followup_rules`, mas com:

- `trigger_type` CHECK IN (`days_before_due`, `days_after_due`) — não `stage_inactivity`
- `wait_hours` representa offset em horas relativo a `due_date` (negativo = antes, positivo = depois)
- `applies_to_stage`/`applies_to_outcome` substituídos por `applies_to_status` (de `payment_dues`)

### Tabela `collection_jobs`

| Coluna                                                      | Tipo                                                                                                 | Notas |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----- |
| id                                                          | uuid PK                                                                                              |       |
| organization_id                                             | uuid NOT NULL FK                                                                                     |       |
| payment_due_id                                              | uuid NOT NULL FK payment_dues ON DELETE CASCADE                                                      |       |
| rule_id                                                     | uuid NOT NULL FK collection_rules ON DELETE RESTRICT                                                 |       |
| scheduled_at                                                | timestamptz NOT NULL                                                                                 |       |
| status                                                      | text NOT NULL CHECK IN (`scheduled`, `triggered`, `sent`, `failed`, `cancelled`, `paid_before_send`) |       |
| attempt_count, last_error, sent_message_id, idempotency_key | iguais a `followup_jobs`                                                                             |       |
| created_at, updated_at                                      | timestamptz                                                                                          |       |

Índices: `unique (payment_due_id, rule_id, idempotency_key)`, `idx_collection_jobs_scheduled` parcial.

## LGPD

- **Base legal:** Art. 7º V (execução de contrato) — cobrança é cumprimento de obrigação contratual.
- **PII:** `contract_reference` é dado financeiro, não pessoal estrito; nenhum CPF na tabela (vincula via `customer_id`).
- **Retenção:** `payment_dues` mantido por **5 anos** após `paid_at`/`renegotiated`, conforme legislação fiscal (alinhado com `audit_logs`).
- **Outbox:** payloads carregam apenas IDs.

## Fora de escopo

- Workers (F5-S07)
- UI (F5-S08)
- Importação de payment_dues (entra como sub-escopo de F5-S08 ou slot futuro)

## Arquivos permitidos

```
apps/api/src/db/schema/paymentDues.ts
apps/api/src/db/schema/collectionRules.ts
apps/api/src/db/schema/collectionJobs.ts
apps/api/src/db/schema/index.ts
apps/api/src/db/migrations/0036_collection.sql
apps/api/src/db/migrations/meta/_journal.json
apps/api/src/db/seeds/featureFlags.ts
```

## Definition of Done

- [ ] Migration 0036 criada com header padrão
- [ ] 3 tabelas com FKs explícitas e índices nomeados
- [ ] `set_updated_at` trigger nas 3 tabelas
- [ ] Entry em `_journal.json`
- [ ] `check-migrations` verde
- [ ] Schemas Drizzle exportados
- [ ] Flags `billing.*` semeadas em `disabled`
- [ ] PR com label `lgpd-impact` + checklist doc 17 (base legal: Art. 7º V)

## Validação

```powershell
python scripts/slot.py check-migrations
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api db:migrate
```
