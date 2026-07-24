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
//   - Notificação ao humano: body sem PII do cidadão do WhatsApp/relay/audit —
//     cidade (dado público) sempre pode ir a qualquer canal. EXCEÇÃO
//     controlada (F29-S01): o nome de exibição do contato/lead é PII e é
//     incluído SOMENTE no body do canal in-app (ver guarda em
//     `dispatchHandoffNotifications`) — nunca no log, no relay de socket,
//     no e-mail, no Web Push nem no audit.
//
// F29-S01 — checklist §14.2 do doc 17 (PR `lgpd-impact`):
//   - Finalidade: informar ao atendente humano QUEM e ONDE está o cidadão
//     aguardando, para priorizar/rotear o atendimento (Art. 7º IX — legítimo
//     interesse no exercício regular de atividade, escopo interno).
//   - Base legal: Art. 7º IX (interesse legítimo do controlador na prestação
//     do atendimento) / Art. 7º V (execução de contrato/procedimento
//     preliminar a pedido do titular).
//   - Minimização: nome só é lido para o body in-app; nunca persistido em
//     outro lugar novo, nunca propagado a log/relay/audit/e-mail/Web Push.
//   - Retenção: acompanha a retenção já existente de `notifications` (sem
//     job dedicado hoje — gap pré-existente, fora do escopo deste slot).
//   - Redação de log: nenhum log novo referencia nome/cidade do cliente;
//     `pino.redact` global já cobre os campos padrão da lista canônica.
// =============================================================================
import { and, eq, isNull } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { cities } from '../../db/schema/cities.js';
import { conversations } from '../../db/schema/conversations.js';
import { leads } from '../../db/schema/leads.js';
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

/**
 * Fallback pelo lead vinculado à conversa (F29-S01) — usado só quando a
 * própria conversa ainda não tem `cityId` e/ou `contactName`. Um lead novo
 * de WhatsApp em pré-atendimento normalmente ainda não tem cidade
 * identificada na conversa (o nó `identify_city` do grafo preenche o lead
 * antes da conversa); a cidade "mora" no lead nesse momento.
 *
 * `name` é PII (LGPD §8.1) — o chamador é responsável por só usá-lo no body
 * do canal in-app (ver guarda em `dispatchHandoffNotifications`).
 * `cityId` é dado público — pode circular por qualquer canal.
 *
 * Único select, escopado por organizationId (mesma defesa de tenant que o
 * restante do módulo).
 */
async function resolveLeadFallback(
  db: Database,
  organizationId: string,
  leadId: string,
): Promise<{ cityId: string | null; name: string | null }> {
  const rows = await db
    .select({ cityId: leads.cityId, name: leads.name })
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)))
    .limit(1);
  const row = rows[0];
  return { cityId: row?.cityId ?? null, name: row?.name ?? null };
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
 * LGPD §8.5: cidade é dado público (pode ir a qualquer canal); motivo do
 * handoff vem de catálogo fechado (não é PII); tempo de espera é derivado de
 * `conversations.last_inbound_at` (timestamp operacional, não PII).
 *
 * F29-S01 — EXCEÇÃO CONTROLADA: `contactName`/`leadId` habilitam incluir o
 * nome de exibição do cliente no `body`. Isso só é seguro porque esta função
 * despacha EXCLUSIVAMENTE via `sendInApp` (nunca `sendWebPush`/`sendEmail` —
 * ver cabeçalho do arquivo) e `sendInApp` não propaga `body` ao payload do
 * socket em tempo real (só `title`, sem PII). O nome NUNCA deve ser incluído
 * em `log.*`, no payload do socket relay (`publish(QUEUES.socketRelay, …)`
 * em `triggerLivechatHandoff`) ou no `auditLog`. Se esta função algum dia
 * passar a despachar outro canal (email/WhatsApp/Web Push), o nome NÃO pode
 * acompanhar — mantenha-o restrito ao `body` do `sendInApp` abaixo.
 *
 * try/catch isolado por destinatário: falha de notificação não deve
 * derrubar o handoff (já concluído — fallback enviado, status atualizado,
 * audit registrado).
 */
async function dispatchHandoffNotifications(
  db: Database,
  params: {
    organizationId: string;
    conversationId: string;
    cityId: string | null;
    /** Lead vinculado à conversa — usado só como fallback de cidade/nome. */
    leadId: string | null;
    /**
     * Nome de exibição do contato (PII — LGPD §8.1). Vem da própria
     * conversa; fallback pelo lead ocorre abaixo quando ausente. Usado
     * SOMENTE no `body` do `sendInApp` (ver guarda acima).
     */
    contactName: string | null;
    reason: string;
    /** Último inbound do cidadão — base do "tempo esperando". null = desconhecido. */
    waitingSince: Date | null;
    recipients: ResolvedRecipient[];
  },
): Promise<void> {
  if (params.recipients.length === 0) return;

  // Fallback pelo lead: cidade (dado público) e nome (PII, só body in-app) —
  // preferir sempre os dados já presentes na conversa; lead é só reserva.
  // Um único select condicional (não roda se conversa já tem os dois dados).
  let effectiveCityId = params.cityId;
  let leadName: string | null = null;
  if (params.leadId !== null && (effectiveCityId === null || params.contactName === null)) {
    const fallback = await resolveLeadFallback(db, params.organizationId, params.leadId);
    if (effectiveCityId === null) effectiveCityId = fallback.cityId;
    leadName = fallback.name;
  }

  const cityName = await resolveCityName(db, effectiveCityId);
  const reasonLabel = describeHandoffReason(params.reason);
  const waitLabel =
    params.waitingSince !== null
      ? formatWaitDuration(Date.now() - params.waitingSince.getTime())
      : null;

  const title = 'Atendimento precisa de humano';
  const locationPart = cityName !== null ? ` (${cityName})` : '';
  const waitPart = waitLabel !== null ? ` — aguardando há ${waitLabel}` : '';

  // ---------------------------------------------------------------------
  // GUARDA LGPD (doc 17 §8.1/§8.5, F29-S01): `customerName` é PII. A partir
  // daqui ele só pode alimentar `body` — não retorne, não logue, não
  // publique este valor em nenhum outro lugar desta função ou do chamador.
  // ---------------------------------------------------------------------
  const customerName = params.contactName ?? leadName;
  const body =
    customerName !== null
      ? `${customerName} — conversa no WhatsApp${locationPart} precisa de atendimento humano. ` +
        `Motivo: ${reasonLabel}${waitPart}.`
      : `Uma conversa no WhatsApp${locationPart} precisa de atendimento humano. ` +
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
      // NÃO incluir `customerName`/`body` aqui — guarda LGPD acima.
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
      // Fallback de cidade/nome pelo lead (F29-S01) — leadId é FK opaca,
      // contactName é PII (só usado no body do canal in-app, ver
      // dispatchHandoffNotifications).
      leadId: conversations.leadId,
      contactName: conversations.contactName,
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
      leadId: claim.leadId,
      contactName: claim.contactName,
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
