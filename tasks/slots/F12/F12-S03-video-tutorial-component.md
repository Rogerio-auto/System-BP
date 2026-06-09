---
id: F12-S03
title: Componente <VideoTutorial> provider-aware + registro no MDX
phase: F12
task_ref: docs/21-tutoriais-em-video.md#6
status: in-progress
priority: medium
estimated_size: S
agent_id: null
claimed_at: 2026-06-09T15:01:23Z
completed_at: null
pr_url: null
depends_on: []
blocks: [F12-S04, F12-S05]
source_docs:
  - docs/21-tutoriais-em-video.md#6
  - docs/21-tutoriais-em-video.md#5
  - docs/18-design-system.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F12-S03 — Componente <VideoTutorial>

## Objetivo

Entregar o componente de vídeo provider-aware (`youtube` | `vimeo` | `mp4`), reutilizado tanto nas páginas MDX da Central quanto no drawer de ajuda contextual (F12-S04), respeitando o Design System.

## Contexto

Norma 21 §6. Realiza o `<VideoEmbed>` que a norma 20 §6 reservava — não criar dois componentes. MVP usa `provider="youtube"` (não listado), mas a interface já abstrai Vimeo/MP4 para upgrade futuro sem reescrever páginas.

## Escopo (faz)

- `apps/web/src/features/help/mdx-components/VideoTutorial.tsx`:
  - Props: `provider`, `videoRef`, `hash?`, `title?`, `onPlay?`, `onEnded?`.
  - YouTube: embed `youtube-nocookie.com` (privacy-enhanced); lazy (só carrega o iframe ao entrar no viewport ou ao abrir o drawer).
  - Vimeo/MP4: caminho preparado (Vimeo via player URL+hash; MP4 via `<video>`). Sem dependência nova obrigatória para o MVP YouTube.
  - Aspect-ratio 16:9, bordas/profundidade/skeleton do DS (tokens da norma 18).
- Registrar em `mdx-components/index.ts` e no `mdx-provider.tsx`.
- Teste em `mdx-components/__tests__/VideoTutorial.test.tsx`.

## Fora de escopo (NÃO faz)

- Drawer / ajuda contextual (F12-S04).
- Telemetria persistida (F12-S07) — aqui só os callbacks `onPlay`/`onEnded`.
- Qualquer chamada de API.

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/help/mdx-components/VideoTutorial.tsx` (criar)
- `apps/web/src/features/help/mdx-components/index.ts` (registrar)
- `apps/web/src/features/help/mdx-provider.tsx` (registrar no MDX)
- `apps/web/src/features/help/mdx-components/__tests__/VideoTutorial.test.tsx` (criar)
- `tasks/slots/F12/F12-S03-video-tutorial-component.md`

## Arquivos proibidos (`files_forbidden`)

- Demais arquivos de `apps/web/src/features/help/` (DocLayout, manifest, etc.)
- `apps/api/**`, `packages/**`
- `tasks/STATUS.md`

## Contratos de entrada

- DS (norma 18) e o provider de MDX existentes.

## Contratos de saída

- `<VideoTutorial>` disponível para MDX e import direto (F12-S04/S05).

## Definition of Done

- [ ] Componente renderiza YouTube não listado com lazy-load
- [ ] Respeita o DS (16:9, skeleton, bordas)
- [ ] Registrado no MDX
- [ ] `pnpm --filter @elemento/web typecheck` / `lint` / `test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
```

## Notas para o agente

- Sem autoplay. `title` em `aria-label`/`<iframe title>`.
- Se for usar `lite-youtube`/qualquer dep nova, justifique no PR (PROTOCOL §1.3) — preferir iframe nativo lazy.
