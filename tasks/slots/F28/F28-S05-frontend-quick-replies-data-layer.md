---
id: F28-S05
title: Frontend — camada de dados de respostas rápidas + realtime
phase: F28
task_ref: docs/25-respostas-rapidas.md
status: in-progress
priority: high
estimated_size: S
agent_id: null
depends_on: [F28-S02]
blocks: [F28-S06, F28-S07]
labels: [frontend, quick-replies, tanstack-query, realtime]
source_docs: [docs/25-respostas-rapidas.md]
docs_required: false
claimed_at: 2026-07-22T21:30:22Z
completed_at: null
pr_url: null
---

# F28-S05 — Camada de dados compartilhada do frontend

## Objetivo

Publicar a única camada de acesso a respostas rápidas no web (client HTTP, query keys, hooks de
leitura e mutação, e a invalidação por socket), consumida tanto pelo composer quanto pelo admin.

## Contexto

Doc 25 §9. O composer (F28-S06) e a tela admin (F28-S07) rodam em paralelo e consomem os mesmos
dados. Sem uma camada única, cada um cria sua própria query key e o cache diverge — foi exatamente
o que causou o bug de colisão de keys no live chat (lista esvaziando ao trocar de aba).

Este slot é dono exclusivo de `apps/web/src/features/quick-replies/` (raiz, não subpastas de UI).

## Escopo (faz)

- `apps/web/src/features/quick-replies/api.ts` — chamadas via `lib/api.ts` para
  `GET/POST/PATCH/DELETE /api/quick-replies`, `PATCH /reorder`, `POST /uploads/signed-url`,
  `POST /:id/used`.
- `apps/web/src/features/quick-replies/queries.ts`:
  - Key factory `quickReplyKeys` com `all` / `list(params)` / `detail(id)` — chaves **isoladas**,
    sem reaproveitar prefixo de outra feature.
  - `useQuickReplies(params)`, `useQuickReply(id)` — `staleTime` 60 s (doc 25 §9).
  - `useCreateQuickReply`, `useUpdateQuickReply`, `useDeleteQuickReply`, `useReorderQuickReplies` —
    invalidam `quickReplyKeys.all` e tratam `409` (conflito de atalho) devolvendo o erro ao form.
  - `useMarkQuickReplyUsed` — fire-and-forget, **nunca** exibe toast de erro.
- `apps/web/src/features/quick-replies/useQuickRepliesRealtime.ts` — assina `quick_reply:changed`
  no socket global (`useSocket`) e invalida `quickReplyKeys.all`. Cleanup no unmount.
- `apps/web/src/features/quick-replies/useUploadQuickReplyMedia.ts` — upload em 2 fases
  (signed URL + `PUT` via XHR com progresso e `abort()`), espelhando
  `features/conversations/hooks/useUploadMedia.ts`.
- Testes: key factory estável; `409` propagado; `useMarkQuickReplyUsed` silencioso em erro;
  handler de socket registrado e removido no unmount.

## Fora de escopo (NÃO faz)

- Qualquer componente visual (F28-S06 e F28-S07).
- Rota, item de menu ou card no hub de configurações (F28-S07).
- Alteração no `SocketProvider` — apenas consumir `useSocket`.

## Arquivos permitidos

- `apps/web/src/features/quick-replies/api.ts`
- `apps/web/src/features/quick-replies/queries.ts`
- `apps/web/src/features/quick-replies/types.ts`
- `apps/web/src/features/quick-replies/useQuickRepliesRealtime.ts`
- `apps/web/src/features/quick-replies/useUploadQuickReplyMedia.ts`
- `apps/web/src/features/quick-replies/index.ts`
- `apps/web/src/features/quick-replies/__tests__/**`

## Arquivos proibidos

- `apps/api/**`
- `apps/langgraph-service/**`
- `packages/**`
- `apps/web/src/App.tsx`
- `apps/web/src/app/navigation.ts`
- `apps/web/src/lib/realtime/**`
- `apps/web/src/features/conversations/**`
- `apps/web/src/features/quick-replies/components/**`
- `apps/web/src/features/quick-replies/admin/**`

## Contratos de entrada

- Tipos e schemas de `@elemento/shared-schemas` (F28-S02).

## Contratos de saída

- `quickReplyKeys`, hooks de leitura/mutação, `useQuickRepliesRealtime`,
  `useUploadQuickReplyMedia` exportados por `features/quick-replies/index.ts`.

## Definition of Done

- [ ] Key factory isolada e única para a feature
- [ ] Hooks de leitura e mutação implementados, com `409` propagado ao chamador
- [ ] `useMarkQuickReplyUsed` nunca gera toast nem quebra o fluxo
- [ ] `useQuickRepliesRealtime` registra e remove o listener corretamente (teste)
- [ ] Upload em 2 fases com progresso e `abort()`
- [ ] Sem `any`; tipos derivados do pacote compartilhado
- [ ] `pnpm --filter @elemento/web typecheck` + `lint` + `test` + `build` verdes

## Validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
pnpm --filter @elemento/web build
```

## Notas para o agente

- **Nunca** misturar `useQuery` e `useInfiniteQuery` na mesma query key — o observer quebra em
  runtime (incidente conhecido no live chat). Se precisar dos dois, use keys distintas.
- O `SocketProvider` é montado uma única vez em `App.tsx`; aqui só se consome `useSocket()`.
  Não montar provider novo — duplicar montagem já causou contador dobrado no live chat.
- Molde do upload: `features/conversations/hooks/useUploadMedia.ts:105`.
- Em worktree isolado, rodar `pnpm install` antes de validar — senão dá falso-vermelho.
