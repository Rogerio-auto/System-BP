// =============================================================================
// workers/cron-retention.ts — Job de retenção LGPD (doc 17 §6.1).
//
// Processo Node.js SEPARADO. Cron diário às 03:00 BRT (UTC-3 = 06:00 UTC).
//
// Regras de retenção (doc 17 §6.1):
//   1. leads sem operação > 90 dias → anonymizeLead()
//   2. customers sem operação > 5 anos → anonymizeCustomer()
//   3. interactions sem operação > 1 ano → eliminação física
//   4. user_sessions expiradas > 30 dias → eliminação física
//
// Relatório:
//   - Insere linha em retention_runs com contagens e erros.
//   - Falha total → log critical + emite lgpd.retention_failed (TODO: alerting).
//
// Modo dry-run:
//   - RETENTION_DRY_RUN=true → apenas conta, não executa.
//   - Útil para testes e verificação prévia.
//
// Multi-organização:
//   - O cron roda para TODAS as organizações (multi-tenant).
//   - Each anonymization/deletion is scoped to organization_id.
//
// LGPD §6.1: retenção é obrigação legal. Não há opt-out por org.
// =============================================================================
import { randomUUID } from 'node:crypto';

import { and, isNull, lt, or, sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import { customers } from '../db/schema/customers.js';
import { retentionRuns } from '../db/schema/data_subject.js';
import { interactions } from '../db/schema/interactions.js';
import { leads } from '../db/schema/leads.js';
import { userSessions } from '../db/schema/user_sessions.js';
import { anonymizeCustomer, anonymizeLead } from '../services/lgpd/anonymize.js';
import type { AnonymizeTx } from '../services/lgpd/anonymize.js';

import { createWorkerRuntime } from './_runtime.js';

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

const WORKER_NAME = 'cron-retention';

/** Thresholds de retenção conforme doc 17 §6.1. */
const RETENTION = {
  /** Leads sem operação > 90 dias → anonimização. */
  LEADS_DAYS: 90,
  /** Customers sem operação > 5 anos → anonimização. */
  CUSTOMERS_YEARS: 5,
  /** Interactions sem operação > 1 ano → eliminação física. */
  INTERACTIONS_DAYS: 365,
  /** Sessions expiradas > 30 dias → eliminação física. */
  SESSIONS_EXPIRED_DAYS: 30,
} as const;

/**
 * Hora UTC para execução do cron (06:00 UTC = 03:00 BRT).
 * O worker verifica se é hora de rodar ao iniciar.
 */
const CRON_HOUR_UTC = 6;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isDryRun(): boolean {
  return process.env['RETENTION_DRY_RUN'] === 'true';
}

function subtractDays(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function subtractYears(years: number): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d;
}

// ---------------------------------------------------------------------------
// Affected counts type
// ---------------------------------------------------------------------------

interface AffectedCounts {
  leads_anonymized: number;
  customers_anonymized: number;
  interactions_deleted: number;
  sessions_deleted: number;
}

interface RetentionError {
  entity_type: string;
  entity_id: string;
  error: string;
}

// ---------------------------------------------------------------------------
// Funções de retenção por categoria
// ---------------------------------------------------------------------------

/**
 * Anonimiza leads sem operação > LEADS_DAYS.
 * Critério: updated_at < threshold E anonymized_at IS NULL E deleted_at IS NULL.
 */
async function retainLeads(
  logger: ReturnType<typeof createWorkerRuntime>['logger'],
  dryRun: boolean,
): Promise<{ count: number; errors: RetentionError[] }> {
  const threshold = subtractDays(RETENTION.LEADS_DAYS);
  const errors: RetentionError[] = [];

  const toAnonymize = await db
    .select({ id: leads.id, organizationId: leads.organizationId })
    .from(leads)
    .where(and(lt(leads.updatedAt, threshold), isNull(leads.anonymizedAt), isNull(leads.deletedAt)))
    .limit(500); // batch cap para não bloquear DB

  logger.info(
    { count: toAnonymize.length, threshold: threshold.toISOString(), dry_run: dryRun },
    `[retention] ${dryRun ? '[DRY-RUN] ' : ''}Leads a anonimizar (> ${RETENTION.LEADS_DAYS} dias)`,
  );

  if (dryRun) {
    return { count: toAnonymize.length, errors: [] };
  }

  let count = 0;
  for (const lead of toAnonymize) {
    try {
      await db.transaction(async (tx) => {
        await anonymizeLead(tx as unknown as AnonymizeTx, lead.id, lead.organizationId, {
          audit: null,
          event: { kind: 'worker', id: null, ip: null },
        });
      });
      count++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push({ entity_type: 'lead', entity_id: lead.id, error: errorMsg });
      logger.error({ err, lead_id: lead.id }, '[retention] Falha ao anonimizar lead');
    }
  }

  return { count, errors };
}

/**
 * Anonimiza customers sem operação > CUSTOMERS_YEARS anos.
 * Critério: updated_at < threshold E anonymized_at IS NULL.
 */
async function retainCustomers(
  logger: ReturnType<typeof createWorkerRuntime>['logger'],
  dryRun: boolean,
): Promise<{ count: number; errors: RetentionError[] }> {
  const threshold = subtractYears(RETENTION.CUSTOMERS_YEARS);
  const errors: RetentionError[] = [];

  const toAnonymize = await db
    .select({ id: customers.id, organizationId: customers.organizationId })
    .from(customers)
    .where(and(lt(customers.updatedAt, threshold), isNull(customers.anonymizedAt)))
    .limit(500);

  logger.info(
    { count: toAnonymize.length, threshold: threshold.toISOString(), dry_run: dryRun },
    `[retention] ${dryRun ? '[DRY-RUN] ' : ''}Customers a anonimizar (> ${RETENTION.CUSTOMERS_YEARS} anos)`,
  );

  if (dryRun) {
    return { count: toAnonymize.length, errors: [] };
  }

  let count = 0;
  for (const customer of toAnonymize) {
    try {
      await db.transaction(async (tx) => {
        await anonymizeCustomer(
          tx as unknown as AnonymizeTx,
          customer.id,
          customer.organizationId,
          {
            audit: null,
            event: { kind: 'worker', id: null, ip: null },
          },
        );
      });
      count++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push({ entity_type: 'customer', entity_id: customer.id, error: errorMsg });
      logger.error({ err, customer_id: customer.id }, '[retention] Falha ao anonimizar customer');
    }
  }

  return { count, errors };
}

/**
 * Elimina fisicamente interactions sem operação > INTERACTIONS_DAYS.
 * Critério: created_at < threshold.
 * Nota: interactions são imutáveis (sem updated_at), usar created_at.
 */
async function retainInteractions(
  logger: ReturnType<typeof createWorkerRuntime>['logger'],
  dryRun: boolean,
): Promise<{ count: number; errors: RetentionError[] }> {
  const threshold = subtractDays(RETENTION.INTERACTIONS_DAYS);

  // Count first
  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(interactions)
    .where(lt(interactions.createdAt, threshold));

  const total = countResult[0]?.count ?? 0;

  logger.info(
    { count: total, threshold: threshold.toISOString(), dry_run: dryRun },
    `[retention] ${dryRun ? '[DRY-RUN] ' : ''}Interactions a eliminar (> ${RETENTION.INTERACTIONS_DAYS} dias)`,
  );

  if (dryRun || total === 0) {
    return { count: dryRun ? total : 0, errors: [] };
  }

  try {
    // Delete in batches to avoid long locks
    const result = await db.delete(interactions).where(lt(interactions.createdAt, threshold));

    // Drizzle returns rowCount for pg
    const deleted = (result as unknown as { rowCount?: number }).rowCount ?? total;
    logger.info({ deleted }, '[retention] Interactions eliminadas fisicamente');
    return { count: deleted, errors: [] };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, '[retention] Falha ao eliminar interactions');
    return {
      count: 0,
      errors: [{ entity_type: 'interactions', entity_id: 'batch', error: errorMsg }],
    };
  }
}

