// =============================================================================
// notifications/senders/email.ts — Sender de email (F15-S06 — stub).
//
// Status: stub/log. Sem provider de email configurado no MVP.
// Quando um provider for integrado (SendGrid, Resend, SES), substituir
// o corpo do sendEmail por chamada ao cliente do provider.
//
// LGPD §8.5:
//   - Não logar conteúdo de title/body — podem ter PII indireta.
//   - Logar apenas IDs opacos (userId, organizationId) + tipo de evento.
//   - userId NÃO é PII direta, mas aponta para entidade com PII — não logar nome.
// =============================================================================
import pino from 'pino';

import { env } from '../../../config/env.js';

const logger = pino({
  name: 'notifications.email-sender',
  level: env.LOG_LEVEL,
  // LGPD: redact canônico — title/body podem ter PII indireta
  redact: {
    paths: ['*.title', '*.body', '*.email', '*.name'],
    censor: '[REDACTED]',
  },
});

export interface EmailSenderInput {
  organizationId: string;
  userId: string;
  /** Email do destinatário — NUNCA logar. */
  recipientEmail: string;
  /** Assunto do email. */
  subject: string;
  /** Corpo HTML ou texto. NUNCA logar. */
  body: string;
  /** Tipo canônico do evento — para audit/trace. */
  eventType: string;
}

/**
 * Envia notificação por email.
 * MVP: stub — loga intenção sem enviar.
 * Quando provider for integrado, adicionar chamada aqui.
 *
 * @throws nunca lança — falha de email não derruba outros canais.
 *   Erros são logados e swallowed pelo fan-out (try/catch por canal).
 */
export async function sendEmail(_input: EmailSenderInput): Promise<void> {
  // TODO(F15-Sxx): integrar provider de email (Resend / SendGrid / SES).
  // Por ora, apenas log de intenção — sem envio real.
  // LGPD: logar apenas IDs opacos, nunca title/body/email.
  logger.info(
    {
      event: 'email.notification.stub',
      organization_id: _input.organizationId,
      user_id: _input.userId,
      event_type: _input.eventType,
    },
    'email notification stub — provider não configurado (MVP)',
  );
}
