---
id: F1-S28
title: Fix typecheck do api — drizzle.config.ts fora de rootDir
phase: F1
task_ref: hotfix
status: available
priority: critical
estimated_size: XS
agent_id: null
claimed_at: null
completed_at: null
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

- [ ] `pnpm --filter @elemento/api typecheck` verde.
- [ ] `pnpm --filter @elemento/api lint` verde.
- [ ] `pnpm --filter @elemento/api build` passa (smoke — extends do mesmo tsconfig.json).
- [ ] `drizzle.config.ts` continua sendo type-checked (o segundo `tsc -p tsconfig.tools.json` cobre).
- [ ] PR aberto.

## Validação

```powershell
pnpm --filter @elemento/api typecheck
```

```powershell
pnpm --filter @elemento/api lint
```

```powershell
pnpm --filter @elemento/api build
```

## Notas

- Após este slot fechar, considerar promover `pnpm typecheck` como gate obrigatório em todos os slots do DoD futuro — esse gap só passou porque nenhum slot exigia explicitamente.
- O bug do `slot.py` que gera subject de chore em uppercase (PROTOCOL §7.5) continua valendo — chores deste slot devem ser commitados manualmente em lowercase.
