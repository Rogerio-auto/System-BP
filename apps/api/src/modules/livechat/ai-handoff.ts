// =============================================================================
// livechat/ai-handoff.ts — Handoff real + fallback ao cidadão (F16-S30).
//
// Responsabilidades:
//   - Enviar mensagem de fallback ao cidadão (ator de sistema, idempotente).
//   - Marcar conversa como 'pending' (aguardando atendente humano) e travar
//     o handoff como já-disparado (ai_handoff_at).
//   - Publicar conversation:updated no socket relay para refletir no inbox.
//   - Registrar auditoria (sem PII bruta).
//   - Notificar o agente atribuído (se houver) e os gestores responsáveis.
//
// Dois gatilhos:
//   - reason='ai_unavailable': falha técnica do LangGraph (timeout/erro).
//   - reason='ai_requested' ou outro: handoff pedido pelo grafo (handoff.required=true).
//
// Idempotência de estado (bug de produção corrigido — migration 0091):
//   Toda mensagem inbound do cliente re-disparava este handoff (o gate só
//   olhava assignedUserId, nunca o status) e o handoff em si só era
//   idempotente por messageId — o resultado era reenviar o fallback
//   "Um atendente vai te responder…" a cada nova mensagem. A trava real é
//   um UPDATE atômico condicionado a `ai_handoff_at IS NULL`: só a PRIMEIRA
//   chamada (por conversa) consegue "reivindicar" o handoff — chamadas
//   subsequentes são no-op idempotente (sem fallback duplicado, sem
//   re-auditoria, sem re-notificação).
//
// LGPD (doc 17 §8.1, §8.3, §8.5):
//   - Mensagem de fallback é texto neutro sem PII.
//   - Logs não incluem content nem telefone — apenas IDs opacos.
//   - Audit log sem PII bruta (apenas IDs + reason).
//   - Idempotência de envio via idempotency_keys (ai_fallback_<messageId>).
//   - Notificação ao humano: body sem PII do cidadão (nome/telefone/CPF) —
//     no máximo o nome do município (dado público, não PII).
// =============================================================================
import { and, eq, isNull } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { cities } from '../../db/schema/cities.js';
import { conversations } from '../../db/schema/conversations.js';
import { users } from '../../db/schema/users.js';
import { auditLog } from '../../lib/audit.js';
import { logger } from '../../lib/logger.js';
import { makeEnvelope, publish } from '../../lib/queue/index.js';
import { QUEUES } from '../../lib/queue/topology.js';
import type { SendActorContext } from '../conversations/send.service.js';
import { sendMessage } from '../conversations/send.service.js';
import { resolveByRoleCity, resolveManagers } from '../notification-rules/recipients.js';
import type { ResolvedRecipient } from '../notification-rules/recipients.js';
import { sendInApp } from '../notifications/senders/inApp.js';

const log = logger.child({ module: 'livechat-ai-handoff' });

/**
 * Texto de fallback enviado ao cidadão quando a IA não consegue responder.
 * Neutro, amigável e sem detalhe técnico — LGPD §8.3 (sem content em log).
 */
const FALLBACK_MESSAGE = 'Olá! Um atendente vai te responder em instantes. Aguarde um momento. 🙂';

/** Roles que também recebem a notificação de handoff, além do agente atribuído. */
const HANDOFF_MANAGER_ROLE_KEYS = ['gestor_regional'] as const;

const HANDOFF_NOTIFICATION_TYPE = 'livechat.handoff';

