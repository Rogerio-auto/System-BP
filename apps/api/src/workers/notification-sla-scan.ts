// notification-sla-scan.ts -- F24-S07
import type { NotificationCategory } from '@elemento/shared-schemas';
import { and, eq } from 'drizzle-orm';

import { env } from '../config/env.js';
import { db as defaultDb } from '../db/client.js';
import type { Database } from '../db/client.js';
import { notificationRuleDeliveries, notificationRules } from '../db/schema/index.js';
import { requireFlag } from '../lib/featureFlags.js';
import { resolveRuleRecipients } from '../modules/notification-rules/recipients.js';
import { findSlaSources } from '../modules/notification-rules/sla-sources.js';
import { isCategoryChannelEnabled } from '../modules/notifications/repository.js';
import { sendEmail } from '../modules/notifications/senders/email.js';
import { sendInApp } from '../modules/notifications/senders/inApp.js';

import { createWorkerRuntime } from './_runtime.js';

const WORKER_NAME = 'notification-sla-scan';
const DEFAULT_TICK_MS = 60 * 60 * 1_000;

/**
 * Subconjunto de Database realmente exercitado por este worker (select + insert
 * — nunca transaction/query/$with). Permite tipar mocks de teste com o tipo
 * correto (Pick<Database, ...>), sem `as unknown as Database`. Onde o `db`
 * precisa satisfazer um parâmetro `Database` completo de outro módulo
 * (recipients.ts, notifications/repository.ts, senders/*), usamos `db as
 * Database` — cast direto justificado (SlaScanDb é assignable DE Database,
 * então o cast reverso é seguro; a implementação real (defaultDb) sempre
 * satisfaz o tipo completo).
 */
export type SlaScanDb = Pick<Database, 'select' | 'insert'>;

/**
 * Logger mínimo injetável (compatível estruturalmente com pino.Logger).
 * Usado para deixar rastreável a supressão fail-closed de city_scope
 * (F24-S16 hardening) — sem isso, "por que esse handoff sem lead não
 * notificou" vira outro silêncio indetectável.
 */
export interface SlaScanLogger {
  warn(obj: object, msg?: string): void;
}

const noopLogger: SlaScanLogger = {
  warn: () => {
    /* no-op — logger não fornecido (ex: chamada direta em teste) */
  },
};

function getTickMs(): number {
  return env.FOLLOWUP_SCHEDULER_TICK_MS ?? DEFAULT_TICK_MS;
}
function sleep(ms: number): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, ms));
}

type RuleChannel = 'in_app' | 'email';

export function buildSlaBucket(
  ruleId: string,
  cooldownHours: number,
  now: Date = new Date(),
): string {
  const epochHours = Math.floor(now.getTime() / (1_000 * 60 * 60));
  const windowSlot = cooldownHours > 0 ? Math.floor(epochHours / cooldownHours) : epochHours;
  return 'sla:' + ruleId + ':' + String(windowSlot);
}

function renderTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    const v = context[key];
    return v === undefined || v === null ? '{{' + key + '}}' : String(v);
  });
}

