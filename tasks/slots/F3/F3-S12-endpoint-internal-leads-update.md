---
id: F3-S12
title: Endpoint PATCH /internal/leads/:id (update_lead_profile)
phase: F3
task_ref: T3.4
status: available
priority: medium
estimated_size: S
agent_id: backend-engineer
claimed_at:
completed_at:
pr_url:
depends_on: [F3-S04]
blocks: [F3-S22]
labels: [lgpd-impact]
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/04-eventos.md
  - docs/17-lgpd-protecao-dados.md
---

# F3-S12 — Endpoint interno update_lead_profile

## Objetivo

Atualizar campos de perfil do lead que a IA coleta na conversa (nome, cidade).
Consumido pela tool `update_lead_profile` (F3-S22).

## Escopo

### `PATCH /internal/leads/:id`

- Auth `X-Internal-Token` → 401 sem.
- Body Zod com campos opcionais atualizáveis pela IA: `{ name?, cityId?,
requestedAmount?, requestedTermMonths? }`. Campos não-IA são rejeitados.
- Atualiza o lead, grava `lead_history` (append-only) e `audit_logs` com
  `actor_type: 'ai'`.
- Emite `leads.updated` via outbox.
- 404 se o lead não existir.

## LGPD

- Atualização de PII por ator IA — audit obrigatório, outbox sem PII bruta.
- A IA só pode mutar o lead da própria conversa (validado a montante; o endpoint
  atualiza apenas o `:id` recebido).

## Fora de escopo

- Tool Python (F3-S22). Edição manual de lead (já existe em F1).

## Arquivos permitidos

- `apps/api/src/modules/internal/leads/routes.ts`
- `apps/api/src/modules/internal/leads/schemas.ts`
- `apps/api/src/modules/internal/leads/__tests__/routes.test.ts`

> Reusa o `modules/internal/leads/routes.ts` criado em F3-S04 (mesmo domínio);
> o autoload já registra a rota.

## Definition of Done

- [ ] `X-Internal-Token` exigido → 401.
- [ ] Só campos permitidos atualizam; campo não permitido → 422.
- [ ] `lead_history` + `audit_logs` (`actor_type: 'ai'`) gravados.
- [ ] `leads.updated` emitido via outbox.
- [ ] 404 para lead inexistente.
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes.
- [ ] PR com label `lgpd-impact` + checklist §14.2.

## Validação

```powershell
pnpm --filter @elemento/api test -- internal/leads
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api typecheck
```
