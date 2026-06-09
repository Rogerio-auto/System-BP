---
id: F12-S12
title: Fix — alinhar cliente admin de tutoriais ao contrato real da API (400/erro ao carregar)
phase: F12
task_ref: docs/21-tutoriais-em-video.md#9
status: review
priority: critical
estimated_size: S
agent_id: null
claimed_at: 2026-06-09T23:29:57Z
completed_at: 2026-06-09T23:39:51Z
pr_url: null
depends_on: [F12-S05]
blocks: []
source_docs:
  - docs/21-tutoriais-em-video.md#9
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F12-S12 — Cliente admin de tutoriais não bate com a API

## Objetivo

Corrigir o cliente/forms do admin de tutoriais para casar com o contrato **real** da API (`apps/api/src/modules/tutorials/`). Hoje a lista dá "Erro ao carregar tutoriais" e o POST dá **400**.

## Diagnóstico (confirmado 2026-06-09)

O F12-S05 (front) e o F12-S02/S08 (API) foram feitos em paralelo e divergem no contrato. A API é a fonte da verdade (mergeada, testada, OpenAPI). Os 3 mismatches:

1. **Naming snake_case vs camelCase.** `apps/web/src/lib/api/tutorials.ts` usa `feature_key`, `video_ref`, `video_hash`, `article_slug`, `duration_seconds`, `is_active`, `created_by`, `created_at`, `updated_at`. A API usa **camelCase**: `featureKey`, `videoRef`, `videoHash`, `articleSlug`, `durationSeconds`, `isActive`, `createdBy`, `createdAt`, `updatedAt` (ver `apps/api/src/modules/tutorials/schemas.ts`). → POST 400 + parse da resposta quebra.
2. **Lista sem paginação.** O front espera `{ data, pagination }`. A API (`GET /api/admin/tutorials`) retorna **só `{ data }`** (`TutorialsAdminListResponseSchema`). → `.parse()` falha → "Erro ao carregar tutoriais" (mesmo com lista vazia).
3. **`idempotencyKey` obrigatório.** O `POST /api/admin/tutorials` exige `idempotencyKey` (string, em `CreateTutorialBodySchema`) e o front não envia. → reforça o 400.

Contrato real (de `schemas.ts` + `routes.ts`):

- `GET /api/admin/tutorials` → `{ data: TutorialAdminItem[] }` (camelCase, inclui `organizationId, isActive, createdBy, createdAt, updatedAt, deletedAt`).
- `POST` → body camelCase + `idempotencyKey` (obrigatório) + `isActive` (default true); resposta = **item direto** `TutorialAdminItem` (camelCase), 200 (idempotente) ou 201.
- `PATCH /:id` → body parcial camelCase (`videoHash/articleSlug/durationSeconds` aceitam null); resposta = item direto camelCase.
- `GET /api/admin/feature-keys` → `{ data: string[] }`.

## Escopo (faz)

### `apps/web/src/lib/api/tutorials.ts`

- Reescrever os Zod schemas para **camelCase**, espelhando a API.
- `TutorialListResponseSchema` = `{ data: TutorialResponseSchema[] }` — **remover `pagination`**.
- `createTutorial`: enviar payload camelCase + **`idempotencyKey`** (gerar via `crypto.randomUUID()` por submit). Resposta = item direto (não `{data}`).
- `updateTutorial`: payload parcial camelCase; resposta = item direto.
- Remover os params de paginação de `listTutorials` (a API não pagina) — ou mantê-los inertes; não quebrar a chamada.

### `apps/web/src/hooks/admin/useTutorials*.ts`

- Ajustar tipos/uso para os novos shapes camelCase e ausência de `pagination`.

### `apps/web/src/features/admin/tutoriais/TutoriaisForm.tsx` e `TutoriaisList.tsx`

- Ler/escrever os campos em camelCase (`featureKey`, `videoRef`, `videoHash`, `articleSlug`, `durationSeconds`, `isActive`).
- A lista não deve depender de `pagination` (renderizar a partir de `data`; remover controles de paginação ou torná-los no-op consistente).
- O form deve gerar e enviar `idempotencyKey`.

### Testes

- Atualizar `apps/web/src/features/admin/tutoriais/__tests__/TutoriaisForm.test.ts` para o payload camelCase + `idempotencyKey`.
- Adicionar teste que valida o **shape de resposta camelCase sem paginação** sendo parseado com sucesso (e que snake_case/`pagination` NÃO são esperados) — pega regressão de contrato.

## Fora de escopo (NÃO faz)

- Mudar a API (`apps/api/**`). A API é o contrato. (Débito separado: `idempotencyKey` obrigatório-mas-não-persistido poderia virar opcional — não aqui.)
- Mexer no `<VideoTutorial>`, drawer, ou instrumentação.

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/lib/api/tutorials.ts`
- `apps/web/src/hooks/admin/useTutorials.ts`
- `apps/web/src/hooks/admin/useTutorials.types.ts`
- `apps/web/src/features/admin/tutoriais/TutoriaisForm.tsx`
- `apps/web/src/features/admin/tutoriais/TutoriaisList.tsx`
- `apps/web/src/features/admin/tutoriais/__tests__/*.test.ts`
- `tasks/slots/F12/F12-S12-fix-admin-tutoriais-contract.md`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/**`, `packages/**`
- `apps/web/src/features/help/**`, `apps/web/src/pages/admin/Tutoriais.tsx` (só a página container; não precisa mudar)
- `tasks/STATUS.md`

## Contratos de entrada

- API de tutoriais mergeada (`apps/api/src/modules/tutorials/schemas.ts` é a referência camelCase).

## Contratos de saída

- `GET /api/admin/tutorials` carrega a lista sem erro.
- Criar/editar tutorial funciona (sem 400).

## Definition of Done

- [ ] Cliente + hooks + form + list em camelCase, sem `pagination`, enviando `idempotencyKey`
- [ ] Teste de contrato (camelCase, sem paginação)
- [ ] `pnpm --filter @elemento/web typecheck` / `lint` / `test` / **`build`** verdes
- [ ] Manual: lista carrega e POST cria (validar contra a API real localmente, se possível)

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
pnpm --filter @elemento/web build
```

## Notas para o agente

- **A API é a fonte da verdade** — confira `apps/api/src/modules/tutorials/schemas.ts` (camelCase) e `routes.ts` (POST retorna item direto; GET retorna `{data}` sem paginação).
- O `idempotencyKey` é obrigatório no body; gere um `crypto.randomUUID()` por submit (não é persistido, serve para dedupe de retry no backend).
- Rode o passo **build** (não só typecheck) antes do finish.
