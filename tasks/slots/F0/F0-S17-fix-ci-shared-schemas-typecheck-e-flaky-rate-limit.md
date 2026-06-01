---
id: F0-S17
title: Fix CI — shared-schemas typecheck (zod resolution + any implícito) + flaky rate-limit test
phase: F0
task_ref: F0.17
status: review
priority: critical
estimated_size: M
agent_id: backend-engineer
depends_on: []
blocks: []
labels: [ci, infra, hardening, flaky-test]
source_docs:
  - apps/api/Dockerfile
  - packages/shared-schemas/package.json
  - packages/shared-schemas/tsconfig.json
claimed_at: 2026-06-01T02:18:13Z
completed_at: 2026-06-01T02:26:29Z
---

# F0-S17 — Fix CI quebrado: shared-schemas typecheck + flaky rate-limit test

## Contexto

PR #171 (F8-S18 — UI puro) bateu em CI vermelho **por causa de dois problemas
pré-existentes que travam todo merge subsequente**:

### Problema A — E2E Smoke FALHA (build Docker)

`E2E Smoke — stack completa + fluxo crítico` falha no stage builder do
`apps/api/Dockerfile` linha 22 (`RUN pnpm --filter @elemento/api build`):

```
packages/shared-schemas/src/auth.ts(8,19): error TS2307: Cannot find module 'zod'
packages/shared-schemas/src/cities.ts(9,19): error TS2307: Cannot find module 'zod'
packages/shared-schemas/src/leads.ts(14,19): error TS2307: Cannot find module 'zod'
packages/shared-schemas/src/cities.ts(117,17): error TS7006: Parameter 'v' implicitly has 'any'
packages/shared-schemas/src/cities.ts(122,17): error TS7006: Parameter 'v' implicitly has 'any'
packages/shared-schemas/src/leads.ts(74,17): error TS7006: Parameter 'v' implicitly has 'any'
packages/shared-schemas/src/leads.ts(117,12): error TS7006: Parameter 'data' implicitly has 'any'
apps/api/src/modules/cities/controller.ts(149,30): error TS7006: Parameter 'c' implicitly has 'any'
```

Análise:

- `Cannot find module 'zod'` em `packages/shared-schemas/src/*.ts` é a causa
  raiz. `packages/shared-schemas/package.json` declara `zod 3.23.8` como
  dependency, mas durante o build Docker o tsc do `@elemento/api` não
  consegue resolver o módulo.
- Os `TS7006` (any implícito) em `.transform((v) => ...)` são **cascata** da
  falha do zod: sem o tipo de `z.enum(...)`, o `v` perde inferência.
- `controller.ts:149` `result.data.map((c) => ...)` provavelmente é um
  `any` independente — `result.data` sai do service sem tipo declarado.

Hipótese mais provável: o stage `builder` copia `node_modules` do stage
`deps`, mas `pnpm install --frozen-lockfile` no `deps` é executado **antes**
do `COPY . .` no `builder`. Como só os `package.json` foram copiados no
`deps`, o pnpm pode ter pulado links/symlinks de `@elemento/shared-schemas`
para suas deps (`zod`) por causa de algum problema de workspace resolution.

Localmente passa porque o `node_modules` está estável; em Docker do zero
explode.

### Problema B — Node CI FALHA (1 teste flaky)

`apps/api/src/modules/auth/__tests__/auth.test.ts:658` — teste de rate-limit:

```
✗ Rate-limit em /api/auth/login > retorna 429 após 5 tentativas de login por IP
  Error: Test timed out in 5000ms.
```

Único teste vermelho em 1352. Estrutura:

```ts
it('retorna 429 após 5 tentativas...', async () => {
  for (let i = 0; i < 5; i++) {
    await app.inject({ method: 'POST', url: '/api/auth/login', ... });
  }
  const res = await app.inject({ ... }); // 6ª — espera 429
  expect(res.statusCode).toBe(429);
});
```

6 chamadas serializadas em 5s. Em CI lento isso estoura. Provavelmente o
`mockFindUserByEmail.mockResolvedValue(null)` retorna rápido mas o boot do
`buildTestApp` + plugins de rate-limit adicionam latência por chamada.

## Objetivo

Deixar o pipeline **verde de novo** — sem `--no-verify`, sem skip de teste,
sem suppress de TS. Os dois fixes são independentes e podem coexistir
no mesmo slot por serem ambos de "destrava CI".

## Escopo

### 1. shared-schemas — resolução de `zod` no Docker build

Investigar a causa raiz da falha de resolução. Possíveis fixes (escolher o
mínimo que resolve, registrar a decisão no PR):

