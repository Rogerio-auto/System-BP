---
id: F28-S02
title: Contrato compartilhado — schemas Zod e catálogo de variáveis
phase: F28
task_ref: docs/25-respostas-rapidas.md
status: in-progress
priority: critical
estimated_size: S
agent_id: null
depends_on: []
blocks: [F28-S03, F28-S05]
labels: [backend, shared-schemas, quick-replies, contract]
source_docs: [docs/25-respostas-rapidas.md]
docs_required: false
claimed_at: 2026-07-22T20:12:42Z
completed_at: null
pr_url: null
---

# F28-S02 — Contrato Zod compartilhado de respostas rápidas

## Objetivo

Publicar em `@elemento/shared-schemas` o contrato único de respostas rápidas (schemas Zod, tipos,
catálogo de variáveis e o interpolador puro), consumido tanto pela API quanto pelo web.

## Contexto

Doc 25 §6. Slots de frontend e backend rodam em paralelo nesta fase — sem um contrato compartilhado
publicado antes, eles divergem e o CI não pega (incidente recorrente de drift front×API).

O interpolador precisa ser **uma única função pura**, usada pelo backend na validação do cadastro e
pelo frontend na renderização do preview e no envio. Duas implementações = duas semânticas.

## Escopo (faz)

- `packages/shared-schemas/src/quick-replies.ts`:
  - `QUICK_REPLY_VARIABLES` — catálogo fechado do doc 25 §6.1 (chave, rótulo pt-BR, se exige fallback).
  - `quickReplyVisibilitySchema`, `quickReplyMediaKindSchema`.
  - `quickReplyShortcutSchema` — regex `^[a-z0-9][a-z0-9_-]{0,31}$`.
  - `quickReplyBodySchema` — `max(4096)`.
  - `quickReplyCreateSchema` / `quickReplyUpdateSchema` (update = partial), com `superRefine` que:
    rejeita variável fora do catálogo (`QUICK_REPLY_UNKNOWN_VARIABLE`); rejeita `contato.*` sem
    fallback (`QUICK_REPLY_MISSING_FALLBACK`); exige `body` ou mídia; exige mídia tudo-ou-nada.
  - `quickReplyResponseSchema`, `quickReplyListQuerySchema` (busca, `visibility`, `category`,
    `isActive`, paginação por cursor no padrão do repo).
  - `quickReplySignedUrlBodySchema` reaproveitando `maxUploadBytesForMime` de `./livechat.js`.
- `parseQuickReplyVariables(body)` — extrai ocorrências `{{chave|fallback}}` com posição.
- `interpolateQuickReply(body, ctx)` — função **pura**, sem I/O e sem `Date.now()` implícito
  (recebe `now` no `ctx`), resolvendo o catálogo do §6.1 e aplicando fallback.
- Export no barrel `packages/shared-schemas/src/index.ts`.
- Testes unitários: catálogo completo, fallback obrigatório, variável desconhecida, chaves não
  fechadas, corpo sem variável, `{{saudacao}}` nos três períodos, mídia sem `body`.

## Fora de escopo (NÃO faz)

- Qualquer rota, service ou repository (F28-S03/S04).
- Qualquer componente ou hook (F28-S05/S06/S07).
- Schema Drizzle ou migration (F28-S01).
- Validação de PII no corpo — é regra de negócio do service (F28-S03).

## Arquivos permitidos

- `packages/shared-schemas/src/quick-replies.ts`
- `packages/shared-schemas/src/index.ts`
- `packages/shared-schemas/src/__tests__/quick-replies.test.ts`

## Arquivos proibidos

- `apps/api/**`
- `apps/web/**`
- `apps/langgraph-service/**`
- `packages/shared-schemas/src/livechat.ts`

## Contratos de entrada

Nenhum. Pode rodar em paralelo com F28-S01.

## Contratos de saída

- `@elemento/shared-schemas` exporta os schemas, o catálogo `QUICK_REPLY_VARIABLES`,
  `parseQuickReplyVariables` e `interpolateQuickReply`.
- Códigos de erro estáveis: `QUICK_REPLY_UNKNOWN_VARIABLE`, `QUICK_REPLY_MISSING_FALLBACK`.

## Definition of Done

- [ ] Schemas, catálogo e interpolador implementados e exportados no barrel
- [ ] `interpolateQuickReply` é pura (sem I/O, `now` injetado) e coberta por teste
- [ ] Variável fora do catálogo e `contato.*` sem fallback são rejeitadas com código estável
- [ ] Sem `any` e sem `as` não justificado
- [ ] `pnpm --filter @elemento/shared-schemas typecheck` + `lint` + `test` + `build` verdes

## Validação

```powershell
pnpm --filter @elemento/shared-schemas typecheck
pnpm --filter @elemento/shared-schemas lint
pnpm --filter @elemento/shared-schemas test
pnpm --filter @elemento/shared-schemas build
```

## Notas para o agente

- `shared-schemas` é consumido em **runtime** pela API: valores exportados exigem `dist` buildado e
  ordem correta no Dockerfile. Não transformar em pacote types-only.
- Reusar `maxUploadBytesForMime` de `src/livechat.ts` por import — **não** duplicar os limites.
- A sintaxe é `{{chave|fallback}}`. O `|` é literal; escapar corretamente no regex e cobrir o caso
  de fallback contendo espaço e acento.
- Sem dependência nova no `package.json`.
