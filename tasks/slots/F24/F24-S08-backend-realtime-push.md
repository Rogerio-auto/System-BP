---
id: F24-S08
title: Backend — push em tempo real (sala user + publish notification.new)
phase: F24
task_ref: docs/planejamento-notificacoes.md
status: available
priority: medium
estimated_size: M
agent_id: null
depends_on: [F24-S06]
blocks: [F24-S13, F24-S14]
labels: [backend, notifications, realtime, socket]
source_docs: [docs/planejamento-notificacoes.md]
docs_required: false
---

# F24-S08 — Backend: push em tempo real

## Objetivo

Entregar notificações in-app em tempo real reusando o socket relay: adicionar a sala
`user:{userId}` e publicar `notification.new` na fila `hm.q.socket.relay` quando uma notificação
in-app é criada. Gate `notifications.realtime.enabled`.

## Contexto

Planejamento §4.7. `plugins/socket.ts` hoje só dá join em `workspace:{orgId}` e `conversation:{}`.
O relay (`workers/livechat-socket-relay.ts`) consome `{room,event,data}` e emite. Publicar via o
publisher de fila existente (`lib/queue/*`, `makeEnvelope`). Payload mínimo (LGPD §8.5).

## Escopo (faz)

- `plugins/socket.ts`: em `setupSocketHandlers`, `socket.join('user:' + userId)` (re-entra em reconexão).
- Helper `publishNotificationSocket(notification)` (`modules/notifications/realtime.ts`): publica em
  `hm.q.socket.relay` com `room='user:'+userId`, `event='notification.new'`,
  `data={ id, type, title, severity, entityType, entityId, createdAt }` (sem PII além de título).
- Chamar o helper no `senders/inApp.ts` (ou no ponto de criação da notificação) atrás de
  `requireFlag('notifications.realtime.enabled')`.
- Testes: join de sala, publish com payload mínimo, no-op por flag.

## Fora de escopo (NÃO faz)

- Frontend (F24-S13).
- Mudar o relay worker.

## Arquivos permitidos

- `apps/api/src/plugins/socket.ts`
- `apps/api/src/modules/notifications/realtime.ts`
- `apps/api/src/modules/notifications/senders/inApp.ts`
- `apps/api/src/plugins/__tests__/socket.test.ts`
- `apps/api/src/modules/notifications/__tests__/realtime.test.ts`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/workers/livechat-socket-relay.ts`
- `apps/api/src/db/migrations/**`

## Definition of Done

- [ ] Join `user:{userId}` no handshake autenticado (escopo de org via claim)
- [ ] `publishNotificationSocket` publica payload mínimo em `hm.q.socket.relay`
- [ ] Disparo atrás de `notifications.realtime.enabled` (no-op quando off)
- [ ] Sem PII além do título no payload; nada logado
- [ ] Testes verdes; `pnpm --filter @elemento/api typecheck` + `lint` + `test` verdes

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
python scripts/slot.py validate F24-S08
```

## Notas para o agente

- Reusar `makeEnvelope` + publisher existente; a sala `user:{}` fica sempre dentro da org do JWT.
- Não acoplar ao relay — ele já roteia qualquer `{room,event,data}`.
