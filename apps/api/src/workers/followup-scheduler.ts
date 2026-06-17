// =============================================================================
// workers/followup-scheduler.ts — Worker periódico de agendamento de follow-ups (F5-S02).
//
// Processo Node.js SEPARADO. Iniciado via: pnpm --filter @elemento/api worker:followup
//
// Responsabilidade:
//   Para cada tick, percorre todas as followup_rules com is_active=true e,
//   para cada regra, identifica os leads que satisfazem o trigger_type.
//   Se os gates de feature flag passarem, insere followup_jobs.
//
// Flag-gating em 2 camadas (triple-gate completo com is_active):
//   Camada 1 — followup.enabled=disabled:
//     Worker sai cedo (skip total). Nenhuma query de regras ou leads executada.
//   Camada 2 — followup.scheduler.enabled=disabled:
//     Lógica roda completa (identifica leads elegíveis, calcula idempotency_key),
//     mas NÃO executa o INSERT. Loga `dry_run=true` por regra para auditoria.
//
// Trigger types suportados:
//   'stage_inactivity': lead ficou em um kanban stage sem movimentação por
//                       wait_hours horas. Identificado via:
//                         kanban_cards.entered_stage_at < now() - wait_hours * interval '1 hour'
//                       + applies_to_stage (se não-null): kanban_stages.name == applies_to_stage
//                       + applies_to_outcome (se não-null): leads.metadata->>'outcome' == valor
//   'event_based': future use — consumer separado registra timestamp em coluna do lead.
//                  Aqui a lógica está parcialmente implementada como stub.
//
// Idempotência:
//   idempotency_key = "<rule_id>:<lead_id>:<day_bucket>" onde day_bucket é a
//   data UTC ISO (YYYY-MM-DD) do tick. Garante 1 job por regra/lead/dia.
//   INSERT ... ON CONFLICT (lead_id, rule_id, idempotency_key) DO NOTHING.
//
// Log estruturado por tick (por regra):
//   { rule_key, leads_matched, jobs_created, dry_run }
//
// LGPD §8.5:
//   Worker manipula apenas IDs opacos + timestamps + metadados de negócio.
//   Nenhum PII (nome, telefone, CPF, email) é lido ou logado.
//   metadata->>'outcome' é dado de negócio (não identificável por si só).
// =============================================================================
import { and, eq, isNull, lt, sql } from 'drizzle-orm';

import { env } from '../config/env.js';
import { db as defaultDb } from '../db/client.js';
import type { Database } from '../db/client.js';
import {
  followupJobs,
  followupRules,
  kanbanCards,
  kanbanStages,
  leads,
} from '../db/schema/index.js';
import type { FollowupRule } from '../db/schema/index.js';
import { resolveChannelForSend } from '../modules/channels/channel-selection.service.js';
import { isFlagEnabled } from '../modules/featureFlags/service.js';

import { createWorkerRuntime } from './_runtime.js';

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

const WORKER_NAME = 'followup-scheduler';

/** Intervalo padrão do tick em ms. Sobrescrito por FOLLOWUP_SCHEDULER_TICK_MS. */
const DEFAULT_TICK_MS = 60_000;

