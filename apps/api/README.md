# apps/api

Backend Fastify + TypeScript estrito + Drizzle ORM.

Veja [docs/02-arquitetura-sistema.md](../../docs/02-arquitetura-sistema.md) para arquitetura e [docs/12-tasks-tecnicas.md](../../docs/12-tasks-tecnicas.md) para tasks.

## Comandos

| Comando | O que faz |
|---|---|
| `pnpm dev` | Sobe API com hot reload (tsx watch) |
| `pnpm build` | Compila TS para `dist/` |
| `pnpm start` | Roda `dist/server.js` (produção) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest |
| `pnpm db:generate` | Gera SQL de migration a partir de mudanca no schema |
| `pnpm db:migrate` | Aplica migrations no banco |
| `pnpm db:studio` | Abre Drizzle Studio |

## Pipeline de migrations

O `.env` da raiz do monorepo e carregado automaticamente por todos os scripts `db:*`
via `--env-file=../../.env` — nao e necessario exportar variaveis de ambiente manualmente.

### Fluxo padrao

1. **Editar schema TypeScript** em `src/db/schema/<modulo>.ts` e re-exportar em `src/db/schema/index.ts`.
2. **Gerar migration**: `pnpm db:generate`
   - O drizzle-kit compara o schema atual com o ultimo snapshot em `src/db/migrations/meta/`.
   - Gera um novo arquivo `.sql` em `src/db/migrations/` e atualiza `meta/_journal.json` e `meta/<n>_snapshot.json`.
3. **Revisar o SQL gerado** antes de aplicar. Verificar especialmente:
   - Indexes parciais (Drizzle nao gera `WHERE` clause automaticamente — editar o `.sql` se necessario).
   - `ON DELETE` em FKs (sempre deve ser explicito).
   - Constraints unicas com soft delete (exigem index parcial manual).
4. **Aplicar no banco**: `pnpm db:migrate`
   - O migrator le `meta/_journal.json`, executa cada `.sql` ainda nao registrado e registra o hash em `drizzle.__drizzle_migrations`.
   - Re-rodar e no-op seguro.

### Regras inviolaveis

- Nunca editar uma migration ja aplicada em producao. Se errou, criar nova migration.
- Todo `CREATE TABLE` de dominio inclui `organization_id uuid NOT NULL` (multi-tenant).
- IDs: `uuid DEFAULT gen_random_uuid()` (pgcrypto). Nunca serial.
- Timestamps: `timestamptz NOT NULL DEFAULT now()`. Nunca `timestamp` sem fuso.
- FKs sempre com `ON DELETE` explicito.

### Verificar migrations aplicadas

Via tabela de controle do Drizzle:

```sql
SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at;
```

Via tabela tecnica do marco zero (confirma que o pipeline rodou):

```sql
SELECT * FROM _schema_meta;
```
