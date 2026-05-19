---
id: F3-S09
title: Endpoint POST /internal/ai/decisions (log_ai_decision)
phase: F3
task_ref: T3.10
status: review
priority: high
estimated_size: S
agent_id: backend-engineer
claimed_at: 2026-05-19T01:14:54Z
completed_at: 2026-05-19T01:23:44Z
pr_url:
depends_on: [F3-S01, F3-S04]
blocks: [F3-S19]
labels: [lgpd-impact]
source_docs:
  - docs/06-langgraph-agentes.md
---

# F3-S09 — Endpoint interno log_ai_decision

## Objetivo

Persistir uma decisão de turno do grafo em `ai_decision_logs`. Consumido pela tool
`log_ai_decision` (F3-S19), chamada no nó final `log_decision`.

## Escopo

### `POST /internal/ai/decisions`

- Auth `X-Internal-Token` → 401 sem.
- Body Zod: `{ conversationId, leadId?, nodeName, intent?, promptKey?,
promptVersion?, model?, tokensIn?, tokensOut?, latencyMs?, decision, error?,
correlationId }`.
- INSERT append-only em `ai_decision_logs` (tabela de F3-S01).
- Resposta: `{ decision_log_id }`.

## LGPD

- `decision` jsonb **não** carrega PII bruta (doc 17 §3.4) — apenas IDs, intents,
  métricas. Validação Zod rejeita campos desconhecidos.

## Fora de escopo

- Tool Python (F3-S19). Tela de auditoria de decisões (pós-F3).

## Arquivos permitidos

- `apps/api/src/modules/internal/ai/routes.ts`
- `apps/api/src/modules/internal/ai/schemas.ts`
- `apps/api/src/modules/internal/ai/__tests__/routes.test.ts`

> A sub-rota é descoberta pelo autoload do plugin agregador (F3-S04) — não há
> arquivo compartilhado a editar.

## Definition of Done

- [ ] `X-Internal-Token` exigido → 401.
- [ ] INSERT em `ai_decision_logs` com todos os campos do contrato.
- [ ] Append-only (sem update).
- [ ] `decision` validado contra PII bruta.
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes.
- [ ] PR com label `lgpd-impact`.

## Validação

```powershell
pnpm --filter @elemento/api test -- internal/ai
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api typecheck
```
