// =============================================================================
// workers/reports-refresh.ts -- Worker periodico de refresh MVs de relatorios (F23-S01).
//
// Iniciado via: pnpm --filter @elemento/api worker:reports:refresh
// Intervalo: 5 min (REPORTS_REFRESH_TICK_MS). Advisory lock previne sobreposicao.
// LGPD doc 17 par 3.3 fin 8: Zero PII nas MVs -- apenas agregados.
// =============================================================================

import type { Database } from '../db/client.js';
import { db as defaultDb } from '../db/client.js';
import { isFlagEnabled } from '../modules/featureFlags/service.js';

import { createWorkerRuntime } from './_runtime.js';

const WORKER_NAME = 'reports-refresh';
const DEFAULT_TICK_MS = 5 * 60 * 1_000;
const LOCK_KEY = 'elemento_reports_refresh';

const MATERIALIZED_VIEWS = [
  'mv_reports_overview',
  'mv_reports_funnel',
  'mv_reports_stage_dwell',
  'mv_reports_credit',
  'mv_reports_collection',
] as const;
type MvName = (typeof MATERIALIZED_VIEWS)[number];

function getTickMs(): number {
  const override = parseInt(process.env['REPORTS_REFRESH_TICK_MS'] ?? '', 10);
  return Number.isFinite(override) && override > 0 ? override : DEFAULT_TICK_MS;
}
function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export const runtime = createWorkerRuntime(WORKER_NAME, 3);

export interface RefreshResult {
  mv: MvName;
  success: boolean;
  durationMs: number;
  error?: string;
}

/**
 * Executa um tick de refresh: adquire advisory lock e refresha cada MV em sequencia.
 * Falha de uma MV nao interrompe as demais. Exportado para testes unitarios.
 */
export async function runReportsRefreshTick(
  db: Database = defaultDb,
  pool: typeof runtime.pool = runtime.pool,
): Promise<RefreshResult[]> {
  const logger = runtime.logger;
  const { enabled: dashboardEnabled } = await isFlagEnabled(db, 'dashboard.enabled');
  if (!dashboardEnabled) {
    logger.debug('dashboard.enabled=false -- pulando refresh das MVs');
    return [];
  }
  const client = await pool.connect();
  let hasLock = false;
  const results: RefreshResult[] = [];
  try {
    const lockResult = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext('elemento_reports_refresh')) AS acquired",
    );
    hasLock = lockResult.rows[0]?.acquired === true;
    if (!hasLock) {
      logger.debug({ lock: LOCK_KEY }, 'reports-refresh: advisory lock ocupado -- pulando tick');
      return [];
    }
    const tickStart = Date.now();
    logger.info({ lock: LOCK_KEY }, 'reports-refresh: inicio do tick');
    for (const mv of MATERIALIZED_VIEWS) {
      const mvStart = Date.now();
      try {
        await client.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${mv}`);
        results.push({ mv, success: true, durationMs: Date.now() - mvStart });
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.push({ mv, success: false, durationMs: Date.now() - mvStart, error: errorMsg });
        logger.error({ mv, err: { message: errorMsg } }, 'reports-refresh: falha ao refreshar MV');
      }
    }
    const totalMs = Date.now() - tickStart;
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    if (failed > 0) {
      logger.warn(
        { results, totalMs, succeeded, failed },
        'reports-refresh: tick com falhas parciais',
      );
    } else {
      logger.info({ results, totalMs, succeeded }, 'reports-refresh: tick com sucesso');
    }
  } finally {
    if (hasLock) {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtext('elemento_reports_refresh'))");
      } catch {
        /* lock expira com o fim da sessao */
      }
    }
    client.release();
  }
  return results;
}

async function main(): Promise<void> {
  const tickMs = getTickMs();
  runtime.logger.info({ worker: WORKER_NAME, tick_ms: tickMs }, 'reports-refresh iniciado');
  while (!runtime.isShuttingDown()) {
    try {
      await runReportsRefreshTick();
    } catch (err: unknown) {
      runtime.logger.error(
        { err: { message: err instanceof Error ? err.message : String(err) } },
        'reports-refresh: erro inesperado no tick -- continuando loop',
      );
    }
    await sleep(tickMs);
  }
  runtime.logger.info({ worker: WORKER_NAME }, 'reports-refresh encerrado graciosamente');
}

if (process.argv[1] !== undefined && process.argv[1].includes('reports-refresh')) {
  main().catch((err: unknown) => {
    runtime.logger.fatal(
      { err: { message: err instanceof Error ? err.message : String(err) } },
      'reports-refresh: falha fatal',
    );
    process.exit(1);
  });
}
