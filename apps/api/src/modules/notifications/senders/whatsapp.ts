// =============================================================================
// notifications/senders/whatsapp.ts — Sender WhatsApp para notificações internas (F15-S06 — stub).
//
// Contexto:
//   O canal WhatsApp do projeto é voltado para mensagens ao CLIENTE (lead/devedor)
//   via MetaWhatsAppClient (apps/api/src/services/meta-whatsapp-client.ts).
//   Notificações internas para USUÁRIOS (funcionários) via WhatsApp requerem
//   um número de WhatsApp Business vinculado ao usuário — não ao lead.
//   Isso está fora do escopo do MVP (F15) e será implementado em slot futuro.
//
// Status: stub/log. Sem integração real para notificações internas via WhatsApp.
//
// LGPD §8.5: não logar telefone do usuário (PII). Logar apenas IDs opacos.
// =============================================================================
import pino from 'pino';

import { env } from '../../../config/env.js';

const logger = pino({
  name: 'notifications.whatsapp-sender',
  level: env.LOG_LEVEL,
  redact: {
    paths: ['*.phone', '*.telefone', '*.whatsapp', '*.title', '*.body'],
    censor: '[REDACTED]',
  },
});

export interface WhatsAppSenderInput {
  organizationId: string;
  userId: string;
  /** Tipo canônico do evento — para audit/trace. */
  eventType: string;
  /** Título da notificação (sem PII direta). */
  title: string;
  /** Corpo da notificação. */
  body: string;
}

/**
 * Envia notificação interna por WhatsApp.
 * MVP: stub — loga intenção sem enviar.
 * Slot futuro: integrar recuperação de telefone do usuário + envio via MetaWhatsAppClient.
 *
 * @throws nunca lança — falha de whatsapp não derruba outros canais.
 *   Erros são logados e swallowed pelo fan-out (try/catch por canal).
 */
export async function sendWhatsApp(_input: WhatsAppSenderInput): Promise<void> {
  // TODO(F15-Sxx): integrar envio de WhatsApp para usuários internos.
  // Requer: recuperar telefone do usuário via users.phone (não exposto ainda).
  // Enviar via MetaWhatsAppClient com template de notificação aprovado pela Meta.
  // LGPD: logar apenas IDs opacos, nunca phone/title/body.
  logger.info(
    {
      event: 'whatsapp.notification.stub',
      organization_id: _input.organizationId,
      user_id: _input.userId,
      event_type: _input.eventType,
    },
    'whatsapp notification stub — integração interna não configurada (MVP)',
  );
}
