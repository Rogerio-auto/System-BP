---
id: F4-S02
title: Backend — service + endpoints CRUD de credit_analyses (RBAC + Art. 20)
phase: F4
task_ref: T4.2
status: done
priority: critical
estimated_size: L
agent_id: backend-engineer
claimed_at: 2026-05-25T13:41:42Z
completed_at: 2026-05-25T13:56:06Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/141
depends_on: [F4-S01, F1-S04, F1-S15, F1-S16]
blocks: [F4-S03, F4-S04, F4-S05]
labels: [lgpd-impact]
source_docs:
  - docs/05-modulos-funcionais.md
  - docs/10-seguranca-permissoes.md
  - docs/04-eventos.md
  - docs/17-lgpd-protecao-dados.md
---

# F4-S02 — Backend service + endpoints CRUD de credit_analyses

## Objetivo

Expor a análise de crédito via HTTP para que o analista humano crie, atualize (nova versão imutável) e consulte pareceres. Toda decisão fica registrada com autor, timestamp e versionamento — atende Art. 20 §1º (registro auditável) e §5 (direito de revisão por humano) da LGPD.

## Escopo

- Módulo `apps/api/src/modules/credit-analyses/`:
  - `repository.ts` — queries CRUD com `applyCityScope` injetado
  - `service.ts` — orquestração transacional (criar análise, criar nova versão, atualizar `current_version_id`, emitir evento, audit log)
  - `controller.ts` — handlers Fastify
  - `schemas.ts` — Zod request/response
  - `routes.ts` — rotas listadas abaixo com `authenticate()` + `authorize()`
  - `index.ts` — registra plugin
  - `__tests__/credit-analyses.routes.test.ts` — integração + RBAC + city-scope
- Migration `0033_seed_credit_analyses_permissions.sql`:
  - Permissões: `credit_analyses:read`, `credit_analyses:write`, `credit_analyses:decide`, `credit_analyses:request_review`
  - Atribuições por role:
    - `admin` → todas
    - `gestor_geral` / `gestor_regional` → read + write + decide (regional city-scoped)
    - `agente` → read (city-scoped, só leads atribuídos)
- Plugin registrado em `apps/api/src/app.ts`

### Rotas

```
GET    /api/credit-analyses                     (credit_analyses:read, city-scoped)
GET    /api/credit-analyses/:id                 (credit_analyses:read, city-scoped)
GET    /api/leads/:leadId/credit-analyses       (credit_analyses:read, city-scoped) — histórico do lead
POST   /api/credit-analyses                     (credit_analyses:write) — cria análise + 1ª versão em tx
POST   /api/credit-analyses/:id/versions        (credit_analyses:write) — nova versão imutável
POST   /api/credit-analyses/:id/decide          (credit_analyses:decide) — promove status a aprovado/recusado
POST   /api/credit-analyses/:id/request-review  (credit_analyses:request_review) — Art. 20 §5
```

### Service — invariantes

1. **Criar análise:** insere em `credit_analyses` + insere `version=1` em `credit_analysis_versions` + atualiza `current_version_id` + grava `audit_logs` + emite `credit_analysis.created` no outbox — **tudo em 1 transação**.
2. **Nova versão:** insere `version = max+1` em `credit_analysis_versions` + atualiza `current_version_id` + atualiza campos derivados (`status`, `approved_amount`, etc) em `credit_analyses` + audit + outbox `credit_analysis.version_added` — **1 transação**.
3. **Decidir:** mesmo fluxo de nova versão, mas valida transição de status (`em_analise|pendente → aprovado|recusado`); emite `credit_analysis.status_changed` para o worker do Kanban (F4-S05) consumir.
4. **Request-review:** insere nova versão `status=em_analise` com `parecer_text="Revisão solicitada pelo titular (LGPD Art. 20 §5)"`, audit e outbox `credit_analysis.review_requested`. Bloqueia novas decisões automáticas até parecer humano.

### Validação Zod

- `parecer_text`: 10–5000 caracteres, **rejeita** se regex defensiva detectar CPF (`\d{3}\.?\d{3}\.?\d{3}-?\d{2}`) ou RG bruto — mensagem clara para o analista usar referência mascarada.
- `attachments[].sha256`: 64 chars hex.
- `attachments[].storage_key`: começa com `credit-analyses/<organization_id>/` para escopo de bucket.

