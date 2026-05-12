---
id: F1-S28
title: Fix typecheck do api — drizzle.config.ts fora de rootDir
phase: F1
task_ref: hotfix
status: review
priority: critical
estimated_size: XS
agent_id: claude-code
claimed_at: 2026-05-12T17:05:53Z
completed_at: 2026-05-12T17:12:12Z
pr_url: null
depends_on: [F1-S27]
blocks: []
source_docs: []
---

# F1-S28 — Fix typecheck do `apps/api` (drizzle.config.ts fora de rootDir)

## Contexto

`apps/api/tsconfig.json` declara duas regras incompatíveis:

```json
"rootDir": "src",
"include": ["src", "drizzle.config.ts"]
```

`drizzle.config.ts` mora em `apps/api/` (raiz do pacote), fora de `src/`. O TypeScript erra:

> `TS6059: File 'drizzle.config.ts' is not under 'rootDir'. 'rootDir' is expected to contain all source files.`

Resultado: `pnpm --filter @elemento/api typecheck` falha de forma determinística desde F0-S04 (slot que introduziu o arquivo). O bug ficou mascarado pelo crash GIN do schema (resolvido em F1-S27) e por nenhum slot anterior ter `typecheck` como gate explícito no DoD.

PROTOCOL.md §7.7 documenta o gap como dívida técnica proposta para slot follow-up; este é o slot.

## Objetivo

Deixar `pnpm --filter @elemento/api typecheck` verde, mantendo `drizzle.config.ts`:

1. Onde está (raiz do pacote — convenção drizzle-kit).
2. Coberto por type-checking (precisa porque importa `defineConfig` e usa env).

## Decisão técnica

Opção **A — `tsconfig.tools.json` dedicado**:

- Criar `apps/api/tsconfig.tools.json` que estende `tsconfig.json` mas:
  - remove `rootDir`,
  - troca `include` para `["drizzle.config.ts"]` (somente o que mora fora do `src/`),
  - mantém `noEmit: true`.
- Em `apps/api/tsconfig.json`: remover `"drizzle.config.ts"` do `include` (volta para `["src"]`).
- Em `apps/api/package.json`: trocar `typecheck` para encadear os dois:
  `"typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.tools.json"`.

Por que A e não B/C:

- **B (mover para `src/`)** quebra a convenção do drizzle-kit (espera o config na raiz do pacote por default) e força `--config` em todas as invocações.
- **C (remover `rootDir`)** muda a topologia de `dist/` em builds futuros (`dist/src/...` em vez de `dist/...`) e enfraquece a garantia de que tudo que é compilado mora em `src/`.

## Escopo

- Criar `apps/api/tsconfig.tools.json`.
- Editar `apps/api/tsconfig.json` (remover entrada de include).
- Editar `apps/api/package.json` (script `typecheck`).

## Fora de escopo

- Mexer em `tsconfig.build.json` — o build atual já exclui arquivos de teste e migrate.ts; `drizzle.config.ts` não vai para `dist/` porque só é referenciado em runtime via drizzle-kit (ferramenta dev).
- Refatorar outros tsconfigs do monorepo.
- Outros erros TS — se aparecerem após o fix, ficam para slot separado.

## Arquivos permitidos

- `apps/api/tsconfig.json`
- `apps/api/tsconfig.tools.json` (novo)
- `apps/api/package.json`

## Arquivos proibidos

- `apps/api/tsconfig.build.json` — escopo de build, não typecheck.
- `apps/api/src/**` — não é problema de código fonte.
- `packages/tsconfig/**` — config compartilhada, não tocar.
- `apps/api/drizzle.config.ts` — o arquivo está correto, o problema é a config.

## Definition of Done

- [ ] Erro `TS6059: File 'drizzle.config.ts' is not under 'rootDir'` eliminado.
- [ ] `drizzle.config.ts` continua sendo type-checked (segundo `tsc -p tsconfig.tools.json`).
- [ ] `pnpm --filter @elemento/api lint` verde.
- [ ] PR aberto, listando os erros TS pré-existentes descobertos (e referenciando os slots follow-up).

## Validação

```powershell
pnpm --filter @elemento/api lint
```

```powershell
pnpm --filter @elemento/api typecheck 2>&1 | Select-String -Pattern "TS6059" -SimpleMatch -NotMatch | Select-String -Pattern "drizzle.config.ts"
```

> Nota: o segundo comando é um teste negativo — deve falhar (sem matches) confirmando que TS6059 não fala mais sobre drizzle.config.ts.

## Descoberta — erros TS pré-existentes (out of scope, follow-ups)

Após eliminar o TS6059 que mascarava todo o resto, `pnpm typecheck` revelou erros pré-existentes em código já mergeado. **Não fazem parte deste slot** (ver "Fora de escopo"). Cada um vai virar slot separado:

| Erro                                                                    | Localização                                     | Origem                       | Follow-up sugerido  |
| ----------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------- | ------------------- |
| TS5069 `declarationMap` sem `declaration` ou `composite`                | `tsconfig.build.json:6`                         | F0-S04 (drizzle init)        | F1-S29 (config)     |
| TS7006 4× `Parameter implicitly has 'any' type`                         | `src/routes/data-subject.routes.ts:247,263,284` | F1-S25 (LGPD subject rights) | F1-S30 (lgpd-types) |
| TS2320 `AnonymizeTx cannot simultaneously extend AuditTx and DrizzleTx` | `src/services/lgpd/anonymize.ts:40`             | F1-S25                       | F1-S30              |
| TS2345 2× `AnonymizeTx not assignable to DrizzleTx`                     | `src/services/lgpd/anonymize.ts:180,248`        | F1-S25                       | F1-S30              |
| TS2339 `Property 'anonymizedAt' does not exist on leads`                | `src/workers/cron-retention.ts:118`             | F1-S25 (schema gap)          | F1-S31 (schema)     |
| TS2339 `Property 'anonymizedAt' does not exist on customers`            | `src/workers/cron-retention.ts:164`             | F1-S25                       | F1-S31              |
| TS2314 `Generic type 'FastifyInstance' requires 5 type arguments`       | `src/shared/errors.test.ts:192`                 | F1-S02 (app-error)           | F1-S32 (test-types) |
| TS2345 2× `unknown not assignable to string`                            | `src/shared/jwt.ts:72,73`                       | F1-S03 (auth)                | F1-S33 (jwt-types)  |

## Notas

- Após este slot fechar, considerar promover `pnpm typecheck` como gate obrigatório em todos os slots do DoD futuro — esse gap só passou porque nenhum slot exigia explicitamente.
- O bug do `slot.py` que gera subject de chore em uppercase (PROTOCOL §7.5) continua valendo — chores deste slot devem ser commitados manualmente em lowercase.
