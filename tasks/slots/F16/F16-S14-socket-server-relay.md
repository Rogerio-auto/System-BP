---
id: F16-S14
title: Socket server + relay — Socket.io no Fastify, auth, rooms, consumo de socket.relay
phase: F16
task_ref: docs/planejamento-live-chat-proprio.md#6-socket-events
status: in-progress
priority: medium
estimated_size: M
agent_id: null
claimed_at: 2026-06-16T05:20:17Z
completed_at: null
pr_url: null
depends_on: [F16-S01, F16-S03, F16-S07]
blocks: [F16-S15]
labels: [lgpd-impact]
source_docs:
  - docs/planejamento-live-chat-proprio.md
  - docs/10-seguranca-permissoes.md
docs_required: false
docs_audience: [dev]
docs_artifacts: []
---
# F16-S14 — Socket server + relay

## Objetivo

Subir o servidor Socket.io acoplado ao Fastify (auth no handshake, rooms por conversa/workspace/member)
e o consumidor da fila `hm.q.socket.relay` que traduz os eventos publicados pelos workers em `emit` para
os clientes conectados.

## Contexto

Decisão D1 (Socket.io). É a peça que entrega o "tempo real" da vitrine: workers publicam em `socket.relay`,
este slot consome e emite para as salas corretas. Contratos de evento vêm de S03.

## Escopo (faz)

- `plugins/socket.ts`: registra Socket.io no Fastify; auth no handshake (JWT do projeto); join em
  `workspace:{orgId}` no connect; join/leave `conversation:{id}` sob demanda; escopo de cidade respeitado.
- `workers/livechat-socket-relay.ts`: consome `hm.q.socket.relay` → `io.to(room).emit(event, payload)`.
- Tipagem dos eventos via `ServerToClient` (S03).

## Fora de escopo (NÃO faz)

- Cliente front (S15).
- Produção dos eventos (workers S08/S09/S10 já publicam em `socket.relay`).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/plugins/socket.ts`
- `apps/api/src/workers/livechat-socket-relay.ts`
- `apps/api/src/workers/__tests__/livechat-socket-relay.test.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/workers/index.ts` (S08 registra — coordenar)
- `apps/api/src/modules/**`

## Contratos de entrada

- Fila `socket.relay` (S01), eventos `ServerToClient` (S03), auth JWT do projeto.

## Contratos de saída

- Conexão Socket.io autenticada + eventos emitidos por sala — consumidos pelo front (S15).

## Definition of Done

- [ ] Handshake rejeita sem JWT válido
- [ ] Cliente só recebe eventos das salas do seu escopo (org + cidade) — teste de vazamento negativo
- [ ] Relay traduz cada job da fila no `emit` correto (room + event)
- [ ] Reconexão re-entra nas salas
- [ ] **LGPD:** payload de evento carrega o mínimo; conteúdo só para sala autorizada; label `lgpd-impact`
- [ ] `pnpm --filter @elemento/api typecheck` / `lint` / `test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- socket-relay
```

## Notas para o agente

- Escopo de cidade nas salas é crítico: um agente de cidade A não pode receber eventos de conversa da cidade B.
- Portar a lógica de rooms do tagix (`socket/index.ts`, `socket/relay.ts`), adaptando o auth ao JWT do projeto.
