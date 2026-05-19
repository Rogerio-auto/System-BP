---
id: F3-S10
title: Endpoint GET /internal/customers/:id/context (get_customer_context)
phase: F3
task_ref: T3.4
status: in-progress
priority: medium
estimated_size: S
agent_id: backend-engineer
claimed_at: 2026-05-19T01:14:56Z
completed_at:
pr_url:
depends_on: [F3-S04]
blocks: [F3-S20]
labels: [lgpd-impact]
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/17-lgpd-protecao-dados.md
---

# F3-S10 — Endpoint interno get_customer_context

## Objetivo

Retornar uma ficha resumida do lead/cliente para o grafo personalizar a conversa.
Consumido pela tool `get_customer_context` (F3-S20).

## Escopo

### `GET /internal/customers/:id/context`

- Auth `X-Internal-Token` → 401 sem.
- Aceita `id` de lead **ou** customer (query param `?type=lead|customer`, default lead).
- Retorna ficha resumida (doc 06 §7.6): nome, cidade, agente, último estágio,
  última simulação, última análise (status + datas apenas), contagem de mensagens
  nos últimos 30 dias.
- **NÃO** retorna CPF, RG, documentos ou dados sensíveis (doc 06 §7.6 + doc 17 §3.4).
- 404 se a entidade não existir.

## LGPD

- Payload sanitizado: o grafo externo nunca recebe PII sensível.
- `pino.redact` cobre qualquer campo pessoal em log.

## Fora de escopo

- Tool Python (F3-S20). Histórico completo de análises (é F4).

## Arquivos permitidos

- `apps/api/src/modules/internal/customers/routes.ts`
- `apps/api/src/modules/internal/customers/schemas.ts`
- `apps/api/src/modules/internal/customers/__tests__/routes.test.ts`

> A sub-rota é descoberta pelo autoload do plugin agregador (F3-S04) — não há
> arquivo compartilhado a editar.

## Definition of Done

- [ ] `X-Internal-Token` exigido → 401.
- [ ] Ficha resumida correta para lead e para customer.
- [ ] Payload **sem** CPF/RG/documentos (teste afirma ausência).
- [ ] 404 para entidade inexistente.
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes.
- [ ] PR com label `lgpd-impact` + checklist §14.2.

## Validação

```powershell
pnpm --filter @elemento/api test -- internal/customers
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api typecheck
```
