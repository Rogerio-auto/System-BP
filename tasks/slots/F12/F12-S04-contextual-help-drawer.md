---
id: F12-S04
title: <ContextualHelp> + Drawer global de ajuda contextual
phase: F12
task_ref: docs/21-tutoriais-em-video.md#7
status: review
priority: medium
estimated_size: M
agent_id: null
claimed_at: 2026-06-09T19:44:09Z
completed_at: 2026-06-09T19:58:37Z
pr_url: null
depends_on: [F12-S02, F12-S03]
blocks: [F12-S06]
source_docs:
  - docs/21-tutoriais-em-video.md#7
  - docs/21-tutoriais-em-video.md#2
  - docs/18-design-system.md
docs_required: true
docs_audience:
  - operador
  - gestor
docs_artifacts:
  - docs/help/conceitos/tutoriais-e-ajuda-contextual.mdx
---

# F12-S04 — Ajuda contextual (ícone ⓘ + drawer)

## Objetivo

Entregar o `<ContextualHelp featureKey>` (ícone ⓘ) e o Drawer global que abre, sem sair da tela, com o vídeo + resumo + link "Ver guia completo" para a Central.

## Contexto

Norma 21 §7. O ⓘ só aparece quando há tutorial **ativo** para a `feature_key` **e** o usuário tem permissão na funcionalidade. Consome `GET /api/help/tutorials` (F12-S02) e renderiza `<VideoTutorial>` (F12-S03). Estado do drawer via Zustand (padrão do `help-palette-store`).

## Escopo (faz)

- `ContextualHelp.tsx`: ícone ⓘ; não renderiza nada se não há tutorial ativo para a key ou se o usuário não tem permissão.
- `useContextualTutorials.ts`: hook TanStack Query que carrega `GET /api/help/tutorials` (cacheado) e indexa por `featureKey`.
- `contextual-help-store.ts`: store Zustand (qual tutorial está aberto).
- `ContextualHelpDrawer.tsx`: drawer (DS) com título + `<VideoTutorial>` + `description` + botão "Ver guia completo" → `/ajuda/<articleSlug>`. Acessível (foco, `Esc`, `aria-label`).
- Montar o drawer global em `apps/web/src/app/AppLayout.tsx`.
- **Doc obrigatória:** `docs/help/conceitos/tutoriais-e-ajuda-contextual.mdx` — explica ao operador o que é o ⓘ e como assistir/encontrar tutoriais. `<FeedbackWidget />` é injetado pelo DocLayout (não inline).
- Testes dos componentes/hook.

## Fora de escopo (NÃO faz)

- Inserir o ⓘ nas telas reais do app (F12-S06).
- Admin de cadastro (F12-S05).
- Telemetria persistida (F12-S07).

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/help/contextual/**` (criar)
- `apps/web/src/app/AppLayout.tsx` (apenas montar o drawer global)
- `docs/help/conceitos/tutoriais-e-ajuda-contextual.mdx` (criar)
- `apps/web/src/features/help/contextual/__tests__/**` (criar)
- `tasks/slots/F12/F12-S04-contextual-help-drawer.md`

## Arquivos proibidos (`files_forbidden`)

- `apps/web/src/features/help/mdx-components/**` (dono: F12-S03)
- `apps/web/src/pages/admin/**`, `apps/web/src/features/admin/**` (dono: F12-S05)
- `apps/web/src/app/router.tsx`, `navigation.ts` (dono: F12-S05)
- demais telas de feature do app (dono: F12-S06)
- `apps/api/**`, `packages/**`
- `tasks/STATUS.md`

## Contratos de entrada

- F12-S02: `GET /api/help/tutorials`. F12-S03: `<VideoTutorial>`.

## Contratos de saída

- `<ContextualHelp featureKey>` pronto para ser plugado em qualquer tela (F12-S06).

## Definition of Done

- [ ] ⓘ aparece só com tutorial ativo + permissão; senão não renderiza
- [ ] Drawer abre com vídeo + resumo + deep-link; acessível
- [ ] Página `docs/help/conceitos/tutoriais-e-ajuda-contextual.mdx` criada (sem PII)
- [ ] `pnpm --filter @elemento/web typecheck` / `lint` / `test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
```

## Notas para o agente

- Reusar a checagem de permissão já existente no app (mesmo mecanismo que esconde itens de menu sem acesso).
- "Ver guia completo": nova aba se houver formulário não salvo; senão navega in-app.