export interface HandoffOptions {
  organizationId: string;
  conversationId: string;
  /** ID da mensagem que disparou o job — usado como base da idempotency key. */
  messageId: string;
  /** Motivo do handoff: 'ai_unavailable' (falha técnica) ou string do grafo. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Resolução de destinatários da notificação de handoff
// ---------------------------------------------------------------------------

/**
 * Busca o agente atribuído à conversa (se houver e estiver ativo).
 * Diferente de `resolveAssignee` (notification-rules/recipients.ts), que
 * resolve pelo assignee do kanban_card do lead — aqui o assignee é o da
 * própria conversa de livechat, já disponível no UPDATE atômico do handoff.
 */
async function resolveConversationAssignee(
  db: Database,
  organizationId: string,
  assignedUserId: string,
): Promise<ResolvedRecipient[]> {
  const rows = await db
    .select({ id: users.id, organizationId: users.organizationId, fullName: users.fullName })
    .from(users)
    .where(
      and(
        eq(users.id, assignedUserId),
        eq(users.organizationId, organizationId),
        eq(users.status, 'active'),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (row === undefined) return [];

  return [
    {
      userId: row.id,
      organizationId: row.organizationId,
      displayName: row.fullName,
      channels: ['in_app'],
    },
  ];
}

/**
 * Resolve os destinatários da notificação de handoff:
 *   - Agente atribuído à conversa (se houver e ativo).
 *   - Gestores gerais/admin da org (resolveManagers).
 *   - Gestor regional com escopo na cidade da conversa (cityId null = geral).
 *
 * Dedupe por userId (um usuário pode acumular mais de um papel).
 */
async function resolveHandoffRecipients(
  db: Database,
  organizationId: string,
  cityId: string | null,
  assignedUserId: string | null,
): Promise<ResolvedRecipient[]> {
  const [assignee, managers, regionalManagers] = await Promise.all([
    assignedUserId !== null
      ? resolveConversationAssignee(db, organizationId, assignedUserId)
      : Promise.resolve([]),
    resolveManagers(db, organizationId, ['in_app']),
    resolveByRoleCity(db, organizationId, [...HANDOFF_MANAGER_ROLE_KEYS], cityId, ['in_app']),
  ]);

  const seen = new Set<string>();
  const deduped: ResolvedRecipient[] = [];
  for (const recipient of [...assignee, ...managers, ...regionalManagers]) {
    if (!seen.has(recipient.userId)) {
      seen.add(recipient.userId);
      deduped.push(recipient);
    }
  }
  return deduped;
}

/** Nome do município da conversa (dado público, não PII) — null se cityId ausente/inválido. */
async function resolveCityName(db: Database, cityId: string | null): Promise<string | null> {
  if (cityId === null) return null;
  const rows = await db
    .select({ name: cities.name })
    .from(cities)
    .where(eq(cities.id, cityId))
    .limit(1);
  return rows[0]?.name ?? null;
}

// ---------------------------------------------------------------------------
// Enriquecimento do corpo da notificação (F26-S02, doc 23 §12.3/§14 — G4)
// ---------------------------------------------------------------------------

/**
 * Rótulos legíveis para o motivo do handoff (catálogo doc 06 §7.4 +
 * 'ai_requested' — fallback usado pelo worker de livechat quando o grafo
 * sinaliza handoff.required sem reason). Motivo desconhecido/futuro cai no
 * rótulo genérico — nunca ecoa a string bruta do LLM sem checagem contra o
 * catálogo conhecido (defesa contra valor inesperado no corpo da notificação).
 */
const HANDOFF_REASON_LABELS: Readonly<Record<string, string>> = {
  ai_unavailable: 'IA indisponível',
  ai_requested: 'atendimento humano solicitado pela IA',
  cliente_solicitou_atendente: 'cliente pediu para falar com atendente',
  consultar_andamento: 'cliente quer saber o andamento',
  cobranca: 'assunto de cobrança',
  reclamacao: 'reclamação',
  nao_entendeu: 'IA não entendeu a solicitação',
  fora_de_escopo: 'fora do escopo do assistente',
  loop_detected: 'loop de conversa detectado',
  tool_error: 'falha técnica em uma ação da IA',
};

/** Traduz o `reason` do handoff em texto curto para o corpo da notificação. */
function describeHandoffReason(reason: string): string {
  return HANDOFF_REASON_LABELS[reason] ?? 'atendimento humano solicitado';
}

/**
 * Formata a duração de espera em texto curto e não-sensível (só números
 * derivados de timestamps já existentes — LGPD §8.5, sem PII).
 */
function formatWaitDuration(sinceMs: number): string {
  const minutes = Math.floor(sinceMs / 60_000);
  if (minutes < 1) return 'menos de 1 minuto';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remMinutes = minutes % 60;
    return remMinutes > 0 ? `${hours}h${remMinutes}min` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `${days} dia${days > 1 ? 's' : ''}`;
}

/**
 * Despacha a notificação in-app de handoff a cada destinatário.
 *
 * LGPD §8.5: body cita, no máximo, o nome do município (dado público), o
 * motivo do handoff (catálogo fechado — não é PII) e o tempo de espera
 * (derivado de `conversations.last_inbound_at`, um timestamp operacional) —
 * NUNCA telefone, CPF ou nome do contato. try/catch isolado por
 * destinatário: falha de notificação não deve derrubar o handoff (já
 * concluído — fallback enviado, status atualizado, audit registrado).
 */
async function dispatchHandoffNotifications(
  db: Database,
  params: {
    organizationId: string;
    conversationId: string;
    cityId: string | null;
    reason: string;
    /** Último inbound do cidadão — base do "tempo esperando". null = desconhecido. */
    waitingSince: Date | null;
    recipients: ResolvedRecipient[];
  },
): Promise<void> {
  if (params.recipients.length === 0) return;

  const cityName = await resolveCityName(db, params.cityId);
  const reasonLabel = describeHandoffReason(params.reason);
  const waitLabel =
    params.waitingSince !== null
      ? formatWaitDuration(Date.now() - params.waitingSince.getTime())
      : null;

  const title = 'Atendimento precisa de humano';
  const locationPart = cityName !== null ? ` (${cityName})` : '';
  const waitPart = waitLabel !== null ? ` — aguardando há ${waitLabel}` : '';
  const body =
    `Uma conversa no WhatsApp${locationPart} precisa de atendimento humano. ` +
    `Motivo: ${reasonLabel}${waitPart}.`;

  for (const recipient of params.recipients) {
    try {
      await sendInApp(db, {
        organizationId: params.organizationId,
        userId: recipient.userId,
        type: HANDOFF_NOTIFICATION_TYPE,
        title,
        body,
        entityType: 'conversation',
        entityId: params.conversationId,
        severity: 'warning',
      });
    } catch (err) {
      log.error(
        {
          err,
          organizationId: params.organizationId,
          conversationId: params.conversationId,
          userId: recipient.userId,
        },
        'livechat-ai-handoff: falha ao notificar destinatário — isolado, continuando',
      );
    }
  }
}

/**
 * Executa handoff real: fallback ao cidadão + marca conversa pending + relay
 * + notifica humano responsável.
 *
 * Idempotente por ESTADO da conversa: um UPDATE atômico condicionado a
 * `ai_handoff_at IS NULL` garante que apenas a primeira chamada (por
 * conversa) executa o fallback/audit/notificação — chamadas subsequentes
 * (nova mensagem inbound antes do humano assumir) são no-op silencioso.
 *
 * Contrato de saída (primeira chamada):
 *   - Cidadão recebe mensagem de fallback (via sendMessage, ator de sistema).
 *   - Conversa muda para status 'pending' (aguardando humano) com ai_handoff_at setado.
 *   - Socket relay conversation:updated publicado para refletir no inbox.
 *   - Audit log registrado (reason, sem PII).
 *   - Agente atribuído + gestores notificados in-app (sem PII no corpo).
 */
export async function triggerLivechatHandoff(db: Database, opts: HandoffOptions): Promise<void> {
  const { organizationId, conversationId, messageId, reason } = opts;

  log.info(
    { organizationId, conversationId, messageId, reason },
    'livechat-ai-handoff: iniciando handoff',
  );

  // 0. Reivindicação atômica: só a primeira chamada por conversa "ganha" —
  //    condição isNull(aiHandoffAt) garante disparo único mesmo sob
  //    reprocessamento de fila ou mensagens quase simultâneas.
  const now = new Date();
  const claimed = await db
    .update(conversations)
    .set({ aiHandoffAt: now, status: 'pending', updatedAt: now })
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.organizationId, organizationId),
        isNull(conversations.aiHandoffAt),
        isNull(conversations.deletedAt),
      ),
    )
    .returning({
      id: conversations.id,
      cityId: conversations.cityId,
      assignedUserId: conversations.assignedUserId,
      // Base do "tempo esperando" no corpo da notificação (F26-S02) — último
      // inbound do cidadão antes deste UPDATE (a própria mensagem que
      // disparou o handoff, no caso do gatilho do grafo). Timestamp
      // operacional, não PII.
      lastInboundAt: conversations.lastInboundAt,
    });

