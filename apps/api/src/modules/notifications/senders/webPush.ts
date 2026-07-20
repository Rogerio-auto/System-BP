// =============================================================================
// notifications/senders/webPush.ts — Sender de Web Push via VAPID (F27-S06).
//
// Quarto sender do motor de notificações F24 (doc 24 §5). Espelha o in-app:
// não resolve destinatário nem preferência própria — o fan-out invoca este
// sender junto de sendInApp, para o MESMO destinatário/regra já resolvidos.
//
// Fluxo:
//   1. Verificar env NOTIFICATIONS_PUSH_ENABLED — no-op se desligada (infra/credenciais).
//   2. Verificar feature flag `pwa.enabled` — no-op se desligada (decisão
//      operacional, doc 24 §7 — camada "Worker"). Fail-closed: falha ao
//      consultar a flag nunca libera o envio (mesmo padrão do email sender).
//   3. Buscar subscriptions ATIVAS do destinatário (`push_subscriptions`).
//   4. Enviar via `web-push` para cada subscription; falha isolada por
//      subscription — uma subscription morta não impede as demais.
//   5. Subscriptions que respondem 404/410 (endpoint expirado/revogado) são
//      removidas (soft-delete) — doc 24 §5.2/§9 (retenção/limpeza).
//
// LGPD §8.5/§9 (doc 24 §5.3 — payload LGPD-mínimo, inviolável):
//   - O payload do push NUNCA carrega PII: apenas `title` (mesmo título
//     genérico/opaco já usado pelo in-app — templates só aceitam placeholders
//     de IDs opacos, doc 23), `severity` e `entity_type`/`entity_id` para
//     deep-link. Sem body, sem nome, sem telefone, sem CPF, sem valor.
//   - endpoint/p256dh/auth: DADO PESSOAL — nunca logados (pino.redact em
//     app.ts cobre estes campos). Apenas IDs opacos (organizationId/userId/
//     subscriptionId) aparecem em log.
//
// Falha de envio:
//   A função nunca propaga exceção — erros são logados (sem PII) e swallowed,
//   mesmo contrato de sendEmail. O fan-out (fanout-notification.ts) já isola
//   falha de canal por design; falha de push não deve derrubar in-app/email.
// =============================================================================
import pino from 'pino';
import { WebPushError, sendNotification, setVapidDetails } from 'web-push';

import { env } from '../../../config/env.js';
import { db as defaultDb } from '../../../db/client.js';
import type { Database } from '../../../db/client.js';
import { requireFlag } from '../../../lib/featureFlags.js';
import {
  getActivePushSubscriptionsByUser,
  softDeletePushSubscriptionByEndpoint,
} from '../repository.js';

// ---------------------------------------------------------------------------
// Logger — redact LGPD dedicado (defesa em profundidade: mesmo padrão de
// senders/email.ts). endpoint/p256dh/auth NUNCA aparecem em log claro, mesmo
// que uma chamada futura passe o objeto de subscription inteiro por engano.
// ---------------------------------------------------------------------------

const logger = pino({
  name: 'notifications.web-push-sender',
  level: env.LOG_LEVEL,
  redact: {
    paths: ['endpoint', 'p256dh', 'auth', '*.endpoint', '*.p256dh', '*.auth', '*.keys'],
    censor: '[REDACTED]',
  },
});

// ---------------------------------------------------------------------------
// Interface pública — mesmo domínio de valores do payload do socket F24
// (NotificationSocketSeverity) e da tabela `notifications.entity_type/id`.
// ---------------------------------------------------------------------------

export interface WebPushSenderInput {
  organizationId: string;
  userId: string;
  /**
   * Título curto — MESMO valor usado pelo in-app (renderizado a partir de
   * `title_template`, que só aceita placeholders de IDs opacos). Doc 24 §5.3:
   * "título genérico" descreve a NATUREZA do texto (sem PII), não uma
   * constante hardcoded — mesmo princípio do socket `notification.new`.
   */
  title: string;
  severity: 'info' | 'warning' | 'critical';
  entityType: string | null;
  entityId: string | null;
}

/** Payload LGPD-mínimo entregue ao push service (doc 24 §5.3 — inviolável). */
interface WebPushPayload {
  title: string;
  severity: 'info' | 'warning' | 'critical';
  entity_type: string | null;
  entity_id: string | null;
}

// ---------------------------------------------------------------------------
// VAPID — configurado uma única vez por processo, lazy (só quando o sender
// é efetivamente chamado com a flag+env ligadas).
// ---------------------------------------------------------------------------

let vapidConfigured = false;

