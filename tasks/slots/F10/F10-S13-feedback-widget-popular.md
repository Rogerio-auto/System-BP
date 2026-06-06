---
id: F10-S13
title: <FeedbackWidget /> + ranking de Populares na home
phase: F10
task_ref: docs/20-central-de-ajuda.md#9
status: in-progress
priority: high
estimated_size: S
agent_id: null
claimed_at: 2026-06-06T17:34:30Z
completed_at: null
pr_url: null
depends_on: [F10-S12]
blocks: [F10-S14]
source_docs:
  - docs/20-central-de-ajuda.md#6
  - docs/20-central-de-ajuda.md#9
  - docs/18-design-system.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F10-S13 — FeedbackWidget + Populares

## Objetivo

Frontend que consome a telemetria de F10-S12: componente MDX `<FeedbackWidget />` automático em todas as páginas da Central de Ajuda + seção "Populares" na home com top 10 artigos mais vistos nos últimos 30 dias. Fecha o vertical de feedback/ranking previsto pela norma §9 e habilita F10-S14 (template MDX pode incluir o widget como padrão obrigatório).

## Contexto

A norma §6 lista `<FeedbackWidget />` no conjunto canônico. F10-S12 expôs 3 endpoints (`POST /views`, `POST /feedback`, `GET /popular`). Este slot:

1. Renderiza o widget no rodapé de **toda** página MDX (não precisa o autor incluir manualmente — injetado no `DocLayout` após o `<article>`).
2. Bate `POST /views` ao montar a página (debounced 1s para evitar contar pré-loads / back/forward).
3. Acrescenta seção "Populares" na home com os 10 mais vistos.

Decisão sobre cobertura: widget **automático** em DocPage; em ApiReferencePage (F10-S10) também aparece, mas o slug enviado é `api/${resource}` para que o tracking seja por recurso, não por endpoint.

## Escopo (faz)

### Componente FeedbackWidget

- `apps/web/src/features/help/mdx-components/FeedbackWidget.tsx`:
  - Estado: `'idle' | 'asking' | 'submitting' | 'sent' | 'error'`.
  - UI:
    - Heading curto: "Esta página ajudou?"
    - Dois botões grandes, lado a lado: 👍 Sim / 👎 Não. Hover/active conforme `docs/18-design-system.md` (estado physical depth).
    - Ao clicar, expande textarea opcional ("Conta pra gente o que faltou — opcional"). Submit envia `{ helpful, comment }`.
    - "sent": estado terminal com agradecimento + opção de "Mudar resposta" (re-submeter no mesmo slug é permitido pelo backend — gera novo row).
    - "error": retry com backoff exponencial uma vez, depois mostra "Não conseguimos enviar — tente novamente" sem expor stack.
  - Slug: lê do `location.pathname` (remove prefixo `/ajuda/`).
  - **LGPD na UX:** placeholder do textarea: "Evite escrever CPF, telefone ou nome de pessoas reais — o feedback é lido pelo time."
  - Tamanho: ≤180 LOC. Sem libs novas.
- `apps/web/src/features/help/mdx-components/__tests__/FeedbackWidget.test.tsx`:
  - Render inicial, click positivo, click negativo, submit com comment, submit sem comment, error retry, sent → mudar resposta.

### Injeção automática no DocLayout

- `apps/web/src/features/help/DocLayout.tsx`:
  - Após `</HelpMDXProvider>` (último filho de `<article>`), renderiza `<FeedbackWidget />` quando o slug não é raiz (`/ajuda`) nem `/ajuda/api` (a home tem seu próprio padrão; a API tem widget próprio no ApiReferencePage). Heurística: se rota começa com `/ajuda/` e tem ao menos um `/` adicional → widget.
- Em `apps/web/src/features/help/api-reference/ApiReferencePage.tsx`:
  - Mesma injeção no rodapé do painel central, com slug `api/${resource}`.

### Hook usePopular

- `apps/web/src/features/help/api/usePopular.ts`:
  - `useQuery({ queryKey: ['help', 'popular', limit], queryFn: () => fetch('/api/help/popular?limit=...'), staleTime: 600_000 })`.
  - Retorna `{ data: { slug: string, title: string, count: number }[], status, ... }`.
  - Resolve título olhando no manifest (`getArticleBySlug`) — backend não tem o título, só o slug.

### Tracking de view

- Hook `useTrackView(slug)` em `apps/web/src/features/help/api/useTrackView.ts`:
  - `useEffect` com debounce de 1s: monta timer; se desmontar antes, cancela; senão dispara `POST /api/help/views { slug }`.
  - Chamado dentro do `DocPage` quando o estado é `loaded` e dentro do `ApiReferencePage` quando spec resolveu.
  - **Erro silencioso:** view é "fire-and-forget"; falhas não afetam UX.

### Home: seção Populares

- `docs/help/index.mdx` (apenas adicionar 1 bloco em local existente):
  - Bloco "Mais vistos" usa um componente MDX novo `<PopularList limit={10} />`.
- `apps/web/src/features/help/mdx-components/PopularList.tsx`:
  - Consome `usePopular(limit)`. Renderiza lista com ícone + título + slug + count.
  - Skeleton enquanto carrega; placeholder amigável se vazio ("Ainda sem dados — volte em alguns dias").
  - Registra no `mdx-provider.tsx`.
