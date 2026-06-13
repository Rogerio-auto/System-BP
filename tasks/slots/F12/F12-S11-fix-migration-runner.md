---
id: F12-S11
title: Fix CRÍTICO — runner de migrations pula migrations em DB existente (go-live blocker)
phase: F12
task_ref: docs/21-tutoriais-em-video.md#12
status: done
priority: critical
estimated_size: M
agent_id: null
claimed_at: 2026-06-13T00:44:49Z
completed_at: 2026-06-13T00:56:40Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/219
depends_on: []
blocks: []
source_docs:
  - docs/21-tutoriais-em-video.md#12
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F12-S11 — Runner de migrations pula migrations (CRÍTICO, go-live blocker)

## Objetivo

Corrigir o runner customizado `apps/api/src/db/migrate.ts` para que **toda migration pendente seja aplicada em qualquer DB**, inclusive bancos já parcialmente migrados (produção, dev local). Hoje migrations são **silenciosamente puladas**.

## Diagnóstico (confirmado em 2026-06-09, DB local do Rogério)

Sintoma: `feature_tutorials`, permissão `tutorials:manage` e flag `tutorials.enabled` (migrations 0047/0048/0049) **nunca aplicaram**, mas `pnpm db:migrate` reportava "Nenhuma migration pendente. DB em dia." Tabela/flag confirmadas ausentes no DB; feature 100% quebrada localmente. Duas causas:

1. **No-op silencioso no Windows.** O guard `isEntrypoint` (migrate.ts:~320) compara `process.argv[1]` (`C:\...\migrate.ts`, backslashes) com `new URL(import.meta.url).pathname` (`/C:/.../migrate.ts`, com barra inicial e forward slashes). No Windows nunca batem → `main()` não roda → processo sai 0 sem aplicar nada e sem log.

2. **Detecção de pendência por timestamp não-monotônico.** `runMigrations` calcula `pending = migrations.filter(m => m.folderMillis > lastTimestamp)`, onde `lastTimestamp = MAX(created_at)` no journal do DB. Mas os `when` do `_journal.json` **não são monotônicos**: 0030/0032/0040 têm `when` ~2026 (`1779…`) enquanto 0041-0049 têm ~2025 (`1748…/1749…`). Num DB que já aplicou até a 0040 (cujo `when` 1779753800000 vira o `lastTimestamp`), **toda migration posterior com `when` menor é considerada já-aplicada e pulada para sempre**.

Impacto em produção: deploy da F12 (e de 0041-0046) num DB existente pula as migrations silenciosamente. CI não pega porque usa DB zerado (lastTimestamp=-1 → tudo roda em ordem de journal).

> Nota: no DB local do Rogério as 3 migrations de tutoriais foram aplicadas manualmente (script throwaway idempotente) para desbloqueio imediato. Este slot conserta a causa raiz.

## Escopo (faz)

### `apps/api/src/db/migrate.ts`

1. **Pendência por hash, não por timestamp.** Trocar o filtro `folderMillis > lastTimestamp` por: aplicar, em ordem de journal, toda entry cujo **hash** ainda não está em `drizzle.__drizzle_migrations`. (Comportamento padrão do Drizzle; robusto a `when` fora de ordem.) Manter o registro de `(hash, created_at=when)` e a lógica transacional/não-transacional existente.
   - Cuidado documentado: hash-based re-tenta arquivos editados pós-aplicação (drift). Aceitável — a disciplina do projeto já proíbe editar migration aplicada. Logar claramente quando um hash do journal não está no DB e vice-versa.
2. **Corrigir o guard `isEntrypoint` no Windows.** Normalizar ambos os lados (ex.: `fileURLToPath(import.meta.url)` vs `path.resolve(process.argv[1])`, comparando paths normalizados) — ou usar outra detecção robusta cross-platform. Garantir que `pnpm db:migrate` aplique no Windows e no Linux.
3. Manter logs claros ("Aplicando…", "aplicada", "Nenhuma pendente").

### `apps/api/src/db/migrations/meta/_journal.json`

- **Normalizar os `when` não-monotônicos** (0030, 0032, 0040 e quaisquer outros fora de ordem) para valores crescentes coerentes com a ordem de `idx`. Não altera o conteúdo `.sql` nem os hashes. (Defensivo — a correção principal é a detecção por hash, mas o journal monotônico evita confusão.)

### Teste

- `apps/api/src/db/__tests__/` (ou onde os testes de `runMigrations` vivem): cenário que prova que, com `lastTimestamp` alto e uma migration de `when` menor **não aplicada (hash ausente)**, o runner **aplica** essa migration. E que migrations já aplicadas (hash presente) **não** re-rodam.

## Fora de escopo (NÃO faz)

- Reconciliar o estado bagunçado de um DB de dev específico (hash drift de `drizzle-kit push`).
- Mudar qualquer migration `.sql` existente (só o journal `when`).
- Adicionar `--env-file` ao script `db:migrate` (separado; o `config/env.ts` já carrega o `.env` via `process.loadEnvFile`).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/db/migrate.ts`
- `apps/api/src/db/migrations/meta/_journal.json`
- `apps/api/src/db/__tests__/migrate.test.ts` (criar/atualizar — confirmar caminho real dos testes de migrate)
- `tasks/slots/F12/F12-S11-fix-migration-runner.md`

## Arquivos proibidos (`files_forbidden`)

- Qualquer `apps/api/src/db/migrations/*.sql`
- `apps/api/src/db/schema/**`, `apps/api/src/modules/**`, `apps/web/**`, `packages/**`
- `tasks/STATUS.md`

## Contratos de saída

- `pnpm db:migrate` aplica todas as pendentes em DB existente, no Windows e Linux.
- `check-migrations` continua verde.

## Definition of Done

- [ ] Detecção por hash implementada; guard Windows corrigido
- [ ] `_journal.json` com `when` monotônico
- [ ] Teste cobrindo migration de `when` baixo + hash ausente sendo aplicada
- [ ] `pnpm --filter @elemento/api typecheck` / `lint` / `test` verdes
- [ ] `python scripts/slot.py check-migrations` verde

## Comandos de validação

```powershell
python scripts/slot.py check-migrations
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api test
```

## Notas para o agente

- Os testes de integração de `runMigrations` podem precisar de um Postgres; se o ambiente não tiver, cubra a lógica de seleção de pendentes com teste unitário puro (função que recebe `entries` + `appliedHashes` e devolve a lista a aplicar — extraia se necessário).
- NÃO toque no conteúdo dos `.sql` (mudaria os hashes e bagunçaria journals existentes).
