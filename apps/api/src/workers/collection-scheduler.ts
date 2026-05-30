// =============================================================================
// workers/collection-scheduler.ts — Worker periódico de agendamento de cobranças (F5-S07).
//
// Processo Node.js SEPARADO. Iniciado via: pnpm --filter @elemento/api worker:collection
//
// Responsabilidade:
//   Para cada tick, percorre todas as collection_rules com is_active=true e,
//   para cada regra, identifica as payment_dues que satisfazem o trigger_type.
//   Se os gates de feature flag passarem, insere collection_jobs.
//
// Flag-gating em 2 camadas (triple-gate com is_active):
//   Camada 1 — billing.enabled=disabled:
//     Worker sai cedo (skip total). Nenhuma query de regras ou parcelas executada.
//   Camada 2 — billing.scheduler.enabled=disabled:
//     Lógica roda completa (identifica parcelas elegíveis, calcula idempotency_key),
//     mas NÃO executa o INSERT. Loga dry_run=true por regra para auditoria.
//
// Trigger types suportados:
//   'days_before_due': parcelas com status='pending' cujo due_date = today + abs(wait_hours)/24.
//                      wait_hours negativo (ex: -72 → D-3 dias antes do vencimento).
//   'days_after_due':  parcelas com status='overdue' cujo due_date = today - wait_hours/24.
//                      wait_hours positivo (ex: 168 → D+7 dias após o vencimento).
//
// Idempotência:
//   idempotency_key = "<due_date>:<rule_key>" garante 1 job por parcela/regra/ciclo.
//   INSERT ... ON CONFLICT (payment_due_id, rule_id, idempotency_key) DO NOTHING.
//
// LGPD §8.5:
//   Worker manipula apenas IDs opacos + timestamps + dados financeiros de negócio.
//   Nenhum PII (nome, telefone, CPF) é lido ou logado.
//   customer_id e payment_due_id são IDs opacos (não identificam pessoa por si só).
// =============================================================================
import { and, eq } from 'drizzle-orm';

import { env } from '../config/env.js';
import { db as defaultDb } from '../db/client.js';
import type { Database } from '../db/client.js';
import { collectionJobs, collectionRules, paymentDues } from '../db/schema/index.js';
import type { CollectionRule } from '../db/schema/index.js';
import { isFlagEnabled } from '../modules/featureFlags/service.js';

import { createWorkerRuntime } from './_runtime.js';

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

const WORKER_NAME = 'collection-scheduler';

/** Intervalo padrão do tick em ms. */
const DEFAULT_TICK_MS = 60_000;

