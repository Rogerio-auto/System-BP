// =============================================================================
// handlers/fanout-notification.ts — Handler de fan-out de notificações (F15-S06).
//
// Responsabilidade:
//   Consome eventos do outbox e despacha notificações para os canais habilitados
//   de cada destinatário.
//
// Eventos suportados:
//   - task.created     → notificar usuários com assignee_role + city_id
//   - contract.signed  → notificar admin/gestor_geral da organização
//
// Fan-out por canal:
//   1. Resolver destinatários (por role+cidade ou por papel admin/gestor).
//   2. Para cada destinatário, verificar notification_preferences.
//   3. Para cada canal habilitado: chamar o sender correspondente.
//   4. Falha de 1 canal NÃO derruba os outros — try/catch por canal.
//
// Idempotência:
//   - O consumidor do outbox garante entrega at-least-once por event_id.
//   - createNotification é idempotente por conteúdo (não há unique constraint
//     por event_id em notifications — a tabela aceita duplicatas se o event_id
//     for reprocessado). Para tornar o handler verdadeiramente idempotente,
//     o consumidor deve rastrear event_ids processados (padrão do outbox worker).
//
// LGPD §8.5:
//   - title/body dos senders montados com IDs — sem PII bruta.
//   - Logs com apenas IDs opacos (userId, organizationId, event_type).
//   - Conteúdo de notificação NUNCA logado.
// =============================================================================
import pino from 'pino';

import { env } from '../config/env.js';
import type { Database } from '../db/client.js';
import { db as defaultDb } from '../db/client.js';
import type { AppEvent, ContractSignedData, TaskCreatedData } from '../events/types.js';
import { isChannelEnabled } from '../modules/notifications/repository.js';
import {
  resolveContractSignedRecipients,
  resolveTaskCreatedRecipients,
} from '../modules/notifications/repository.js';
import { sendEmail } from '../modules/notifications/senders/email.js';
import { sendInApp } from '../modules/notifications/senders/inApp.js';
import { sendWhatsApp } from '../modules/notifications/senders/whatsapp.js';

// ---------------------------------------------------------------------------
// Logger
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

type NotificationChannel = 'in_app' | 'email' | 'whatsapp';

const ALL_CHANNELS: NotificationChannel[] = ['in_app', 'email', 'whatsapp'];

interface NotificationPayload {
  organizationId: string;
  userId: string;
  /** Tipo canônico da notificação — ex: 'in_app:task.created'. */
  type: string;
  title: string;
  body: string;
  entityType?: string | null;
  entityId?: string | null;
  /** Tipo do evento que gerou a notificação. */
  eventType: string;
}

// ---------------------------------------------------------------------------
// Builders de payload por evento
// ---------------------------------------------------------------------------

/**
 * Monta payload de notificação para task.created.
 * LGPD: title/body sem PII bruta — apenas tipo de tarefa e role.
 */
function buildTaskCreatedPayload(
  data: TaskCreatedData,
  userId: string,
  channel: NotificationChannel,
): NotificationPayload {
  return {
    organizationId: data.organization_id,
    userId,
    type: `${channel}:task.created`,
    title: `Nova tarefa: ${data.type}`,
    body: `Uma tarefa do tipo "${data.type}" foi criada para o papel "${data.assignee_role}".`,
    entityType: data.entity_type ?? null,
    entityId: data.entity_id ?? null,
    eventType: 'task.created',
  };
}

/**
 * Monta payload de notificação para contract.signed.
 * LGPD: title/body sem PII bruta — apenas IDs opacos.
 */
function buildContractSignedPayload(
  data: ContractSignedData,
  userId: string,
  channel: NotificationChannel,
): NotificationPayload {
  return {
    organizationId: data.organization_id,
    userId,
    type: `${channel}:contract.signed`,
    title: 'Contrato assinado',
    body: `Um contrato foi assinado e está aguardando revisão.`,
    entityType: 'contract',
    entityId: data.contract_id,
    eventType: 'contract.signed',
  };
}

// ---------------------------------------------------------------------------
// Dispatcher por canal
// ---------------------------------------------------------------------------

/**
 * Despacha notificação para um canal específico.
 * Falha de 1 canal é logada e não propaga para os outros.
 */
