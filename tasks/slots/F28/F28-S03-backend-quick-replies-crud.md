---
id: F28-S03
title: Backend — módulo CRUD de respostas rápidas (RBAC, audit, realtime)
phase: F28
task_ref: docs/25-respostas-rapidas.md
status: done
priority: critical
estimated_size: M
agent_id: null
depends_on: [F28-S01, F28-S02]
blocks: [F28-S04, F28-S07]
labels: [backend, livechat, quick-replies, rbac]
source_docs:
  [docs/25-respostas-rapidas.md, docs/10-seguranca-permissoes.md, docs/17-lgpd-protecao-dados.md]
docs_required: false
claimed_at: 2026-07-22T21:30:07Z
completed_at: 2026-07-22T22:12:03Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/441
---

# F28-S03 — Módulo backend de respostas rápidas

## Objetivo

Entregar o módulo `quick-replies` da API com CRUD completo, autorização de duas visibilidades,
audit log e notificação em tempo real da mudança de configuração.

## Contexto

Doc 25 §5 e §9. O molde é `apps/api/src/modules/credit-products/**` (routes / controller / service /
repository / schemas), com o refinamento de `notification-rules` de consumir os schemas do pacote
compartilhado.

A regra de autorização mais delicada é a do §5: `manage` administra as da organização, `write`
administra apenas as próprias, e **ninguém** vê a resposta pessoal de outro operador nas rotas de
consumo. Isso é regra de **service**, não só de rota.

## Escopo (faz)

- `apps/api/src/modules/quick-replies/` (routes, controller, service, repository, schemas locais):
  - `GET /api/quick-replies` — lista visíveis ao ator (org ∪ próprias), com busca, filtro por
    `category`/`visibility`/`isActive`, `city_ids` como filtro de conveniência, ordenação
    `sort_order ASC, usage_count DESC, title ASC`, paginação por cursor.
  - `GET /api/quick-replies/:id`
  - `POST /api/quick-replies` — `visibility='organization'` exige `manage`; `'personal'` exige
    `write` e **força** `owner_user_id = actor.userId` (ignorar o que vier no body).
  - `PATCH /api/quick-replies/:id`
  - `DELETE /api/quick-replies/:id` — soft-delete.
  - `PATCH /api/quick-replies/reorder` — lote de `{id, sortOrder}`, exige `manage`.
- `authenticate()` no plugin + `authorize({ permissions: [...] })` por rota +
  `featureGate('livechat.quick_replies.enabled')`.
- Repository filtra **sempre** por `organization_id` e `deleted_at IS NULL`. Regra de visibilidade
  aplicada em SQL, não em memória.
- Validação de PII no `body` (doc 25 §12): rejeitar corpo que case com os padrões canônicos de
  CPF/CNPJ/e-mail/telefone do doc 17 §8.4, com erro claro.
- Conflito de `shortcut` → `409` com código estável `QUICK_REPLY_SHORTCUT_CONFLICT`.
- Audit log em toda mutação (`quick_reply.created` / `.updated` / `.deleted`), **sem `body`** no
  payload — só `quickReplyId`, `shortcut`, `visibility`.
- Realtime (doc 25 §9): após commit, publicar em `QUEUES.socketRelay` via `makeEnvelope` o evento
  `quick_reply:changed` na room `workspace:{orgId}` (visibilidade organização) ou
  `user:{ownerUserId}` (pessoal). Payload sem `body`/`title`/mídia.
- Registro do plugin em `apps/api/src/app.ts`.
- Testes de rota e de service: matriz de permissão positiva e negativa, isolamento entre operadores,
  isolamento entre organizações, conflito de atalho, rejeição de PII, `owner_user_id` forjado.

## Fora de escopo (NÃO faz)

- Upload de mídia e telemetria de uso (F28-S04).
- Qualquer alteração em `modules/conversations/**` ou no worker de saída — o envio reusa o que existe.
- Qualquer frontend.
- Migration ou schema Drizzle (F28-S01).

## Arquivos permitidos

- `apps/api/src/modules/quick-replies/**`
- `apps/api/src/app.ts`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/db/**`
- `apps/api/src/workers/**`
- `apps/api/src/modules/conversations/**`
- `apps/api/src/modules/livechat/**`
- `packages/**`

## Contratos de entrada

- Tabela `quick_replies`, permissões e flag (F28-S01).
- Schemas Zod, catálogo de variáveis e `interpolateQuickReply` (F28-S02).

## Contratos de saída

- Rotas `/api/quick-replies` (list, get, create, patch, delete, reorder) estáveis.
- Evento socket `quick_reply:changed` publicado nas rooms corretas.
- Códigos de erro `QUICK_REPLY_SHORTCUT_CONFLICT`, `QUICK_REPLY_UNKNOWN_VARIABLE`,
  `QUICK_REPLY_MISSING_FALLBACK`, `QUICK_REPLY_PII_IN_BODY`.

## Definition of Done

- [ ] CRUD + reorder implementados conforme escopo
- [ ] Matriz de autorização do doc 25 §5 coberta por teste (positivo **e** negativo)
- [ ] Operador A não obtém resposta pessoal de B em nenhuma rota (teste explícito)
- [ ] `owner_user_id` vindo do body é ignorado (teste explícito)
- [ ] Isolamento entre organizações testado
- [ ] Audit log sem `body` no payload
- [ ] `featureGate` aplicado; flag desligada → 403 `feature_disabled`
- [ ] Evento `quick_reply:changed` publicado após commit, sem PII
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` + `test` + `build` verdes

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
pnpm --filter @elemento/api build
```

## Notas para o agente

- Molde: `apps/api/src/modules/credit-products/**`. Variante moderna: `modules/notification-rules/**`.
- **Não** usar `applyCityScope` aqui: `city_ids` é filtro de exibição, não fronteira (doc 25 §D6).
  A fronteira é `organization_id`.
- O socket nunca é emitido direto — sempre `publish(QUEUES.socketRelay, makeEnvelope(...))`.
  Publicar **após** o commit da transação.
- Permissões são AND no `authorize`. Para rotas em que `write` **ou** `manage` servem, autorize com
  a permissão mínima e decida o resto no service.
- Sem `any`. Erros tipados via `AppError`, nunca `throw new Error('string')`.
