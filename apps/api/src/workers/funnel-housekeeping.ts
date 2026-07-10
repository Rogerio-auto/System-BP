// funnel-housekeeping.ts -- F25-S05
// Worker de housekeeping do funil: estagnacao + abandono reversivel.
// Gate: internal_assistant.actions.enabled
// Config: ai_funnel_settings por org (stagnant_after_days/abandon_after_days)
// LGPD: apenas IDs opacos. Sem PII.
import { and, eq, inArray, isNull, lt, notInArray, sql } from 'drizzle-orm';

import { env } from '../config/env.js';
import { db as defaultDb } from '../db/client.js';
import type { Database } from '../db/client.js';
import {
  aiFunnelSettings,
  eventOutbox,
  kanbanCards,
  kanbanStages,
  leads,
} from '../db/schema/index.js';
import { emit } from '../events/emit.js';
import type { DrizzleTx } from '../events/emit.js';
import { auditLog } from '../lib/audit.js';
import type { AuditTx } from '../lib/audit.js';
import { requireFlag } from '../lib/featureFlags.js';

import { createWorkerRuntime } from './_runtime.js';

const WORKER_NAME = 'funnel-housekeeping';
const DEFAULT_TICK_MS = 24 * 60 * 60 * 1_000;
function getTickMs() {
  return env.FOLLOWUP_SCHEDULER_TICK_MS ?? DEFAULT_TICK_MS;
}
function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
const ELIGIBLE_CANONICAL_ROLES = ['pre_atendimento', 'simulacao'] as const;
const TERMINAL_STATUSES = ['closed_won', 'closed_lost', 'archived'] as const;

// Chaves de bucket diario: idempotencyKey unica por lead+dia para o outbox (onConflictDoNothing).
function buildStagnantKey(leadId: string, dayBucket: string) {
  return 'funnel-stagnant:' + leadId + ':' + dayBucket;
}
function buildAbandonKey(leadId: string, dayBucket: string) {
  return 'funnel-abandon:' + leadId + ':' + dayBucket;
}
function getDayBucket(now: Date = new Date()) {
  return now.toISOString().slice(0, 10);
}

interface StagnantLead {
  leadId: string;
  orgId: string;
  cityId: string | null;
  stageId: string;
  cardId: string;
  canonicalRole: string;
  daysSinceUpdate: number;
}