function ensureVapidConfigured(): void {
  if (vapidConfigured) return;

  // Non-null assertion justificada: chegamos aqui apenas quando
  // env.NOTIFICATIONS_PUSH_ENABLED=true, que o refine de envSchema garante
  // exigir VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT definidos
  // (boot falha cedo se ausentes — apps/api/src/config/env.ts).
  setVapidDetails(env.VAPID_SUBJECT!, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
  vapidConfigured = true;
}

// ---------------------------------------------------------------------------
// Sender principal
// ---------------------------------------------------------------------------

/**
 * Envia notificação Web Push (VAPID) para todas as subscriptions ativas do
 * destinatário.
 *
 * Gate em duas camadas — as duas precisam estar ligadas para enviar:
 *   1. Env `NOTIFICATIONS_PUSH_ENABLED` — infraestrutura/credenciais.
 *   2. Feature flag `pwa.enabled` — decisão operacional (doc 24 §7, camada
 *      Worker). Fail-closed: falha ao consultar a flag NÃO libera o envio.
 *
 * No-op limpo quando qualquer camada está desligada. Nunca lança — falha por
 * subscription é isolada e logada sem PII.
 *
 * @param db     Instância Drizzle (injetável para testes; default = singleton).
 * @param input  Destinatário + payload LGPD-mínimo (mesmo resolvido para in-app).
 */
export async function sendWebPush(
  db: Database = defaultDb,
  input: WebPushSenderInput,
): Promise<void> {
  // ── 1. Env (infra/credenciais) — barato, sem I/O ───────────────────────────
  if (!env.NOTIFICATIONS_PUSH_ENABLED) {
    logger.debug(
      {
        event: 'web_push.notification.disabled',
        organization_id: input.organizationId,
        user_id: input.userId,
      },
      'web-push-sender: NOTIFICATIONS_PUSH_ENABLED=false — no-op',
    );
    return;
  }

  // ── 2. Feature flag (decisão operacional) ───────────────────────────────────
  let flagEnabled: boolean;
  try {
    flagEnabled = await requireFlag(db, 'pwa.enabled', logger);
  } catch (err: unknown) {
    // Fail-closed: falha ao consultar a flag (ex.: banco indisponível) nunca
    // libera o envio.
    logger.error(
      {
        err,
        event: 'web_push.notification.flag_check_error',
        organization_id: input.organizationId,
        user_id: input.userId,
      },
      'web-push-sender: falha ao consultar pwa.enabled — fail-closed, no-op',
    );
    return;
  }

  if (!flagEnabled) {
    // requireFlag já loga o motivo (evento 'job.skipped_feature_disabled').
    return;
  }

  try {
    ensureVapidConfigured();

    // ── 3. Buscar subscriptions ativas do destinatário ───────────────────────
    const subscriptions = await getActivePushSubscriptionsByUser(
      db,
      input.organizationId,
      input.userId,
    );

    if (subscriptions.length === 0) {
      logger.debug(
        {
          event: 'web_push.notification.no_subscriptions',
          organization_id: input.organizationId,
          user_id: input.userId,
        },
        'web-push-sender: usuário sem subscriptions ativas — skip',
      );
      return;
    }

    // ── 4. Payload LGPD-mínimo (doc 24 §5.3 — sem PII) ───────────────────────
    const payload: WebPushPayload = {
      title: input.title,
      severity: input.severity,
      entity_type: input.entityType,
      entity_id: input.entityId,
    };
    const serializedPayload = JSON.stringify(payload);

    // ── 5. Enviar para cada subscription — falha isolada por subscription ────
    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            },
            serializedPayload,
          );

          logger.info(
            {
              event: 'web_push.notification.sent',
              organization_id: input.organizationId,
              user_id: input.userId,
              subscription_id: subscription.id,
            },
            'web-push-sender: push enviado com sucesso',
          );
        } catch (err: unknown) {
          // Subscription morta (endpoint expirado/revogado): remove (doc 24 §9).
          if (err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410)) {
            await softDeletePushSubscriptionByEndpoint(
              db,
              input.organizationId,
              input.userId,
              subscription.endpoint,
            );

            logger.info(
              {
                event: 'web_push.notification.subscription_removed',
                organization_id: input.organizationId,
                user_id: input.userId,
                subscription_id: subscription.id,
                status_code: err.statusCode,
              },
              'web-push-sender: subscription morta removida (404/410)',
            );
            return;
          }

          // Falha de envio não propaga — log sem PII, subscription isolada.
          logger.error(
            {
              err,
              event: 'web_push.notification.error',
              organization_id: input.organizationId,
              user_id: input.userId,
              subscription_id: subscription.id,
              // LGPD: endpoint/p256dh/auth NÃO incluídos — seriam PII no log
            },
            'web-push-sender: falha ao enviar push para subscription',
          );
        }
      }),
    );
  } catch (err: unknown) {
    // Guarda externa: falha inesperada (ex.: erro ao buscar subscriptions)
    // não propaga — mesmo contrato de sendEmail.
    logger.error(
      {
        err,
        event: 'web_push.notification.unexpected_error',
        organization_id: input.organizationId,
        user_id: input.userId,
      },
      'web-push-sender: falha inesperada — no-op',
    );
  }
}