function getTickMs(): number {
  return env.FOLLOWUP_SCHEDULER_TICK_MS ?? DEFAULT_TICK_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Idempotência
// ---------------------------------------------------------------------------

/**
 * Monta a idempotency_key canônica para um job de cobrança.
 * Formato: "<due_date>:<rule_key>"
 * Ex: "2026-06-15:d7" → job D+7 para parcela com due_date=2026-06-15.
 */
export function buildCollectionIdempotencyKey(dueDate: string, ruleKey: string): string {
  return `${dueDate}:${ruleKey}`;
}

// ---------------------------------------------------------------------------
// Cálculo do threshold de data para queries
// ---------------------------------------------------------------------------

/**
 * Calcula a data alvo (YYYY-MM-DD) para uma regra dado o dia atual.
 *
 * Para 'days_before_due' (wait_hours negativo, ex: -72):
 *   target = today + abs(wait_hours) / 24 days
 *   Ex: wait_hours=-72 → target = today + 3 dias (parcelas que vencem em 3 dias)
 *
 * Para 'days_after_due' (wait_hours positivo, ex: 168):
 *   target = today - wait_hours / 24 days
 *   Ex: wait_hours=168 → target = today - 7 dias (parcelas que venceram há 7 dias)
 *
 * NOTA: wait_hours pode ser 0 para D+0 (vencimento no dia de hoje).
 */
export function calcTargetDate(rule: CollectionRule, now: Date = new Date()): string {
  const dayOffsetMs =
    rule.triggerType === 'days_before_due'
      ? Math.abs(rule.waitHours) * 60 * 60 * 1000
      : -rule.waitHours * 60 * 60 * 1000;

  const targetDate = new Date(now.getTime() + dayOffsetMs);
  return targetDate.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

export interface EligibleDue {
  paymentDueId: string;
  organizationId: string;
  dueDate: string;
}

export interface RuleTickResult {
  ruleKey: string;
  duesMatched: number;
  jobsCreated: number;
  dryRun: boolean;
}

// ---------------------------------------------------------------------------
// Logger interface mínima
// ---------------------------------------------------------------------------

export interface SchedulerLogger {
  info(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

// ---------------------------------------------------------------------------
// Queries — encontrar parcelas elegíveis para uma regra
// ---------------------------------------------------------------------------

/**
 * Encontra payment_dues elegíveis para uma regra.
 *
 * Para 'days_before_due':
 *   status='pending' AND due_date = targetDate
 * Para 'days_after_due':
 *   status='overdue' AND due_date = targetDate
 *
 * appliesToStatus da regra refina ainda mais o filtro se definido.
 *
 * LGPD §8.5: retorna apenas IDs opacos + due_date. Sem PII bruta.
 */
export async function findEligibleDues(
  database: Database,
  rule: CollectionRule,
  targetDate: string,
): Promise<EligibleDue[]> {
  // Status padrão por trigger_type: regra sem appliesToStatus usa default semântico
  const defaultStatus =
    rule.triggerType === 'days_before_due' ? ('pending' as const) : ('overdue' as const);
  const targetStatus = rule.appliesToStatus ?? defaultStatus;

  const rows = await database
    .select({
      paymentDueId: paymentDues.id,
      organizationId: paymentDues.organizationId,
      dueDate: paymentDues.dueDate,
    })
    .from(paymentDues)
    .where(
      and(
        eq(paymentDues.organizationId, rule.organizationId),
        eq(paymentDues.status, targetStatus),
        // due_date é tipo date no Postgres — comparar como text 'YYYY-MM-DD'
        eq(paymentDues.dueDate, targetDate),
      ),
    );

  return rows;
}

// ---------------------------------------------------------------------------
// Processamento de uma regra
// ---------------------------------------------------------------------------

/**
 * Processa uma regra em um tick do scheduler.
 *
 * @param database   Instância Drizzle (injetável para testes).
 * @param rule       Regra ativa a processar.
 * @param dryRun     Se true, loga mas não insere.
 */
export async function processCollectionRule(
  database: Database,
  rule: CollectionRule,
  dryRun: boolean,
): Promise<RuleTickResult> {
  const targetDate = calcTargetDate(rule);
  const eligibleDues = await findEligibleDues(database, rule, targetDate);

  const duesMatched = eligibleDues.length;
  let jobsCreated = 0;

  if (!dryRun && duesMatched > 0) {
    const scheduledAt = new Date();

    for (const due of eligibleDues) {
      const idempotencyKey = buildCollectionIdempotencyKey(due.dueDate, rule.key);

      // INSERT individual com ON CONFLICT DO NOTHING (idempotência garantida pelo unique index).
      // Performance aceitável para carteira do Banco do Povo (max ~500 parcelas/tick por regra).
      const result = await database
        .insert(collectionJobs)
        .values({
          organizationId: due.organizationId,
          paymentDueId: due.paymentDueId,
          ruleId: rule.id,
          scheduledAt,
          status: 'scheduled',
          attemptCount: 0,
          idempotencyKey,
        })
        .onConflictDoNothing()
        .returning({ id: collectionJobs.id });

      if (result.length > 0) {
        jobsCreated++;
      }
    }
  }

  return { ruleKey: rule.key, duesMatched, jobsCreated, dryRun };
}

// ---------------------------------------------------------------------------
// Tick principal
// ---------------------------------------------------------------------------

/**
 * Executa um tick do collection-scheduler:
 *   1. Verifica flag billing.enabled → sai cedo se disabled.
 *   2. Verifica flag billing.scheduler.enabled → define dryRun.
 *   3. Carrega todas as regras ativas.
 *   4. Para cada regra, chama processCollectionRule().
 *   5. Loga resultado estruturado por regra.
 *
 * @param database  Instância Drizzle (injetável para testes).
 * @param logger    Logger Pino do worker.
 */
export async function runCollectionSchedulerTick(
  database: Database,
  logger: SchedulerLogger,
): Promise<RuleTickResult[]> {
  // -------------------------------------------------------------------------
  // Camada 1: billing.enabled — gate total.
  // -------------------------------------------------------------------------
  const { enabled: billingEnabled } = await isFlagEnabled(database, 'billing.enabled');
  if (!billingEnabled) {
    logger.debug(
      { event: 'collection_scheduler.skipped', flag: 'billing.enabled' },
      'billing.enabled=disabled — tick ignorado',
    );
    return [];
  }

  // -------------------------------------------------------------------------
  // Camada 2: billing.scheduler.enabled — gate de escrita (dry-run).
  // -------------------------------------------------------------------------
  const { enabled: schedulerEnabled } = await isFlagEnabled(database, 'billing.scheduler.enabled');
  const dryRun = !schedulerEnabled;

  if (dryRun) {
    logger.info(
      { event: 'collection_scheduler.dry_run', flag: 'billing.scheduler.enabled' },
      'billing.scheduler.enabled=disabled — tick em dry-run (sem inserts)',
    );
  }

  // -------------------------------------------------------------------------
  // Carregar todas as regras ativas (multi-tenant).
  // -------------------------------------------------------------------------
  const activeRules = await database
    .select()
    .from(collectionRules)
    .where(eq(collectionRules.isActive, true));

  if (activeRules.length === 0) {
    logger.debug(
      { event: 'collection_scheduler.no_active_rules' },
      'nenhuma regra de cobrança ativa encontrada',
    );
    return [];
  }

  // -------------------------------------------------------------------------
  // Processar cada regra
  // -------------------------------------------------------------------------
  const results: RuleTickResult[] = [];

  for (const rule of activeRules) {
    try {
      const result = await processCollectionRule(database, rule, dryRun);
      results.push(result);

      logger.info(
        {
          event: 'collection_scheduler.rule_processed',
          rule_key: result.ruleKey,
          dues_matched: result.duesMatched,
          jobs_created: result.jobsCreated,
          dry_run: result.dryRun,
        },
        `regra ${result.ruleKey}: ${String(result.duesMatched)} parcelas elegíveis, ${String(result.jobsCreated)} jobs criados`,
      );
    } catch (err: unknown) {
      logger.error(
        {
          event: 'collection_scheduler.rule_error',
          rule_id: rule.id,
          rule_key: rule.key,
          err: { message: err instanceof Error ? err.message : String(err) },
        },
        `erro ao processar regra ${rule.key} — continuando com próxima`,
      );
      // Falha de 1 regra não deve parar o tick para as demais.
    }
  }

  const totalDues = results.reduce((acc, r) => acc + r.duesMatched, 0);
  const totalJobs = results.reduce((acc, r) => acc + r.jobsCreated, 0);

  logger.info(
    {
      event: 'collection_scheduler.tick_complete',
      rules_processed: results.length,
      total_dues_matched: totalDues,
      total_jobs_created: totalJobs,
      dry_run: dryRun,
    },
    `tick concluído: ${String(results.length)} regras, ${String(totalDues)} parcelas, ${String(totalJobs)} jobs`,
  );

  return results;
}

// ---------------------------------------------------------------------------
// Main — loop periódico
// ---------------------------------------------------------------------------

const runtime = createWorkerRuntime(WORKER_NAME);

export { runtime as _workerRuntime };

async function main(): Promise<void> {
  const tickMs = getTickMs();
  runtime.logger.info({ tick_ms: tickMs }, 'collection-scheduler iniciado');

  while (!runtime.isShuttingDown()) {
    try {
      await runCollectionSchedulerTick(defaultDb, runtime.logger);
    } catch (err: unknown) {
      runtime.logger.error(
        { err: { message: err instanceof Error ? err.message : String(err) } },
        'collection-scheduler: erro inesperado no tick',
      );
    }
    await sleep(tickMs);
  }
}

// Guard: só executar main() quando rodado diretamente
if (process.argv[1] !== undefined && process.argv[1].includes('collection-scheduler')) {
  main().catch((err: unknown) => {
    runtime.logger.fatal(
      { err: { message: err instanceof Error ? err.message : String(err) } },
      'collection-scheduler: falha fatal',
    );
    process.exit(1);
  });
}
