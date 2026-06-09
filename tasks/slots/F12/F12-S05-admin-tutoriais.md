---
id: F12-S05
title: Admin /admin/tutoriais (CRUD de tutoriais)
phase: F12
task_ref: docs/21-tutoriais-em-video.md#8
status: available
priority: medium
estimated_size: M
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F12-S02, F12-S03]
blocks: [F12-S06]
source_docs:
  - docs/21-tutoriais-em-video.md#8
  - docs/21-tutoriais-em-video.md#9
  - docs/18-design-system.md
docs_required: true
docs_audience:
  - gestor
  - dev
docs_artifacts:
  - docs/help/guias/admin/tutoriais-em-video.mdx
---

# F12-S05 — Admin de tutoriais

## Objetivo

Painel admin onde o desenvolvedor cadastra/edita/ativa/remove tutoriais (feature_key → vídeo + descrição + artigo) **sem deploy**.

## Contexto

Norma 21 §8. Consome o CRUD de F12-S02 e o `<VideoTutorial>` (F12-S03, para preview). `feature_key` vem do catálogo via `GET /api/admin/feature-keys` (dropdown, nunca texto livre). Acesso restrito a `tutorials:manage`.

## Escopo (faz)

- `apps/web/src/pages/admin/Tutoriais.tsx`: lista (title, feature_key, provider, ativo, ações).
- `apps/web/src/features/admin/tutoriais/**`: form (React Hook Form + Zod espelhando a API), dropdown de `feature_key`, `provider`, `videoRef` (+ `hash` se Vimeo), `description`, `articleSlug` (autocomplete via manifest do front), `is_active`, **preview** do player.
- Rota em `apps/web/src/app/router.tsx` + item de menu em `apps/web/src/app/navigation.ts` (visível só com `tutorials:manage`).
- **Doc obrigatória:** `docs/help/guias/admin/tutoriais-em-video.mdx` — "Como cadastrar um tutorial em vídeo" (passos com `<Step>`, erros comuns, veja também). Sem PII.
- Testes da página/form.

## Fora de escopo (NÃO faz)

- ⓘ/drawer (F12-S04).
- Inserir o ⓘ nas telas (F12-S06).
- API (F12-S02, já entregue).

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/pages/admin/Tutoriais.tsx` (criar)
- `apps/web/src/features/admin/tutoriais/**` (criar)
- `apps/web/src/app/router.tsx` (apenas adicionar a rota)
- `apps/web/src/app/navigation.ts` (apenas adicionar o item de menu)
- `docs/help/guias/admin/tutoriais-em-video.mdx` (criar)
- `tasks/slots/F12/F12-S05-admin-tutoriais.md`

## Arquivos proibidos (`files_forbidden`)

- `apps/web/src/features/help/**` (donos: F12-S03/S04)
- `apps/web/src/app/AppLayout.tsx` (dono: F12-S04)
- `apps/api/**`, `packages/**`
- demais telas de feature do app (dono: F12-S06)
- `tasks/STATUS.md`

## Contratos de entrada

- F12-S02: CRUD `/api/admin/tutorials` + `GET /api/admin/feature-keys`. F12-S03: `<VideoTutorial>` para preview.

## Contratos de saída

- Admin funcional: criar/editar/ativar/desativar/remover tutorial sem deploy.

## Definition of Done

- [ ] CRUD completo na UI, restrito a `tutorials:manage`
- [ ] Dropdown de feature_key do catálogo; preview do player
- [ ] Validação client espelhando a API; erros tratados
- [ ] Guia `docs/help/guias/admin/tutoriais-em-video.mdx` criado (sem PII)
- [ ] `pnpm --filter @elemento/web typecheck` / `lint` / `test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
```

## Notas para o agente

- Seguir o padrão das páginas admin existentes (`pages/admin/Cities.tsx`, `Users.tsx`, `Products.tsx`).
- Não duplicar regra de permissão: reusar o guard de rota admin existente.
