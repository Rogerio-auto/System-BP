---
id: F10-S02
title: Layout 3-pane (nav + conteúdo + TOC) + filesystem-based nav
phase: F10
task_ref: docs/20-central-de-ajuda.md#3
status: available
priority: high
estimated_size: M
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F10-S01]
blocks: [F10-S03, F10-S04, F10-S05]
source_docs:
  - docs/20-central-de-ajuda.md#3
  - docs/20-central-de-ajuda.md#5
  - docs/18-design-system.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F10-S02 — Layout 3-pane + filesystem-based nav

## Objetivo

Entregar a casca da Central de Ajuda: rota `/ajuda` com layout 3-pane (nav esquerda / conteúdo / sumário lateral direito), nav gerado dinamicamente a partir do filesystem (`docs/help/**.mdx`), e roteamento dinâmico que carrega qualquer página por slug.

## Contexto

F10-S01 deixou pipeline MDX + componentes base prontos. S02 entrega o que o usuário vê: a "casa" da Central de Ajuda, no padrão Stripe Docs. A partir desse slot, qualquer `.mdx` em `docs/help/` automaticamente vira página acessível em `/ajuda/<caminho-sem-mdx>`.

A rota dev-only `/_dev/help-mdx-preview` (criada em S01) é removida aqui.

## Escopo (faz)

- Instala `remark-mdx-frontmatter` para que cada `.mdx` exporte `frontmatter` como named export (título, descrição, ordem).
- Atualiza `vite.config.ts`:
  - Adiciona `remarkMdxFrontmatter` aos `remarkPlugins`.
  - Adiciona `server.fs.allow` incluindo `docs/` (monorepo root) — Vite por default bloqueia acesso fora de `apps/web/`.
- Cria estrutura inicial em `docs/help/`:
  - `docs/help/index.mdx` — landing page placeholder
  - `docs/help/conceitos/pipeline-mdx.mdx` — página de teste cobrindo todos os componentes (substitui o sample.mdx removido)
- Cria `apps/web/src/features/help/manifest.ts`:
  - Usa `import.meta.glob('../../../../docs/help/**/*.mdx', { eager: false })`.
  - Deriva nav tree (`Section[] = { slug, title, items: Article[] }`).
  - Exporta `getHelpManifest()`, `getArticleBySlug(slug)`.
- Cria `apps/web/src/features/help/DocLayout.tsx`:
  - Shell 3-pane: nav esquerda (sticky, 240px), conteúdo centro (max-w prose), TOC direita (sticky, 200px).
  - Responsivo: TOC some <lg, nav vira drawer <md.
- Cria `apps/web/src/features/help/HelpNav.tsx`:
  - Renderiza o manifest como lista expansível por seção.
  - Highlight da rota ativa via `useLocation`.
- Cria `apps/web/src/features/help/Toc.tsx`:
  - Pós-mount, query `h2, h3` do conteúdo + render como lista com scroll-into-view.
  - Highlight da seção visível via IntersectionObserver.
- Cria `apps/web/src/features/help/HelpHomePage.tsx`:
  - Renderiza `docs/help/index.mdx` dentro de `DocLayout`.
- Cria `apps/web/src/features/help/DocPage.tsx`:
  - Lê `useParams()`, busca slug no manifest, dynamic `import()` do MDX correspondente, renderiza dentro de `DocLayout`.
  - 404 amigável quando slug não existe.
- Atualiza `App.tsx`:
  - Adiciona `<Route path="/ajuda" element={<HelpHomePage />} />` e `<Route path="/ajuda/*" element={<DocPage />} />` dentro do bloco protegido.
  - Remove a rota dev-only `/_dev/help-mdx-preview`.
- Remove `apps/web/src/features/help/__demo__/` inteiro (sample.mdx e HelpMdxPreview.tsx).

## Fora de escopo (NÃO faz)

