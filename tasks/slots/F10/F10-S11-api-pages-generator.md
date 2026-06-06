---
id: F10-S11
title: Geração de páginas MDX da API + samples curl/TS
phase: F10
task_ref: docs/20-central-de-ajuda.md#8
status: blocked
priority: medium
estimated_size: S
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F10-S09, F10-S10]
blocks: []
source_docs:
  - docs/20-central-de-ajuda.md#8
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F10-S11 — Geração de páginas MDX da API + samples curl/TS

## Objetivo

Fechar o vertical da API Reference: (a) script de build que lê `/openapi.json` e produz 1 página `.mdx` por recurso em `docs/help/api/_generated/`, (b) helper que converte schemas Zod do backend em exemplos TypeScript usáveis no painel direito da UI, (c) pré-renderização do spec para `apps/web/public/api-reference.json` em prod. Resultado: busca FlexSearch encontra endpoints, tab "TypeScript" deixa de mostrar placeholder.

## Contexto

A norma §8 separa o "spec em runtime" (F10-S09) e a "página MDX por recurso" (este slot). O motivo é busca: o FlexSearch já é alimentado por MDX em `docs/help/**`; gerar MDX para cada recurso da API fecha o gap (hoje busca por "criar lead via API" não acha nada). Os MDX gerados são **stubs leves**: title, description, lista de endpoints com `<EndpointCard>`. O conteúdo rico fica na UI da API Reference (S10) — MDX só é semente da busca.

O helper `zod-to-ts-example.ts` precisa rodar no contexto do backend (tem acesso aos schemas Zod fontes). Roda como script Node que importa os schemas, gera exemplos JSON.stringify-able com valores realistas, e exporta um JSON `apps/api/dist/schema-examples.json` consumido pelo gerador de páginas e pelo painel TS da UI.

## Escopo (faz)

### Helper Zod → TS example

- `apps/api/scripts/zod-to-ts-example.ts`:
  - Recebe um schema Zod, retorna `{ tsCode: string, exampleValue: unknown }`.
  - Estratégia: usa `z.ZodTypeAny._def` para detectar tipo; valores realistas por convenção (UUID v4 placeholder, datas ISO, telefones em formato BR, CPF fictício `000.000.000-00`).
  - Cobre: `ZodObject`, `ZodArray`, `ZodEnum`, `ZodLiteral`, `ZodOptional`, `ZodNullable`, `ZodUnion` (pega o primeiro), `ZodString` (com format hint), `ZodNumber`, `ZodBoolean`, `ZodDate`. Outros tipos → fallback `"<...>"`.
  - **LGPD:** nunca gera CPF/telefone reais; sempre placeholders. Adiciona comentário no topo do exemplo: `// Valores fictícios — substituir antes de enviar`.
  - Testes em `apps/api/scripts/__tests__/zod-to-ts-example.test.ts` (10 fixtures cobrindo todos os tipos suportados).

### Gerador de exemplos

- `apps/api/scripts/generate-schema-examples.ts`:
  - Importa os schemas usados em request bodies de cada rota (re-aproveita o registry montado pelo plugin OpenAPI).
  - Roda `zod-to-ts-example` para cada um.
  - Saída: `apps/api/dist/schema-examples.json` no formato `{ [routeKey: string]: { ts: string, json: object } }` onde `routeKey = "${method} ${path}"`.
  - npm script: `pnpm --filter @elemento/api openapi:examples`.

### Gerador de MDX

- `apps/web/scripts/generate-api-pages.ts`:
  - Lê `apps/web/public/api-reference.json` (gerado pelo pre-render abaixo).
  - Lê `apps/api/dist/schema-examples.json` (se existir; opcional — sem ele, omite a seção de exemplo).
  - Para cada recurso (tag), gera `docs/help/api/_generated/<slug>.mdx`:
    - Frontmatter: `title`, `description`, `keywords: [method, path, tag, ...summaries]`.
    - Body: descrição da tag (do spec `tag.description`), lista de endpoints com `<EndpointCard method=... path=... summary=...>`.
    - Footer: link para `/ajuda/api/:resource` ("Ver detalhes interativos →").
  - npm script: `pnpm --filter @elemento/web docs:api`.
  - Idempotente: arquivos novos só se mudaram.

### Pré-renderização do spec

