// =============================================================================
// Runner customizado de migrations Drizzle para o @elemento/api.
//
// Por que substituir o runner padrão?
// O runner padrão do drizzle-orm/node-postgres envolve CADA arquivo .sql dentro
// de uma única transação (BEGIN ... COMMIT). O PostgreSQL recusa executar
// CREATE INDEX CONCURRENTLY (e VACUUM / REINDEX) dentro de uma transação
// explícita — o driver lança um erro e o ROLLBACK descarta as DDLs, mas o
// journal (`drizzle.__drizzle_migrations`) já havia sido gravado antes do
// erro, criando "journal drift": o banco acha que a migration foi aplicada
// quando na verdade ela falhou parcialmente.
//
// Solução: detectar se um arquivo SQL requer execução fora de transação e, se
// sim, rodar statement por statement diretamente no cliente, sem BEGIN/COMMIT.
// O hash gravado no journal é idêntico ao do drizzle-kit (SHA-256 do conteúdo
// bruto do arquivo), garantindo compatibilidade com `drizzle-kit generate`.
//
// Detecção de "modo não-transacional":
//   1. Linha 1 do arquivo contém o marker `-- no-transaction`.
//   2. OU o arquivo contém as palavras CONCURRENTLY, VACUUM ou REINDEX.
//
// Garantias:
//   - Idempotente: re-executar em DB atualizado não aplica nada.
//   - Se uma migration não-transacional falha: o journal NÃO é gravado e o
//     processo termina com exit(1) + mensagem clara.
//   - Migrations transacionais continuam com BEGIN/COMMIT — se falharem, o
//     ROLLBACK garante que o journal também não é gravado (tudo na transação).
// =============================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import pg from 'pg';

import { env } from '../config/env.js';

const { Pool } = pg;

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

interface MigrationEntry {
  tag: string;
  when: number; // folderMillis — timestamp numérico do nome da pasta no meta
  breakpoints: boolean;
}

interface Journal {
  entries: MigrationEntry[];
}

interface MigrationFile {
  tag: string;
  folderMillis: number;
  hash: string;
  // Conteúdo completo (para detecção de markers)
  content: string;
  // Statements separados pelo breakpoint do drizzle-kit
  statements: string[];
  noTransaction: boolean;
}

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const MIGRATIONS_SCHEMA = 'drizzle';
const MIGRATIONS_TABLE = '__drizzle_migrations';

// Regex que detecta statements que não podem rodar em transação
const NO_TXN_RE = /\bCONCURRENTLY\b|\bVACUUM\b|\bREINDEX\b/i;

// Marker explícito na primeira linha do arquivo
const MARKER_RE = /^--\s*no-transaction\b/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Lê o journal Drizzle (_journal.json) e os arquivos .sql, retornando uma
 * lista ordenada por `folderMillis` com todos os metadados necessários.
 */