async function dispatchToChannel(
  db: Database,
  channel: NotificationChannel,
  payload: NotificationPayload,
): Promise<void> {
  try {
    if (channel === 'in_app') {
      await sendInApp(db, {
        organizationId: payload.organizationId,
        userId: payload.userId,
        type: payload.type,
        title: payload.title,
        body: payload.body,
        // exactOptionalPropertyTypes: omitir propriedades opcionais se undefined
        ...(payload.entityType !== undefined ? { entityType: payload.entityType } : {}),
        ...(payload.entityId !== undefined ? { entityId: payload.entityId } : {}),
      });
      return;
    }

    if (channel === 'email') {
      // Email sender é stub no MVP — recipientEmail não está disponível sem busca extra.
      // Chamada ao stub com dados disponíveis.
      await sendEmail({
        organizationId: payload.organizationId,
        userId: payload.userId,
        // recipientEmail: stub — sem provider, sem busca de email do usuário.
        recipientEmail: '[stub]',
        subject: payload.title,
        body: payload.body,
        eventType: payload.eventType,
      });
      return;
    }

    if (channel === 'whatsapp') {
      await sendWhatsApp({
        organizationId: payload.organizationId,
        userId: payload.userId,
        eventType: payload.eventType,
        title: payload.title,
        body: payload.body,
      });
    }
  } catch (err: unknown) {
    // Falha de canal não propaga — log e continua
    logger.error(
      {
        err,
        channel,
        event_type: payload.eventType,
        user_id: payload.userId,
        organization_id: payload.organizationId,
      },
      `fanout: erro ao despachar para canal ${channel}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Fan-out por destinatário
// ---------------------------------------------------------------------------

/**
 * Para cada destinatário, verifica preferências e despacha nos canais habilitados.
 */
async function fanoutToRecipients(
  db: Database,
  recipients: Array<{ id: string; organizationId: string }>,
  buildPayload: (userId: string, channel: NotificationChannel) => NotificationPayload,
  eventType: string,
): Promise<void> {
  for (const recipient of recipients) {
    for (const channel of ALL_CHANNELS) {
      // Verificar preferência do usuário para este canal
      const enabled = await isChannelEnabled(db, recipient.organizationId, recipient.id, channel);

      if (!enabled) {
        logger.debug(
          {
            user_id: recipient.id,
            channel,
            event_type: eventType,
          },
          'fanout: canal desabilitado pelo usuário — pulando',
        );
        continue;
      }

      const payload = buildPayload(recipient.id, channel);
      await dispatchToChannel(db, channel, payload);

      logger.debug(
        {
          user_id: recipient.id,
          channel,
          event_type: eventType,
        },
        'fanout: notificação despachada',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------

/**
 * Processa um evento do outbox e despacha notificações para os destinatários.
 *
 * Suporta:
 *   - task.created     → assignee_role + city_id → notifica usuários com role na cidade
 *   - contract.signed  → admin/gestor_geral da organização
 *
 * Eventos não suportados são ignorados silenciosamente.
 *
 * @param event  Evento tipado do outbox.
 * @param db     Instância Drizzle injetável (facilita testes).
 */
export async function handleFanoutNotification(
  event: AppEvent,
  db: Database = defaultDb,
): Promise<void> {
  const { eventName } = event;

  logger.info(
    {
      event_id: event.idempotencyKey,
      event_name: eventName,
      organization_id: event.organizationId,
    },
    'fanout-notification: processando evento',
  );

  if (eventName === 'task.created') {
    // `as` justificado: eventName === 'task.created' garante que data é TaskCreatedData.
    const data = event.data as TaskCreatedData;

    const recipients = await resolveTaskCreatedRecipients(
      db,
      data.organization_id,
      data.assignee_role,
      data.city_id,
    );

    logger.info(
      {
        event_type: 'task.created',
        assignee_role: data.assignee_role,
        city_id: data.city_id,
        recipient_count: recipients.length,
      },
      'fanout-notification: destinatários resolvidos para task.created',
    );

    await fanoutToRecipients(
      db,
      recipients,
      (userId, channel) => buildTaskCreatedPayload(data, userId, channel),
      'task.created',
    );

    return;
  }

  if (eventName === 'contract.signed') {
    // `as` justificado: eventName === 'contract.signed' garante que data é ContractSignedData.
    const data = event.data as ContractSignedData;

    const recipients = await resolveContractSignedRecipients(db, data.organization_id);

    logger.info(
      {
        event_type: 'contract.signed',
        contract_id: data.contract_id,
        recipient_count: recipients.length,
      },
      'fanout-notification: destinatários resolvidos para contract.signed',
    );

    await fanoutToRecipients(
      db,
      recipients,
      (userId, channel) => buildContractSignedPayload(data, userId, channel),
      'contract.signed',
    );

    return;
  }

  // Evento não suportado — ignora silenciosamente
  logger.debug({ event_name: eventName }, 'fanout-notification: evento não suportado — ignorando');
}
