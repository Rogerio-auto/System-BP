---
id: F0-S20
title: Fix CI — db:migrate exige .env físico que CI não tem (6ª camada)
phase: F0
task_ref: F0.20
status: in-progress
priority: critical
estimated_size: XS
agent_id: backend-engineer
depends_on: []
blocks: []
labels: [ci, infra, migrations]
source_docs:
  - apps/api/package.json
claimed_at: 2026-06-01T17:12:40Z
---

# F0-S20 — `db:migrate` exige `.env` físico que o CI não tem

## Contexto

F0-S19 destravou as env vars do langgraph (5ª camada). Stack inteira agora
sobe healthy (postgres + api + langgraph). 6ª camada — última conhecida —
está no step `Run database migrations` do E2E Smoke:

```
> @elemento/api db:migrate
> tsx --env-file=../../.env src/db/migrate.ts
node: ../../.env: not found
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL ... Exit status 9
```

### Causa raiz

`apps/api/package.json:18`:

```json
"db:migrate": "tsx --env-file=../../.env src/db/migrate.ts"
```

O `--env-file=../../.env` exige que o arquivo `.env` exista fisicamente. Em
dev local existe (o desenvolvedor copiou de `.env.example`). No CI, todas as
env vars (`DATABASE_URL`, `JWT_*`, `LGPD_*`, `LANGGRAPH_INTERNAL_TOKEN`,
etc.) já são injetadas pelo step do GitHub Actions — o `.env` físico não
existe e não precisaria existir. O `tsx` aborta com exit 9 antes de ler
qualquer env do processo.

### Fix proposto

`tsx` 4.7+ suporta `--env-file-if-exists`, que carrega se o arquivo existe
e ignora silenciosamente se não. **Comportamento desejado nos dois
ambientes:**

- Dev local: arquivo existe → carrega normalmente (zero mudança de DX).
- CI: arquivo não existe → ignora; env vem do step do workflow.

Confirmar a versão do tsx instalada antes (em `apps/api/package.json` ou no
lockfile). Se for >= 4.7 — fix de 1 linha. Se for menor — atualizar para
`^4.19.0` (versão estável atual).

## Objetivo

Tornar o script `db:migrate` executável tanto em dev local quanto em CI sem
hacks (não criar `.env` fake no CI; não duplicar script).

## Escopo

### 1. Atualizar 1 linha em `apps/api/package.json`

```json
// ANTES
"db:migrate": "tsx --env-file=../../.env src/db/migrate.ts"

// DEPOIS
"db:migrate": "tsx --env-file-if-exists=../../.env src/db/migrate.ts"
```

### 2. Confirmar versão do tsx

```powershell
pnpm --filter @elemento/api list tsx
```

Se for `< 4.7`, atualizar para `^4.19.0` em `apps/api/package.json`
`devDependencies` e rodar `pnpm install` para regerar o lockfile.

### 3. Auditar outros scripts com mesmo padrão

```powershell
grep -rn "env-file=" apps/api/package.json apps/api/scripts 2>$null
```

Se houver outros scripts (`db:seed`, `db:reset`, workers em CI, etc.) com
o mesmo `--env-file=...`, aplicar o mesmo fix em todos. Documentar no PR
quantos foram alterados.

## Fora de escopo

- Migrar para outro carregador de env (dotenv-cli, node --env-file etc).
- Mudar o `.env.example` ou criar variantes de env.
- Mudar a estrutura do `src/db/migrate.ts` (o script Node em si está OK).
- F8-S18 (PR #171) — desbloqueia depois desse merge.

## Arquivos permitidos

- `apps/api/package.json`
- `pnpm-lock.yaml` (se precisar atualizar tsx)

## Arquivos proibidos

- Tudo o resto.

## Definition of Done

- [ ] Step `Run database migrations` do E2E Smoke verde no PR.
- [ ] CI verde: Node CI + Python CI + **E2E Smoke** todos PASS.
- [ ] `pnpm --filter @elemento/api db:migrate` funciona localmente
      (manualmente verificado pelo agente).
- [ ] PR documenta a versão final do tsx e quantos scripts foram ajustados.

## Validação

```powershell
# Local — confirma que o fix não quebrou dev:
pnpm --filter @elemento/api db:migrate

# Confirma versão do tsx:
pnpm --filter @elemento/api list tsx

# CI faz o resto.
```