function getTickMs(): number {
  return env.FOLLOWUP_SCHEDULER_TICK_MS ?? DEFAULT_TICK_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Cálculo do day bucket
// ---------------------------------------------------------------------------

/**
 * Retorna a data UTC corrente no formato YYYY-MM-DD.
 * Usada como bucket diário de idempotência: 1 job por regra/lead/dia.
 */
export function getDayBucket(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Monta a idempotency_key canônica para um job de followup.
 * Formato: "<rule_id>:<lead_id>:<day_bucket>"
 */
export function buildIdempotencyKey(ruleId: string, leadId: string, dayBucket: string): string {
  return `${ruleId}:${leadId}:${dayBucket}`;
}

// ---------------------------------------------------------------------------
// Queries — encontrar leads elegíveis para uma regra
// ---------------------------------------------------------------------------

export interface EligibleLead {
  leadId: string;
  organizationId: string;
}

/**
 * Encontra leads elegíveis para uma regra trigger_type='stage_inactivity'.
 *
 * Critérios:
 *   1. Lead não está deletado (deleted_at IS NULL).
 *   2. Card do lead existe e entered_stage_at < now() - wait_hours * interval '1 hour'.
 *   3. Se applies_to_stage não-null: kanban_stages.name = applies_to_stage.
 *   4. Se applies_to_outcome não-null: leads.metadata->>'outcome' = applies_to_outcome.
 *   5. Escopo de org: mesmo organization_id da regra.
 *
 * LGPD §8.5: retorna apenas lead_id e organization_id (IDs opacos, sem PII).
 */
export async function findInactivityLeads(
  database: Database,
  rule: FollowupRule,
): Promise<EligibleLead[]> {
  // Threshold de inatividade como timestamp
  // Equivalente SQL: now() - wait_hours * interval '1 hour'
  const inactivityThreshold = new Date(Date.now() - rule.waitHours * 60 * 60 * 1000);

  // Subquery: IDs dos cards elegíveis (dentro do stage correto + inatividade)
  // Abordagem: JOIN kanban_cards + kanban_stages + leads em uma query
  const baseConditions = [
    eq(kanbanCards.organizationId, rule.organizationId),
    lt(kanbanCards.enteredStageAt, inactivityThreshold),
    isNull(leads.deletedAt),
  ];

  // Filtro por stage name (applies_to_stage)
  // Nota: applies_to_stage é o NAME do stage (não o ID), para flexibilidade.
  if (rule.appliesToStage !== null) {
    baseConditions.push(eq(kanbanStages.name, rule.appliesToStage));
  }

  const rows = await database
    .select({
      leadId: leads.id,
      organizationId: leads.organizationId,
      outcome: sql<string | null>`${leads.metadata}->>'outcome'`,
    })
    .from(kanbanCards)
    .innerJoin(kanbanStages, eq(kanbanCards.stageId, kanbanStages.id))
    .innerJoin(leads, eq(kanbanCards.leadId, leads.id))
    .where(and(...baseConditions));

  // Filtro por outcome em memória (metadata JSONB — filtrar app-side é mais seguro
  // contra índices faltantes em dev/staging e evita SQL injection em campos livres).
  if (rule.appliesToOutcome !== null) {
    return rows
      .filter((r) => r.outcome === rule.appliesToOutcome)
      .map((r) => ({ leadId: r.leadId, organizationId: r.organizationId }));
  }

  return rows.map((r) => ({ leadId: r.leadId, organizationId: r.organizationId }));
}

// ---------------------------------------------------------------------------
// Processamento de uma regra
// ---------------------------------------------------------------------------

export interface RuleTickResult {
  ruleKey: string;
  leadsMatched: number;
  jobsCreated: number;
  dryRun: boolean;
}

/**
 * Processa uma regra em um tick do scheduler.
 *
 * @param database  Instância Drizzle (injetável para testes).
 * @param rule      Regra ativa a processar.
 * @param dryRun    Se true, loga mas não insere (flag followup.scheduler.enabled=disabled).
 * @param dayBucket Bucket diário UTC (YYYY-MM-DD) para idempotency_key.
 * @param logger    Logger do worker (opcional — no-op em testes sem logger injetado).
 */
export async function processRule(
  database: Database,
  rule: FollowupRule,
  dryRun: boolean,
  dayBucket: string,
  logger?: SchedulerLogger,
): Promise<RuleTickResult> {
  let eligibleLeads: EligibleLead[] = [];

  if (rule.triggerType === 'stage_inactivity') {
    eligibleLeads = await findInactivityLeads(database, rule);
  } else {
    // 'event_based': consumer separado registra timestamp — stub para slot futuro.
    // Aqui retornamos lista vazia (sem leads elegíveis por este trigger).
    eligibleLeads = [];
  }

  const leadsMatched = eligibleLeads.length;
  let jobsCreated = 0;

  if (!dryRun && leadsMatched > 0) {
    // Resolver o canal da regra antes de entrar no loop de leads (1 chamada por regra).
    // Se a org não tiver canal ativo, `channelId` será null — o sender fará o fallback
    // novamente no momento do envio via resolveChannelForSend(db, org, null).
    const resolvedChannel = await resolveChannelForSend(
      database,
      rule.organizationId,
      rule.channelId,
    ).catch((err: unknown) => {
      logger?.warn(
        {
          event: 'scheduler.channel_not_resolved',
          rule_id: rule.id,
          rule_key: rule.key,
          organization_id: rule.organizationId,
          err: { message: err instanceof Error ? err.message : String(err) },
        },
        `regra ${rule.key}: canal não resolvido — jobs serão inseridos com channel_id=null`,
      );
      return null;
    });
    const channelIdToAssign = resolvedChannel?.channelId ?? null;

    // INSERT em lote com ON CONFLICT DO NOTHING (idempotência garantida pelo unique index).
    const scheduledAt = new Date();

    for (const lead of eligibleLeads) {
      const idempotencyKey = buildIdempotencyKey(rule.id, lead.leadId, dayBucket);

      // INSERT individual para capturar corretamente o DO NOTHING por item.
      // Alternativa em lote seria INSERT ... VALUES (...),(...) mas perderíamos
      // a contagem granular de jobs_created. Performance aceitável para MVP
      // (máximo ~100 leads por regra por tick em operação normal do Banco do Povo).
      const result = await database
        .insert(followupJobs)
        .values({
          organizationId: lead.organizationId,
          leadId: lead.leadId,
          ruleId: rule.id,
          channelId: channelIdToAssign,
          scheduledAt,
          status: 'scheduled',
          attemptCount: 0,
          idempotencyKey,
        })
        .onConflictDoNothing()
        .returning({ id: followupJobs.id });

      if (result.length > 0) {
        jobsCreated++;
      }
    }
  }

  return { ruleKey: rule.key, leadsMatched, jobsCreated, dryRun };
}

// ---------------------------------------------------------------------------
// Tick principal
// ---------------------------------------------------------------------------

/**
 * Executa um tick do scheduler:
 *   1. Verifica flag followup.enabled → sai cedo se disabled.
 *   2. Verifica flag followup.scheduler.enabled → define dryRun.
 *   3. Carrega todas as regras ativas da org.
 *   4. Para cada regra, chama processRule().
 *   5. Loga resultado estruturado por regra.
 *
 * @param database  Instância Drizzle (injetável para testes).
 * @param logger    Logger Pino do worker.
 * @param dayBucket Bucket diário (sobrecarregado em testes para controle de idempotência).
 * @returns Array de RuleTickResult (vazio se feature desabilitada).
 */
export async function runSchedulerTick(
  database: Database,
  logger: SchedulerLogger,
  dayBucket: string = getDayBucket(),
): Promise<RuleTickResult[]> {
  // -------------------------------------------------------------------------
  // Camada 1: followup.enabled — gate total.
  // Se disabled, worker não roda nenhuma query de regra/lead.
  // -------------------------------------------------------------------------
  const { enabled: followupEnabled } = await isFlagEnabled(database, 'followup.enabled');
  if (!followupEnabled) {
    logger.debug(
      { event: 'scheduler.skipped', flag: 'followup.enabled' },
      'followup.enabled=disabled — tick ignorado',
    );
    return [];
  }

  // -------------------------------------------------------------------------
  // Camada 2: followup.scheduler.enabled — gate de escrita (dry-run).
  // Se disabled, roda lógica mas não insere no banco.
  // -------------------------------------------------------------------------
  const { enabled: schedulerEnabled } = await isFlagEnabled(database, 'followup.scheduler.enabled');
  const dryRun = !schedulerEnabled;

  if (dryRun) {
    logger.info(
      { event: 'scheduler.dry_run', flag: 'followup.scheduler.enabled' },
      'followup.scheduler.enabled=disabled — tick em dry-run (sem inserts)',
    );
  }

  // -------------------------------------------------------------------------
  // Carregar todas as regras ativas (qualquer organização).
  // O scheduler é multi-tenant: processa regras de todas as orgs por tick.
  // -------------------------------------------------------------------------
  const activeRules = await database
    .select()
    .from(followupRules)
    .where(eq(followupRules.isActive, true));

  if (activeRules.length === 0) {
    logger.debug({ event: 'scheduler.no_active_rules' }, 'nenhuma regra ativa encontrada');
    return [];
  }

  // -------------------------------------------------------------------------
  // Processar cada regra
  // -------------------------------------------------------------------------
  const results: RuleTickResult[] = [];

  for (const rule of activeRules) {
    try {
      const result = await processRule(database, rule, dryRun, dayBucket, logger);
      results.push(result);

      logger.info(
        {
          event: 'scheduler.rule_processed',
          rule_key: result.ruleKey,
          leads_matched: result.leadsMatched,
          jobs_created: result.jobsCreated,
          dry_run: result.dryRun,
        },
        `regra ${result.ruleKey}: ${result.leadsMatched} leads elegíveis, ${result.jobsCreated} jobs criados`,
      );
    } catch (err: unknown) {
      logger.error(
        { event: 'scheduler.rule_error', rule_id: rule.id, rule_key: rule.key, err },
        `erro ao processar regra ${rule.key} — continuando com próxima`,
      );
      // Não propaga: falha de 1 regra não deve parar o tick para as demais.
    }
  }

  const totalLeads = results.reduce((acc, r) => acc + r.leadsMatched, 0);
  const totalJobs = results.reduce((acc, r) => acc + r.jobsCreated, 0);

  logger.info(
    {
      event: 'scheduler.tick_complete',
      rules_processed: results.length,
      total_leads_matched: totalLeads,
      total_jobs_created: totalJobs,
      dry_run: dryRun,
    },
    `tick concluído: ${results.length} regras, ${totalLeads} leads, ${totalJobs} jobs`,
  );

  return results;
}

// ---------------------------------------------------------------------------
// Logger interface mínima
// ---------------------------------------------------------------------------

/**
 * Interface mínima de logger aceita por runSchedulerTick.
 * Compatível com pino.Logger e com mocks de teste.
 * Evita poluição do tipo com os 20+ campos internos do pino.Logger<never,boolean>.
 */
export interface SchedulerLogger {
  info(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

// ---------------------------------------------------------------------------
// Main — loop periódico
// ---------------------------------------------------------------------------

const runtime = createWorkerRuntime(WORKER_NAME);

export { runtime as _workerRuntime };

async function main(): Promise<void> {
  const tickMs = getTickMs();
  runtime.logger.info({ tick_ms: tickMs }, 'followup-scheduler iniciado');

  // Usa o db singleton de db/client.js (compatível com Database) em vez de runtime.db
  // (que usa um pool dedicado com tipo NodePgClient incompatível com exactOptionalPropertyTypes).
  while (!runtime.isShuttingDown()) {
    try {
      await runSchedulerTick(defaultDb, runtime.logger);
    } catch (err: unknown) {
      runtime.logger.error({ err }, 'followup-scheduler: erro inesperado no tick');
    }
    await sleep(tickMs);
  }
}

// Guard: só executar main() quando rodado diretamente
if (process.argv[1] !== undefined && process.argv[1].includes('followup-scheduler')) {
  main().catch((err: unknown) => {
    runtime.logger.fatal({ err }, 'followup-scheduler: falha fatal');
    process.exit(1);
  });
}
