---
id: F27-S07
title: Frontend — push client (SW handlers + opt-in) + SocketProvider global
phase: F27
task_ref: docs/24-pwa.md
status: in-progress
priority: high
estimated_size: M
agent_id: null
depends_on: [F27-S01, F27-S03, F27-S06]
blocks: []
labels: [frontend, notifications, pwa]
source_docs: [docs/24-pwa.md, docs/23-notificacoes.md, docs/18-design-system.md]
docs_required: false
claimed_at: 2026-07-20T16:29:54Z
---

# F27-S07 — Push no cliente + realtime global

## Objetivo

Fechar o loop de push no frontend: handlers de `push`/`notificationclick` no SW, opt-in explícito
de notificação (atrás da flag `pwa.enabled`), subscribe via `PushManager` e subir o `SocketProvider`
para o layout global (sino realtime em todas as rotas, não só em `/conversas`).

## Contexto

Doc 24 §5.4/§7. O SW base existe (F27-S01, modo `injectManifest`). O backend de push existe
(F27-S06: `GET /push/public-key`, `POST/DELETE /push/subscription`). Hoje o `SocketProvider` só é
montado em `pages/ConversasPage.tsx`, então o sino só tem realtime nessa rota; fora dela, poll de
60s. O opt-in de notificação **nunca** deve ser pedido no load — só num gesto do usuário.

## Escopo (faz)

- **SW** (`src/sw/service-worker.ts`): handler `push` → `showNotification` (title genérico + `data.href`
  - icon/badge, **sem PII**); handler `notificationclick` → focar client existente ou `openWindow`
    no deep-link.
- **Opt-in UI** em `apps/web/src/features/pwa/` (novo): botão que pede `Notification.requestPermission()`
  num gesto do usuário, faz `PushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`
  (chave via `GET /push/public-key`) e registra no backend (`POST /push/subscription`). Opt-out chama
  `DELETE`. Tudo atrás da flag `pwa.enabled` (UI).
- **Superfície do opt-in**: expor em `/configuracoes` e/ou no sino (`features/notifications`).
- **SocketProvider global**: mover o mount de `ConversasPage.tsx` para o `App.tsx` (árvore de
  providers autenticada), para o realtime do sino valer em todas as rotas. Remover o mount local
  em `ConversasPage.tsx` sem quebrar as conversas.

## Fora de escopo (NÃO faz)

- Backend de push/VAPID (F27-S06).
- Config do plugin/manifest/ícones (F27-S01/S02).
- Alterar `lib/realtime/**` (só mudar o ponto de montagem do provider, não o provider).
- Cache de API / offline de dados.

## Arquivos permitidos

- `apps/web/src/sw/service-worker.ts`
- `apps/web/src/features/pwa/**`
- `apps/web/src/features/notifications/**`
- `apps/web/src/App.tsx`
- `apps/web/src/pages/ConversasPage.tsx`
- `apps/web/src/pages/ConfiguracoesPage.tsx`
- `apps/web/src/**/*.test.ts`
- `apps/web/src/**/*.test.tsx`

## Arquivos proibidos

- `apps/api/**`
- `apps/langgraph-service/**`
- `apps/web/src/lib/realtime/**`
- `apps/web/src/components/layout/**`
- `packages/**`

## Definition of Done

- [ ] SW trata `push` (showNotification sem PII) e `notificationclick` (foca/abre deep-link)
- [ ] Opt-in pedido só num gesto do usuário; subscribe registra no backend; opt-out remove
- [ ] Toda a UI de push atrás da flag `pwa.enabled` (off = nada aparece)
- [ ] `SocketProvider` montado globalmente no `App.tsx`; sino recebe realtime fora de `/conversas`
- [ ] Conversas continuam funcionando (sem duplo-mount de socket — cuidar do contador dobrado histórico)
- [ ] Tokens do DS; foco visível; `pnpm --filter @elemento/web typecheck` + `lint` + `test` + `build` verdes

## Validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
pnpm --filter @elemento/web build
```

## Notas para o agente

- **Pegadinha de duplo-mount** (memória do projeto): `useConversationSocket` já montou 2x e dobrou
  o contador de unread. Ao subir o `SocketProvider` para o global, garanta **um único** provider na
  árvore e remova o mount de `ConversasPage`. Não criar conexão nova.
- Payload de push não tem `body`/PII (doc 24 §5.3) — o detalhe é buscado após auth ao abrir.
- iOS: push só ≥16.4 + app na home; sem `beforeinstallprompt` (doc 24 §11) — degradar com
  mensagem, não quebrar.
  </content>