a) **Mover `zod` para `peerDependencies` + `devDependencies`** em
`packages/shared-schemas/package.json` — pattern comum em monorepos pnpm
quando o package é consumido por outro workspace que já tem `zod`.

b) **Adicionar `zod` explícito em `apps/api/package.json`** caso não esteja
declarado (confirmar). O `api` consome `loginBodySchema` etc, deveria ter
zod como dep direta.

c) **Ajustar o Dockerfile** para copiar `packages/shared-schemas/src/**`
antes do `pnpm install` (ou usar `pnpm fetch` + `pnpm install --offline`),
garantindo que os workspace links sejam criados corretamente.

d) **Pré-build de `shared-schemas`** antes do build do `api` no Dockerfile
(`pnpm --filter @elemento/shared-schemas typecheck` antes do build do api).

Critério: o build `pnpm --filter @elemento/api build` rodando em container
limpo (Alpine node:20) deve passar sem erros TS2307/TS7006 em shared-schemas.

### 2. cities/controller.ts:149 — `any` implícito

`result.data.map((c) => ({ ... }))` — `c` é `any`. Fix:

- Tipar o retorno do service em `apps/api/src/modules/cities/service.ts`
  para `Promise<{ data: City[]; ... }>` onde `City` vem do schema, ou
- Importar o tipo `CityListItem` de `packages/shared-schemas` se já existir, ou
- Anotar inline: `result.data.map((c: { id: string; name: string; state_uf: string }) => ...)`.

Preferir tipagem real do service (mais correto) em vez de inline.

### 3. Flaky rate-limit test

Em `apps/api/src/modules/auth/__tests__/auth.test.ts:658`:

- Aumentar timeout do teste para `15000ms` (vitest aceita 3º arg em `it`):
  `it('retorna 429...', async () => { ... }, 15000);`
- Considerar também rodar as 5 tentativas em **paralelo** com `Promise.all`
  (rate-limit conta por IP, então não importa a ordem) — corta tempo total.
- Confirmar que o teste continua determinístico (rate-limit por IP, sem
  conflito com outros testes que rodam em paralelo).

### 4. Validação local que reproduza o CI

Documentar nas docs internas (ou no próprio slot) como rodar o build
Docker localmente para reproduzir antes de subir:

```powershell
docker build -f apps/api/Dockerfile -t elemento-api:test .
```

## Fora de escopo

- F8-S18 (UI dos cards Cobrança/Templates) — slot separado, PR #171, aguarda
  esse fix mergear primeiro.
- Refatoração do monorepo / mudança de pnpm-workspace.yaml.
- Refatoração geral da auth.test.ts.

## Arquivos permitidos

- `packages/shared-schemas/package.json`
- `packages/shared-schemas/src/cities.ts` (apenas se necessário tipar transform)
- `packages/shared-schemas/src/leads.ts` (idem)
- `packages/shared-schemas/src/auth.ts` (idem)
- `apps/api/Dockerfile`
- `apps/api/package.json` (apenas para confirmar/adicionar `zod`)
- `apps/api/src/modules/cities/controller.ts`
- `apps/api/src/modules/cities/service.ts` (se precisar tipar retorno)
- `apps/api/src/modules/auth/__tests__/auth.test.ts` (apenas o teste de rate-limit)

## Arquivos proibidos

- Qualquer coisa em `apps/web/**`
- Qualquer coisa em `apps/langgraph-service/**`
- Qualquer migration
- `tsconfig.base.json` (fora de escopo — não mexer sem nova fase)
- `pnpm-workspace.yaml`

## Definition of Done

- [ ] `pnpm --filter @elemento/shared-schemas typecheck` verde local.
- [ ] `pnpm --filter @elemento/api typecheck && build` verde local.
- [ ] `pnpm --filter @elemento/api test -- auth` verde local (sem flaky), 3
      rodadas consecutivas.
- [ ] `docker build -f apps/api/Dockerfile -t elemento-api:test .` verde
      local (em ambiente Linux ou Docker Desktop com WSL).
- [ ] CI no PR fica verde: Node CI + E2E Smoke ambos PASS.
- [ ] PR documenta a causa raiz da falha de resolução de `zod` e a decisão
      tomada (a, b, c ou d acima).
- [ ] Nenhum `// @ts-ignore`, nenhum `as any`, nenhum skip de teste.

## Validação

```powershell
pnpm --filter @elemento/shared-schemas typecheck
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api build
pnpm --filter @elemento/api test -- auth
# Repro Docker (idealmente em WSL/Linux — Docker Desktop suporta):
# docker build -f apps/api/Dockerfile -t elemento-api:test .
```
