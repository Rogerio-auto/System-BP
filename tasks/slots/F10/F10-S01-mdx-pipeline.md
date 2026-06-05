---
id: F10-S01
title: Pipeline MDX + componentes base (Callout, Step, CodeBlock)
phase: F10
task_ref: docs/20-central-de-ajuda.md#4
status: available
priority: high
estimated_size: M
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: []
blocks: [F10-S02, F10-S03, F10-S04, F10-S05]
source_docs:
  - docs/20-central-de-ajuda.md#3
  - docs/20-central-de-ajuda.md#4
  - docs/20-central-de-ajuda.md#6
  - docs/18-design-system.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F10-S01 — Pipeline MDX + componentes base

## Objetivo

Habilitar a renderização de arquivos `.mdx` em qualquer rota do `apps/web` com syntax highlight Shiki e três componentes canônicos (`<Callout>`, `<Step>`, `<CodeBlock>`) prontos para uso pelos slots subsequentes do F10.

## Contexto

A norma da Central de Ajuda ([`docs/20-central-de-ajuda.md`](../../../docs/20-central-de-ajuda.md) §4) trava as escolhas técnicas: `@mdx-js/rollup` + `@mdx-js/react` + Shiki. Este slot é o desbloqueio de toda a fase — sem pipeline MDX, S02 (layout), S05 (home + conceitos) e os demais slots de conteúdo não podem começar.

Slot de infraestrutura — `docs_required: false` porque não há feature visível ao usuário final. A página visível chega em F10-S02 (layout) + F10-S05 (home).

## Escopo (faz)

- Instala dependências runtime: `@mdx-js/rollup`, `@mdx-js/react`, `shiki`, `remark-gfm`, `remark-frontmatter`, `rehype-slug`, `rehype-autolink-headings`.
- Atualiza `apps/web/vite.config.ts` para registrar o plugin MDX com a cadeia remark/rehype canônica e Shiki configurado com tema `github-light` (alinhado ao DS light-first) + linguagens `ts, tsx, bash, json`.
- Cria `apps/web/src/features/help/mdx-components/`:
  - `Callout.tsx` — `<Callout type="info|warn|danger|tip">…</Callout>` aplicando tokens DS `--info-bg`, `--warning-bg`, `--danger-bg`, `--success-bg`, com ícone inline por tipo.
  - `Step.tsx` — `<Step number={N}>…</Step>` com circle index + título + corpo.
  - `CodeBlock.tsx` — wrapper para `<pre>` já tratado pelo Shiki, adiciona botão "Copiar" e título opcional.
- Cria `apps/web/src/features/help/mdx-provider.tsx` exportando `HelpMDXProvider` (wrapper do `MDXProvider` do `@mdx-js/react` com o mapping de componentes).
- Cria `apps/web/src/features/help/__demo__/sample.mdx` — página de smoke test cobrindo todos os 3 componentes + tabela GFM + heading com permalink.
- Cria rota temporária `/_dev/help-mdx-preview` em `App.tsx` montada **apenas quando `import.meta.env.DEV`** que renderiza `sample.mdx`. Será removida em F10-S02 quando o layout real chegar.
- Atualiza `apps/web/src/vite-env.d.ts` (ou cria) para declarar o módulo `*.mdx`.

## Fora de escopo (NÃO faz)

- Layout 3-pane (`/ajuda`) — F10-S02.
- Filesystem-based nav — F10-S02.
- Busca FlexSearch + Cmd+K — F10-S03.
- Entry points na sidebar/topbar — F10-S04.
- Páginas reais de conteúdo (home, conceitos, guias) — F10-S05+.
- `<EndpointCard>`, `<Permission>`, `<Screenshot>`, `<VideoEmbed>`, `<RelatedArticles>`, `<FeedbackWidget>` — slots subsequentes.

## Arquivos permitidos (`files_allowed`)

- `apps/web/package.json`
- `apps/web/vite.config.ts`
- `apps/web/src/vite-env.d.ts` (criar se não existir)
- `apps/web/src/App.tsx` (apenas adicionar a rota temporária `/_dev/help-mdx-preview`)
- `apps/web/src/features/help/**` (criação livre)
- `tasks/slots/F10/F10-S01-mdx-pipeline.md` (este próprio arquivo)
- `pnpm-lock.yaml` (efeito colateral do install)

## Arquivos proibidos (`files_forbidden`)

- Qualquer outro arquivo em `apps/web/src/features/**` que não seja `help/`.
- `apps/api/**`, `apps/langgraph-service/**`, `packages/**` — slot é frontend-only.
- `tasks/STATUS.md` — script gerencia.

## Contratos de entrada

- React 18.3 + Vite 5.4 já instalados (confirmado em `apps/web/package.json`).
- Tailwind 3 + tokens DS já existentes em `apps/web/src/index.css` (`--info-bg`, etc.).

## Contratos de saída

- Importar `import Sample from './features/help/__demo__/sample.mdx';` em qualquer componente compila e renderiza.
- Os 3 componentes (`Callout`, `Step`, `CodeBlock`) são importáveis de `apps/web/src/features/help/mdx-components/index.ts` (barrel export).
- Rota `/_dev/help-mdx-preview` renderiza a sample em dev sem erros no console.
- `pnpm --filter @elemento/web build` produz bundle sem erros e tamanho cresce <100 KB gzipped (Shiki é o pesado — usar subset de langs).

## Definition of Done

- [ ] Código implementado conforme escopo
- [ ] `pnpm --filter @elemento/web typecheck` verde
- [ ] `pnpm --filter @elemento/web lint` verde
- [ ] `pnpm --filter @elemento/web test` verde
- [ ] `pnpm --filter @elemento/web build` verde com bundle ≤ baseline + 100 KB
- [ ] Rota `/_dev/help-mdx-preview` renderiza sem erro em `pnpm dev`
- [ ] PR aberto e referenciado neste slot

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
pnpm --filter @elemento/web build
```

## Notas para o agente

- **Shiki ESM:** Importar `getHighlighter` de `shiki` (não `shiki/dist/...`). Vite 5 lida bem com ESM puro.
- **MDX Vite plugin:** Importar `mdx` de `@mdx-js/rollup` e registrar com `enforce: 'pre'` para que o React plugin processe os componentes depois.
- **Subset de langs:** evitar carregar todas as ~150 linguagens do Shiki — limitar a `ts`, `tsx`, `bash`, `json`. Isso mantém o bundle pequeno.
- **Tema:** o DS é light-first com toggle dark — começar com `github-light`. Tema dark fica para slot futuro.
- **Componentes DS:** seguir tokens existentes (`--info`, `--info-bg`, `--warning`, `--success`, `--danger`, `--text`, `--text-2`, `--text-3`). Sem hex hardcoded. Sem inventar variantes.
- **Sample.mdx:** cobrir TODOS os tipos de Callout (info/warn/danger/tip), 2-3 Steps consecutivos, um CodeBlock TS com título, uma tabela GFM, headings H2 e H3.
- **Rota temporária:** envolver em `{import.meta.env.DEV && <Route path="/_dev/help-mdx-preview" element={<HelpMdxPreview />} />}` dentro do bloco protegido do App.tsx para não vazar em prod.
