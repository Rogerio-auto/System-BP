// =============================================================================
// livechat/ai-handoff.ts — Handoff real + fallback ao cidadão (F16-S30).
//
// Responsabilidades:
//   - Enviar mensagem de fallback ao cidadão (ator de sistema, idempotente).
//   - Marcar conversa como 'pending' (aguardando atendente humano).
//   - Publicar conversation:updated no socket relay para refletir no inbox.
//   - Registrar auditoria (sem PII bruta).
//
// Dois gatilhos:
//   - reason='ai_unavailable': falha técnica do LangGraph (timeout/erro).
//   - reason='ai_requested' ou outro: handoff pedido pelo grafo (handoff.required=true).
//
// LGPD (doc 17 §8.1, §8.3):
//   - Mensagem de fallback é texto neutro sem PII.
//   - Logs não incluem content nem telefone — apenas IDs opacos.
//   - Audit log sem PII bruta (apenas IDs + reason).
//   - Idempotência via idempotency_keys (ai_fallback_<messageId>).
// =============================================================================
import { and, eq, isNull } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { conversations } from '../../db/schema/conversations.js';
import { auditLog } from '../../lib/audit.js';
import { logger } from '../../lib/logger.js';
import { makeEnvelope, publish } from '../../lib/queue/index.js';
import { QUEUES } from '../../lib/queue/topology.js';
import type { SendActorContext } from '../conversations/send.service.js';
import { sendMessage } from '../conversations/send.service.js';

const log = logger.child({ module: 'livechat-ai-handoff' });

/**
 * Texto de fallback enviado ao cidadão quando a IA não consegue responder.
 * Neutro, amigável e sem detalhe técnico — LGPD §8.3 (sem content em log).
 */
const FALLBACK_MESSAGE =
  'Olá! Um atendente vai te responder em instantes. Aguarde um momento. 🙂';

export interface HandoffOptions {
  organizationId: string;
  conversationId: string;
  /** ID da mensagem que disparou o job — usado como base da idempotency key. */
  messageId: string;
  /** Motivo do handoff: 'ai_unavailable' (falha técnica) ou string do grafo. */
  reason: string;
}

/**
 * Executa handoff real: fallback ao cidadão + marca conversa pending + relay.
 *
 * Idempotente: a idempotency key `ai_fallback_<messageId>` garante que a
 * mensagem de fallback não é enviada duas vezes em reprocessamento de fila.
 *
 * Contrato de saída:
 *   - Cidadão recebe mensagem de fallback (via sendMessage, ator de sistema).
 *   - Conversa muda para status 'pending' (aguardando humano).
 *   - Socket relay conversation:updated publicado para refletir no inbox.
 *   - Audit log registrado (reason, sem PII).
 */
export async function triggerLivechatHandoff(
  db: Database,
  opts: HandoffOptions,
): Promise<void> {
  const { organizationId, conversationId, messageId, reason } = opts;

  log.info(
    { organizationId, conversationId, messageId, reason },
    'livechat-ai-handoff: iniciando handoff',
  );

  const botActor: SendActorContext = {
    userId: null, // ator de sistema — null é FK uuid válida (audit_logs.actor_user_id)
    organizationId,
    role: 'system',
    cityScopeIds: null,
  };

  // 1. Enviar mensagem de fallback ao cidadão (idempotente por messageId)
  //    A idempotency key garante que não enviamos duas vezes em re-entrega da fila.
  const fallbackIdempKey = `ai_fallback_${messageId}`;

  try {
    await sendMessage(
      db,
      botActor,
      conversationId,
      { type: 'text', content: FALLBACK_MESSAGE },
      fallbackIdempKey,
    );
    log.info(
      { organizationId, conversationId, messageId },
      'livechat-ai-handoff: fallback enviado ao cidadao',
    );
  } catch (sendErr) {
    // Falha ao enviar fallback não deve bloquear o handoff — logamos e seguimos.
    // A janela de 24h pode já estar fechada (cidadão não interagiu há mais de 24h).
    // Nesse caso o handoff ainda deve ser registrado.
    log.warn(
      { organizationId, conversationId, messageId, err: sendErr },
      'livechat-ai-handoff: falha ao enviar fallback (janela fechada?) — prosseguindo com handoff',
    );
  }

  // 2. Marcar conversa como 'pending' (aguardando atendente humano)
  const updatedAt = new Date();

  await db
    .update(conversations)
    .set({
      status: 'pending',
      updatedAt,
    })
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.organizationId, organizationId),
        isNull(conversations.deletedAt),
      ),
    );

  // 3. Socket relay — conversation:updated para refletir no inbox
  await publish(
    QUEUES.socketRelay,
    makeEnvelope(QUEUES.socketRelay, organizationId, {
      room: `workspace:${organizationId}`,
      event: 'conversation:updated',
      data: {
        conversationId,
        status: 'pending',
        organizationId,
        updatedAt: updatedAt.toISOString(),
        // handoff_reason não é PII — indica o tipo de handoff para o inbox mostrar
        handoff_reason: reason === 'ai_unavailable' ? 'ai_unavailable' : 'ai_requested',
      },
    }),
  );

  // 4. Audit log — sem PII bruta (apenas IDs + reason)
  await auditLog(db as Parameters<typeof auditLog>[0], {
    organizationId,
    actor: null, // ator de sistema
    action: 'livechat.ai_handoff',
    resource: { type: 'conversation', id: conversationId },
    before: null,
    after: {
      status: 'pending',
      handoff_reason: reason,
      message_id: messageId,
    },
  });

  log.info(
    { organizationId, conversationId, messageId, reason },
    'livechat-ai-handoff: handoff concluido — conversa pending, relay publicado',
  );
}
