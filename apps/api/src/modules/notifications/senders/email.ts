// =============================================================================
// notifications/senders/email.ts — Sender de email via Resend (F24-S03).
//
// Implementação real que substitui o stub do F15-S06.
//
// Fluxo:
//   1. Verificar env NOTIFICATIONS_EMAIL_ENABLED — no-op se desligada (infra/credenciais).
//   2. Verificar feature flag `notifications.email.enabled` — no-op se desligada
//      (decisão operacional por organização, F24-S18). As duas camadas precisam
//      estar ligadas para enviar; env é checada primeiro (barato, sem I/O).
//   3. Buscar email do destinatário na tabela users por userId.
//   4. Resolver marca da organização (nome, cor) a partir da tabela organizations.
//   5. Montar HTML do email com renderEmailTemplate (org-aware).
//   6. Enviar via resendSendEmail (fetch + retry exponencial 3x).
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
import { requireFlag } from '../../../lib/featureFlags.js';
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
 * Gate em duas camadas — as duas precisam estar ligadas para enviar (F24-S18):
 *   1. Env `NOTIFICATIONS_EMAIL_ENABLED` — infraestrutura/credenciais. Checada
 *      primeiro (barato, sem I/O); desligada evita a consulta de flag abaixo.
 *   2. Feature flag `notifications.email.enabled` — decisão operacional por
 *      organização, consultada no banco via `requireFlag`. Fail-closed: se a
 *      consulta falhar (ex.: banco indisponível), NÃO envia — email é o único
 *      canal de notificação que sai da rede.
 *
 * No-op limpo (sem lançar, sem quebrar o fan-out) quando qualquer uma das
 * camadas está desligada ou indisponível.
 * Nunca propaga exceção — erros são absorvidos com log (sem PII).
 *
 * @param input   Payload de notificação do fan-out.
 * @param db      Instância Drizzle (injetável para testes; default = singleton).
 */
export async function sendEmail(input: EmailSenderInput, db: Database = defaultDb): Promise<void> {
  // ── 1. Env (infra/credenciais) — barato, sem I/O ───────────────────────────
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

  // ── 2. Feature flag (decisão operacional por organização) ──────────────────
  let flagEnabled: boolean;
  try {
    flagEnabled = await requireFlag(db, 'notifications.email.enabled', logger);
  } catch (err: unknown) {
    // Fail-closed: falha ao consultar a flag (ex.: banco indisponível) nunca
    // libera o envio. E-mail é o único canal de notificação que sai da rede.
    logger.error(
      {
        err,
        event: 'email.notification.flag_check_error',
        organization_id: input.organizationId,
        user_id: input.userId,
        event_type: input.eventType,
      },
      'email-sender: falha ao consultar notifications.email.enabled — fail-closed, no-op',
    );
    return;
  }

  if (!flagEnabled) {
    // requireFlag já loga o motivo (evento 'job.skipped_feature_disabled').
    return;
  }

  // Vars obrigatórias validadas pelo refine do envSchema (boot falha se ausentes).
  // Non-null assertion justificada: env.NOTIFICATIONS_EMAIL_ENABLED=true implica
  // que RESEND_API_KEY e EMAIL_FROM são definidos (garantido pelo refine).

  const apiKey = env.RESEND_API_KEY!;

  const fromAddress = env.EMAIL_FROM!;

  try {
    // ── 3. Resolver email do destinatário ──────────────────────────────────
    const recipientEmail = await resolveRecipientEmail(db, input.userId, input.organizationId);
    if (recipientEmail === null) {
      return;
    }

    // ── 4. Resolver marca da organização ──────────────────────────────────
    const orgBrand = await resolveOrgBrand(db, input.organizationId);

    // ── 5. Montar HTML ────────────────────────────────────────────────────
    const html = renderEmailTemplate({
      orgBrand,
      subject: input.subject,
      body: input.body,
    });

    // ── 6. Enviar via Resend ──────────────────────────────────────────────
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
