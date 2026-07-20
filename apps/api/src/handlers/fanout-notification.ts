// =============================================================================
// handlers/fanout-notification.ts — Handler de fan-out rules-driven (F24-S06).
//
// Responsabilidade:
//   Consome eventos do outbox e despacha notificações dirigidas por
//   `notification_rules` configuradas no banco — não mais hard-coded.
//
// Fluxo para cada evento recebido:
//   1. Checar feature flag `notifications.rules.enabled` — early return se off.
//   2. Buscar notification_rules enabled com trigger_kind='event'
//      e trigger_key = eventName, da organização do evento.
//   3. Para cada regra:
//      a. Aplicar filtros de cidade (city_scope do jsonb `filters`).
//      b. Resolver destinatários via resolveRuleRecipients.
//      c. Idempotência: verificar se já há delivery para
//         (rule_id, entity_type, entity_id, bucket=event_id).
//      d. Para cada destinatário × canal da regra:
//         - Checar isCategoryChannelEnabled (com fallback opt-out).
//         - Renderizar title_template / body_template (sem PII bruta).
//         - Despachar via sender (in_app ou email).
//         - F27-S06: canal in_app também despacha Web Push (VAPID) — espelha
//           o mesmo destinatário/preferência do in_app, sem regra própria.
//         - Falha de canal isolada — não derruba outros.
//      e. Gravar delivery após despacho bem-sucedido de ao menos 1 canal.
//
// Idempotência:
//   bucket = event_id (UUID do evento outbox).
//   INSERT ... ON CONFLICT DO NOTHING em notification_rule_deliveries.
//   Permite reprocessamento sem duplicar notificações.
//
// LGPD §8.5:
//   - title/body renderizados com IDs opacos — sem PII bruta nos templates.
//   - Logs redactados (title, body, email, cpf).
//   - organization_id sempre do evento/contexto, nunca de argumento externo.
// =============================================================================
import type { NotificationCategory } from '@elemento/shared-schemas';
import { and, eq } from 'drizzle-orm';
import pino from 'pino';

import { env } from '../config/env.js';
import type { Database } from '../db/client.js';
import { db as defaultDb } from '../db/client.js';
import type { EventOutbox } from '../db/schema/events.js';
import { notificationRuleDeliveries, notificationRules } from '../db/schema/index.js';
import { requireFlag } from '../lib/featureFlags.js';
import { resolveRuleRecipients } from '../modules/notification-rules/recipients.js';
import type { NotificationSocketSeverity } from '../modules/notifications/realtime.js';
import { isCategoryChannelEnabled } from '../modules/notifications/repository.js';
import { sendEmail } from '../modules/notifications/senders/email.js';
import { sendInApp } from '../modules/notifications/senders/inApp.js';
import { sendWebPush } from '../modules/notifications/senders/webPush.js';

// ---------------------------------------------------------------------------
// Logger — redact LGPD §8.5
// ---------------------------------------------------------------------------

const REDACT_PATHS = [
  '*.cpf',
  '*.email',
  '*.telefone',
  '*.phone',
  '*.password',
  '*.senha',
  '*.token',
  '*.title',
  '*.body',
  '*.subject',
  '*.titleTemplate',
  '*.bodyTemplate',
  '*.title_template',
  '*.body_template',
];

const logger = pino({
  name: 'fanout-notification',
  level: env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  ...(env.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
        },
      }
    : {}),
});

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

/** Canal suportado pelo fan-out rules-driven (subset dos canais de regra). */
type RuleChannel = 'in_app' | 'email';

// ---------------------------------------------------------------------------
// Template renderer
// ---------------------------------------------------------------------------

/**
 * Renderiza um template com {{placeholder}} substituindo pelos valores do contexto.
 *
 * Suporta apenas IDs opacos e metadados operacionais nos valores —
 * sem PII bruta (conforme TRIGGER_CATALOG.placeholders).
 *
 * Substituições não encontradas no contexto ficam como literal "{{key}}".
 */
function renderTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = context[key];
    if (value === undefined || value === null) return match;
    return String(value);
  });
}

/**
 * Constrói o contexto de interpolação a partir do payload do evento.
 * Aceita apenas campos que o TRIGGER_CATALOG declara como placeholders —
 * sem PII bruta.
 */