  const claim = claimed[0];
  if (claim === undefined) {
    // Handoff já ocorrido (ou conversa inexistente/deletada) — no-op idempotente.
    // Isso é o que impede o loop de reenvio do fallback em produção.
    log.info(
      { organizationId, conversationId, messageId, event: 'livechat_handoff_already_done' },
      'livechat-ai-handoff: handoff ja disparado anteriormente — no-op idempotente',
    );
    return;
  }

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

  // 2. Socket relay — conversation:updated para refletir no inbox
  //    (status já foi setado no UPDATE atômico acima — única fonte de escrita.)
  await publish(
    QUEUES.socketRelay,
    makeEnvelope(QUEUES.socketRelay, organizationId, {
      room: `workspace:${organizationId}`,
      event: 'conversation:updated',
      data: {
        conversationId,
        status: 'pending',
        organizationId,
        updatedAt: now.toISOString(),
        // handoff_reason não é PII — indica o tipo de handoff para o inbox mostrar
        handoff_reason: reason === 'ai_unavailable' ? 'ai_unavailable' : 'ai_requested',
      },
    }),
  );

  // 3. Audit log — sem PII bruta (apenas IDs + reason)
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

  // 4. Notificação ao humano responsável (agente atribuído + gestores).
  //    Best-effort: falha isolada por destinatário não desfaz o handoff acima.
  try {
    const recipients = await resolveHandoffRecipients(
      db,
      organizationId,
      claim.cityId,
      claim.assignedUserId,
    );
    await dispatchHandoffNotifications(db, {
      organizationId,
      conversationId,
      cityId: claim.cityId,
      reason,
      waitingSince: claim.lastInboundAt,
      recipients,
    });
  } catch (notifyErr) {
    log.error(
      { err: notifyErr, organizationId, conversationId, messageId },
      'livechat-ai-handoff: falha ao resolver/despachar notificacoes — handoff ja concluido, seguindo',
    );
  }
}

// Reexport para uso em testes (resolvers puros, sem side-effect de rede).
export { resolveHandoffRecipients as __resolveHandoffRecipientsForTests };
