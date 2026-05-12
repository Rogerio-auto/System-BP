---
id: F1-S25
title: LGPD — direitos do titular (acesso/portabilidade/revogação/correção) + jobs de retenção
phase: F1
task_ref: LGPD §5 §6
status: available
priority: high
estimated_size: L
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F1-S16, F1-S15, F1-S24]
blocks: []
labels: [lgpd-impact]
source_docs:
  - docs/17-lgpd-protecao-dados.md
  - docs/04-eventos.md
  - docs/10-seguranca-permissoes.md
---

# F1-S25 — Direitos do titular + jobs de retenção

## Objetivo

Implementar tecnicamente os direitos do titular (Art. 18 LGPD) com SLA de 15 dias úteis, mais o motor de retenção/anonimização conforme doc 17 §5 e §6. Sem isso o cliente não consegue atender solicitação de cidadão dentro do prazo legal.

## Escopo

### Endpoints (rota base `/api/v1/data-subject`)

Todos exigem desafio de autenticação do titular (CPF + OTP enviado ao canal cadastrado + matching de dados conhecidos). Rate-limit `3/h` por CPF. Idempotência por `request_id`.

- `POST /confirm` — confirmação de tratamento (Art. 19 §1).
- `POST /access-request` — agenda job; entrega export JSON + PDF no canal verificado.
- `POST /portability-request` — alias do access com `format=portable`.
- `POST /consent/revoke` — revoga consentimento (atualiza `customers.consent_revoked_at`, marca todas as flags de follow-up/marketing como off). Idempotente.
- `POST /anonymize-request` — agenda anonimização quando finalidade extinta (regra do §6.2). Requer aprovação do DPO técnico (estado `pending_dpo_review`).
- `POST /delete-request` — agenda eliminação física quando base legal era consentimento e revogado.
- `POST /review-decision/:analysis_id` — solicita revisão humana de decisão automatizada (Art. 20). Bloqueia a decisão original até parecer humano.

Cada solicitação registra linha em `data_subject_requests` (`id, customer_id, type, status, requested_at, fulfilled_at, fulfilled_by, channel, payload_meta`). Estado: `received → in_progress → fulfilled | rejected`.

### Geração do export

- Job `data-subject-export` consome evento `data_subject.access_requested`.
- Compila JSON cobrindo todas as tabelas do doc 17 §3.4 onde o titular aparece (joins por `customer_id` + por `document_hash` para casos órfãos).
- Inclui seção "Suboperadores com quem compartilhamos" (lista do doc 17 §12.1).
- Inclui seção "Bases legais" (extrato do RoPA).
- Gera PDF a partir do JSON com layout simples (template `pdf/access-export.html`).
- Entrega via canal verificado (WhatsApp se opt-in, email caso contrário). Link tem expiração de 7 dias e contador de downloads.

### Jobs de retenção

- `cron-retention` (diário, 03:00 BRT) varre conforme tabela do doc 17 §6.1:
  - Leads sem operação > 90 dias → anonimiza.
  - Customers sem operação > 5 anos → anonimiza.
  - Interactions sem operação > 1 ano → elimina fisicamente.
  - Sessions expiradas > 30 dias → elimina.
  - Logs aplicacionais > 90 dias → move para frio.
- `cron-retention` produz relatório em `retention_runs` (linhas afetadas, decisões, erros).
- Falha de job → alerta crítico.

### Anonimização (helper canônico)

- `apps/api/src/services/lgpd/anonymize.ts`:
  - `anonymizeCustomer(tx, customer_id)` — substitui PII por tokens irreversíveis, mantém PK e FKs, deixa flag `anonymized_at`.
  - `anonymizeLead(tx, lead_id)` — idem.
  - Sempre dentro de transação + emit evento `customer.anonymized` (via outbox, sem PII no payload).

### Eventos novos (catálogo doc 04)

- `data_subject.access_requested`
- `data_subject.access_fulfilled`
- `data_subject.consent_revoked`
- `data_subject.anonymized`
- `data_subject.deletion_completed`
- `data_subject.review_requested`

### Audit

Toda solicitação e toda ação executada gera linha em `audit_logs`. Acesso a export de outra pessoa por operador interno também é auditado.

## Arquivos permitidos

- `apps/api/src/db/schema/data_subject.ts`
- `apps/api/src/db/migrations/000X_data_subject.sql`
- `apps/api/src/services/lgpd/anonymize.ts`
- `apps/api/src/services/lgpd/export.ts`
- `apps/api/src/controllers/data-subject.controller.ts`
- `apps/api/src/routes/data-subject.routes.ts`
- `apps/api/src/workers/cron-retention.ts`
- `apps/api/src/workers/data-subject-export.ts`
- `apps/api/src/events/types.ts` (adicionar eventos novos)
- `docs/04-eventos.md` (registrar eventos)
- `docs/17-lgpd-protecao-dados.md` (marcar itens do §16)
- Testes correspondentes (`*.test.ts`)

## Definition of Done

- [ ] 7 endpoints existem, validados Zod, rate-limited, auditados.
- [ ] Desafio do titular implementado (CPF + OTP por canal verificado).
- [ ] Export consolidado cobre 100% das tabelas do §3.4 (teste por tabela).
- [ ] Anonimização preserva integridade referencial (FK intacta, audit preservado).
- [ ] Eliminação física só ocorre quando base legal era consentimento revogado.
- [ ] `cron-retention` roda em dry-run sem dado real e em DB com seed; relatório verificável.
- [ ] Direito de revisão (Art. 20) bloqueia decisão automatizada original.
- [ ] Eventos LGPD não carregam PII bruta no payload.
- [ ] SLA do worker de export é monitorado (alerta se > 15 dias úteis).
- [ ] PR com label `lgpd-impact` e checklist do doc 17 §14.2.

## Validação

```powershell
pnpm --filter @elemento/api test -- data-subject lgpd retention
pnpm --filter @elemento/api db:migrate
pnpm lint
pnpm typecheck
```
