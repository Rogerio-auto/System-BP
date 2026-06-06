---
id: F10-S10
title: UI de API Reference 3-pane Stripe-like
phase: F10
task_ref: docs/20-central-de-ajuda.md#8
status: done
priority: medium
estimated_size: L
agent_id: null
claimed_at: 2026-06-06T17:34:12Z
completed_at: 2026-06-06T18:08:08Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/197
depends_on: [F10-S09]
blocks: [F10-S11]
source_docs:
  - docs/20-central-de-ajuda.md#6
  - docs/20-central-de-ajuda.md#8
  - docs/18-design-system.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F10-S10 — UI de API Reference 3-pane Stripe-like

## Objetivo

Construir a UI in-app da API Reference: layout 3-pane (sumário de recursos → endpoint → exemplos) inspirado em Stripe Docs, lendo o `openapi.json` exposto por F10-S09. Custom — **NÃO** Swagger UI, **NÃO** Redoc com tema default (proibidos pela norma §4). Os componentes MDX `<EndpointCard>` e `<Permission>` da norma §6 são entregues aqui.

## Contexto

A norma §8 define o layout: esquerda = lista de recursos (Leads, Customers, …), centro = descrição do endpoint + parâmetros + responses, direita = exemplo de request + response com toggle curl / TS. Variáveis de path destacadas com `--info-bg`. A UI é dinâmica (lê o spec em runtime durante dev/staging) **e** pré-render para prod (busca o JSON em build, gera o índice estático). F10-S11 produz os MDX por recurso para a busca encontrar e para a sidebar mostrar tooltip. Este slot **NÃO** depende dos MDX gerados — só do spec.

A rota fica em `/ajuda/api`. Existe convivência com o filesystem-driven nav atual: a seção `api` no manifest aparece como um item de nav que abre a UI dedicada (não um MDX). Decisão: a rota `/ajuda/api/:resource` é tratada por um componente próprio (`ApiReferencePage`), bypassando o manifest. O manifest manterá um stub `docs/help/api/index.mdx` curto (entregue por F10-S11) só para o slug `api` aparecer no nav.

## Escopo (faz)

### Roteamento

- Em `apps/web/src/app/AppRoutes.tsx`, adiciona rota `/ajuda/api/:resource?` apontando para `<ApiReferencePage />` ANTES da rota wildcard de DocPage que captura `/ajuda/*`.
- `ApiReferencePage` reusa `<DocLayout>` (mesma sidebar de seções, mesmo padrão visual) mas substitui a coluna central por seu próprio renderer.

### Carregamento do spec

- `apps/web/src/features/help/api-reference/useOpenApi.ts`: hook TanStack Query que faz `GET /openapi.json` em dev/staging; em prod, fallback para `/api-reference.json` (pre-rendered, copiado para `apps/web/public/` por script no build — script entregue por F10-S11).
- Cache: 1h (`staleTime: 3_600_000`).

### Componente principal

- `apps/web/src/features/help/api-reference/ApiReferencePage.tsx`:
  - Parse do spec em formato denormalizado por recurso (groupBy `tags`).
  - URL drives state: `/ajuda/api/leads#post-leads` seleciona recurso "Leads" e ancora no endpoint POST /api/leads.
  - 3-pane interno (dentro do DocLayout — porque DocLayout já tem sidebar de seções globais; coluna central do DocLayout vira o trio interno):
    - **Esquerda:** lista de endpoints do recurso atual com ícone + método colorido + path.
    - **Centro:** título + descrição + parâmetros (path, query, body) em seções, schema dos responses por status code (200/4xx/5xx) com expandable rows.
    - **Direita:** painel sticky com tabs "curl | TypeScript" — curl é gerado on-the-fly do spec; TS placeholder até F10-S11 entregar o helper.
- `ApiReferencePage` cobre 100% dos endpoints do spec. Recursos sem endpoint exibem mensagem amigável (nunca ocorre na prática, mas defensivo).

### Componentes MDX da norma §6

