---
id: F12-S13
title: Fix — Callout crasha a página com type inválido (white-screen no help)
phase: F12
task_ref: docs/20-central-de-ajuda.md#6
status: review
priority: high
estimated_size: XS
agent_id: null
claimed_at: 2026-06-10T00:25:38Z
completed_at: 2026-06-10T00:31:13Z
pr_url: null
depends_on: []
blocks: []
source_docs:
  - docs/20-central-de-ajuda.md#6
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F12-S13 — Callout com type inválido derruba a página

## Objetivo

Corrigir o crash (white-screen) ao abrir um guia da Central de Ajuda e blindar o `<Callout>` para que um `type` inválido nunca quebre a página.

## Diagnóstico (confirmado 2026-06-09)

- `apps/web/src/features/help/mdx-components/Callout.tsx:74` faz `const cfg = CONFIG[type]` **sem fallback**. Tipos válidos: `info | warn | danger | tip` (linha 3). Um `type` fora disso → `cfg` undefined → linha 80 `cfg.bg` lança `TypeError: Cannot read properties of undefined (reading 'bg')` → React desmonta a árvore (white-screen).
- Único MDX com tipo inválido em todo `docs/help/**`: `docs/help/guias/admin/tutoriais-em-video.mdx:119` usa `type="warning"` (deveria ser `warn`). (Varredura: info=28, warn=15, tip=13, danger=1, warning=1 → só esse.)

## Escopo (faz)

### `apps/web/src/features/help/mdx-components/Callout.tsx`

- Fallback defensivo: `const cfg = CONFIG[type] ?? CONFIG.info;` (tipo desconhecido cai em `info`, nunca crasha).
- Aceitar `type` como string no runtime (MDX não é type-checked): manter o union `CalloutType` para autores, mas o componente não deve assumir que `type` é válido. (Ex.: `type?: CalloutType | (string & {})` ou normalizar antes do lookup.) Opcional: `console.warn` quando o type for desconhecido (ajuda autor a achar o typo), sem quebrar.

### `docs/help/guias/admin/tutoriais-em-video.mdx`

- Linha ~119: `type="warning"` → `type="warn"`.

### Teste de regressão

- Teste em `apps/web/src/features/help/mdx-components/__tests__/Callout.test.tsx`: renderizar `<Callout type={'warning' as any}>` (tipo desconhecido) e asseverar que **não lança** (cai no fallback `info`). Cobrir também os 4 tipos válidos.

## Fora de escopo (NÃO faz)

- Lint build-time de tipos de Callout em MDX (slot futuro de hardening, se desejado).
- Mexer em outros componentes MDX ou no DocLayout.

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/help/mdx-components/Callout.tsx`
- `docs/help/guias/admin/tutoriais-em-video.mdx`
- `apps/web/src/features/help/mdx-components/__tests__/Callout.test.tsx`
- `tasks/slots/F12/F12-S13-fix-callout-crash.md`

## Arquivos proibidos (`files_forbidden`)

- Outros `docs/help/**` (só o arquivo com o tipo inválido)
- `apps/api/**`, `packages/**`
- `tasks/STATUS.md`

## Definition of Done

- [ ] Callout não crasha com type inválido (fallback para info)
- [ ] `tutoriais-em-video.mdx` usa `warn`
- [ ] Teste de regressão cobrindo type desconhecido + os 4 válidos
- [ ] `pnpm --filter @elemento/web typecheck` / `lint` / `test` / **`build`** verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
pnpm --filter @elemento/web build
```

## Notas para o agente

- Tipos válidos canônicos do Callout (norma 20 §6): `info | warn | danger | tip`. NÃO inventar novos.
- O fallback é a defesa principal — um typo de autor não pode dar white-screen numa página inteira.
