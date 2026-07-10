---
id: F24-S13
title: Frontend — sino de notificações em tempo real (socket + toast + badge)
phase: F24
task_ref: docs/planejamento-notificacoes.md
status: done
priority: medium
estimated_size: M
agent_id: null
depends_on: [F24-S08]
blocks: []
labels: [frontend, notifications, realtime, design-system]
source_docs: [docs/planejamento-notificacoes.md, docs/18-design-system.md]
docs_required: false
claimed_at: 2026-07-10T16:32:49Z
completed_at: 2026-07-10T16:44:44Z
---

# F24-S13 — Frontend: sino em tempo real

## Objetivo

Atualizar o sino para receber notificações em tempo real via Socket.io: escutar `notification.new`,
atualizar o badge ao vivo, exibir toast por severidade e manter o poll de 60s como fallback.

## Contexto

Planejamento §4.7. Já existem `SocketProvider`/`useSocket` (`lib/realtime/*`) e
`features/notifications/{NotificationDropdown,hooks}.tsx` (poll 60s). O backend (F24-S08) emite
`notification.new` na sala `user:{userId}`. Reusar o provider — não criar conexão nova.

## Escopo (faz)

- `features/notifications/useNotificationSocket.ts` — assina `notification.new`, invalida a query
  de notificações (TanStack), incrementa o badge de não-lidas.
- Toast por severidade (`info`/`warning`/`critical`) com link de deep-link (entityType/entityId).
- Integrar no `NotificationDropdown.tsx`/`hooks.ts`; manter poll 60s como fallback.

## Fora de escopo (NÃO faz)

- Backend (F24-S08).
- Admin / preferências.

## Arquivos permitidos

- `apps/web/src/features/notifications/useNotificationSocket.ts`
- `apps/web/src/features/notifications/NotificationDropdown.tsx`
- `apps/web/src/features/notifications/hooks.ts`
- `apps/web/src/features/notifications/index.ts`

## Arquivos proibidos

- `apps/api/**`
- `apps/langgraph-service/**`
- `apps/web/src/lib/realtime/**`

## Definition of Done

- [ ] `notification.new` atualiza badge + lista ao vivo (sem esperar o poll)
- [ ] Toast por severidade com deep-link
- [ ] Poll 60s mantido como fallback; sem conexão socket duplicada
- [ ] `pnpm --filter @elemento/web typecheck` + `lint` + `test` + `build` verdes

## Validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
pnpm --filter @elemento/web build
```

## Notas para o agente

- Reusar `useSocket`/`SocketProvider` — a conexão já existe (namespace `/livechat`).
- Toast deve respeitar tokens do DS (cores por severidade vindas dos tokens, não hardcoded).