async function hasDelivery(
  db: Pick<Database, 'select'>,
  ruleId: string,
  entityType: string,
  entityId: string,
  bucket: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: notificationRuleDeliveries.id })
    .from(notificationRuleDeliveries)
    .where(
      and(
        eq(notificationRuleDeliveries.ruleId, ruleId),
        eq(notificationRuleDeliveries.entityType, entityType),
        eq(notificationRuleDeliveries.entityId, entityId),
        eq(notificationRuleDeliveries.bucket, bucket),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function recordDelivery(
  db: Pick<Database, 'insert'>,
  organizationId: string,
  ruleId: string,
  entityType: string,
  entityId: string,
  bucket: string,
): Promise<void> {
  await db
    .insert(notificationRuleDeliveries)
    .values({ organizationId, ruleId, entityType, entityId, bucket, firedAt: new Date() })
    .onConflictDoNothing();
}

async function dispatchToChannel(
  db: Database,
  channel: RuleChannel,
  params: {
    organizationId: string;
    userId: string;
    type: string;
    title: string;
    body: string;
    entityType: string;
    entityId: string;
  },
): Promise<boolean> {
  try {
    if (channel === 'in_app') {
      await sendInApp(db, {
        organizationId: params.organizationId,
        userId: params.userId,
        type: params.type,
        title: params.title,
        body: params.body,
        entityType: params.entityType,
        entityId: params.entityId,
      });
      return true;
    }
    if (channel === 'email') {
      await sendEmail(
        {
          organizationId: params.organizationId,
          userId: params.userId,
          recipientEmail: '',
          subject: params.title,
          body: params.body,
          eventType: 'sla:' + params.type,
        },
        db,
      );
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

interface ProcessSlaRuleOptions {
  db: SlaScanDb;
  rule: typeof notificationRules.$inferSelect;
  entityId: string;
  entityType: string;
  cityId: string | null;
  /**
   * Lead associado à entidade elegível (via SlaEligibleEntity.leadId),
   * usado apenas para resolver recipientMode='assignee'. Substitui a
   * checagem antiga `entityType === 'lead'` (F24-S16) — entityType agora
   * vem do catálogo por eixo (kanban_card, conversation, simulation, etc.)
   * e nunca mais é literalmente 'lead'.
   */
  leadId: string | null;
  bucket: string;
  logger: SlaScanLogger;
}

async function processSlaRule(opts: ProcessSlaRuleOptions): Promise<void> {
  const { db, rule, entityId, entityType, cityId, leadId, bucket, logger } = opts;
  if (await hasDelivery(db, rule.id, entityType, entityId, bucket)) return;
  const filters = rule.filters as Record<string, unknown> | null;
  const cityScope = Array.isArray(filters?.['city_scope'])
    ? (filters['city_scope'] as string[])
    : null;
  // Fail-closed (hardening pós-review F24-S16): regra com city_scope configurado
  // é uma decisão explícita de restringir. Se a entidade não tem cidade
  // resolvível (cityId null — ex: chatwoot_handoffs sem lead vinculado),
  // NÃO tratar como "sem restrição": resolveByRoleCity trataria cityId=null
  // como contexto global e faria broadcast pra org inteira, furando o
  // city_scope da regra (cross-city leak — CLAUDE.md regra #3).
  if (cityScope !== null) {
    if (cityId === null) {
      logger.warn(
        {
          rule_id: rule.id,
          trigger_key: rule.triggerKey,
          organization_id: rule.organizationId,
        },
        'sla-scan: notificação suprimida (fail-closed) — regra tem city_scope ' +
          'mas a entidade não tem cidade resolvível',
      );
      return;
    }
    if (!cityScope.includes(cityId)) return;
  }
  // as justificado: channels e text[] validado na borda HTTP; apenas 'in_app'|'email'.
  const ruleChannels = rule.channels as RuleChannel[];
  // as justificado: recipients.ts/notifications exigem Database completo; SlaScanDb
  // (Pick<Database,'select'|'insert'>) é assignable DE Database — cast reverso seguro,
  // a implementação real (defaultDb) sempre satisfaz o tipo completo.
  const fullDb = db as Database;
  const recipients = await resolveRuleRecipients(fullDb, {
    organizationId: rule.organizationId,
    recipientMode: rule.recipientMode,
    recipientRoles: rule.recipientRoles,
    channels: ruleChannels,
    cityId,
    leadId,
  });
  if (recipients.length === 0) return;
  const ctx: Record<string, unknown> = {
    entity_id: entityId,
    entity_type: entityType,
    city_id: cityId ?? '',
  };
  const renderedTitle = renderTemplate(rule.titleTemplate, ctx);
  const renderedBody = renderTemplate(rule.bodyTemplate, ctx);
  // as justificado: category validado no insert da regra pelo service.
  const category = rule.category as NotificationCategory;
  for (const recipient of recipients) {
    for (const channel of recipient.channels) {
      if (
        !(await isCategoryChannelEnabled(
          fullDb,
          recipient.organizationId,
          recipient.userId,
          channel,
          category,
        ))
      )
        continue;
      await dispatchToChannel(fullDb, channel, {
        organizationId: recipient.organizationId,
        userId: recipient.userId,
        type: 'sla:' + rule.triggerKey + ':' + rule.id,
        title: renderedTitle,
        body: renderedBody,
        entityType,
        entityId,
      });
    }
  }
  await recordDelivery(db, rule.organizationId, rule.id, entityType, entityId, bucket);
}

export async function runSlaScanTick(
  db: SlaScanDb = defaultDb,
  logger: SlaScanLogger = noopLogger,
): Promise<{ rulesProcessed: number; entitiesEligible: number }> {
  const activeRules = await db
    .select()
    .from(notificationRules)
    .where(
      and(
        eq(notificationRules.triggerKind, 'stage_inactivity'),
        eq(notificationRules.enabled, true),
      ),
    );
  if (activeRules.length === 0) return { rulesProcessed: 0, entitiesEligible: 0 };
  const now = new Date();
  let entitiesEligible = 0;
  for (const rule of activeRules) {
    const thresholdHours = rule.thresholdHours ?? 24;
    const cooldownHours = rule.cooldownHours > 0 ? rule.cooldownHours : 24;
    const bucket = buildSlaBucket(rule.id, cooldownHours, now);
    try {
      const entities = await findSlaSources(
        db,
        rule.organizationId,
        thresholdHours,
        rule.triggerKey,
      );
      entitiesEligible += entities.length;
      for (const entity of entities) {
        try {
          await processSlaRule({
            db,
            rule,
            entityId: entity.entityId,
            entityType: entity.entityType,
            cityId: entity.cityId,
            leadId: entity.leadId,
            bucket,
            logger,
          });
        } catch {
          /* isolado */
        }
      }
    } catch {
      /* isolado */
    }
  }
  return { rulesProcessed: activeRules.length, entitiesEligible };
}

if (process.argv[1] !== undefined && process.argv[1].includes('notification-sla-scan')) {
  const { logger, db, onShutdown } = createWorkerRuntime(WORKER_NAME);
  let running = true;
  onShutdown(async () => {
    running = false;
  });
  logger.info({ worker: WORKER_NAME }, 'worker iniciado');
  void (async () => {
    while (running) {
      const flagEnabled = await requireFlag(db, 'notifications.sla.enabled', logger);
      if (!flagEnabled) {
        logger.info({ flag: 'notifications.sla.enabled' }, 'flag desabilitada');
        await sleep(getTickMs());
        continue;
      }
      try {
        const r = await runSlaScanTick(db, logger);
        logger.info(r, 'sla-scan tick');
      } catch (err: unknown) {
        logger.error({ err }, 'erro no tick');
      }
      await sleep(getTickMs());
    }
    logger.info('worker encerrando');
    process.exit(0);
  })();
}