- `apps/web/src/features/help/mdx-components/EndpointCard.tsx`:
  - Props: `method`, `path`, `summary?`, `children?`.
  - Renderiza card compacto com badge de método colorido (cores DS: GET azul, POST verde, PATCH amarelo, DELETE vermelho), path com variáveis destacadas (`--info-bg`), summary curto.
  - Click abre a página da API Reference correspondente.
- `apps/web/src/features/help/mdx-components/Permission.tsx`:
  - Props: `requires` (string ou array).
  - Renderiza badge com ícone de cadeado + texto "Requer: leads:write". Tooltip explica que vem do conceito Papéis e Cidades.
- Registra ambos no `mdx-provider.tsx` para uso em qualquer MDX (especialmente os gerados por F10-S11).

### Highlight do path

- Helper `apps/web/src/features/help/api-reference/highlightPath.tsx`: parseia `/leads/:id/cards/:cardId` em segmentos React com background `--info-bg` nos `:vars`. Reutilizado em `EndpointCard` e no centro da API page.

### Geração de curl

- Helper `apps/web/src/features/help/api-reference/curl.ts`: a partir de `{ method, path, requestBody?, parameters[] }`, monta um `curl` com `-X`, `-H "Authorization: Bearer ..."`, `-H "Content-Type: application/json"`, body via `-d` (pretty-print) usando `examples` quando presentes.

### Sidebar de recursos

- `apps/web/src/features/help/api-reference/ApiSidebar.tsx`: lista os recursos do spec ordenados por tag, com contador de endpoints. Active state pela tag atual.

### Testes

- `apps/web/src/features/help/api-reference/__tests__/curl.test.ts` — gera curl correto para 3 fixtures (GET com query, POST com body, DELETE).
- `apps/web/src/features/help/api-reference/__tests__/highlightPath.test.tsx` — destaca variáveis corretamente; segmentos sem `:` ficam plain.
- `apps/web/src/features/help/api-reference/__tests__/ApiReferencePage.test.tsx` — render com fixture de spec, navegação entre endpoints, ancora URL.
- `apps/web/src/features/help/mdx-components/__tests__/EndpointCard.test.tsx` — badge de método, click navega.
- `apps/web/src/features/help/mdx-components/__tests__/Permission.test.tsx` — badge, tooltip.

## Fora de escopo (NÃO faz)

