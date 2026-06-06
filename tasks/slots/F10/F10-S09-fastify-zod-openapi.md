---
id: F10-S09
title: fastify-zod-openapi + /openapi.json em todas as rotas
phase: F10
task_ref: docs/20-central-de-ajuda.md#8
status: review
priority: high
estimated_size: M
agent_id: null
claimed_at: 2026-06-06T02:40:27Z
completed_at: 2026-06-06T03:25:48Z
pr_url: null
depends_on: []
blocks: [F10-S10, F10-S11]
source_docs:
  - docs/20-central-de-ajuda.md#4
  - docs/20-central-de-ajuda.md#8
  - docs/10-seguranca-permissoes.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F10-S09 — fastify-zod-openapi + /openapi.json

## Objetivo

Instrumentar todas as rotas do backend com `fastify-zod-openapi` aproveitando os schemas Zod existentes, expor `GET /openapi.json` em dev/staging (gated por flag em prod), e produzir um spec OpenAPI 3.1 válido que cubra 100% dos endpoints públicos de `apps/api/src/modules/*/routes.ts`. Este slot é a fundação para F10-S10 (UI API Reference) e F10-S11 (samples curl/TS).

## Contexto

A norma §4 escolhe `fastify-zod-openapi` justamente porque o backend já usa Zod em todas as bordas (regra inviolável §5 do CLAUDE.md do projeto). Não precisamos rescrever schemas — só pendurar metadados (`.describe()`, `.openapi({ example })`) e registrar o plugin.

24 módulos têm rotas: `account`, `admin`, `agents`, `ai-console`, `auth`, `billing`, `chatwoot`, `cities`, `credit-analyses`, `credit-products`, `dashboard`, `featureFlags`, `followup`, `health`, `imports`, `internal`, `kanban`, `leads`, `roles`, `simulations`, `templates`, `users`, `whatsapp`. **`internal/*` não entra na spec pública** — é gated por `X-Internal-Token` para o LangGraph e seu vazamento seria risco. Resto entra.

Em prod, `/openapi.json` fica fechado: só responde quando `OPENAPI_PUBLIC_ENABLED=true` (env) ou origem é `dev`/`staging`. Critério da norma §8.

## Escopo (faz)

### Plugin + bootstrap

- Adiciona `fastify-zod-openapi` ao `apps/api/package.json` (dep).
- Cria `apps/api/src/plugins/openapi.ts`:
  - Registra `@fastify/swagger` + adapter `fastify-zod-openapi`.
  - Config: OpenAPI 3.1, `info` (title "Manager Banco do Povo API", version do package.json, description curta apontando para `/ajuda/api`), `servers` (dev `http://localhost:3000`, staging/prod por env).
  - `securitySchemes`: `bearerAuth` (JWT) e `internalToken` (apiKey header `X-Internal-Token`, marcado como `x-internal: true` para o gerador da UI esconder).
  - `tags`: ordenadas (Auth, Leads, CRM, Kanban, Credit Analyses, Credit Products, Simulations, Follow-up, Billing/Cobrança, Templates, Imports, Cities, Roles & Users, Admin, AI Console, Chatwoot, WhatsApp, Dashboard, Health, Feature Flags).
- Registra plugin em `apps/api/src/app.ts` somente quando `process.env.OPENAPI_PUBLIC_ENABLED === 'true'` **ou** `NODE_ENV !== 'production'`. Em prod com a flag off, rota não é registrada (não retorna 401 — retorna 404, mais difícil de fingerprint).

### Instrumentação por módulo

Para cada `apps/api/src/modules/<m>/routes.ts` listado em `files_allowed`:

- Adiciona `schema: { tags: ['<Tag>'], summary: '...', description: '...', security, request/response refs }` em todas as rotas.
- Schemas Zod ganham `.describe()` em campos não-óbvios; pelo menos um `.openapi({ example })` por payload principal para que F10-S11 gere sample útil.
- Rotas que retornam erros padronizados (400/401/403/404/409/429) declaram o response `{ description, content: { 'application/json': errorSchema } }` reusando `apps/api/src/lib/errorSchemas.ts` (criar se não existir).

### Gating de `internal/*`

- `apps/api/src/modules/internal/routes.ts` recebe `schema: { hide: true }` em todas as rotas — `fastify-zod-openapi` respeita o hint e exclui da spec.

### Validação

- Cria `apps/api/scripts/validate-openapi.ts`: liga a app em modo teste, captura `/openapi.json`, valida com `@apidevtools/swagger-parser` (devDep), e falha o script se houver erro. Script chamado por um novo npm script `openapi:validate`.
- Adiciona o script ao bloco "Comandos de validação" do slot e ao CI (`.github/workflows/ci.yml`, job Node) **somente se o slot tocá-lo**. Esse arquivo está fora de `files_allowed` deste slot — então deixe sem alterar o workflow; F10-S11 (que precisa do spec em build do web) reabre o CI.

## Fora de escopo (NÃO faz)

- UI da API Reference — F10-S10.
- Geração de MDX a partir do spec — F10-S11.
- Helper `zod-to-ts-example.ts` — F10-S11.
- Telemetria de docs (`doc_views`, `doc_feedback`) — F10-S12.
- Alterar comportamento runtime de qualquer rota — este slot é puramente declarativo de schema.
- Documentar `internal/*` na spec pública.
- Adicionar autenticação ou rate-limit a `/openapi.json` em prod — gating é por flag de env (não-registro). Caso queira hardening futuro (proxy mTLS, IP allowlist), slot separado.
- Atualizar CI (`.github/workflows/*`).

## Arquivos permitidos (`files_allowed`)

