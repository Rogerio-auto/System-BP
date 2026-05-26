---
id: F0-S16
title: Fix vitest + @fastify/autoload (forceESM) — env.js não resolve em integração
phase: F0
task_ref: hotfix
status: in-progress
priority: high
estimated_size: S
agent_id: ''
claimed_at: 2026-05-26T15:10:16Z
completed_at: ''
pr_url: ''
depends_on: []
blocks: []
labels: []
source_docs:
  - tasks/PROTOCOL.md
  - apps/api/vitest.config.ts
  - apps/api/src/modules/internal/index.ts
---

# F0-S16 — Fix vitest + @fastify/autoload (forceESM) — env.js não resolve

## Contexto (incidente 2026-05-26)

Auditoria de slots done identificou **4 test files de integração quebrados** em
`apps/api`, todos com a mesma assinatura:

```
FAIL src/modules/health/health.test.ts
FAIL src/modules/chatwoot/__tests__/chatwoot.test.ts
FAIL src/modules/whatsapp/__tests__/whatsapp.test.ts
FAIL src/shared/errors.test.ts

Error: Cannot find module '...src/config/env.js'
       imported from .../modules/internal/ai/routes.ts
TypeError: Cannot read properties of undefined (reading 'close')
```

Output completo:

```
Test Files  4 failed | 75 passed (79)
     Tests  1092 passed | 39 skipped (1131)
```

### Causa raiz

`apps/api/src/modules/internal/index.ts` registra rotas internas via
`@fastify/autoload` com `forceESM: true` (commit `af75db9`, F3-S04). Isso força
o autoload a usar `import()` dinâmico nativo do Node em vez do require do
`createRequire`. Em produção (`pnpm build` → `tsc` emite `.js` reais e o Node
ESM resolve `env.js` literal) funciona. No vitest, o `import()` dinâmico
bypassa o resolver `.ts→.js` do plugin do vitest — o resolver fica preso
no primeiro `internal/<dir>/routes.ts` em ordem alfabética (ai), reportando
ERR_MODULE_NOT_FOUND mesmo com `apps/api/src/config/env.ts` presente.

Sintoma colateral: os 4 testes têm `let app: FastifyInstance` declarado em
`beforeAll` e fazem `await app.close()` no `afterAll`. Como o build falhou,
`app === undefined` e o `afterAll` joga `TypeError`, produzindo dois erros por
suite (1 = boot fail, 2 = teardown undefined).

### Por que typecheck/lint/build estão verdes

- `tsc` resolve `.js`→`.ts` via `moduleResolution: bundler/nodenext` em build-time.
- `tsc -p tsconfig.build.json` emite `.js` reais — em runtime ESM o autoload
  resolve normalmente.
- Os testes unitários (75 suites) passam porque importam `routes.ts` direto, sem
  passar pelo autoload.

A regressão **só atinge os testes de integração que sobem `buildApp()`**.

## Objetivo

`pnpm --filter @elemento/api test` verde — sem mascarar com `it.skip` ou
remover os testes de integração. A solução tem que manter a feature do autoload
funcionando (não regredir F3-S04, F4-S04 etc.) e funcionar igualmente em vitest
e em produção.

## Opções a investigar (preferência: 1 > 2 > 3)

### Opção 1 — Substituir `import()` dinâmico do autoload por map estático

Em `modules/internal/index.ts`, manter o autoload em produção mas em
ambiente de teste registrar as rotas explicitamente via imports estáticos.
Trade-off: precisa atualizar a lista quando um novo slot adiciona rota interna.
Mitigado por teste que falha se um diretório `internal/<dir>/` não estiver
listado.

### Opção 2 — Configurar resolver do vitest para tratar `.js` como `.ts`

`apps/api/vitest.config.ts` aceita `resolve.alias` e `resolve.extensions`.
Configurar para que o `import()` dinâmico do autoload caia no resolver do
vitest. Verificar se `vite-tsconfig-paths` ou `vite-plugin-resolve` resolvem o
caso. Trade-off: mais complexo, mas zero mudança de produção.

### Opção 3 — Desligar `forceESM: true` em test

Verificar se `forceESM: false` (usa require via createRequire) sobrevive em
test E em produção. Risco: F3-S04 documenta explicitamente que `forceESM: true`
é necessário em ESM strict.

## Escopo

- Reproduzir os 4 fails localmente (`pnpm --filter @elemento/api test`).
- Investigar qual das 3 opções acima sobrevive a `pnpm typecheck` + `pnpm test` +
  `pnpm --filter @elemento/api build`.
- Aplicar fix mínimo.
- **Não** alterar testes para mascarar problema (não trocar `beforeAll` por
  optional `app?.close()` — isso esconde a regressão real).

## Arquivos permitidos

- `apps/api/vitest.config.ts`
- `apps/api/src/modules/internal/index.ts`
- `apps/api/src/test/setup.ts` (apenas se necessário para o fix)
- `apps/api/src/modules/health/health.test.ts` (apenas se a opção exigir
  ajuste mínimo de teardown; preferir não mexer)
- `apps/api/src/shared/errors.test.ts` (idem)
- `apps/api/src/modules/chatwoot/__tests__/chatwoot.test.ts` (idem)
- `apps/api/src/modules/whatsapp/__tests__/whatsapp.test.ts` (idem)

## Arquivos proibidos

- `apps/api/src/modules/internal/*/routes.ts` — fix é no carregador, não nos
  consumidores.
- `apps/api/src/config/env.ts` — env não é a causa.
- `apps/api/src/app.ts` — registro do plugin já está correto.
- Qualquer mudança em produção que regrida `pnpm build` ou `pnpm dev`.

## Definition of Done

- [ ] `pnpm --filter @elemento/api test` verde (0 failed suites, 0 failed
      tests).
- [ ] `pnpm --filter @elemento/api typecheck` continua verde.
- [ ] `pnpm --filter @elemento/api lint --max-warnings 0` continua verde.
- [ ] `pnpm --filter @elemento/api build` (tsc) continua verde.
- [ ] PR descreve qual das 3 opções foi adotada e por quê.
- [ ] Sem `it.skip`/`describe.skip`/`expect.soft` no diff.

## Validação

```powershell
pnpm --filter @elemento/api typecheck
```

```powershell
pnpm --filter @elemento/api lint
```

```powershell
pnpm --filter @elemento/api test
```

```powershell
pnpm --filter @elemento/api build
```

## Notas

- A regressão é silenciosa em CI se a pipeline ignorou os 4 fails (verificar
  configuração do GH Actions). Reportar no PR se for o caso.
- Não há impacto em produção até este momento — todos os endpoints
  `/internal/*` funcionam normalmente sob `node dist/server.js` (ESM real).
- Slot de origem do autoload: F3-S04 (`af75db9`).
