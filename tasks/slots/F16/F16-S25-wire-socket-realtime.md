---
id: F16-S25
title: Ligar tempo real — registrar socketPlugin + startSocketRelay no boot
phase: F16
task_ref: docs/planejamento-live-chat-proprio.md#realtime
status: done
priority: critical
estimated_size: S
agent_id: null
claimed_at: 2026-06-17T20:45:35Z
completed_at: 2026-06-17T20:54:20Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/310
depends_on: []
blocks: [F16-S26, F16-S27]
labels: []
source_docs:
  - docs/planejamento-live-chat-proprio.md
  - docs/04-eventos.md
docs_required: false
docs_audience:
  - dev
docs_artifacts: []
---

# F16-S25 — Ligar tempo real no boot

## Objetivo

Fazer o livechat atualizar em tempo real: registrar o servidor Socket.io (`socketPlugin`) e
iniciar o relay RabbitMQ→Socket.io (`startSocketRelay`) no boot da API. Hoje ambos existem
(F16-S14) mas **nunca são chamados** — por isso mensagens persistem no banco mas nada chega
ao front em tempo real.

## Contexto

Diagnóstico (2026-06-17): `apps/api/src/plugins/socket.ts` (servidor Socket.io, namespace
`/livechat`) e `apps/api/src/workers/livechat-socket-relay.ts` (`startSocketRelay(io)`, consome
`hm.q.socket.relay` e emite aos rooms) estão prontos e testados, mas **não há registro de
`socketPlugin` no `app.ts` nem chamada de `startSocketRelay` no `server.ts`**. O front
(`useConversationSocket`, F16-S15) já conecta em `/livechat` e escuta `message:new` — só falta
o lado servidor subir. Os workers (inbound/outbound/media) já publicam em `hm.q.socket.relay`.

## Escopo (faz)

- `app.ts`: registrar `socketPlugin` (decora `fastify.io`). Ordem: após os plugins core, antes/depois
  das rotas (o plugin anexa o Socket.io ao `fastify.server` HTTP — registrar antes do `listen`).
- `server.ts`: após `app.listen(...)`, chamar `const stopRelay = await startSocketRelay(app.io)`.
  Guardar `stopRelay` e chamá-lo no graceful shutdown (antes de `app.close()`), junto com SIGINT/SIGTERM.
- Garantir que `env.CORS_ALLOWED_ORIGINS` inclui a origem do web local (Vite, ex: `http://localhost:5173`)
  — se não incluir, o handshake do Socket.io é barrado por CORS. Apenas validar/documentar; não alterar
  valores reais de `.env` (só `.env.example` se necessário).
- Smoke test de boot: o app sobe com o plugin registrado e `app.io` definido; relay conecta na fila
  sem lançar. (A lógica do relay já é coberta por `livechat-socket-relay.test.ts` — não reescrever.)

## Fora de escopo (NÃO faz)

- Mudar o protocolo de eventos do socket ou o `useConversationSocket` do front (F16-S27 trata o front).
- Emitir novos eventos de domínio (read/badge → F16-S26).
- Integração de IA (F16-S28/S29).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/app.ts`
- `apps/api/src/server.ts`
- `apps/api/src/__tests__/socket-boot.test.ts`
- `.env.example`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/plugins/socket.ts` (já pronto — não alterar)
- `apps/api/src/workers/livechat-socket-relay.ts` (já pronto — não alterar)
- `apps/web/**` (F16-S27 é dono)

## Contratos de entrada

- `socketPlugin` (`plugins/socket.ts`) — `FastifyPluginAsync`, decora `fastify.io`.
- `startSocketRelay(io: SocketIOServer): Promise<() => Promise<void>>` (`workers/livechat-socket-relay.ts`).
- Fila `hm.q.socket.relay` já declarada na topologia (F16-S01).

## Contratos de saída

- Servidor Socket.io ativo em `/livechat` no processo da API.
- Relay consumindo `hm.q.socket.relay` e emitindo aos rooms → front recebe `message:new` em tempo real.
- Shutdown limpo (relay parado antes do `app.close`).

## Definition of Done

- [ ] `socketPlugin` registrado e `startSocketRelay(app.io)` chamado no boot
- [ ] Graceful shutdown chama `stopRelay()` antes de `app.close()`
- [ ] `pnpm --filter @elemento/api typecheck` verde
- [ ] `pnpm --filter @elemento/api lint` verde
- [ ] `pnpm --filter @elemento/api test` verde
- [ ] Validação manual documentada no PR: enviar mensagem inbound → front atualiza sem refresh
- [ ] CORS local conferido (origem do Vite em `CORS_ALLOWED_ORIGINS`)
- [ ] PR aberto com checklist e link para o slot

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
```

## Notas para o agente

- O relay abre **sua própria** conexão RabbitMQ (ver o worker) — registrá-lo no processo da API
  significa que a API passa a ter um consumer do relay. É o design pretendido (relay in-process).
- O docstring do `socketPlugin` documenta a ordem canônica: `register(socketPlugin)` → `listen` →
  `startSocketRelay(app.io)`. Siga-a.
- Não dispare o relay em `buildApp()` (que é usado em testes sem `listen`) — dispare no `server.ts`
  após o `listen`, para não abrir RabbitMQ em todo teste.

```

```