function buildTemplateContext(payload: unknown): Record<string, unknown> {
  if (payload === null || typeof payload !== 'object') return {};
  // `as` justificado: payload do outbox é sempre jsonb (Record<string, unknown>)
  // sem PII bruta conforme LGPD §8.5 + regra do TRIGGER_CATALOG.
  const raw = payload as Record<string, unknown>;
  const data = raw['data'];
  if (data !== null && typeof data === 'object') {
    // `as` justificado: data é jsonb sem PII bruta (LGPD §8.5 garantido pelo emit).
    return data as Record<string, unknown>;
  }
  return {};
}

/**
 * Extrai city_scope de filters jsonb da regra.
 * null = sem filtro de cidade (regra aplica a todas as cidades da org).
 */
function extractCityScopeFromFilters(filters: unknown): string[] | null {
  if (filters === null || typeof filters !== 'object') return null;
  // `as` justificado: filters é jsonb persistido pelo próprio repositório de regras.
  const f = filters as Record<string, unknown>;
  const cs = f['city_scope'];
  if (!Array.isArray(cs) || cs.length === 0) return null;
  // `as` justificado: city_scope sempre string[] quando presente (garantido pelo service).
  return cs as string[];
}

// ---------------------------------------------------------------------------
// Idempotência — notification_rule_deliveries
// ---------------------------------------------------------------------------

/**
 * Verifica se já existe entrega registrada para (rule_id, entity_type, entity_id, bucket).
 * bucket = event_id garante 1 disparo por (regra, entidade, evento) mesmo com reprocesso.
 */
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

/**
 * Grava entrega de regra (ON CONFLICT DO NOTHING — idempotente).
 * Chamado após despachar ao menos 1 canal com sucesso.
 */
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
    .values({
      organizationId,
      ruleId,
      entityType,
      entityId,
      bucket,
      firedAt: new Date(),
    })
    .onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// Dispatcher por canal
// ---------------------------------------------------------------------------