### Eventos (outbox, na mesma transação)

| Evento                             | Quando                | Payload (sem PII bruta)                                        |
| ---------------------------------- | --------------------- | -------------------------------------------------------------- |
| `credit_analysis.created`          | nova análise          | `{ analysis_id, lead_id, organization_id, status, origin }`    |
| `credit_analysis.version_added`    | nova versão           | `{ analysis_id, version, status, version_id }`                 |
| `credit_analysis.status_changed`   | decisão               | `{ analysis_id, lead_id, from_status, to_status, version_id }` |
| `credit_analysis.review_requested` | titular pediu revisão | `{ analysis_id, lead_id, requested_by_user_id }`               |

### Permissões adicionadas (migration 0033 seed)

| Permissão                        | admin | gestor_geral | gestor_regional | agente                        |
| -------------------------------- | ----- | ------------ | --------------- | ----------------------------- |
| `credit_analyses:read`           | ✅    | ✅           | ✅ (city)       | ✅ (own city + assigned lead) |
| `credit_analyses:write`          | ✅    | ✅           | ✅ (city)       | ❌                            |
| `credit_analyses:decide`         | ✅    | ✅           | ✅ (city)       | ❌                            |
| `credit_analyses:request_review` | ✅    | ✅           | ✅              | ✅ (somente leads atribuídos) |

## LGPD

PR recebe label `lgpd-impact` + checklist [doc 17 §14.2](../../../docs/17-lgpd-protecao-dados.md). Pontos:

- **Art. 20 §1º** — toda decisão tem `analyst_user_id`, `created_at`, `parecer_text`, versão anterior preservada. Registro auditável atendido.
- **Art. 20 §5** — endpoint `/request-review` cria versão `em_analise` e bloqueia status terminal até nova decisão humana. SLA 15 dias — não enforced aqui (worker de SLA é slot futuro), mas evento emitido para dashboard.
- **DLP do parecer:** regex defensiva no Zod rejeita CPF/RG bruto. Operador é orientado a usar `customer_id` para referência.
- **Outbox sem PII bruta:** payloads só carregam IDs e status.
- **Audit:** toda mutação em `audit_logs` com `before`/`after` mascarados (`parecer_text` truncado em 200 chars no audit).
- **Logs estruturados:** `pino.redact` cobre `parecer_text`, `attachments`, `internal_score`.

## Fora de escopo

- Frontend (F4-S03)
- Tool LangGraph de leitura (F4-S04)
- Worker que move card do Kanban (F4-S05)
- Upload físico de anexos (slot futuro de storage)

## Arquivos permitidos

```
apps/api/src/modules/credit-analyses/repository.ts
apps/api/src/modules/credit-analyses/service.ts
apps/api/src/modules/credit-analyses/controller.ts
apps/api/src/modules/credit-analyses/schemas.ts
apps/api/src/modules/credit-analyses/routes.ts
apps/api/src/modules/credit-analyses/index.ts
apps/api/src/modules/credit-analyses/__tests__/credit-analyses.routes.test.ts
apps/api/src/modules/credit-analyses/__tests__/credit-analyses.service.test.ts
apps/api/src/app.ts
apps/api/src/db/migrations/0033_seed_credit_analyses_permissions.sql
apps/api/src/db/migrations/meta/_journal.json
apps/api/src/db/seed/permissions.ts
apps/api/src/events/types.ts
```

## Definition of Done

- [ ] 7 rotas implementadas com Zod request/response
- [ ] Service garante atomicidade (insert análise + versão + outbox + audit em 1 tx)
- [ ] Transição de status validada (`em_analise|pendente → aprovado|recusado` ou `request-review → em_analise`)
- [ ] RBAC + city-scope testado (admin ✅, gestor_regional dentro/fora da cidade ✅/❌, agente apenas leads atribuídos)
- [ ] Regex CPF/RG no Zod rejeita parecer bruto (teste explícito)
- [ ] Migration 0033 com 4 permissões + atribuições, idempotente
- [ ] Events `credit_analysis.*` adicionados em `events/types.ts`
- [ ] Cobertura: criar, nova versão, decidir, request-review, listar (filtrada), 403 fora do escopo
- [ ] PR com label `lgpd-impact` + checklist doc 17

## Validação

```powershell
python scripts/slot.py check-migrations
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- credit-analyses
```
