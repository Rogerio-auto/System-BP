---
id: F3-S02
title: Endpoints /internal/conversations/:id/state (load/save)
phase: F3
task_ref: T3.2
status: done
priority: critical
estimated_size: S
agent_id: backend-engineer
claimed_at: 2026-05-19T00:22:29Z
completed_at: 2026-05-19T00:30:43Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/79
depends_on: [F3-S01, F3-S04]
blocks: [F3-S23, F3-S30]
labels: [lgpd-impact]
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/10-seguranca-permissoes.md
  - docs/17-lgpd-protecao-dados.md
---

# F3-S02 — Endpoints internos de estado de conversa

## Objetivo

Persistir e carregar o `ConversationState` do grafo via backend (regra inviolável:
LangGraph nunca toca o Postgres direto). A sub-rota é auto-registrada pelo plugin
agregador `/internal/*` criado em F3-S04.

## Escopo

### `GET /internal/conversations/:id/state`

- Auth por header `X-Internal-Token` (= `env.INTERNAL_API_TOKEN`), senão 401.
- Retorna o `ai_conversation_states` por `conversation_id`. 404 se não existir.

### `PUT /internal/conversations/:id/state`

- Mesmo auth. Body Zod com o snapshot do estado.
- Upsert por `conversation_id` (cria se não existir, atualiza se existir).
- `updated_at` automático.

## LGPD

- Validação Zod rejeita campos desconhecidos. State não loga conteúdo bruto.
- Sem PII bruta em logs (`pino.redact`).

## Fora de escopo

- Tipo Python do estado (F3-S03). Demais endpoints internos.

## Arquivos permitidos

- `apps/api/src/modules/internal/conversations/routes.ts`
- `apps/api/src/modules/internal/conversations/schemas.ts`
- `apps/api/src/modules/internal/conversations/__tests__/routes.test.ts`

> A sub-rota é descoberta pelo autoload do plugin agregador (F3-S04) — não há
> arquivo compartilhado a editar.

## Definition of Done

- [ ] `X-Internal-Token` exigido → 401 sem.
- [ ] GET retorna estado / 404 quando ausente.
- [ ] PUT faz upsert idempotente por `conversation_id`.
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes.
- [ ] PR com label `lgpd-impact`.

## Validação

```powershell
pnpm --filter @elemento/api test -- internal/conversations
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api typecheck
```
