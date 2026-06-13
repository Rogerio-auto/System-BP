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
// Detecção de migrations pendentes:
//   Por HASH (SHA-256 do conteúdo .sql) — NÃO por timestamp.
//   Razão: o campo `when` do _journal.json não é monotônico (migrations geradas
//   em épocas diferentes, reordenadas por idx). Usar timestamp levava a pular
//   silenciosamente migrations com `when` menor que o MAX(created_at) do DB.
//   A detecção por hash é robusta a qualquer ordenação de `when`.
//
// Garantias:
//   - Idempotente: re-executar em DB atualizado não aplica nada.
//   - Se uma migration não-transacional falha: o journal NÃO é gravado e o
//     processo termina com exit(1) + mensagem clara.
//   - Migrations transacionais continuam com BEGIN/COMMIT — se falharem, o
//     ROLLBACK garante que o journal também não é gravado (tudo na transação).
//   - Cross-platform: o guard `isEntrypoint` funciona em Windows e Linux.
// =============================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

// Regex que detecta statements que não podem rodar em transação.
// Aplicado somente sobre o conteúdo SQL sem comentários (ver stripComments).
const NO_TXN_RE = /\bCONCURRENTLY\b|\bVACUUM\b|\bREINDEX\b/i;

// Marker explícito na primeira linha do arquivo
const MARKER_RE = /^--\s*no-transaction\b/;

/**
 * Remove comentários SQL (`-- …` de linha e `/* … *\/` de bloco) do conteúdo
 * bruto para evitar falsos-positivos na detecção de CONCURRENTLY/VACUUM/REINDEX.
 *
 * Não afeta o hash (que é calculado sobre o conteúdo bruto) nem o marker
 * `-- no-transaction` (que é lido separadamente na primeira linha antes do strip).
 */