- `apps/web/scripts/prerender-openapi.ts`:
  - Em build/CI, sobe a API em modo teste (reusa o helper de F10-S09), captura `/openapi.json`, escreve em `apps/web/public/api-reference.json`.
  - npm script: `pnpm --filter @elemento/web docs:openapi`.
  - Chamado por `pnpm --filter @elemento/web build`? **Não** — adiciona um pre-build hook seria pesado para todos os builds. Em vez disso: o CI tem job `docs-prebuild` que roda os 3 scripts (`openapi:examples` → `docs:openapi` → `docs:api`) **antes** do `web:build`. Em dev, o `useOpenApi` busca `/openapi.json` direto (não precisa do JSON pré-render).

### Atualização do CI

- `.github/workflows/ci.yml`:
  - Job Node ganha steps `docs-prebuild`:
    ```yaml
    - run: pnpm --filter @elemento/api openapi:examples
    - run: pnpm --filter @elemento/web docs:openapi
    - run: pnpm --filter @elemento/web docs:api
    ```
    rodando **antes** de `pnpm --filter @elemento/web build`.

### UI: tab TypeScript real

- `apps/web/src/features/help/api-reference/ApiReferencePage.tsx`:
  - Tab "TypeScript" passa a buscar `schema-examples.json` (em prod, copiado para `public/` pelo CI; em dev, fetch direto de `http://localhost:3000/__dev/schema-examples`).
  - Endpoint dev-only `GET /__dev/schema-examples` em `apps/api/src/modules/dev/routes.ts` (criar) — serve o JSON sob a mesma flag `NODE_ENV !== 'production'`.

### Manifest e busca

- Adicionar `api` ao `SECTION_ORDER` já está feito (F10-S06 entregou order 40). Os MDX gerados aparecem automaticamente na seção "API" do manifest filesystem-driven.
- `docs/help/api/index.mdx` (NOVO, mínimo): frontmatter + 1 parágrafo explicando "API completa em /ajuda/api". Necessário para o slug `api` aparecer no nav (manifest filtra slugs sem `/`).
- Testes: `apps/web/src/features/help/__tests__/manifest.test.ts` ganha assertion de que ≥1 página em `api/_generated/` resolve, e de que `api/index` resolve.
- `apps/web/src/features/help/__tests__/search.test.ts` ganha busca por nome de recurso (e.g., "leads", "auth") e por endpoint (e.g., "POST /api/leads").

### Gitignore vs commit

- `docs/help/api/_generated/` é **gerado**, não editado. Adicionar ao `.gitignore` do monorepo root **MAS** garantir que o CI rode o gerador antes de build. Decisão alternativa (commit dos generated): rejeitada — gera churn em todo PR de API.
- `apps/web/public/api-reference.json` também gitignored.
- `apps/api/dist/schema-examples.json` já está em `apps/api/dist/` que é gitignored.

## Fora de escopo (NÃO faz)

- Mudar comportamento dos componentes `<EndpointCard>` ou `<Permission>` — S10 é dono.
- Mudar layout ou interatividade da página de API Reference além do tab TS — S10 é dono.
- Sample em outras linguagens (Python, Go) — futuro.
- Validador dev-only "Try it" — futuro.
- Migrar `internal/*` para a spec — fora por segurança.

## Arquivos permitidos (`files_allowed`)

- `apps/api/scripts/zod-to-ts-example.ts` (criar)
- `apps/api/scripts/generate-schema-examples.ts` (criar)
- `apps/api/scripts/__tests__/zod-to-ts-example.test.ts` (criar)
- `apps/api/src/modules/dev/routes.ts` (criar, dev-only)
- `apps/api/src/app.ts` (registrar dev module em `NODE_ENV !== 'production'`)
- `apps/api/package.json` (npm scripts)
- `apps/web/scripts/generate-api-pages.ts` (criar)
- `apps/web/scripts/prerender-openapi.ts` (criar)
- `apps/web/package.json` (npm scripts)
- `apps/web/src/features/help/api-reference/ApiReferencePage.tsx` (apenas substituir placeholder TS pela tab real)
- `apps/web/src/features/help/api-reference/__tests__/ApiReferencePage.test.tsx` (atualizar assertions)
- `apps/web/src/features/help/__tests__/manifest.test.ts` (assertion de api/\_generated)
- `apps/web/src/features/help/__tests__/search.test.ts` (buscas por API)
- `docs/help/api/index.mdx` (criar, mínimo)
- `.github/workflows/ci.yml` (adicionar 3 steps de docs-prebuild)
- `.gitignore` (ignorar `docs/help/api/_generated/`, `apps/web/public/api-reference.json`)
- `tasks/slots/F10/F10-S11-api-pages-generator.md`

