---
id: F3-S11
title: Endpoint POST /internal/simulations/:id/sent (mark_simulation_sent)
phase: F3
task_ref: T3.7
status: in-progress
priority: medium
estimated_size: S
agent_id: backend-engineer
claimed_at: 2026-05-18T19:45:32Z
completed_at:
pr_url:
depends_on: []
blocks: [F3-S21]
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/04-eventos.md
---

# F3-S11 — Endpoint interno mark_simulation_sent

## Objetivo

Marcar uma simulação como efetivamente enviada ao cliente. Consumido pela tool
`mark_simulation_sent` (F3-S21). Complementa o `POST /internal/simulations`
já criado em F2-S05.

## Escopo

### `POST /internal/simulations/:id/sent`

- Auth `X-Internal-Token` → 401 sem.
- Marca `credit_simulations` com `sent_at` (e flag de enviada).
- Idempotente: reenvio não altera `sent_at` já gravado.
- Emite evento de simulação enviada via outbox (conferir catálogo doc 04).
- 404 se a simulação não existir.
- Adiciona a rota ao arquivo `internal-routes.ts` já existente do módulo simulations.

## Fora de escopo

- Tool Python (F3-S21). Geração de simulação (já em F2-S05).

## Arquivos permitidos

- `apps/api/src/modules/simulations/internal-routes.ts`
- `apps/api/src/modules/simulations/service.ts` (só se faltar método de marcação)
- `apps/api/src/modules/simulations/__tests__/internal-routes.test.ts`

## Definition of Done

- [ ] `X-Internal-Token` exigido → 401.
- [ ] `sent_at` gravado na simulação.
- [ ] Idempotente: 2ª chamada não regrava `sent_at`.
- [ ] Evento emitido uma única vez via outbox.
- [ ] 404 para simulação inexistente.
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes.

## Validação

```powershell
pnpm --filter @elemento/api test -- simulations/internal
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api typecheck
```