function stripSqlComments(sql: string): string {
  // Remove blocos /* ... */ (incluindo multi-linha, não-guloso)
  let stripped = sql.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove comentários de linha -- ... até EOL
  stripped = stripped.replace(/--[^\r\n]*/g, '');
  return stripped;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Lê o journal Drizzle (_journal.json) e os arquivos .sql, retornando uma
 * lista na ordem do journal (por idx) com todos os metadados necessários.
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
    // O marker é verificado na linha 1 bruta (antes do strip) — tem precedência.
    // NO_TXN_RE é aplicado no conteúdo sem comentários para evitar falsos-positivos
    // como `-- CONCURRENTLY não pode ser usada em transação`.
    const firstLine = content.split('\n')[0] ?? '';
    const contentWithoutComments = stripSqlComments(content);
    const noTransaction = MARKER_RE.test(firstLine) || NO_TXN_RE.test(contentWithoutComments);

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
 * Função pura — sem efeitos colaterais, sem I/O, sem pg.
 *
 * Dado o slice do journal (entradas já lidas do disco) e o conjunto de hashes
 * já registrados no DB, retorna as entradas que ainda precisam ser aplicadas,
 * na ordem do journal.
 *
 * Regra de decisão: uma entry é "pendente" se o seu hash NÃO estiver em
 * `appliedHashes`. Isso é robusto a qualquer ordenação de `folderMillis`/`when`.
 *
 * Log side-effect: recebe `log` (default console.log) para que testes possam
 * silenciar ou capturar as mensagens sem precisar de Postgres.
 */
function selectPendingMigrations(
  journalEntries: MigrationFile[],
  appliedHashes: ReadonlySet<string>,
  log: (msg: string) => void = (msg) => {
    // eslint-disable-next-line no-console
    console.log(msg);
  },
): MigrationFile[] {
  const pending: MigrationFile[] = [];

  for (const entry of journalEntries) {
    if (appliedHashes.has(entry.hash)) {
      // Hash presente no DB → já aplicada, pula
      log(`[migrate] ${entry.tag} já aplicada (hash match). Pulando.`);
    } else {
      // Hash ausente → precisa aplicar
      log(`[migrate] ${entry.tag} pendente (hash não encontrado no DB). Será aplicada.`);
      pending.push(entry);
    }
  }

  // Aviso: hash no DB que não existe no journal (migration removida ou journal corrompido)
  // Não bloqueia, mas vale logar para diagnóstico.
  // (Não temos como calcular isso aqui sem o set de tags do journal, mas o caller pode fazer.)

  return pending;
}

/**
 * Garante que o schema e a tabela de journal existam, incluindo um constraint
 * UNIQUE no hash para evitar double-inserts em race conditions de deploy.
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
  // Garante UNIQUE no hash para serializar gravações duplas em deploys paralelos.
  // Usa bloco DO para idempotência em versões do Postgres que não suportam
  // ADD CONSTRAINT IF NOT EXISTS (disponível apenas a partir do PG 9.x para alguns casos).
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_migration_hash'
          AND conrelid = '${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}'::regclass
      ) THEN
        ALTER TABLE ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}
          ADD CONSTRAINT uq_migration_hash UNIQUE (hash);
      END IF;
    END $$;
  `);
}

/**
 * Retorna o conjunto de hashes de todas as migrations registradas no DB.
 * É robusto a qualquer ordenação de `created_at`.
 */
async function getAppliedHashes(client: pg.PoolClient): Promise<Set<string>> {
  const result = await client.query<{ hash: string }>(
    `SELECT hash FROM ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`,
  );

  return new Set(result.rows.map((row) => row.hash));
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

  // `client` é declarado fora do try para que o finally possa liberar
  // mesmo se pool.connect() lançar (evita pool leak).
  let client: pg.PoolClient | undefined;

  try {
    client = await pool.connect();

    // Advisory lock para serializar execuções concorrentes em deploys com
    // múltiplas réplicas. hashtext('elemento_db_migrate') = lock ID estável.
    // O lock é por sessão e liberado explicitamente no finally.
    await client.query(`SELECT pg_advisory_lock(hashtext('elemento_db_migrate'))`);

    await ensureJournalTable(client);

    // Detecção por hash: busca todos os hashes já aplicados no DB.
    // Robusto a `when` fora de ordem e a gaps no idx do journal.
    const appliedHashes = await getAppliedHashes(client);
    const migrations = readMigrationFiles(migrationsFolder);

    // Loga hashes no DB que não existem no journal (warning de diagnóstico)
    const journalHashes = new Set(migrations.map((m) => m.hash));
    for (const dbHash of appliedHashes) {
      if (!journalHashes.has(dbHash)) {
        console.warn(
          `[migrate] AVISO: hash ${dbHash.slice(0, 12)}… está no DB mas não no journal. ` +
            `Migration removida ou journal corrompido.`,
        );
      }
    }

    const pending = selectPendingMigrations(migrations, appliedHashes);

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
    if (client !== undefined) {
      // Libera o advisory lock antes de devolver o client ao pool.
      // Sem await intencional em pg_advisory_unlock: se o unlock falhar, o lock
      // expira ao fim da sessão de qualquer forma — não queremos mascarar o erro
      // original da migration. Mas usamos try/catch para não suprimir o erro principal.
      try {
        await client.query(`SELECT pg_advisory_unlock(hashtext('elemento_db_migrate'))`);
      } catch {
        // silencioso — lock expira com a sessão
      }
      client.release();
    }
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
//
// Problema histórico: comparar `process.argv[1]` com `new URL(import.meta.url).pathname`
// falha no Windows porque:
//   - process.argv[1]  →  "C:\...\migrate.ts"    (backslashes, sem barra inicial)
//   - URL.pathname     →  "/C:/...\migrate.ts"   (forward slashes, barra inicial extra)
// Os dois nunca batem → main() nunca rodava → processo saía 0 sem aplicar nada.
//
// Correção: usar `fileURLToPath(import.meta.url)` (devolve path nativo do SO)
// e `path.resolve(process.argv[1])` (normaliza separadores e resolve CWD).
// Ambos produzem caminhos nativos comparáveis em Windows e Linux.
// ---------------------------------------------------------------------------
const _thisFile = fileURLToPath(import.meta.url).replace(/\.[jt]s$/, '');
const _argv1 =
  process.argv[1] !== undefined ? path.resolve(process.argv[1]).replace(/\.[jt]s$/, '') : '';
const isEntrypoint = _argv1 !== '' && _thisFile === _argv1;

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
export { readMigrationFiles, runMigrations, ensureJournalTable, selectPendingMigrations };
export type { MigrationFile, Journal, MigrationEntry };
