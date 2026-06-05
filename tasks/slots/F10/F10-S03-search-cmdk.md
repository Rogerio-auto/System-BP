---
id: F10-S03
title: Busca FlexSearch + Cmd+K palette global
phase: F10
task_ref: docs/20-central-de-ajuda.md#7
status: done
priority: high
estimated_size: S
agent_id: null
claimed_at: null
completed_at: 2026-06-05T17:43:16Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/185
depends_on: [F10-S02]
blocks: [F10-S04]
source_docs:
  - docs/20-central-de-ajuda.md#7
  - docs/18-design-system.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F10-S03 — Busca FlexSearch + Cmd+K palette

## Objetivo

Habilitar busca global na Central de Ajuda via palette Cmd+K (Mac) / Ctrl+K (Win/Linux) acessível em qualquer rota autenticada. FlexSearch indexa título, descrição e corpo de todos os `.mdx` em `docs/help/`. Resultados ranqueados, navegação por teclado (↑/↓/Enter), latência alvo <100 ms.

## Contexto

A norma §7 trava a escolha: FlexSearch (índice pré-built) + cmdk (palette acessível, padrão Linear/Stripe/Vercel). Sem busca, Central de Ajuda escala mal — operadores precisam clicar a árvore manualmente. Cmd+K é o caminho de descoberta canônico em SaaS modernos.

## Escopo (faz)

- Instala `flexsearch` (~10 KB gzipped) e `cmdk` (~5 KB gzipped, da Vercel).
- Cria `apps/web/src/features/help/search.ts`:
  - Usa `import.meta.glob('.../docs/help/**/*.mdx', { query: '?raw', import: 'default', eager: true })` para ter o markdown bruto na build (HMR funcional).
  - Extrai `frontmatter` via parser simples + corpo limpo (strip code blocks, JSX, links, headings markers).
  - Builda `FlexSearch.Document` com campos `title` (peso alto), `description`, `body`.
  - Exposes `searchHelp(query, limit?)` retornando `{ slug, title, description?, snippet? }[]`.
  - Memoizado: índice construído uma vez.
- Cria `apps/web/src/features/help/SearchPalette.tsx`:
  - `cmdk` dialog em modo controlado.
  - Atalho global Cmd+K / Ctrl+K via `useEffect` em `window`.
  - Esc fecha. Enter navega.
  - DS tokens: `--bg-elev-1`, `--border`, `--brand-azul` (focus), `--surface-hover`.
  - Renderiza resultado com título destacado, snippet abaixo (cor `--text-3`).
  - Empty state amigável quando query vazia ("Digite para buscar nas páginas de ajuda") + sem resultados ("Nada encontrado").
- Monta `<SearchPalette />` em `AppLayout.tsx` (fica global em todas as rotas protegidas).
- Adiciona teste de unidade para `search.ts`: queries básicas encontram artigos esperados.

## Fora de escopo (NÃO faz)

- Botão visível para abrir palette (ícone "?" da topbar) — F10-S04.
- Histórico de buscas / recentes — slot futuro.
- Busca por API Reference (não tem ainda) — F10-S09+.
- Highlight de termos no resultado — pode ser perf hardening depois.
- Telemetria de buscas — F10-S12.

## Arquivos permitidos (`files_allowed`)

- `apps/web/package.json`
- `apps/web/src/app/AppLayout.tsx` (apenas adicionar `<SearchPalette />`)
- `apps/web/src/features/help/**`
- `tasks/slots/F10/F10-S03-search-cmdk.md`
- `pnpm-lock.yaml`

## Arquivos proibidos (`files_forbidden`)

- Qualquer `apps/web/src/features/**` que não seja `help/`.
- `apps/api/**`, `apps/langgraph-service/**`, `packages/**`.
- `tasks/STATUS.md`.

## Contratos de entrada

- F10-S02 entregue: manifest filesystem-driven em `docs/help/**.mdx` existe.
- React 18 + Vite 5 + Tailwind 3 já configurados (S01+S02).

## Contratos de saída

- Pressionar `Cmd+K` ou `Ctrl+K` em qualquer rota autenticada abre o palette.
- Digitar termo retorna resultados em <100 ms (medido em dev).
- `Enter` navega para `/ajuda/<slug>` do item selecionado.
- `Esc` fecha o palette.
- `SearchPalette` é testável em isolamento via render unitário (mas como projeto não tem JSDOM, teste fica focado em `searchHelp` puro).

## Definition of Done

- [ ] Código implementado conforme escopo
- [ ] `pnpm --filter @elemento/web typecheck` verde
- [ ] `pnpm --filter @elemento/web lint` verde
- [ ] `pnpm --filter @elemento/web test` verde (incluindo testes novos de search.ts)
- [ ] `pnpm --filter @elemento/web build` verde com main bundle ≤ baseline + 25 KB gzipped
- [ ] Cmd+K abre o palette em dev
- [ ] Busca por "pipeline" retorna o artigo conceitos/pipeline-mdx

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
pnpm --filter @elemento/web build
```

## Notas para o agente

- **`cmdk` v1.x** expõe `Command.Dialog` que renderiza um `<dialog>` nativo + portal — usar essa API. Estilizar via className passada nos sub-componentes.
- **FlexSearch Document** com `{ document: { id: 'slug', index: [{field:'title',tokenize:'forward'},{field:'description'},{field:'body'}] } }` dá peso natural ao título.
- **Strip markdown:** regex simples — code fences, JSX tags, anchors, headers markers, ênfase. Não precisa de parser completo; texto bruto serve para FlexSearch.
- **Snippet:** primeiros ~120 chars do corpo limpo do artigo. Em iterações futuras, pode ser o fragmento ao redor do match.
- **Atalho global:** `window.addEventListener('keydown', ...)` em `useEffect`, checar `(e.metaKey || e.ctrlKey) && e.key === 'k'`, `e.preventDefault()`. Cleanup no return.
- **Acessibilidade:** cmdk já cuida de roles/aria-selected/foco. Não inventar.
- **Não vazar PII no índice:** a partir de F10-S05, screenshots e exemplos podem ter "Ana Paula" etc., mas isso são personas fictícias da norma §12. OK no índice.