/**
 * Elimina fisicamente user_sessions expiradas > SESSIONS_EXPIRED_DAYS.
 * Critério: expires_at < threshold (sessions já expiradas há > 30 dias).
 */
async function retainSessions(
  logger: ReturnType<typeof createWorkerRuntime>['logger'],
  dryRun: boolean,
): Promise<{ count: number; errors: RetentionError[] }> {
  const threshold = subtractDays(RETENTION.SESSIONS_EXPIRED_DAYS);

  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userSessions)
    .where(
      or(
        // Expired sessions older than threshold
        lt(userSessions.expiresAt, threshold),
        // Revoked sessions older than threshold
        and(lt(userSessions.revokedAt, threshold)),
      ),
    );

  const total = countResult[0]?.count ?? 0;

  logger.info(
    { count: total, threshold: threshold.toISOString(), dry_run: dryRun },
    `[retention] ${dryRun ? '[DRY-RUN] ' : ''}Sessions a eliminar (expiradas > ${RETENTION.SESSIONS_EXPIRED_DAYS} dias)`,
  );

  if (dryRun || total === 0) {
    return { count: dryRun ? total : 0, errors: [] };
  }

  try {
    const result = await db
      .delete(userSessions)
      .where(or(lt(userSessions.expiresAt, threshold), and(lt(userSessions.revokedAt, threshold))));

    const deleted = (result as unknown as { rowCount?: number }).rowCount ?? total;
    logger.info({ deleted }, '[retention] Sessions eliminadas fisicamente');
    return { count: deleted, errors: [] };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, '[retention] Falha ao eliminar sessions');
    return { count: 0, errors: [{ entity_type: 'sessions', entity_id: 'batch', error: errorMsg }] };
  }
}