- Busca FlexSearch + Cmd+K — F10-S03.
- Topbar "?" + sidebar entry — F10-S04.
- Páginas reais de conteúdo (home rica, conceitos, guias) — F10-S05+.
- TOC extraído em build-time via rehype-extract-toc — F10-S03 ou perf futuro.
- Drawer mobile elaborado — basta funcionalidade básica responsiva.
- Telemetria de view — F10-S12.

## Arquivos permitidos (`files_allowed`)

- `apps/web/package.json`
- `apps/web/vite.config.ts`
- `apps/web/src/App.tsx` (apenas remover rota dev + adicionar `/ajuda` e `/ajuda/*`)
- `apps/web/src/features/help/**` (criação livre; pode deletar `__demo__/`)
- `docs/help/**` (criar `index.mdx` + `conceitos/pipeline-mdx.mdx` no mínimo)
- `tasks/slots/F10/F10-S02-layout-3-pane.md` (este arquivo)
- `pnpm-lock.yaml`

## Arquivos proibidos (`files_forbidden`)

- Qualquer `apps/web/src/features/**` que não seja `help/`.
- `apps/api/**`, `apps/langgraph-service/**`, `packages/**`.
- `tasks/STATUS.md`.

## Contratos de entrada

- F10-S01 entregue: `HelpMDXProvider`, `Callout`, `Step`, `CodeBlock`, pipeline Vite MDX.
- `apps/web/src/features/help/mdx-components/` e `mdx-provider.tsx` existem e funcionam.

## Contratos de saída

- Acessar `/ajuda` autenticado renderiza a home (`docs/help/index.mdx`) no shell 3-pane.
- Acessar `/ajuda/conceitos/pipeline-mdx` renderiza a página de teste, com nav highlight e TOC à direita.
- Adicionar um novo `.mdx` em `docs/help/<dir>/<arquivo>.mdx` faz a página aparecer automaticamente na nav e ser acessível em `/ajuda/<dir>/<arquivo>` sem reiniciar o dev server (HMR funcional).
- 404 amigável em slug inexistente.

## Definition of Done

- [ ] Código implementado conforme escopo
- [ ] `pnpm --filter @elemento/web typecheck` verde
- [ ] `pnpm --filter @elemento/web lint` verde
- [ ] `pnpm --filter @elemento/web test` verde
- [ ] `pnpm --filter @elemento/web build` verde com main bundle ≤ baseline + 50 KB gzipped
- [ ] `/ajuda` renderiza em dev e em build
- [ ] `/ajuda/conceitos/pipeline-mdx` renderiza com nav + TOC
- [ ] Rota dev-only `/_dev/help-mdx-preview` removida
- [ ] Pasta `apps/web/src/features/help/__demo__` removida

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
pnpm --filter @elemento/web build
```

## Notas para o agente

- **`server.fs.allow`** é necessário porque `docs/` está fora de `apps/web/`. Sem isso, Vite serve 403.
- **`import.meta.glob`** com path relativo: `../../../../docs/help/**/*.mdx` se manifest.ts está em `apps/web/src/features/help/`. Confirme depth contando segmentos.
- **Nav tree:** ordenar seções e items por (frontmatter `order` se existir, senão alfabético). Folder slug vira título capitalizado por default — labels custom (pt-BR pretty) ficam em S05.
- **TOC:** query `article h2, article h3` dentro do `<DocLayout>`. Use `useEffect(..., [location.pathname])` para re-extrair em troca de página.
- **404:** quando slug não bate, renderizar dentro do `DocLayout` (mantém UX) com link para `/ajuda`.
- **Sample.mdx → docs/help/conceitos/pipeline-mdx.mdx:** mantém o mesmo conteúdo de sample (cobre Callout/Step/CodeBlock/tabela), mas agora com frontmatter `title`, `description`, `order: 999` para ficar no final.
- **DS:** seguir tokens existentes — `--bg`, `--bg-elev-1`, `--border`, `--text`, `--text-2`, `--text-3`. Sticky panes com `position: sticky; top: 3.5rem` (abaixo da topbar).