## Arquivos proibidos (`files_forbidden`)

- Qualquer rota de `apps/api/src/modules/` que não seja `dev/routes.ts` (S09 é dono)
- `apps/api/src/plugins/openapi.ts` (S09 é dono)
- `apps/web/src/features/help/manifest.ts`
- `apps/web/src/features/help/DocLayout.tsx`, `DocPage.tsx`, `HelpNav.tsx`
- `apps/web/src/features/help/mdx-components/EndpointCard.tsx` (S10 é dono)
- `apps/web/src/features/help/mdx-components/Permission.tsx` (S10 é dono)
- `docs/help/api/_generated/*.mdx` (não commitar — gerado em CI)
- `docs/help/conceitos/**`, `docs/help/comecar/**`, `docs/help/guias/**`
- `tasks/STATUS.md`

## Contratos de entrada

- F10-S09 entregue: `/openapi.json` retorna spec válido em dev/staging.
- F10-S10 entregue: `<EndpointCard>` e `<Permission>` disponíveis no MDX provider; `ApiReferencePage` lê spec do `useOpenApi`.

## Contratos de saída

- `pnpm --filter @elemento/web docs:api` gera 1 `.mdx` por tag em `docs/help/api/_generated/`.
- `pnpm --filter @elemento/api openapi:examples` gera `apps/api/dist/schema-examples.json` cobrindo todos request bodies.
- CI rode todos os 3 scripts antes do build do web.
- Busca por "leads" ou "POST /api/leads" no Cmd+K acha as páginas geradas.
- Tab "TypeScript" da ApiReferencePage mostra exemplo real (não placeholder).
- Endpoint dev-only `GET /__dev/schema-examples` retorna o JSON em dev; 404 em prod.

## Definition of Done

- [ ] 23 (ou mais, se algum module tiver sub-tag) `.mdx` gerados em `_generated/`
- [ ] `zod-to-ts-example` cobre 10 fixtures com testes verdes
- [ ] CI executa `docs-prebuild` antes do build do web
- [ ] Busca encontra páginas da API por tag e por path
- [ ] `pnpm --filter @elemento/api openapi:validate` continua verde
- [ ] `pnpm --filter @elemento/api typecheck/lint/test/build` verde
- [ ] `pnpm --filter @elemento/web typecheck/lint/test/build` verde
- [ ] `.gitignore` cobre `_generated/` e `api-reference.json`

## Comandos de validação

```powershell
pnpm --filter @elemento/api openapi:examples
pnpm --filter @elemento/web docs:openapi
pnpm --filter @elemento/web docs:api
pnpm --filter @elemento/api openapi:validate
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api test
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
pnpm --filter @elemento/web build
```

## Notas para o agente

- **Idempotência:** scripts devem ser idempotentes. Rodar duas vezes → mesmo resultado. Hash dos inputs em comentário no topo do MDX gerado ajuda o diff a sumir quando nada mudou.
- **PII em exemplos:** **nunca** gere CPF, telefone ou email real. Use `000.000.000-00`, `(11) 99999-9999`, `usuario@example.com`. Adicione lint check no script — falha se detectar padrão de CPF real válido.
- **JSON pretty-printed:** exemplos em `schema-examples.json` formatados com `JSON.stringify(value, null, 2)` para a UI mostrar bonito sem reprocessar.
- **Ordem dos endpoints:** mesma ordem do spec (que F10-S09 controla). Estável entre runs.
- **MDX mínimo:** os `.mdx` gerados são **stubs** — não tente competir com a UI da S10. O propósito é alimentar o índice de busca.
- **CI matter:** o job `docs-prebuild` precisa do Postgres? **Não.** A API roda em modo "introspect-only" (carrega rotas mas não conecta no banco). Reuse o helper de F10-S09 que já fez essa separação.
- **`__dev/schema-examples`:** prefixo `__dev/` torna evidente que é não-prod. Em adição ao gating por NODE_ENV.
- **Falha graciosa:** se `schema-examples.json` faltar (build local sem rodar gerador), `ApiReferencePage` tab TS mostra "Exemplo indisponível — rode `pnpm docs:api`" em vez de quebrar.
- **Cache:** o gerador escreve um manifest `_generated/.manifest.json` com hashes — só sobrescreve arquivos que mudaram, evita ruído de timestamp.
