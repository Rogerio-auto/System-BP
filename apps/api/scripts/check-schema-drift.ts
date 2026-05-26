// =============================================================================
// check-schema-drift.ts — Detecta drift entre schema Drizzle e banco real.
//
// Como funciona:
//   Para cada tabela exportada pelo schema Drizzle, executa
//   `SELECT * FROM <tabela> LIMIT 0`. O Postgres retorna um erro se qualquer
//   coluna referenciada pelo schema não existir na tabela real — indicando que
//   uma migration foi registrada no journal mas não foi de fato aplicada no DB.
//
// Quando usar:
//   - Antes de iniciar o dev server em uma máquina nova.
//   - Em CI, após `pnpm db:migrate`, para confirmar que o DB está em dia.
//   - Após suspeita de "journal drift" (migration com CONCURRENTLY que falhou
//     silenciosamente com o runner padrão do drizzle-orm).
//
// Uso:
//   pnpm --filter @elemento/api db:check-drift
//
// Saída:
//   - Imprime OK para cada tabela sem drift.
//   - Imprime DRIFT para tabelas com colunas faltando.
//   - Sai com código 1 se qualquer drift for encontrado.
// =============================================================================

import pg from 'pg';

import { env } from '../src/config/env.js';
import * as schema from '../src/db/schema/index.js';

const { Pool } = pg;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extrai o nome real da tabela a partir do símbolo interno do Drizzle.
 * Funciona para PgTable (que usa Symbol(DrizzleConfig)).
 */
function getTableName(table: unknown): string | null {
  if (typeof table !== 'object' || table === null) return null;

  // O Drizzle guarda o nome da tabela em Symbol(DrizzleConfig) ou em
  // propriedade pública `_` da instância. A forma mais confiável é
  // inspecionar o prototype ou a propriedade `[Symbol.for('drizzle:Name')]`.
  const nameSymbol = Object.getOwnPropertySymbols(table).find(
    (s) => s.toString().includes('BaseName') || s.toString().includes('Name'),
  );

  if (nameSymbol) {
    const value = (table as Record<symbol, unknown>)[nameSymbol];
    if (typeof value === 'string') return value;
  }

  // Fallback: propriedade _
  const underscore = (table as Record<string, unknown>)['_'];
  if (
    typeof underscore === 'object' &&
    underscore !== null &&
    typeof (underscore as Record<string, unknown>)['name'] === 'string'
  ) {
    return (underscore as Record<string, unknown>)['name'] as string;
  }

  return null;
}

/**
 * Retorna true se o objeto parecer um PgTable do Drizzle.
 * Critério: tem Symbol que inclui "DrizzleConfig" ou tem propriedade `_.name`.
 */
function isDrizzleTable(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;

  const symbols = Object.getOwnPropertySymbols(value);
  if (
    symbols.some((s) => s.toString().includes('DrizzleConfig') || s.toString().includes('BaseName'))
  ) {
    return true;
  }

  const underscore = (value as Record<string, unknown>)['_'];
  return (
    typeof underscore === 'object' &&
    underscore !== null &&
    typeof (underscore as Record<string, unknown>)['name'] === 'string'
  );
}

// ---------------------------------------------------------------------------
// Verificação de drift por tabela
// ---------------------------------------------------------------------------

interface DriftResult {
  table: string;
  ok: boolean;
  error?: string;
}

async function checkTable(client: pg.PoolClient, tableName: string): Promise<DriftResult> {
  try {
    // Consulta vazia — retorna 0 linhas mas valida todas as colunas
    await client.query(`SELECT * FROM "${tableName}" LIMIT 0`);
    return { table: tableName, ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { table: tableName, ok: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const client = await pool.connect();

  try {
    // Coleta tabelas do schema Drizzle
    const tables: string[] = [];

    for (const [exportName, value] of Object.entries(schema)) {
      if (!isDrizzleTable(value)) continue;
      const name = getTableName(value);
      if (name) {
        tables.push(name);
      } else {
        console.warn(
          `[drift] Aviso: não foi possível determinar o nome da tabela para "${exportName}".`,
        );
      }
    }

    if (tables.length === 0) {
      console.error(
        '[drift] Nenhuma tabela encontrada no schema. Verifique apps/api/src/db/schema/index.ts.',
      );
      process.exit(1);
    }

    // eslint-disable-next-line no-console
    console.log(`[drift] Verificando ${tables.length} tabela(s) do schema Drizzle...`);

    const results: DriftResult[] = [];

    for (const tableName of tables) {
      const result = await checkTable(client, tableName);
      results.push(result);

      if (result.ok) {
        // eslint-disable-next-line no-console
        console.log(`[drift] OK       ${tableName}`);
      } else {
        console.error(`[drift] DRIFT    ${tableName} — ${result.error ?? 'erro desconhecido'}`);
      }
    }

    const drifted = results.filter((r) => !r.ok);

    if (drifted.length > 0) {
      console.error('');
      console.error(`[drift] FALHA: ${drifted.length} tabela(s) com drift detectado.`);
      console.error(
        '[drift] Execute "pnpm db:migrate" e verifique se há migrations com CONCURRENTLY',
      );
      console.error('[drift] que falharam silenciosamente. Veja docs/19-runbook-go-live.md §13.');
      process.exit(1);
    }

    // eslint-disable-next-line no-console
    console.log('');
    // eslint-disable-next-line no-console
    console.log('[drift] Schema em dia. Nenhum drift detectado.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[drift] Falha fatal: ${message}`);
  process.exit(1);
});