function readMigrationFiles(migrationsFolder: string): MigrationFile[] {
  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');

  if (!fs.existsSync(journalPath)) {
    throw new Error(`Journal não encontrado: ${journalPath}`);
  }

  const journal: Journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));

  return journal.entries.map((entry) => {
    const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`);

    if (!fs.existsSync(sqlPath)) {
      throw new Error(`Arquivo de migration não encontrado: ${sqlPath}`);
    }

    const content = fs.readFileSync(sqlPath, 'utf8');
    const hash = crypto.createHash('sha256').update(content).digest('hex');

    // Quebra pelo marcador do drizzle-kit (mesma lógica do runner oficial)
    const statements = content.split('--> statement-breakpoint');

    // Detecta modo não-transacional pelo marker explícito OU pela presença de
    // statements que o Postgres recusa dentro de BEGIN/COMMIT.
    const firstLine = content.split('\n')[0] ?? '';
    const noTransaction = MARKER_RE.test(firstLine) || NO_TXN_RE.test(content);

    return {
      tag: entry.tag,
      folderMillis: entry.when,
      hash,
      content,
      statements,
      noTransaction,
    };
  });
}

/**
 * Garante que o schema e a tabela de journal existam.
 * Usa um cliente dedicado para não interferir com transações em curso.
 */
async function ensureJournalTable(client: pg.PoolClient): Promise<void> {
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${MIGRATIONS_SCHEMA}`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} (
      id         SERIAL PRIMARY KEY,
      hash       TEXT    NOT NULL,
      created_at BIGINT
    )
  `);
}

/**
 * Retorna o `created_at` da última migration registrada no journal,
 * ou -1 se o journal estiver vazio.
 */
async function getLastAppliedTimestamp(client: pg.PoolClient): Promise<number> {
  const result = await client.query<{ created_at: string }>(
    `SELECT created_at
     FROM ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}
     ORDER BY created_at DESC
     LIMIT 1`,
  );

  if (result.rows.length === 0) return -1;
  return Number(result.rows[0]!.created_at);
}

/**
 * Grava o hash da migration no journal.
 * Em modo transacional, `client` já está dentro de BEGIN.
 * Em modo não-transacional, a inserção é atômica por si só.
 */
async function recordMigration(
  client: pg.PoolClient,
  hash: string,
  folderMillis: number,
): Promise<void> {
  await client.query(
    `INSERT INTO ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} (hash, created_at)
     VALUES ($1, $2)`,
    [hash, folderMillis],
  );
}

// ---------------------------------------------------------------------------
// Runner principal
// ---------------------------------------------------------------------------

async function runMigrations(migrationsFolder: string): Promise<void> {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const client = await pool.connect();

  try {
    await ensureJournalTable(client);
    const lastTimestamp = await getLastAppliedTimestamp(client);
    const migrations = readMigrationFiles(migrationsFolder);

    const pending = migrations.filter((m) => m.folderMillis > lastTimestamp);

    if (pending.length === 0) {
      // eslint-disable-next-line no-console
      console.log('[migrate] Nenhuma migration pendente. DB em dia.');
      return;
    }

    for (const migration of pending) {
      const mode = migration.noTransaction ? 'non-transactional' : 'transactional';

      // eslint-disable-next-line no-console
      console.log(`[migrate] Aplicando ${migration.tag} (mode=${mode})...`);

      if (migration.noTransaction) {
        // ---------------------------------------------------------------
        // Modo não-transacional: cada statement roda diretamente no cliente,
        // sem BEGIN/COMMIT. O journal só é gravado APÓS todos os statements
        // executarem com sucesso.
        // ---------------------------------------------------------------
        try {
          for (const stmt of migration.statements) {
            const trimmed = stmt.trim();
            if (!trimmed) continue;
            await client.query(trimmed);
          }

          // Só grava no journal se todos os statements passaram
          await recordMigration(client, migration.hash, migration.folderMillis);

          // eslint-disable-next-line no-console
          console.log(`[migrate] ${migration.tag} aplicada com sucesso.`);
        } catch (err) {
          // NÃO grava no journal — o operador precisa corrigir e re-executar
          const message = err instanceof Error ? err.message : String(err);

          console.error(
            `[migrate] ERRO em migration não-transacional ${migration.tag}: ${message}`,
          );
          console.error(
            `[migrate] ATENÇÃO: a migration ${migration.tag} foi parcialmente aplicada. ` +
              `Corrija o problema e execute "pnpm db:migrate" novamente. ` +
              `O journal NÃO foi gravado — a migration será re-tentada.`,
          );

          throw err; // Propaga para o main() que chama process.exit(1)
        }
      } else {
        // ---------------------------------------------------------------
        // Modo transacional: BEGIN / statements / journal / COMMIT.
        // Se qualquer statement falhar, ROLLBACK reverte tudo (inclusive
        // o journal) — estado consistente garantido pelo Postgres.
        // ---------------------------------------------------------------
        await client.query('BEGIN');

        try {
          for (const stmt of migration.statements) {
            const trimmed = stmt.trim();
            if (!trimmed) continue;
            await client.query(trimmed);
          }

          await recordMigration(client, migration.hash, migration.folderMillis);

          await client.query('COMMIT');

          // eslint-disable-next-line no-console
          console.log(`[migrate] ${migration.tag} aplicada com sucesso.`);
        } catch (err) {
          await client.query('ROLLBACK');

          const message = err instanceof Error ? err.message : String(err);

          console.error(`[migrate] ERRO em migration transacional ${migration.tag}: ${message}`);
          console.error(
            `[migrate] ROLLBACK executado. DB permanece em estado consistente. ` +
              `O journal NÃO foi gravado.`,
          );

          throw err;
        }
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // O caminho é relativo ao CWD — quando invocado via `pnpm db:migrate` a
  // partir de apps/api, o CWD é apps/api.
  const migrationsFolder = path.resolve('./src/db/migrations');

  // eslint-disable-next-line no-console
  console.log('[migrate] Iniciando runner customizado...');
  // eslint-disable-next-line no-console
  console.log(`[migrate] Pasta: ${migrationsFolder}`);

  await runMigrations(migrationsFolder);

  // eslint-disable-next-line no-console
  console.log('[migrate] Concluido.');
}

// ---------------------------------------------------------------------------
// Entrypoint guard: só executa quando rodado diretamente (não importado).
// Em ESM, `process.argv[1]` aponta para o arquivo que foi iniciado pelo Node.
// Quando importado em testes (import { runMigrations } from '../migrate.js'),
// process.argv[1] aponta para o runner do Vitest — condição falsa, main() não roda.
// ---------------------------------------------------------------------------
const isEntrypoint =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  // tsx substitui .ts por .js no argv — normaliza para comparar
  process.argv[1].replace(/\.[jt]s$/, '') ===
    new URL(import.meta.url).pathname.replace(/\.[jt]s$/, '');

if (isEntrypoint) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[migrate] Falha fatal: ${message}`);
    process.exit(1);
  });
}

// ---------------------------------------------------------------------------
// Exports para uso em testes de integração
// ---------------------------------------------------------------------------
export { readMigrationFiles, runMigrations, ensureJournalTable };
export type { MigrationFile, Journal, MigrationEntry };
