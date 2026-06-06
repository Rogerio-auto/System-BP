---
id: F10-S12
title: Schema doc_views + doc_feedback + endpoints /api/help/*
phase: F10
task_ref: docs/20-central-de-ajuda.md#9
status: available
priority: medium
estimated_size: S
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: []
blocks: [F10-S13]
source_docs:
  - docs/20-central-de-ajuda.md#9
  - docs/20-central-de-ajuda.md#12
  - docs/17-lgpd-protecao-dados.md
  - docs/10-seguranca-permissoes.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F10-S12 — Telemetria da Central de Ajuda

## Objetivo

Schema Postgres (`doc_views`, `doc_feedback`) + 3 endpoints (`POST /api/help/views`, `POST /api/help/feedback`, `GET /api/help/popular`) para alimentar o ranking de "Populares" da home e o `<FeedbackWidget />` (F10-S13). LGPD aplicada: `pino.redact` no comment, retenção 12 meses, anonimização após.

## Contexto

Norma §9. Dados:

- `doc_views`: granular por user+slug, com `viewed_at`. Sem rate-limit no DB; rate-limit é aplicado na rota (1 view por user+slug em 30s).
- `doc_feedback`: 👍/👎 + comentário opcional. Comment pode ter PII inadvertida → redact no logging; retenção 12 meses.
- Retenção: job semanal (slot futuro de hardening; aqui só schema + endpoints).

Postgres é fonte de verdade (CLAUDE.md §1). Nenhuma cache externa; `GET /popular` usa cache em memória (TTL 10min) dentro da rota.

## Escopo (faz)

### Schema Drizzle

- `apps/api/src/db/schema/docViews.ts`:
  ```ts
  export const docViews = pgTable(
    'doc_views',
    {
      id: uuid('id').primaryKey().defaultRandom(),
      userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
      articleSlug: text('article_slug').notNull(),
      viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => ({
      slugTimeIdx: index('idx_doc_views_slug_time').on(t.articleSlug, t.viewedAt.desc()),
    }),
  );
  ```
- `apps/api/src/db/schema/docFeedback.ts`:
  ```ts
  export const docFeedback = pgTable(
    'doc_feedback',
    {
      id: uuid('id').primaryKey().defaultRandom(),
      userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
      articleSlug: text('article_slug').notNull(),
      helpful: boolean('helpful').notNull(),
      comment: text('comment'),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => ({
      slugIdx: index('idx_doc_feedback_slug').on(t.articleSlug, t.createdAt.desc()),
    }),
  );
  ```
- Exporta ambos em `apps/api/src/db/schema/index.ts`.

### Migration SQL

- `apps/api/src/db/migrations/0046_doc_telemetry.sql`:
  - Cria as 2 tabelas e os 2 índices exatamente como na norma §9.
  - Statement-breakpoint conforme padrão das migrations existentes (vide 0036, 0041 — F0-S22 normatizou).

### Módulo help

- `apps/api/src/modules/help/` (criar):
  - `repository.ts`: `recordView(userId, slug)`, `recordFeedback({ userId, slug, helpful, comment })`, `getPopular(limit, since)`.
  - `routes.ts`:
    - `POST /api/help/views { slug }` — autenticado, body validado por Zod. Rate-limit em memória: por `${userId}:${slug}` aceita 1 a cada 30s; excedente retorna 204 (no-op, não 429 — UX silenciosa para uma operação opcional).
    - `POST /api/help/feedback { slug, helpful, comment? }` — autenticado. `comment` em Zod com `.max(2000)`. Loga com `pino.redact` cobrindo `comment` (substituído por `***`).
    - `GET /api/help/popular?limit=10` — autenticado. Query: top N slugs por count(views) nos últimos 30 dias. Cache in-memory por 10min (`Map<limit, { value, expiresAt }>`).
  - `schemas.ts`: Zod para os 3 payloads + responses, com `.openapi({ example })` para que F10-S09 inclua na spec.
  - `__tests__/help.test.ts`: integration tests rodando com Postgres real (padrão do projeto):
    - View registrada; segunda view em <30s retorna 204; terceira após 31s registra.
    - Feedback registrado; log do request capturado e validado que `comment` foi redatado.
    - Popular ordena por count, filtra ≥ 30d, respeita limit.
- Registra módulo em `apps/api/src/app.ts`.
- Adiciona tag `Help` na lista de tags do plugin OpenAPI **somente se F10-S09 estiver mergeado** (caso contrário, comente: `// TODO: tag injetada quando S09 entrar`). Default: assumir S09 mergeado — mas como `depends_on` é vazio, o agente que pegar este slot deve verificar `apps/api/src/plugins/openapi.ts` antes; se existir, adicionar tag; se não, omitir.

### Pino redact

- `apps/api/src/lib/logger.ts` (verificar; se já tem lista canônica de paths a redatar, adicionar `req.body.comment`).
- Se logger config estiver em outro lugar, identificar e ajustar.

### Permissão

- Não há permissão RBAC específica — qualquer usuário autenticado registra views/feedback dos próprios accessos. Esquema de "ler popular de outras pessoas" é leitura agregada, **sem** PII de quem viu — qualquer usuário pode ler.
- `applyCityScope` **não** se aplica (slug não é vinculado a cidade).

## Fora de escopo (NÃO faz)

- Componente UI `<FeedbackWidget />` — F10-S13.
- Mudanças na home/UI para mostrar populares — F10-S13.
- Job de retenção/anonimização de 12 meses — slot futuro de hardening (`docs/17-lgpd-protecao-dados.md` exige; aqui declaramos o requisito em comentário no schema).
- Cache distribuído (Redis) — escopo MVP é in-memory; quando MVP virar multi-instância, slot dedicado.
- Outbox de eventos para `doc.viewed`/`doc.feedback_given` — não há consumidor (não é evento de domínio). Não criar.
- Endpoints de admin para listar/exportar feedback — slot futuro.

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/db/schema/docViews.ts` (criar)
- `apps/api/src/db/schema/docFeedback.ts` (criar)
- `apps/api/src/db/schema/index.ts` (apenas exports)
- `apps/api/src/db/migrations/0046_doc_telemetry.sql` (criar)
- `apps/api/src/modules/help/repository.ts` (criar)
- `apps/api/src/modules/help/routes.ts` (criar)
- `apps/api/src/modules/help/schemas.ts` (criar)
- `apps/api/src/modules/help/__tests__/help.test.ts` (criar)
- `apps/api/src/app.ts` (registrar módulo)
- `apps/api/src/plugins/openapi.ts` (adicionar tag `Help` **se** o arquivo existir; do contrário deixar para S09 cuidar)
- `apps/api/src/lib/logger.ts` (apenas adicionar path à lista de redact se necessário)
- `tasks/slots/F10/F10-S12-doc-telemetry-schema.md`

## Arquivos proibidos (`files_forbidden`)

- `apps/web/**`
- `apps/langgraph-service/**`
- `docs/help/**`
- `packages/**`
- Qualquer outro `apps/api/src/modules/*/routes.ts`
- `apps/api/src/db/schema/users.ts` (usar como FK, não modificar)
- `tasks/STATUS.md`

## Contratos de entrada

- Backend Fastify 5 com auth JWT funcional (`request.user.id` disponível em rotas autenticadas).
- Drizzle ORM + migrations já configurados.
- Postgres 16 com `pgcrypto` para `gen_random_uuid()`.
- pino logger configurado.

## Contratos de saída

- 2 tabelas criadas via migration 0046.
- 3 endpoints respondem conforme spec da norma §9.
- Rate-limit de 30s por user+slug aplicado em `POST /views`.
- `GET /popular?limit=10` retorna top 10 ordenado por count, últimos 30 dias, cache 10min.
- `comment` redatado nos logs (verificado em teste).
- Schemas Zod expostos com `.openapi({ example })`.

## Definition of Done

- [ ] Migration 0046 aplica e reverte limpa
- [ ] 3 endpoints com testes integration verdes (Postgres real)
- [ ] Rate-limit testado: <30s = no-op (204), ≥30s = persist (201)
- [ ] Pino redact validado por teste de log capture
- [ ] `pnpm --filter @elemento/api typecheck/lint/test/build` verde
- [ ] `pnpm --filter @elemento/api db:migrate` aplica sem erro num DB clean
- [ ] Se F10-S09 mergeado: tag `Help` aparece na spec; endpoints com schemas completos

## Comandos de validação

```powershell
pnpm --filter @elemento/api db:migrate
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
pnpm --filter @elemento/api build
```

## Notas para o agente

- **`onDelete: 'set null'`** em `user_id` é parte da política de retenção (norma §9): quando o usuário pede exclusão, mantemos a métrica agregada mas perdemos a identidade.
- **Rate-limit in-memory:** suficiente para MVP single-instance. Estrutura: `Map<string, number>` com `userId:slug → lastAt`. GC a cada 1000 inserts iterando e removendo entries antigas. Documentar limitação em comentário.
- **Cache de popular:** in-memory. TTL 10min. Invalidação não acontece em writes (eventual consistency aceitável aqui).
- **Validação de slug:** Zod regex `/^[a-z0-9/-]+$/` — ASCII puro (norma §5). Não normalizar; recusar caracteres fora do conjunto.
- **`POST /views` é "fire-and-forget"** da perspectiva do client. Não bloqueia, não tem `await` no UI quando o widget chamar. Repositório retorna void, rota retorna 201 ou 204 sem body.
- **PII em comment:** mesmo redatado no log, o DB armazena raw. Slot futuro de hardening: trigger PL/pgSQL que detecta padrão de CPF/telefone e marca o row como `needs_review`. Não fazer agora.
- **Tag `Help` no OpenAPI:** se S09 ainda não mergeado, ao registrar tag em `apps/api/src/plugins/openapi.ts` não existe → omita; S09 vai cobrir quando juntar. Caso S09 esteja em main: edite a lista de tags adicionando `'Help'` no fim da ordem editorial e marcando description "Telemetria e feedback das páginas de ajuda".
- **Testes:** seguir padrão dos módulos existentes (`apps/api/src/modules/*/[__tests__]/*.test.ts`) — usar `testApp` fixture, setup/teardown de Postgres por arquivo, factories de user.
