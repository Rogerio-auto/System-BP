---
id: F24-S09
title: Backend — preferências de notificação por categoria
phase: F24
task_ref: docs/planejamento-notificacoes.md
status: review
priority: medium
estimated_size: M
agent_id: null
depends_on: [F24-S01]
blocks: [F24-S06, F24-S12]
labels: [backend, notifications, lgpd-impact]
source_docs: [docs/planejamento-notificacoes.md]
docs_required: false
claimed_at: 2026-06-30T20:01:56Z
completed_at: 2026-06-30T20:46:37Z
---

# F24-S09 — Backend: preferências por categoria

## Objetivo

Estender as preferências de notificação de "por canal global" para "por categoria × canal",
mantendo o modelo opt-out, e expor a resolução `isCategoryChannelEnabled` para o fan-out e o worker.

## Contexto

Planejamento §4.5. Coluna `category` já criada em F24-S01. Resolução: override de categoria

> default do canal (category NULL) > habilitado (default). API atual em `modules/notifications/routes.ts`
> (`GET/PUT /notifications/preferences`, perm `notifications:read`).

## Escopo (faz)

- Estender schemas (`modules/notifications/schemas.ts`) para aceitar `category` (das 6 categorias) — usar enum compartilhado de F24-S04.
- `repository.ts`: `getNotificationPreferences` retorna por (channel, category); upsert por (user_id, channel, category);
  novo `isCategoryChannelEnabled(db, orgId, userId, channel, category)` com fallback para default do canal.
- `service.ts`/`routes.ts`: `GET` devolve matriz categoria × canal; `PUT` faz upsert idempotente.
- Manter retrocompat: linhas com `category=NULL` continuam sendo o default do canal.
- Testes: override de categoria, fallback para default, mute por canal.

## Fora de escopo (NÃO faz)

- Quiet hours / digest (follow-up).
- UI (F24-S12).
- Consumo no fan-out/worker (F24-S06/S07 importam o helper).

## Arquivos permitidos

- `apps/api/src/modules/notifications/schemas.ts`
- `apps/api/src/modules/notifications/repository.ts`
- `apps/api/src/modules/notifications/service.ts`
- `apps/api/src/modules/notifications/routes.ts`
- `apps/api/src/modules/notifications/__tests__/preferences.test.ts`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/handlers/**`
- `apps/api/src/db/migrations/**`

## Definition of Done

- [ ] API de preferências aceita e retorna matriz categoria × canal (opt-out)
- [ ] `isCategoryChannelEnabled` com fallback para default do canal
- [ ] Retrocompat com linhas `category=NULL`
- [ ] Testes de resolução verdes
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` + `test` verdes

## Validação

```powershell
pnpm --filter @elemento/shared-schemas build
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
python scripts/slot.py validate F24-S09
```

## Notas para o agente

- Reusar o enum de categorias de `@elemento/shared-schemas` (F24-S04) — não redefinir.
- Upsert via `ON CONFLICT (user_id, channel, category)`.
