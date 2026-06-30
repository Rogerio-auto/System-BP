// =============================================================================
// notifications/senders/email.ts — Sender de email via Resend (F24-S03).
//
// Implementação real que substitui o stub do F15-S06.
//
// Fluxo:
//   1. Verificar flag NOTIFICATIONS_EMAIL_ENABLED — no-op se desligada.
//   2. Buscar email do destinatário na tabela users por userId.
//   3. Resolver marca da organização (nome, cor) a partir da tabela organizations.
//   4. Montar HTML do email com renderEmailTemplate (org-aware).
//   5. Enviar via resendSendEmail (fetch + retry exponencial 3x).
//
// LGPD §8.5:
//   - email do destinatário: nunca logado — coberto por pino.redact.
//   - title/body: podem ter PII indireta — cobertos por pino.redact.
//   - O corpo HTML nunca é logado em nenhuma camada.
//   - userId e organizationId são IDs opacos — podem aparecer em logs.
//
// Falha de envio:
//   A função nunca propaga exceção — erros são logados (sem PII) e swallowed.
//   O fan-out (fanout-notification.ts) envolve cada canal em try/catch
//   por design — falha de email não derruba outros canais.
// =============================================================================
import { eq } from 'drizzle-orm';
import pino from 'pino';

import { env } from '../../../config/env.js';
import { db as defaultDb } from '../../../db/client.js';
import type { Database } from '../../../db/client.js';
import { users } from '../../../db/schema/index.js';
import { resendSendEmail } from '../email/resendClient.js';
import { renderEmailTemplate, resolveOrgBrand } from '../email/template.js';

// ---------------------------------------------------------------------------
// Logger — com redact LGPD
// ---------------------------------------------------------------------------

const logger = pino({
  name: 'notifications.email-sender',
  level: env.LOG_LEVEL,
  redact: {
    // LGPD: email é PII direta. title/body podem conter PII indireta.
    // Cobrir tanto paths diretos quanto aninhados (objetos de contexto do pino).
    paths: [
      'email',
      'recipientEmail',
      '*.email',
      '*.recipientEmail',
      '*.title',
      '*.body',
      '*.subject',
    ],
    censor: '[REDACTED]',
  },
});

// ---------------------------------------------------------------------------
// Interface pública (compatível com o fan-out existente)
// ---------------------------------------------------------------------------

export interface EmailSenderInput {
  organizationId: string;
  userId: string;
  /**
   * Email do destinatário passado pelo chamador.
   * Quando o fan-out passa '[stub]', este campo é ignorado e o email
   * é resolvido a partir de users.email via userId.
   * LGPD: nunca logar — coberto por pino.redact.
   */
  recipientEmail: string;
  /** Assunto do email. NUNCA logar. */
  subject: string;
  /** Corpo do email (texto ou HTML simples). NUNCA logar. */
  body: string;
  /** Tipo canônico do evento — para audit/trace (opaco, não é PII). */
  eventType: string;
}

// ---------------------------------------------------------------------------
// Busca do email do destinatário
// ---------------------------------------------------------------------------

/**
 * Resolve o email corporativo do usuário a partir do banco.
 * Retorna null se o usuário não for encontrado.
 *
 * LGPD: email é PII — não logar o valor retornado.
 */
async function resolveRecipientEmail(
  db: Database,
  userId: string,
  organizationId: string,
): Promise<string | null> {
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const row = rows[0];

  if (row === undefined) {
    logger.warn(
      { user_id: userId, organization_id: organizationId, event: 'email.user_not_found' },
      'email-sender: usuário não encontrado — skip',
    );
    return null;
  }

  return row.email;
}

// ---------------------------------------------------------------------------
// Sender principal
// ---------------------------------------------------------------------------

/**
 * Envia notificação por email via Resend.
 *
 * No-op limpo quando `NOTIFICATIONS_EMAIL_ENABLED=false`.
 * Nunca propaga exceção — erros são absorvidos com log (sem PII).
 *
 * @param input   Payload de notificação do fan-out.
 * @param db      Instância Drizzle (injetável para testes; default = singleton).
 */
export async function sendEmail(input: EmailSenderInput, db: Database = defaultDb): Promise<void> {
  // ── 1. Feature flag ────────────────────────────────────────────────────────
  if (!env.NOTIFICATIONS_EMAIL_ENABLED) {
    logger.debug(
      {
        event: 'email.notification.disabled',
        organization_id: input.organizationId,
        user_id: input.userId,
        event_type: input.eventType,
      },
      'email-sender: NOTIFICATIONS_EMAIL_ENABLED=false — no-op',
    );
    return;
  }

  // Vars obrigatórias validadas pelo refine do envSchema (boot falha se ausentes).
  // Non-null assertion justificada: env.NOTIFICATIONS_EMAIL_ENABLED=true implica
  // que RESEND_API_KEY e EMAIL_FROM são definidos (garantido pelo refine).

  const apiKey = env.RESEND_API_KEY!;

  const fromAddress = env.EMAIL_FROM!;

  try {
    // ── 2. Resolver email do destinatário ──────────────────────────────────
    const recipientEmail = await resolveRecipientEmail(db, input.userId, input.organizationId);
    if (recipientEmail === null) {
      return;
    }

    // ── 3. Resolver marca da organização ──────────────────────────────────
    const orgBrand = await resolveOrgBrand(db, input.organizationId);

    // ── 4. Montar HTML ────────────────────────────────────────────────────
    const html = renderEmailTemplate({
      orgBrand,
      subject: input.subject,
      body: input.body,
    });

    // ── 5. Enviar via Resend ──────────────────────────────────────────────
    const result = await resendSendEmail(apiKey, {
      from: fromAddress,
      // LGPD: recipientEmail nunca passa pelo logger — apenas via Resend API
      to: [recipientEmail],
      subject: input.subject,
      html,
      ...(env.EMAIL_REPLY_TO !== undefined ? { reply_to: env.EMAIL_REPLY_TO } : {}),
    });

    // Log de sucesso: apenas IDs opacos — sem PII
    logger.info(
      {
        event: 'email.notification.sent',
        organization_id: input.organizationId,
        user_id: input.userId,
        event_type: input.eventType,
        resend_message_id: result.id,
      },
      'email-sender: email enviado com sucesso',
    );
  } catch (err: unknown) {
    // Falha de envio não propaga — log sem PII e retorna normalmente.
    // O fan-out envolve cada canal em try/catch; falha de email não derruba outros canais.
    logger.error(
      {
        err,
        event: 'email.notification.error',
        organization_id: input.organizationId,
        user_id: input.userId,
        event_type: input.eventType,
        // LGPD: recipientEmail NÃO incluído — seria PII no log
      },
      'email-sender: falha ao enviar email',
    );
  }
}
