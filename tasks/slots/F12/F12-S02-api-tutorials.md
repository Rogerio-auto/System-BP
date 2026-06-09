---
id: F12-S02
title: API /api/help/tutorials + /api/admin/tutorials CRUD + RBAC
phase: F12
task_ref: docs/21-tutoriais-em-video.md#9
status: in-progress
priority: medium
estimated_size: M
agent_id: null
claimed_at: 2026-06-09T17:26:44Z
completed_at: null
pr_url: null
depends_on: [F12-S01]
blocks: [F12-S04, F12-S05, F12-S07]
source_docs:
  - docs/21-tutoriais-em-video.md#9
  - docs/21-tutoriais-em-video.md#4
  - docs/21-tutoriais-em-video.md#12
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F12-S02 — API de tutoriais (leitura pública + CRUD admin)

## Objetivo

Expor a leitura dos tutoriais ativos (qualquer autenticado) e o CRUD administrativo (permissão `tutorials:manage`), com Zod + OpenAPI + audit + idempotência, atrás da flag `tutorials.enabled`.

## Contexto

Norma 21 §9 define os endpoints e o RBAC. O `<ContextualHelp>` (F12-S04) consome `GET /api/help/tutorials`; o admin (F12-S05) consome o CRUD. Endpoints com `fastify-zod-openapi` entram sozinhos na API Reference (F10-S09/S11).

## Escopo (faz)

- Módulo `apps/api/src/modules/tutorials/` (`routes.ts`, `repository.ts`, `schemas.ts`, `__tests__/`).
- `GET /api/help/tutorials` — lista de ativos (`is_active` e `deleted_at IS NULL`), payload enxuto, cacheável.
- `GET /api/admin/tutorials` — lista completa; `POST` / `PATCH /:id` / `DELETE /:id` (soft-delete) — todos com permissão `tutorials:manage`.
- `GET /api/admin/feature-keys` — devolve o catálogo de `packages/shared-types`.
- Zod request+response em todas; `.describe()` + `.openapi({ example })`; `summary`/`description` escritos para publicação.
- Validação de `feature_key` contra o catálogo no POST/PATCH.
- **Audit log** em POST/PATCH/DELETE; **idempotência** no POST.
- Registrar a flag `tutorials.enabled` e fazer as rotas a respeitarem.
- Registrar o módulo onde os demais módulos são registrados (seguir o padrão do módulo `help`).

## Fora de escopo (NÃO faz)

- Schema/migration (F12-S01, já entregue).
- Qualquer UI (F12-S04/S05).
- Telemetria de adoção (F12-S07).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/tutorials/**` (criar)
- `apps/api/src/app.ts` (apenas registrar o módulo/rotas — seguir padrão existente)
- `apps/api/src/lib/featureFlags.ts` (adicionar `tutorials.enabled` se o registro de flags viver aqui)
- `tasks/slots/F12/F12-S02-api-tutorials.md`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/db/schema/**`, `apps/api/src/db/migrations/**` (donos: F12-S01)
- `apps/web/**`, `apps/langgraph-service/**`
- Outros módulos em `apps/api/src/modules/` que não `tutorials`
- `tasks/STATUS.md`

## Contratos de entrada

- F12-S01: `feature_tutorials`, permissão `tutorials:manage`, catálogo `featureKeys`.

## Contratos de saída

- `GET /api/help/tutorials` retorna `[{ featureKey, title, description, provider, videoRef, hash?, articleSlug?, durationSeconds? }]` ativos.
- CRUD admin protegido por `tutorials:manage`, auditado.
- Endpoints na API Reference auto-gerada.

## Definition of Done

- [ ] Endpoints conforme §9 com Zod + OpenAPI
- [ ] RBAC `tutorials:manage` testado (positivo + negativo)
- [ ] Audit em mutações; idempotência no POST
- [ ] Flag `tutorials.enabled` respeitada
- [ ] `pnpm --filter @elemento/api typecheck` / `lint` / `test` verdes (testes novos do módulo)

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
```

## Notas para o agente

- Espelhe a estrutura do módulo `help` (F10-S12) para roteamento e testes.
- Resposta de `GET /api/help/tutorials` **sem** PII e sem campos de auditoria internos.
- `feature_key` inválida (fora do catálogo) → 422 com mensagem clara.