- `apps/web/src/features/help/mdx-components/__tests__/PopularList.test.tsx`.

### Provider

- `apps/web/src/features/help/mdx-provider.tsx`:
  - Registra `FeedbackWidget` e `PopularList` em `COMPONENTS`.

## Fora de escopo (NÃO faz)

- Backend `/api/help/*` — F10-S12.
- Análise de sentimento ou clustering de comments — futuro.
- Notificação por slack quando um artigo cai abaixo de 60% helpful — futuro.
- Internacionalização do widget — pt-BR único no MVP.
- Persistir resposta do widget em localStorage para evitar re-submit — backend permite re-submit.
- Animação de transição entre states — design final usa apenas fade rápido (200ms).
- Mostrar comentários para autor da página — slot futuro.

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/help/mdx-components/FeedbackWidget.tsx` (criar)
- `apps/web/src/features/help/mdx-components/PopularList.tsx` (criar)
- `apps/web/src/features/help/mdx-components/__tests__/FeedbackWidget.test.tsx` (criar)
- `apps/web/src/features/help/mdx-components/__tests__/PopularList.test.tsx` (criar)
- `apps/web/src/features/help/mdx-components/index.ts` (export)
- `apps/web/src/features/help/api/usePopular.ts` (criar)
- `apps/web/src/features/help/api/useTrackView.ts` (criar)
- `apps/web/src/features/help/api/__tests__/usePopular.test.ts` (criar)
- `apps/web/src/features/help/api/__tests__/useTrackView.test.ts` (criar)
- `apps/web/src/features/help/DocLayout.tsx` (apenas injeção do widget)
- `apps/web/src/features/help/DocPage.tsx` (apenas chamar `useTrackView`)
- `apps/web/src/features/help/api-reference/ApiReferencePage.tsx` (apenas injetar widget + tracking)
- `apps/web/src/features/help/mdx-provider.tsx` (registrar widget + popular)
- `docs/help/index.mdx` (apenas adicionar `<PopularList />`)
- `tasks/slots/F10/F10-S13-feedback-widget-popular.md`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/**`
- `apps/web/src/features/help/manifest.ts`
- `apps/web/src/features/help/HelpNav.tsx`, `Toc.tsx`, `SearchPalette.tsx`
- Demais MDX em `docs/help/**` (widget é injetado, não inline em cada arquivo)
- `tasks/STATUS.md`

## Contratos de entrada

- F10-S12 entregue: 3 endpoints respondendo.
- DocLayout e ApiReferencePage funcionais (S02 e S10).
- TanStack Query configurado e disponível.

## Contratos de saída

- Toda página de `/ajuda/*` (exceto home e API root) renderiza `<FeedbackWidget />` no rodapé.
- View é registrada 1s após montar a página.
- Home mostra `<PopularList limit={10}>` com top 10.
- Submeter feedback retorna ao usuário um agradecimento visível.
- Nenhuma falha de rede quebra UX da página principal.
- Bundle do web cresce ≤ 8 KB gzipped.

## Definition of Done

- [ ] Widget renderiza nas páginas certas (testado em 3 rotas: guia, conceito, API resource)
- [ ] Tracking de view dispara após 1s com debounce funcional (unmount cancela)
- [ ] Home mostra populares com 10 itens (ou skeleton/empty state)
- [ ] `pnpm --filter @elemento/web typecheck/lint/test/build` verde
- [ ] Manual: hard-refresh em 3 páginas, dar feedback positivo/negativo, ver na home se entra no ranking (após 31s do rate-limit ou em DB diretamente)

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
pnpm --filter @elemento/web build
```

## Notas para o agente

- **Slug-from-pathname:** strip `/ajuda/` e trailing slashes. `/ajuda/guias/crm/criar-lead` → `guias/crm/criar-lead`. Para a home, slug é vazio — não disparar `POST /views` na home.
- **Debounce 1s:** evita contar back/forward instantâneo. Se o usuário ficar <1s na página, a view não conta. OK conforme norma — "view" é "leitura intencional".
- **State machine:** prefira `useReducer` com states bem nomeados. Evita race condition entre `submit` em andamento e novo click.
- **Submit failure:** uma retry automática com backoff 500ms + 1.5s. Falha definitiva → mostra erro mas mantém a resposta clicada visível para o usuário não perder estado.
- **`PopularList` empty state:** se `data.length === 0`, mostra mensagem "Ainda sem dados — em alguns dias volte aqui pra ver o que sua equipe mais lê". Não esconde a seção.
- **Tracking em api-reference:** `useTrackView('api/${resource}')` quando `resource` resolve. Quando muda para outro recurso, novo track.
- **A11y:** widget é `role="group" aria-label="Avaliação da página"`. Botões com `aria-pressed` quando o estado é "asking" (depois de clicar).
- **DS:** botões usam o padrão de hover 1 ou 2 do `docs/18-design-system.md`. Textarea usa `--surface-muted` com border `--border-subtle`.
- **Privacidade na UX:** placeholder explícito desencorajando PII; comment é opcional, nunca obrigatório.
- **Não persista no localStorage** que o usuário "já avaliou" — pode submeter de novo legitimamente.
