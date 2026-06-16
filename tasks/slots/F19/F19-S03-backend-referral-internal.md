---
id: F19-S03
title: Backend — ação "encaminhar para advocacia" + /internal/law-firm-status
phase: F19
task_ref: docs/planejamento-2026-06-evolucao.md
status: review
priority: high
estimated_size: M
agent_id: null
claimed_at: 2026-06-16T15:39:48Z
completed_at: 2026-06-16T16:07:53Z
pr_url: null
depends_on: [F19-S01, F19-S02]
blocks: [F19-S05, F19-S06]
labels: [backend, advocacia, whatsapp, langgraph, lgpd]
source_docs:
  - docs/planejamento-2026-06-evolucao.md
  - docs/17-lgpd-protecao-dados.md
  - docs/04-eventos.md
docs_required: false
---

# F19-S03 — Backend: encaminhamento advocacia + /internal

## Objetivo

Implementar a ação de encaminhar cliente para advogado (canal humano e IA), com cooldown 7 dias, auditoria, evento outbox e endpoint /internal para o LangGraph verificar elegibilidade.

## Contexto

Item 10 / F.3b e F.3c. Ponto central: liga agente humano/IA à ação de repasse. O LangGraph consome `/internal/law-firm-status` para decidir se deve enviar o contato automaticamente. LGPD §12: compartilhamento com terceiro (escritório) = base legal execução de contrato/cobrança; registrar.

## Escopo (faz)

### `POST /api/customers/:id/law-firm-referral`

- Corpo Zod: `{ law_firm_id: uuid, notes?: string }` (channel='human' injetado pelo service)
- RBAC: `law_firms:referral`; org-scope + city-scope (customer deve ser da city do agente)
- Feature flag: `law_firm.referral.enabled` — se false, 403 `FEATURE_DISABLED`
- Lógica:
  1. Verifica `cooldown_until > NOW()` na tabela `customer_law_firm_referrals` → 409 `LAW_FIRM_COOLDOWN` com `{ cooldown_until }`
  2. Insere `customer_law_firm_referrals` com `sent_at = NOW()`, `cooldown_until = NOW() + INTERVAL '7 days'`, `channel = 'human'`, `linked_by = actor.userId`
  3. Emite evento `customer.law_firm_referred` via outbox (payload: `{ referral_id, customer_id, law_firm_id, organization_id }` — sem PII bruta)
  4. Registra em `audit_logs` (actor, action='law_firm_referral', entity='customer', entity_id)
  5. Retorna `{ ok: true, referral_id, cooldown_until }`

### `GET /internal/law-firm-status?customer_id=`

- Header: `X-Internal-Token` (obrigatório — validado pelo middleware de /internal)
- Aceita `?channel=ai` para que o LangGraph possa registrar encaminhamento via `/internal` também (POST)
- Retorna: `{ eligible: boolean, law_firm: { id, name, contact_phone } | null, cooldown_until: string | null, reason: string }`
- Lógica de elegibilidade: customer tem `payment_dues.status = 'overdue'` E existe `law_firms` vinculado (is_default_for_city para a cidade do customer) E cooldown inativo
- DLP: NÃO retorna nome, CPF, telefone do customer — apenas dados do escritório (contact_phone público)

### `POST /internal/customers/:id/law-firm-referral` (para LangGraph)

- Header: `X-Internal-Token`
- Corpo: `{ law_firm_id: uuid, channel: 'ai' }`
- Mesma lógica do POST humano mas `channel = 'ai'`, `linked_by = null`
- Registra em `ai_decision_logs` via serviço existente

### Evento outbox

- `customer.law_firm_referred`: `{ referral_id, customer_id, law_firm_id, organization_id, channel, sent_at }`
- Sem nome/CPF/telefone do customer (DLP)

## Fora de escopo (NÃO faz)

- Nó LangGraph (F19-S06)
- Frontend (F19-S05)
- Envio real do WhatsApp (o outbox worker já lida com isso via template — apenas emitir o evento)

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/customers/law-firm-referral.controller.ts`
- `apps/api/src/modules/customers/law-firm-referral.service.ts`
- `apps/api/src/modules/customers/law-firm-referral.repository.ts`
- `apps/api/src/modules/customers/law-firm-referral.schemas.ts`
- `apps/api/src/modules/customers/routes.ts`
- `apps/api/src/modules/internal/routes.ts`
- `apps/api/src/events/types.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/db/schema/**`
- `apps/api/src/modules/law-firms/**` (F19-S02 é dono)
- `apps/web/**`
- `apps/langgraph-service/**`

## Contratos de saída

- `POST /api/customers/:id/law-firm-referral` → `{ ok: true, referral_id: uuid, cooldown_until: string }`
- `GET /internal/law-firm-status?customer_id=` → `{ eligible: boolean, law_firm: LawFirmBasic | null, cooldown_until: string | null, reason: string }`
- `POST /internal/customers/:id/law-firm-referral` → `{ ok: true, referral_id: uuid }`
- Evento `customer.law_firm_referred` no outbox

## Definition of Done

- [ ] POST cria referral com cooldown e emite evento outbox sem PII
- [ ] POST retorna 409 `LAW_FIRM_COOLDOWN` quando cooldown ativo
- [ ] Feature flag `law_firm.referral.enabled` respeitada (4 camadas: pelo menos API)
- [ ] GET /internal retorna `eligible` + contato do escritório; sem PII do customer
- [ ] POST /internal (canal IA) registra em `ai_decision_logs`
- [ ] `audit_logs` registrado no encaminhamento humano
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- law-firm-referral
```

## Notas para o agente

- LGPD: `customer.law_firm_referred` no outbox NÃO deve incluir nome/CPF/telefone do customer. O worker que consome o evento busca os dados necessários para o WhatsApp template — sem PII no payload do evento.
- `/internal/law-firm-status`: verificar elegibilidade = tem `overdue` dues + tem escritório (default da cidade) + cooldown inativo. Retorno mínimo para DLP.
- Cooldown CHECK: `SELECT 1 FROM customer_law_firm_referrals WHERE customer_id = $1 AND cooldown_until > NOW()`.
- `channel='ai'` via /internal não tem `linked_by` (null); registra `ai_decision_logs` com actor identificado pelo X-Internal-Token.
