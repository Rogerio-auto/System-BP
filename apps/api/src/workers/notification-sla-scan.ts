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
  db: Database,
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
  db: Database,
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
  db: Database;
  rule: typeof notificationRules.$inferSelect;
  entityId: string;
  entityType: string;
  cityId: string | null;
  bucket: string;
}

async function processSlaRule(opts: ProcessSlaRuleOptions): Promise<void> {
  const { db, rule, entityId, entityType, cityId, bucket } = opts;
  if (await hasDelivery(db, rule.id, entityType, entityId, bucket)) return;
  const filters = rule.filters as Record<string, unknown> | null;
  const cityScope = Array.isArray(filters?.['city_scope'])
    ? (filters['city_scope'] as string[])
    : null;
  if (cityScope !== null && cityId !== null && !cityScope.includes(cityId)) return;
  // as justificado: channels e text[] validado na borda HTTP; apenas 'in_app'|'email'.
  const ruleChannels = rule.channels as RuleChannel[];
  const recipients = await resolveRuleRecipients(db, {
    organizationId: rule.organizationId,
    recipientMode: rule.recipientMode,
    recipientRoles: rule.recipientRoles,
    channels: ruleChannels,
    cityId,
    leadId: entityType === 'lead' ? entityId : null,
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
          db,
          recipient.organizationId,
          recipient.userId,
          channel,
          category,
        ))
      )
        continue;
      await dispatchToChannel(db, channel, {
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
  db: Database = defaultDb,
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
            bucket,
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
        const r = await runSlaScanTick(db);
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