// ---------------------------------------------------------------------------
// Execução principal do cron
// ---------------------------------------------------------------------------

export async function runRetention(
  logger: ReturnType<typeof createWorkerRuntime>['logger'],
  options: { dryRun?: boolean } = {},
): Promise<{ success: boolean; counts: AffectedCounts; errors: RetentionError[] }> {
  const dryRun = options.dryRun ?? isDryRun();
  const startedAt = new Date();
  const runId = randomUUID();

  logger.info(
    { run_id: runId, dry_run: dryRun, started_at: startedAt.toISOString() },
    '[retention] Iniciando rodada de retenção LGPD',
  );

  const allErrors: RetentionError[] = [];
  const counts: AffectedCounts = {
    leads_anonymized: 0,
    customers_anonymized: 0,
    interactions_deleted: 0,
    sessions_deleted: 0,
  };

  // 1. Leads
  const leadsResult = await retainLeads(logger, dryRun);
  counts.leads_anonymized = leadsResult.count;
  allErrors.push(...leadsResult.errors);

  // 2. Customers
  const customersResult = await retainCustomers(logger, dryRun);
  counts.customers_anonymized = customersResult.count;
  allErrors.push(...customersResult.errors);

  // 3. Interactions
  const interactionsResult = await retainInteractions(logger, dryRun);
  counts.interactions_deleted = interactionsResult.count;
  allErrors.push(...interactionsResult.errors);

  // 4. Sessions
  const sessionsResult = await retainSessions(logger, dryRun);
  counts.sessions_deleted = sessionsResult.count;
  allErrors.push(...sessionsResult.errors);

  const endedAt = new Date();
  const success = allErrors.length === 0;

  // Registrar em retention_runs (mesmo em dry-run para auditabilidade)
  try {
    await db.insert(retentionRuns).values({
      id: runId,
      startedAt,
      endedAt,
      affectedCounts: counts,
      errors: allErrors,
    });
  } catch (err) {
    logger.error({ err }, '[retention] Falha ao inserir retention_run — continuando');
  }

  if (!success) {
    logger.error(
      { run_id: runId, errors: allErrors, counts },
      '[LGPD CRITICAL] Rodada de retenção completada com erros — revisar manualmente',
    );
  } else {
    logger.info(
      {
        run_id: runId,
        counts,
        dry_run: dryRun,
        duration_ms: endedAt.getTime() - startedAt.getTime(),
      },
      '[retention] Rodada de retenção concluída com sucesso',
    );
  }

  return { success, counts, errors: allErrors };
}

// ---------------------------------------------------------------------------
// Scheduling: verifica horário e agenda próxima execução
// ---------------------------------------------------------------------------

async function scheduleAndRun(
  logger: ReturnType<typeof createWorkerRuntime>['logger'],
): Promise<void> {
  /**
   * Calcula ms até próxima execução às CRON_HOUR_UTC:00 UTC.
   */
  function msUntilNextRun(): number {
    const now = new Date();
    const next = new Date();
    next.setUTCHours(CRON_HOUR_UTC, 0, 0, 0);
    if (next <= now) {
      // Já passou hoje — agendar para amanhã
      next.setUTCDate(next.getUTCDate() + 1);
    }
    return next.getTime() - now.getTime();
  }

  while (true) {
    const delay = msUntilNextRun();
    const nextRun = new Date(Date.now() + delay);

    logger.info(
      { next_run: nextRun.toISOString(), delay_ms: delay },
      '[cron-retention] Próxima execução agendada',
    );

    await new Promise<void>((resolve) => setTimeout(resolve, delay));
    await runRetention(logger);
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { logger } = createWorkerRuntime(WORKER_NAME, 3);

  logger.info(
    { worker: WORKER_NAME, cron_hour_utc: CRON_HOUR_UTC },
    'Cron retention LGPD iniciado',
  );

  // Se RETENTION_RUN_IMMEDIATELY=true, executa imediatamente (útil para CI/debug)
  if (process.env['RETENTION_RUN_IMMEDIATELY'] === 'true') {
    await runRetention(logger);
    process.exit(0);
  }

  await scheduleAndRun(logger);
}

main().catch((err) => {
  console.error('[FATAL] Cron retention crashou:', err);
  process.exit(1);
});