- `apps/api/package.json` (adicionar deps)
- `apps/api/src/plugins/openapi.ts` (criar)
- `apps/api/src/app.ts` (registrar plugin)
- `apps/api/src/lib/errorSchemas.ts` (criar se necessário)
- `apps/api/src/modules/account/routes.ts`
- `apps/api/src/modules/admin/routes.ts`
- `apps/api/src/modules/agents/routes.ts`
- `apps/api/src/modules/ai-console/routes.ts`
- `apps/api/src/modules/auth/routes.ts`
- `apps/api/src/modules/billing/routes.ts`
- `apps/api/src/modules/chatwoot/routes.ts`
- `apps/api/src/modules/cities/routes.ts`
- `apps/api/src/modules/credit-analyses/routes.ts`
- `apps/api/src/modules/credit-products/routes.ts`
- `apps/api/src/modules/dashboard/routes.ts`
- `apps/api/src/modules/featureFlags/routes.ts`
- `apps/api/src/modules/followup/routes.ts`
- `apps/api/src/modules/health/routes.ts`
- `apps/api/src/modules/imports/routes.ts`
- `apps/api/src/modules/internal/routes.ts` (apenas `hide: true`)
- `apps/api/src/modules/kanban/routes.ts`
- `apps/api/src/modules/leads/routes.ts`
- `apps/api/src/modules/roles/routes.ts`
- `apps/api/src/modules/simulations/routes.ts`
- `apps/api/src/modules/templates/routes.ts`
- `apps/api/src/modules/users/routes.ts`
- `apps/api/src/modules/whatsapp/routes.ts`
- `apps/api/scripts/validate-openapi.ts` (criar)
- `apps/api/src/modules/**/__tests__/*.test.ts` (apenas para asserções de spec, sem alterar comportamento)
- `tasks/slots/F10/F10-S09-fastify-zod-openapi.md`
- `.env.example` (adicionar `OPENAPI_PUBLIC_ENABLED=false`)

## Arquivos proibidos (`files_forbidden`)

- `apps/web/**`
- `apps/langgraph-service/**`
- `docs/help/**`
- `packages/**` (schemas compartilhados só podem ser estendidos por slot dedicado)
- `apps/api/src/db/**` (este slot é HTTP-only)
- `.github/workflows/**` (F10-S11 reabre se precisar)
- `tasks/STATUS.md`

## Contratos de entrada

- Backend Fastify 5 com Zod 3 nos schemas (CLAUDE.md regra §5).
- Schemas Zod compartilhados em `@elemento/shared-schemas` (não alterar; só importar).
- Plugin de autenticação JWT já existente e injetando `request.user`.

## Contratos de saída

- `GET /openapi.json` responde com spec OpenAPI 3.1 válido (validado por `swagger-parser`) em `NODE_ENV !== 'production'` **OU** quando `OPENAPI_PUBLIC_ENABLED=true`.
- Em `NODE_ENV=production` com a flag off, `GET /openapi.json` retorna 404 (rota não registrada).
- Spec contém todas as rotas dos 23 módulos públicos. Spec **NÃO** contém nenhuma rota de `internal/*`.
- Cada rota pública tem: `tags`, `summary`, `description`, schemas de request/response/erros, exemplos onde aplicável.
- `pnpm --filter @elemento/api openapi:validate` passa zero-erros zero-warnings.
- Teste de integração novo cobre: (a) rota acessível em dev; (b) rota 404 em prod com flag off; (c) spec inclui `/auth/login`; (d) spec NÃO inclui `/internal/*`.

## Definition of Done

- [ ] Plugin registrado e gating por env funcional (3 modos testados: dev sem flag, prod sem flag, prod com flag)
- [ ] 23 módulos públicos instrumentados
- [ ] `internal/*` escondido
- [ ] `pnpm --filter @elemento/api openapi:validate` verde
- [ ] `pnpm --filter @elemento/api typecheck` verde
- [ ] `pnpm --filter @elemento/api lint` verde
- [ ] `pnpm --filter @elemento/api test` verde com os novos testes de integração
- [ ] `pnpm --filter @elemento/api build` verde
- [ ] `.env.example` documenta `OPENAPI_PUBLIC_ENABLED`

## Comandos de validação

```powershell
pnpm --filter @elemento/api openapi:validate
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
pnpm --filter @elemento/api build
```

## Notas para o agente

- **Não rescreva schemas Zod existentes.** Só adicione `.describe()` e `.openapi({ example })` onde a UX da API Reference vai sofrer sem isso. Padrão: campo cujo nome não auto-explica (e.g., `cityId` → "Identificador da cidade (UUID v4)").
- **Ordem dos exemplos:** request → response 200 → resposta de erro mais comum (4xx). UI vai mostrar nessa ordem.
- **Tags consistentes:** uma por módulo. Não invente sinônimos; UI usa a tag como agrupamento na sidebar.
- **`internal/*` é segurança.** Esconder com `hide: true` é correto, mas duplicar com um teste que falha se um endpoint de `internal/*` aparecer na spec — o agente que vier depois pode adicionar um endpoint lá sem o hint.
- **Security schemes:** rotas que dependem de `request.user` (JWT) declaram `security: [{ bearerAuth: [] }]`; `health/*` é `security: []` (anônimo).
- **Gating em prod:** prefira não-registro ao 401. Spec exposta com 401 é fingerprintable; spec não-registrada é silêncio.
- **Helper para diminuir boilerplate:** considere `apps/api/src/lib/routeSchema.ts` que recebe `(method, path, zod schemas, tag, summary)` e retorna o `schema` montado. Reduz repetição em 23 arquivos.
