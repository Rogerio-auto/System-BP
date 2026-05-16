---
id: F0-S15
title: Saneamento — restaurar typecheck e testes verdes da API
phase: F0
task_ref: F0.15
status: in-progress
priority: high
estimated_size: L
agent_id: backend-engineer
claimed_at: 2026-05-16T19:18:03Z
completed_at:
pr_url:
depends_on: []
blocks: []
labels: []
source_docs: []
---

# F0-S15 — Saneamento do typecheck e testes da API

## Contexto

`pnpm --filter @elemento/api typecheck` está vermelho há muito tempo. Os slots vinham
mascarando isso com a nota "typecheck pode ter erro pré-existente — reportar, não
arrumar". Sem um gate de tipo confiável no backend, regressões reais passam batido
(o bug do simulador e o 500 do dashboard são exemplos do que um gate verde teria pego).

A causa-raiz principal já foi corrigida num hotfix (commit `51eb34f`): o
`apps/api/src/shared/fastify.d.ts` não tinha marcador de módulo, então `declare module
'fastify'` substituía os tipos reais do Fastify em vez de aumentá-los. Isso derrubou o
typecheck de **465 → 193 erros**. Este slot ataca os **193 erros reais restantes** e os
testes quebrados.

## Objetivo

`pnpm --filter @elemento/api typecheck` e `pnpm --filter @elemento/api test` **verdes**.
Sem `as any`, sem `@ts-ignore`, sem `--no-verify` — corrigir as causas, não silenciar.

## Escopo

### 1. Erros de typecheck (193, pós-hotfix `51eb34f`)

Rode `pnpm --filter @elemento/api typecheck` e categorize. As famílias conhecidas:

- **Fastify + ZodTypeProvider** (`app.ts` e rotas): `FastifyInstance<...ZodTypeProvider>`
  não atribuível ao default; `No overload matches this call`. A app usa
  `fastify-type-provider-zod` — o encadeamento de `withTypeProvider<ZodTypeProvider>()`
  e a tipagem dos plugins/rotas precisa ficar coerente. Esta é a família mais
  arquitetural — resolva-a primeiro, pois deve eliminar muitos erros derivados.
- **`error is of type 'unknown'`** (TS18046): blocos `catch` sem narrowing. Corrigir com
  narrowing apropriado (`instanceof Error`, type guards) — não com `as`.
- **Colunas ausentes no schema Drizzle**: `consentRevokedAt` (e provavelmente
  `anonymizedAt`) são usadas em `data-subject.controller.ts`/`cron-retention.ts` mas não
  existem nos schemas `customers.ts` / `leads.ts`. **Verifique se a coluna já existe no
  banco** (a migration `0010_data_subject` provavelmente já as criou) — se sim, é só
  declará-las no schema Drizzle, **sem migration nova**. Se NÃO existirem no banco, pare
  e reporte (migration é decisão à parte).
- **`exactOptionalPropertyTypes`** em arquivos de teste (`{ description: undefined }`
  etc.): ajustar os testes para não passar `undefined` explícito, ou ajustar o tipo —
  o que for correto caso a caso.

### 2. Testes quebrados (8 falhas)

`apps/api/src/modules/auth/__tests__/authenticate.test.ts` e `authorize.test.ts` têm
8 testes falhando (confirmado pré-existente — falham em `main` antes deste slot).
Investigar a causa raiz e corrigir. Pode ser o mesmo root cause do typecheck ou
independente — descobrir.

## Guardrails

- **Não mude regra de negócio.** Este slot corrige tipos e testes — não comportamento.
  Se um erro de tipo expõe um bug de lógica real, PARE e reporte (não conserte por
  conta própria).
- **Se a correção exigir mudar versão de dependência** (ex: bump major do Fastify ou
  do type-provider): PARE e reporte — não faça upgrade de dependência sem alinhar.
- **Não toque em migrations já aplicadas** (`db/migrations/**`).
- Nada de `as any` / `@ts-ignore` / `eslint-disable` para silenciar — se for
  inevitável num caso, justificar em comentário (padrão do projeto para `as`).

## Arquivos permitidos

- `apps/api/src/**` (qualquer arquivo de código/teste — a correção é transversal)
- **EXCETO** `apps/api/src/db/migrations/**` (migrations aplicadas são imutáveis)
- `apps/api/tsconfig.json` (só se a causa raiz estiver na config — justificar no PR)

> NÃO editar `package.json` (mudança de dependência exige alinhamento — ver guardrails).

## Definition of Done

- [ ] `pnpm --filter @elemento/api typecheck` — 0 erros.
- [ ] `pnpm --filter @elemento/api test` — todos verdes (inclui os 8 de auth).
- [ ] `pnpm --filter @elemento/api lint` — verde.
- [ ] `pnpm --filter @elemento/api build` — verde.
- [ ] Nenhuma regra de negócio alterada; nenhum `as any`/`@ts-ignore` novo sem
      justificativa.
- [ ] PR descreve as famílias de erro encontradas e como cada uma foi resolvida.

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api test
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api build
```
