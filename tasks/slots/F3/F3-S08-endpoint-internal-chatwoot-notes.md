---
id: F3-S08
title: Endpoint POST /internal/chatwoot/notes (create_chatwoot_note)
phase: F3
task_ref: T3.9
status: available
priority: medium
estimated_size: S
agent_id: backend-engineer
claimed_at:
completed_at:
pr_url:
depends_on: [F3-S04]
blocks: [F3-S18]
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/07-integracoes-whatsapp-chatwoot.md
---

# F3-S08 — Endpoint interno create_chatwoot_note

## Objetivo

Criar nota interna numa conversa do Chatwoot. Consumido pela tool
`create_chatwoot_note` (F3-S18).

## Escopo

### `POST /internal/chatwoot/notes`

- Auth `X-Internal-Token` → 401 sem.
- Body Zod: `{ chatwootConversationId, body, type: 'internal' }`.
- Renderiza `body` no markdown padrão definido em doc 07.
- Cria a nota via cliente Chatwoot de F1-S20.
- Resposta: `{ note_id }`.

## Fora de escopo

- Tool Python (F3-S18). Nota automática do handoff (já dentro de F3-S07).

## Arquivos permitidos

- `apps/api/src/modules/internal/chatwoot/routes.ts`
- `apps/api/src/modules/internal/chatwoot/schemas.ts`
- `apps/api/src/modules/internal/chatwoot/__tests__/routes.test.ts`

> A sub-rota é descoberta pelo autoload do plugin agregador (F3-S04) — não há
> arquivo compartilhado a editar.

## Definition of Done

- [ ] `X-Internal-Token` exigido → 401.
- [ ] Nota criada na conversa correta (cliente Chatwoot mockado no teste).
- [ ] `body` renderizado no markdown padrão do doc 07.
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes.

## Validação

```powershell
pnpm --filter @elemento/api test -- internal/chatwoot
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api typecheck
```
