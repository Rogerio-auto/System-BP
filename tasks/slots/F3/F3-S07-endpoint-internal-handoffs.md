---
id: F3-S07
title: Endpoint POST /internal/handoffs (request_handoff)
phase: F3
task_ref: T3.8
status: available
priority: high
estimated_size: M
agent_id: backend-engineer
claimed_at:
completed_at:
pr_url:
depends_on: [F3-S04]
blocks: [F3-S17, F3-S34]
labels: [lgpd-impact]
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/07-integracoes-whatsapp-chatwoot.md
  - docs/04-eventos.md
---

# F3-S07 — Endpoint interno request_handoff

## Objetivo

Transferir a conversa para um atendente humano: cria `chatwoot_handoffs`,
atualiza o Chatwoot e move o card do Kanban. Consumido pela tool `request_handoff`
(F3-S17) e reusado pelo fallback de falha da IA (F3-S34).

## Escopo

### `POST /internal/handoffs`

- Auth `X-Internal-Token` → 401 sem.
- `Idempotency-Key` obrigatório (IA pode reenviar) → reenvio retorna o mesmo handoff.
- Body Zod: `{ leadId, conversationId, reason, summary, simulationId? }`.
- Pipeline (doc 06 §7.4), tudo na mesma transação:
  1. Cria `chatwoot_handoffs` com `status: requested`.
  2. Atualiza Chatwoot via cliente de F1-S20: assignee + custom attributes + nota interna.
  3. Move card do Kanban se ainda em `pre_atendimento`/`simulacao`.
  4. Emite `chatwoot.handoff_requested` via outbox.
- Resposta: `{ handoff_id, chatwoot_conversation_id, assigned_agent_id, status }`.
- `reason` aceita o catálogo do doc 06 (inclui `ai_unavailable` para F3-S34).

## LGPD

- `summary` pode conter contexto do cliente — não loga bruto; outbox sem PII bruta.

## Fora de escopo

- Tool Python (F3-S17). Nota interna avulsa (é `create_chatwoot_note`, F3-S08).

## Arquivos permitidos

- `apps/api/src/modules/internal/handoffs/routes.ts`
- `apps/api/src/modules/internal/handoffs/schemas.ts`
- `apps/api/src/modules/internal/handoffs/service.ts`
- `apps/api/src/modules/internal/handoffs/__tests__/routes.test.ts`

> A sub-rota é descoberta pelo autoload do plugin agregador (F3-S04) — não há
> arquivo compartilhado a editar.

## Definition of Done

- [ ] `X-Internal-Token` exigido → 401.
- [ ] Idempotência: reenvio com mesma chave retorna o mesmo handoff (sem duplicar).
- [ ] Chatwoot atualizado (assignee + attributes + nota) — mockado no teste.
- [ ] Card movido no Kanban quando aplicável.
- [ ] `chatwoot.handoff_requested` emitido uma vez via outbox.
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes.
- [ ] PR com label `lgpd-impact`.

## Validação

```powershell
pnpm --filter @elemento/api test -- internal/handoffs
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api typecheck
```
