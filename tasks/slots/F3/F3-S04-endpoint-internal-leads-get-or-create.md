---
id: F3-S04
title: Endpoint POST /internal/leads/get-or-create + plugin agregador /internal/*
phase: F3
task_ref: T3.4
status: done
priority: critical
estimated_size: M
agent_id: backend-engineer
claimed_at: 2026-05-18T19:45:32Z
completed_at: 2026-05-18T20:12:46Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/77
depends_on: []
blocks: [F3-S02, F3-S05, F3-S06, F3-S07, F3-S08, F3-S09, F3-S10, F3-S12, F3-S13]
labels: [lgpd-impact]
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/04-eventos.md
  - docs/17-lgpd-protecao-dados.md
---

# F3-S04 — Endpoint get-or-create lead + plugin agregador /internal/\*

## Objetivo

Estabelecer a infra de rotas internas de F3 **e** entregar o primeiro endpoint.
Endpoint consumido pela tool `get_or_create_lead` (F3-S13): garante um `lead_id`
para a conversa, com dedupe por telefone normalizado. Reusa o serviço de leads de F1.

## Escopo

### Plugin agregador `/internal/*` (infra — feito uma vez aqui)

- Criar `apps/api/src/modules/internal/index.ts` — plugin Fastify que **auto-registra**
  cada sub-rota interna de F3 via `@fastify/autoload` apontando para
  `apps/api/src/modules/internal/*/routes.ts`.
- Registrar o plugin agregador uma única vez em `app.ts`.
- **Objetivo do autoload:** os demais endpoints internos (F3-S02, S05–S12) só criam
  seu próprio `modules/internal/<domínio>/routes.ts` — **nunca** editam um arquivo
  compartilhado, eliminando colisão de merge entre slots paralelos.
- `@fastify/autoload` é nova dependência — justificar no PR (PROTOCOL §1.3).

### `POST /internal/leads/get-or-create`

- Auth `X-Internal-Token` → 401 sem.
- Body Zod: `{ phone, name?, source, chatwootConversationId?, correlationId }`.
- Pipeline:
  1. Normaliza telefone (serviço `shared/phone` de F1).
  2. Lookup por telefone normalizado + `organization_id`.
  3. Existe → retorna `created: false` + dados do lead.
  4. Não existe → cria lead em `pre_atendimento`, emite `leads.created` via outbox
     (mesma transação), retorna `created: true`.
- Resposta conforme doc 06 §7.1: `lead_id, customer_id, created, current_stage, city_id, assigned_agent_id`.
- Erros tipados: `INVALID_PHONE`, `LEAD_MERGE_REQUIRED` (>1 candidato).
- Rate limit 60 req/min por IP.

## LGPD

- Telefone/nome são PII — `pino.redact` cobre, outbox sem PII bruta.
- Reusa criptografia/HMAC já existente no módulo leads.

## Fora de escopo

- Tool Python (F3-S13). Merge de leads (handoff humano resolve).
- Demais endpoints internos (cada um no seu slot — autoload pega automaticamente).

## Arquivos permitidos

- `apps/api/src/modules/internal/index.ts` (plugin agregador + autoload)
- `apps/api/src/modules/internal/leads/routes.ts`
- `apps/api/src/modules/internal/leads/schemas.ts`
- `apps/api/src/modules/internal/leads/__tests__/routes.test.ts`
- `apps/api/src/app.ts` (registrar o plugin agregador — uma vez)
- `apps/api/package.json` (dependência `@fastify/autoload`)
- `apps/api/src/modules/leads/service.ts` (só se precisar expor método get-or-create)

## Definition of Done

- [ ] Plugin agregador `/internal/*` com autoload criado e registrado em `app.ts`.
- [ ] `X-Internal-Token` exigido → 401.
- [ ] Dedupe por telefone normalizado funciona.
- [ ] `leads.created` emitido **só** quando `created: true`, via outbox.
- [ ] `INVALID_PHONE` e `LEAD_MERGE_REQUIRED` retornados como erro tipado.
- [ ] Rate limit testado.
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes.
- [ ] PR com label `lgpd-impact` + checklist §14.2.

## Validação

```powershell
pnpm --filter @elemento/api test -- internal/leads
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api typecheck
```