- Geração de MDX por recurso — F10-S11.
- Helper `zod-to-ts-example.ts` para sample TS — F10-S11. Tab "TypeScript" mostra placeholder "Em breve" até F10-S11.
- Alterar a estrutura de pré-renderização do search index — busca só vê API após F10-S11.
- Telemetria de visualizações da API — F10-S12.
- Tema dark da API Reference (light-first apenas; DS já tem dark mas ApiReferencePage usa tokens DS então automático).
- Sandbox interativo "Try it" — slot futuro.
- Versionamento de spec — slot futuro.

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/app/AppRoutes.tsx` (apenas adicionar a rota da API)
- `apps/web/src/features/help/api-reference/ApiReferencePage.tsx` (criar)
- `apps/web/src/features/help/api-reference/ApiSidebar.tsx` (criar)
- `apps/web/src/features/help/api-reference/useOpenApi.ts` (criar)
- `apps/web/src/features/help/api-reference/curl.ts` (criar)
- `apps/web/src/features/help/api-reference/highlightPath.tsx` (criar)
- `apps/web/src/features/help/api-reference/types.ts` (criar — tipos para spec parseado)
- `apps/web/src/features/help/api-reference/__tests__/*.test.{ts,tsx}` (criar)
- `apps/web/src/features/help/mdx-components/EndpointCard.tsx` (criar)
- `apps/web/src/features/help/mdx-components/Permission.tsx` (criar)
- `apps/web/src/features/help/mdx-components/__tests__/EndpointCard.test.tsx` (criar)
- `apps/web/src/features/help/mdx-components/__tests__/Permission.test.tsx` (criar)
- `apps/web/src/features/help/mdx-components/index.ts` (export dos novos)
- `apps/web/src/features/help/mdx-provider.tsx` (registrar os novos componentes)
- `tasks/slots/F10/F10-S10-api-reference-ui.md`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/**` (S09 é dono do backend; spec é consumido só)
- `apps/web/src/features/help/manifest.ts` (não tocar — S06 já entregou)
- `apps/web/src/features/help/DocLayout.tsx` (reusar como está; criar sub-layout interno se precisar)
- `apps/web/src/features/help/DocPage.tsx`
- `apps/web/src/features/help/HelpNav.tsx`
- `apps/web/scripts/**` (F10-S11 é dono)
- `docs/help/**` (F10-S11 é dono dos MDX gerados; este slot só consome o spec)
- `apps/web/public/api-reference.json` (gerado por F10-S11 no build)
- `tasks/STATUS.md`

## Contratos de entrada

- F10-S09 entregue: `/openapi.json` responde em dev com OpenAPI 3.1 válido; 23 módulos cobertos; `internal/*` escondido.
- Componentes MDX canônicos (`<Callout>`, `<Step>`, `<CodeBlock>`) e provider existentes.

## Contratos de saída

- `/ajuda/api` renderiza listando todos os recursos.
- `/ajuda/api/:resource` renderiza com 3-pane: sidebar de endpoints, centro com descrição, direita com curl.
- `<EndpointCard method="POST" path="/api/leads">` renderiza com badge colorido e path destacado em qualquer MDX.
- `<Permission requires="leads:write">` renderiza badge inline em qualquer MDX.
- `useOpenApi` cacheia o spec por 1h; em prod sem `OPENAPI_PUBLIC_ENABLED` lê o JSON pré-renderizado.
- Build do `apps/web` cresce no máximo +25 KB gzipped (limite negociado para uma feature L).

## Definition of Done

- [ ] Rotas `/ajuda/api` e `/ajuda/api/:resource` funcionam
- [ ] `<EndpointCard>` e `<Permission>` registrados no provider e disponíveis em MDX
- [ ] `pnpm --filter @elemento/web typecheck` verde
- [ ] `pnpm --filter @elemento/web lint` verde
- [ ] `pnpm --filter @elemento/web test` verde com os testes novos
- [ ] `pnpm --filter @elemento/web build` verde com main bundle ≤ baseline + 25 KB gzipped
- [ ] Curl gerado bate com 3 fixtures (asserções de test snapshot)
- [ ] Recurso "Auth" testado manualmente em dev — POST /auth/login renderiza com schema completo

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
pnpm --filter @elemento/web build
```

## Notas para o agente

- **Reuse `DocLayout`** — não crie um shell paralelo. Coluna central do DocLayout recebe o trio interno (recursos | endpoint | curl). A sidebar global de seções fica visível (usuário pode pular para Guias sem voltar).
- **Tipos do spec:** use `openapi-types` (devDep — adicionar se necessário) ou tipo local minimal — não puxe runtime de `openapi-typescript` para o bundle.
- **Cores de método:** use tokens DS, não hex. `--success-bg` para GET? Não — GET é leitura, neutro. Sugestão: GET `--info-bg/--info-fg`, POST `--success-bg/--success-fg`, PATCH/PUT `--warn-bg/--warn-fg`, DELETE `--danger-bg/--danger-fg`. Confirme contraste AA.
- **Variáveis de path:** background `--info-bg`, fontFamily monospace, padding lateral 2px, borderRadius 3px.
- **Stripe Docs feel:** breathing room. Headings grandes (`text-2xl` para nome do endpoint), descrição em `text-base`, props/params em `text-sm` com gap generoso. NÃO comprima.
- **TanStack Query:** já configurado no app. Use `useQuery` com `queryKey: ['help', 'openapi']`. `useSuspenseQuery` se preferir, mas envolva em Suspense próprio.
- **Bundle:** code-split via `React.lazy(() => import('./api-reference/ApiReferencePage'))` na rota — a maioria dos usuários nunca abre API Reference; não pague no main bundle.
- **Acessibilidade:** método + path são link ARIA-labeled "POST /api/leads — Criar lead". Schemas expansíveis usam `<details>` nativo (rapid keyboard nav).
- **Permission badge:** click abre `/ajuda/conceitos/papeis-e-cidades` em nova aba (não navega — usuário pode estar no meio de leitura).