/**
 * Despacha notificação para um canal específico.
 * Retorna true em sucesso, false em falha.
 * Falha é logada (sem PII) e NÃO propaga — outros canais continuam.
 */
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
    eventName: string;
    severity: NotificationSocketSeverity;
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
        severity: params.severity,
      });

      // F27-S06 (doc 24 §5): Web Push ESPELHA o in-app — mesmo destinatário,
      // mesma preferência já verificada acima (isCategoryChannelEnabled para
      // 'in_app'). Não cria destinatário novo nem regra de fan-out própria.
      // Payload LGPD-mínimo: mesmo `title` do in-app (templates só aceitam
      // placeholders de IDs opacos — sem PII), sem `body` (doc 24 §5.3).
      // sendWebPush nunca lança (mesmo contrato de sendEmail) — falha de push
      // não deve derrubar o dispatch de in_app, que já teve sucesso acima.
      await sendWebPush(db, {
        organizationId: params.organizationId,
        userId: params.userId,
        title: params.title,
        severity: params.severity,
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
          // recipientEmail é resolvido internamente pelo sendEmail via userId.
          // Passa placeholder vazio — o sender ignora e usa users.email.
          recipientEmail: '',
          subject: params.title,
          body: params.body,
          eventType: params.eventName,
        },
        db,
      );
      return true;
    }

    return false;
  } catch (err: unknown) {
    // Falha de canal isolada — log sem PII, retorna false
    logger.error(
      {
        err,
        channel,
        event_name: params.eventName,
        user_id: params.userId,
        organization_id: params.organizationId,
      },
      `fanout: erro ao despachar para canal ${channel}`,
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// Processamento de uma regra para um evento
// ---------------------------------------------------------------------------

interface ProcessRuleOptions {
  db: Database;
  event: EventOutbox;
  rule: typeof notificationRules.$inferSelect;
  /** Contexto para interpolação dos templates (sem PII bruta). */
  templateContext: Record<string, unknown>;
  /** Cidade extraída do payload — usada no filtro de city_scope. */
  eventCityId: string | null;
  /** ID opaco da entidade principal do evento (aggregate_id). */
  entityId: string;
  /** Tipo da entidade (aggregate_type). */
  entityType: string;
  /** ID do evento outbox — usado como bucket de idempotência. */
  eventOutboxId: string;
}

/**
 * Processa uma regra específica para o evento recebido:
 * 1. Verifica filtros de cidade.
 * 2. Verifica idempotência por bucket=event_id.
 * 3. Resolve destinatários.
 * 4. Despacha por canal.
 * 5. Grava delivery.
 */
async function processRule(opts: ProcessRuleOptions): Promise<void> {
  const { db, event, rule, templateContext, eventCityId, entityId, entityType, eventOutboxId } =
    opts;

  // ── 1. Filtro de cidade ────────────────────────────────────────────────────
  const cityScope = extractCityScopeFromFilters(rule.filters);
  // Fail-closed (F24-S21, espelha o fix do F24-S16 no worker de SLA): regra com
  // city_scope configurado é uma decisão explícita de restringir. Se o evento
  // não carrega city_id resolvível (eventCityId null — ex.: task.created,
  // contract.signed), NÃO tratar como "sem restrição": resolveByRoleCity
  // trataria cityId=null como contexto global e faria broadcast pra org
  // inteira, furando o city_scope da regra (cross-city leak — CLAUDE.md #3).
  if (cityScope !== null) {
    if (eventCityId === null) {
      logger.warn(
        {
          rule_id: rule.id,
          event_name: event.eventName,
          organization_id: event.organizationId,
        },
        'fanout: notificação suprimida (fail-closed) — regra tem city_scope ' +
          'mas o evento não tem city_id resolvível',
      );
      return;
    }
    if (!cityScope.includes(eventCityId)) {
      logger.debug(
        {
          rule_id: rule.id,
          event_name: event.eventName,
          event_city_id: eventCityId,
          city_scope: cityScope,
        },
        'fanout: regra filtrada por city_scope — pulando',
      );
      return;
    }
  }

  // ── 2. Idempotência: verificar delivery existente ─────────────────────────
  const alreadyDelivered = await hasDelivery(
    db,
    rule.id,
    entityType,
    entityId,
    eventOutboxId, // bucket = event_id (UUID da linha no outbox)
  );

  if (alreadyDelivered) {
    logger.debug(
      {
        rule_id: rule.id,
        event_outbox_id: eventOutboxId,
        entity_type: entityType,
        entity_id: entityId,
      },
      'fanout: delivery já registrado para este evento — idempotente, pulando',
    );
    return;
  }

  // ── 3. Resolver destinatários ─────────────────────────────────────────────

  // Extrair lead_id do contexto para modo assignee
  const leadId = (() => {
    const rawLeadId = templateContext['lead_id'];
    return typeof rawLeadId === 'string' ? rawLeadId : null;
  })();

  // `as` justificado: channels é text[] validado pela borda HTTP via ruleChannelSchema
  // (apenas 'in_app' | 'email' — validado no insert da regra).
  const ruleChannels = rule.channels as RuleChannel[];

  const recipients = await resolveRuleRecipients(db, {
    organizationId: event.organizationId,
    recipientMode: rule.recipientMode,
    recipientRoles: rule.recipientRoles,
    channels: ruleChannels,
    cityId: eventCityId,
    leadId,
  });

  if (recipients.length === 0) {
    logger.debug(
      { rule_id: rule.id, event_name: event.eventName },
      'fanout: nenhum destinatário resolvido para a regra — pulando',
    );
    return;
  }

  logger.info(
    {
      rule_id: rule.id,
      event_name: event.eventName,
      recipient_count: recipients.length,
    },
    'fanout: destinatários resolvidos',
  );

  // ── 4. Renderizar templates ────────────────────────────────────────────────
  // LGPD: templateContext contém apenas IDs opacos (conforme TRIGGER_CATALOG.placeholders).
  const renderedTitle = renderTemplate(rule.titleTemplate, templateContext);
  const renderedBody = renderTemplate(rule.bodyTemplate, templateContext);

  // ── 5. Despachar por destinatário × canal ─────────────────────────────────
  // `as` justificado: NotificationCategory é string enum; rule.category é
  // validado pelo schema na criação da regra.
  const category = rule.category as NotificationCategory;

  let anyDispatched = false;

  for (const recipient of recipients) {
    for (const channel of recipient.channels) {
      // Verificar preferência do usuário (categoria × canal) — opt-out model
      const channelEnabled = await isCategoryChannelEnabled(
        db,
        recipient.organizationId,
        recipient.userId,
        channel,
        category,
      );

      if (!channelEnabled) {
        logger.debug(
          {
            rule_id: rule.id,
            user_id: recipient.userId,
            channel,
            category,
          },
          'fanout: canal/categoria desabilitado pelo usuário — pulando',
        );
        continue;
      }

      const dispatched = await dispatchToChannel(db, channel, {
        organizationId: recipient.organizationId,
        userId: recipient.userId,
        // Tipo canônico: "<canal>:<event_name>:<rule_id>" — sem PII
        type: `${channel}:${event.eventName}:${rule.id}`,
        title: renderedTitle,
        body: renderedBody,
        entityType,
        entityId,
        eventName: event.eventName,
        severity: rule.severity,
      });

      if (dispatched) {
        anyDispatched = true;
        logger.debug(
          {
            rule_id: rule.id,
            user_id: recipient.userId,
            channel,
            event_name: event.eventName,
          },
          'fanout: notificação despachada',
        );
      }
    }
  }

  // ── 6. Gravar delivery (idempotência futura) ──────────────────────────────
  // Grava independente de anyDispatched para evitar re-tentativas em casos
  // onde todos os destinatários têm o canal desabilitado por preferência.
  // Isso é correto: a regra foi "processada" para este evento, o resultado é
  // que nenhum canal estava habilitado — não deve reprocessar.
  await recordDelivery(db, event.organizationId, rule.id, entityType, entityId, eventOutboxId);

  logger.info(
    {
      rule_id: rule.id,
      event_name: event.eventName,
      entity_id: entityId,
      entity_type: entityType,
      any_dispatched: anyDispatched,
    },
    'fanout: delivery registrado',
  );
}

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------

/**
 * Processa um evento do outbox e despacha notificações dirigidas por
 * `notification_rules` configuradas (trigger_kind='event').
 *
 * Idempotente: bucket=event_id garante 1 disparo por (regra, entidade, evento).
 * Falha de canal isolada — não interrompe processamento das demais regras/canais.
 * Feature-gated: early return se `notifications.rules.enabled` estiver off.
 *
 * @param event  Linha do event_outbox (já validada pelo worker outbox-publisher).
 * @param db     Instância Drizzle injetável (facilita testes).
 */
export async function handleFanoutNotification(
  event: EventOutbox,
  db: Database = defaultDb,
): Promise<void> {
  // ── 1. Feature flag ────────────────────────────────────────────────────────
  const flagEnabled = await requireFlag(db, 'notifications.rules.enabled', logger);
  if (!flagEnabled) return;

  logger.info(
    {
      event_outbox_id: event.id,
      event_name: event.eventName,
      organization_id: event.organizationId,
      aggregate_type: event.aggregateType,
      aggregate_id: event.aggregateId,
    },
    'fanout-notification: processando evento',
  );

  // ── 2. Buscar regras ativas para este evento ───────────────────────────────
  const rules = await db
    .select()
    .from(notificationRules)
    .where(
      and(
        eq(notificationRules.organizationId, event.organizationId),
        eq(notificationRules.triggerKind, 'event'),
        eq(notificationRules.triggerKey, event.eventName),
        eq(notificationRules.enabled, true),
      ),
    );

  if (rules.length === 0) {
    logger.debug(
      {
        event_name: event.eventName,
        organization_id: event.organizationId,
      },
      'fanout-notification: nenhuma regra ativa para o evento — ignorando',
    );
    return;
  }

  logger.info(
    {
      event_name: event.eventName,
      organization_id: event.organizationId,
      rule_count: rules.length,
    },
    'fanout-notification: regras encontradas',
  );

  // ── 3. Construir contexto de template ─────────────────────────────────────
  const templateContext = buildTemplateContext(event.payload);

  // Extrair city_id do contexto (disponível em vários eventos — LGPD: é ID opaco)
  const rawCityId = templateContext['city_id'];
  const eventCityId = typeof rawCityId === 'string' ? rawCityId : null;

  // ── 4. Processar cada regra ────────────────────────────────────────────────
  for (const rule of rules) {
    try {
      await processRule({
        db,
        event,
        rule,
        templateContext,
        eventCityId,
        entityId: event.aggregateId,
        entityType: event.aggregateType,
        eventOutboxId: event.id,
      });
    } catch (err: unknown) {
      // Falha de uma regra NÃO interrompe as demais — log e continua
      logger.error(
        {
          err,
          rule_id: rule.id,
          event_name: event.eventName,
          organization_id: event.organizationId,
        },
        'fanout-notification: erro ao processar regra — continuando',
      );
    }
  }

  logger.info(
    {
      event_outbox_id: event.id,
      event_name: event.eventName,
      rule_count: rules.length,
    },
    'fanout-notification: processamento concluído',
  );
}

// ---------------------------------------------------------------------------
// Builder factory (para registro no outbox worker)
// ---------------------------------------------------------------------------

/**
 * Retorna um EventHandler compatível com registerHandler().
 *
 * Usa closure para injetar `db` padrão — handlers registrados via
 * setupWorkerHandlers() usam o singleton; testes injetam mock.
 */
export function buildFanoutNotificationHandler(
  db: Database = defaultDb,
): (event: EventOutbox) => Promise<void> {
  return (event: EventOutbox) => handleFanoutNotification(event, db);
}