async function processStagnant(db: Database, lead: StagnantLead, dayBucket: string): Promise<void> {
  // idempotencyKey unica por lead+dia: onConflictDoNothing no outbox garante idempotencia.
  const idempotencyKey = buildStagnantKey(lead.leadId, dayBucket);
  await db.transaction(async (tx) => {
    // Pre-checagem: se o outbox ja tem esta idempotencyKey, e um tick repetido
    // no mesmo dia (restart do worker, trigger manual, sobreposicao de
    // agendamento) -- pula emit E audit para nao inflar audit_logs (F25-S10).
    const existing = await tx
      .select({ id: eventOutbox.id })
      .from(eventOutbox)
      .where(
        and(
          eq(eventOutbox.organizationId, lead.orgId),
          eq(eventOutbox.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (existing.length > 0) return;

    await emit(
      tx as unknown as DrizzleTx,
      {
        eventName: 'leads.stagnant',
        aggregateType: 'lead',
        aggregateId: lead.leadId,
        organizationId: lead.orgId,
        idempotencyKey,
        actor: { kind: 'worker', id: 'funnel-housekeeping', ip: null },
        data: {
          lead_id: lead.leadId,
          organization_id: lead.orgId,
          canonical_role: lead.canonicalRole,
          stage_id: lead.stageId,
          card_id: lead.cardId,
          stagnant_days: lead.daysSinceUpdate,
        },
      },
      { onConflictDoNothing: true },
    );
    await auditLog(tx as unknown as AuditTx, {
      organizationId: lead.orgId,
      // type: 'ai' explícito (F25-S11) -- intenção clara, não depende só da
      // heurística de role==='ai' em lib/audit.ts.
      actor: { userId: null, role: 'ai', type: 'ai' },
      action: 'leads.stagnant',
      resource: { type: 'lead', id: lead.leadId },
      after: { stagnant_days: lead.daysSinceUpdate },
    });
  });
}

async function processAbandon(db: Database, lead: StagnantLead, dayBucket: string): Promise<void> {
  // idempotencyKey unica por lead+dia: onConflictDoNothing no outbox garante idempotencia.
  const idempotencyKey = buildAbandonKey(lead.leadId, dayBucket);
  await db.transaction(async (tx) => {
    // Pre-checagem: mesma logica de processStagnant (F25-S10). O lead.abandoned
    // ja saia da elegibilidade apos o 1o tick (status vira terminal), mas a
    // pre-checagem mantem os dois caminhos consistentes e cobre a janela entre
    // o UPDATE de status e a proxima leitura de elegibilidade.
    const existingAbandon = await tx
      .select({ id: eventOutbox.id })
      .from(eventOutbox)
      .where(
        and(
          eq(eventOutbox.organizationId, lead.orgId),
          eq(eventOutbox.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (existingAbandon.length > 0) return;

    // sql justificado: atualizacao atomica de jsonb sem sobrescrever outros campos.
    const outcomeSql = sql`jsonb_set(COALESCE(metadata, '{}'::jsonb), '{outcome}', '"abandonado"')`; // as justificado: sql<unknown> compativel com jsonb
    await tx
      .update(leads)
      .set({
        status: 'closed_lost',
        metadata: outcomeSql as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(leads.id, lead.leadId),
          eq(leads.organizationId, lead.orgId),
          notInArray(leads.status, [...TERMINAL_STATUSES]),
        ),
      );
    await emit(
      tx as unknown as DrizzleTx,
      {
        eventName: 'leads.abandoned',
        aggregateType: 'lead',
        aggregateId: lead.leadId,
        organizationId: lead.orgId,
        idempotencyKey,
        actor: { kind: 'worker', id: 'funnel-housekeeping', ip: null },
        data: {
          lead_id: lead.leadId,
          organization_id: lead.orgId,
          reason: 'no_progress',
          card_id: lead.cardId,
        },
      },
      { onConflictDoNothing: true },
    );
    await auditLog(tx as unknown as AuditTx, {
      organizationId: lead.orgId,
      // type: 'ai' explícito (F25-S11) -- intenção clara, não depende só da
      // heurística de role==='ai' em lib/audit.ts.
      actor: { userId: null, role: 'ai', type: 'ai' },
      action: 'leads.abandoned',
      resource: { type: 'lead', id: lead.leadId },
      before: { status: 'active' },
      after: { status: 'closed_lost', outcome: 'abandonado' },
    });
  });
}

interface OrgSettings {
  organizationId: string;
  stagnantAfterDays: number;
  abandonAfterDays: number;
}

async function findEligibleLeads(
  db: Database,
  orgSettings: OrgSettings,
  now: Date,
): Promise<StagnantLead[]> {
  const stagnantCutoff = new Date(
    now.getTime() - orgSettings.stagnantAfterDays * 24 * 60 * 60 * 1_000,
  );
  const rows = await db
    .select({
      leadId: leads.id,
      orgId: leads.organizationId,
      cityId: leads.cityId,
      stageId: kanbanCards.stageId,
      cardId: kanbanCards.id,
      canonicalRole: kanbanStages.canonicalRole,
      updatedAt: leads.updatedAt,
    })
    .from(leads)
    .innerJoin(kanbanCards, eq(kanbanCards.leadId, leads.id))
    .innerJoin(kanbanStages, eq(kanbanCards.stageId, kanbanStages.id))
    .where(
      and(
        eq(leads.organizationId, orgSettings.organizationId),
        inArray(kanbanStages.canonicalRole, [...ELIGIBLE_CANONICAL_ROLES]),
        notInArray(leads.status, [...TERMINAL_STATUSES]),
        isNull(leads.deletedAt),
        lt(leads.updatedAt, stagnantCutoff),
      ),
    );
  return rows.map((r) => ({
    leadId: r.leadId,
    orgId: r.orgId,
    cityId: r.cityId ?? null,
    stageId: r.stageId,
    cardId: r.cardId,
    canonicalRole: r.canonicalRole ?? 'pre_atendimento',
    daysSinceUpdate: Math.floor((now.getTime() - r.updatedAt.getTime()) / (24 * 60 * 60 * 1_000)),
  }));
}

export interface FunnelHousekeepingResult {
  orgsProcessed: number;
  stagnantEmitted: number;
  abandonedEmitted: number;
}

export async function runFunnelHousekeepingTick(
  db: Database = defaultDb,
): Promise<FunnelHousekeepingResult> {
  const orgSettings = await db
    .select()
    .from(aiFunnelSettings)
    .where(eq(aiFunnelSettings.enabled, true));
  if (orgSettings.length === 0)
    return { orgsProcessed: 0, stagnantEmitted: 0, abandonedEmitted: 0 };

  const now = new Date();
  const dayBucket = getDayBucket(now);
  let stagnantEmitted = 0;
  let abandonedEmitted = 0;

  for (const settings of orgSettings) {
    try {
      const eligibleLeads = await findEligibleLeads(db, settings, now);
      for (const lead of eligibleLeads) {
        try {
          if (lead.daysSinceUpdate >= settings.abandonAfterDays) {
            await processAbandon(db, lead, dayBucket);
            abandonedEmitted++;
          } else {
            await processStagnant(db, lead, dayBucket);
            stagnantEmitted++;
          }
        } catch {
          /* isolado */
        }
      }
    } catch {
      /* isolado */
    }
  }

  return { orgsProcessed: orgSettings.length, stagnantEmitted, abandonedEmitted };
}

if (process.argv[1] !== undefined && process.argv[1].includes('funnel-housekeeping')) {
  const { logger, db, onShutdown } = createWorkerRuntime(WORKER_NAME);
  let running = true;
  onShutdown(async () => {
    running = false;
  });
  logger.info({ worker: WORKER_NAME }, 'worker iniciado');
  void (async () => {
    while (running) {
      const flagEnabled = await requireFlag(db, 'internal_assistant.actions.enabled', logger);
      if (!flagEnabled) {
        logger.info({ flag: 'internal_assistant.actions.enabled' }, 'flag off');
        await sleep(getTickMs());
        continue;
      }
      try {
        const r = await runFunnelHousekeepingTick(db);
        logger.info(r, 'tick');
      } catch (err: unknown) {
        logger.error({ err }, 'erro');
      }
      await sleep(getTickMs());
    }
    logger.info('encerrando');
    process.exit(0);
  })();
}
