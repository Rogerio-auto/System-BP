// =============================================================================
// conversations/service.ts — Orquestração das rotas de leitura de conversas (F16-S12).
//
// Responsabilidades:
//   - listConversations: aplica filtros, escopo de cidade, paginação por cursor.
//   - getConversationDetail: busca conversa + decifra contactPhone (se autorizado)
//     + monta composerState via getComposerState (S07).
//   - getMessages: lista mensagens por cursor e marca como lidas.
//
// Regras LGPD (doc 17 §8.1):
//   - contactPhoneEnc: só decifrado se o caller possui crm:contact:phone:read.
//   - Logs com redact de PII (contactName, contactRemoteId, content).
//   - Respostas sem PII bruta: contact_remote_id retornado como campo opaco,
//     contactPhone apenas no detalhe autorizado.
//
// Multi-tenant:
//   - Todos os métodos recebem organizationId explícito (preparado para F17).
//   - applyCityScope aplicado via UserScopeCtx passado do request.user.
//
// markConversationRead: emite conversation:updated no socket relay (F16-S26) após zerar unread_count.
// =============================================================================

import { and, asc, eq, isNull } from 'drizzle-orm';
import pino from 'pino';

import type { Database } from '../../db/client.js';
import { conversations } from '../../db/schema/conversations.js';
import type { Message } from '../../db/schema/messages.js';
import { messages } from '../../db/schema/messages.js';
import { whatsappTemplates } from '../../db/schema/whatsappTemplates.js';
import type { AuditTx } from '../../lib/audit.js';
import { auditLog } from '../../lib/audit.js';
import { decryptPii } from '../../lib/crypto/pii.js';
import { makeEnvelope, publish } from '../../lib/queue/index.js';
import { QUEUES } from '../../lib/queue/topology.js';
import { AppError, ConflictError } from '../../shared/errors.js';
import type { UserScopeCtx } from '../../shared/scope.js';
import { getOrCreateLead } from '../leads/service.js';
import type { ConversationRow } from '../livechat/repo.js';
import { countConversationsByStatus, linkConversationLead } from '../livechat/repo.js';
import type { ComposerState } from '../livechat/schemas.js';
import {
  findChannel,
  getComposerState,
  getConversation,
  getMessages as repoGetMessages,
  listConversations as repoListConversations,
} from '../livechat/service.js';
import { fetchApprovedTemplatesFromMeta } from '../templates/service.js';

import type {
  ConversationCountsQuery,
  ConversationCountsResponse,
  ConversationDetail,
  ConversationListResponse,
  ConversationListQuery,
  MessageListResponse,
  MessageListQuery,
  WindowState,
  LinkLeadBody,
  LinkLeadResponse,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Logger com redact de PII (doc 17 §8.3)
// ---------------------------------------------------------------------------

const log = pino({
  name: 'conversations.service',
  redact: {
    paths: ['contactName', 'contactRemoteId', 'contactPhone', 'content'],
    censor: '[redacted]',
  },
});

// ---------------------------------------------------------------------------
// Helpers de mapeamento Drizzle → DTO
// ---------------------------------------------------------------------------

/**
 * Converte uma ConversationRow (Drizzle + provider join) para o DTO público de listagem.
 * SEM contactPhone (LGPD M1).
 */
function toConversationDto(conv: ConversationRow): Omit<ConversationDetail, 'contactPhone'> {
  return {
    id: conv.id,
    organizationId: conv.organizationId,
    cityId: conv.cityId,
    channelId: conv.channelId,
    contactRemoteId: conv.contactRemoteId,
    contactName: conv.contactName,
    leadId: conv.leadId,
    customerId: conv.customerId ?? null,
    status: conv.status as ConversationDetail['status'],
    assignedUserId: conv.assignedUserId,
    lastInboundAt: conv.lastInboundAt?.toISOString() ?? null,
    lastMessageAt: conv.lastMessageAt?.toISOString() ?? null,
    kind: conv.kind as ConversationDetail['kind'],
    provider: conv.provider as ConversationDetail['provider'],
    unreadCount: conv.unreadCount,
    createdAt: conv.createdAt.toISOString(),
    updatedAt: conv.updatedAt.toISOString(),
  };
}

/**
 * Converte uma Message (Drizzle) para MessageDto público.
 * LGPD: content é PII — não logar.
 */
function toMessageDto(msg: Message): MessageListResponse['data'][number] {
  return {
    id: msg.id,
    conversationId: msg.conversationId,
    channelId: msg.channelId,
    direction: msg.direction as 'in' | 'out',
    externalId: msg.externalId,
    type: msg.type as MessageListResponse['data'][number]['type'],
    content: msg.content,
    mediaUrl: msg.mediaUrl,
    mediaMime: msg.mediaMime,
    mediaSizeBytes: msg.mediaSizeBytes,
    mediaSha256: msg.mediaSha256,
    // `as` justificado: interactivePayload é jsonb (Record<string,unknown> | null) no Drizzle
    // schema mas pode vir como objeto genérico — o tipo Zod aceita Record<string,unknown> | null.
    interactivePayload: msg.interactivePayload as Record<string, unknown> | null,
    viewStatus: msg.viewStatus as MessageListResponse['data'][number]['viewStatus'],
    metadata: (msg.metadata ?? {}) as Record<string, unknown>,
    createdAt: msg.createdAt.toISOString(),
    updatedAt: msg.updatedAt.toISOString(),
  };
}

/**
 * Converte ComposerState do S07 (lastInboundAt: Date | null) para WindowState (ISO string).
 */
function toWindowStateDto(state: ComposerState): WindowState {
  return {
    conversationId: state.conversationId,
    provider: state.provider,
    window: state.window,
    lastInboundAt: state.lastInboundAt !== null ? state.lastInboundAt.toISOString() : null,
    remainingMs: state.remainingMs,
  };
}

// ---------------------------------------------------------------------------
// ActorContext — subconjunto de request.user necessário para as operações
// ---------------------------------------------------------------------------

export interface ActorContext {
  readonly userId: string;
  readonly organizationId: string;
  readonly cityScopeIds: string[] | null;
  readonly permissions: string[];
}

// ---------------------------------------------------------------------------
// listConversationsService
// ---------------------------------------------------------------------------

/**
 * Lista conversas com filtros, escopo de cidade e paginação por cursor.
 *
 * Ordenação: last_message_at DESC (mais recentes primeiro).
 * Paginação: cursor por `id` da última conversa da página anterior.
 *
 * LGPD: resposta sem contactPhone (listagem não exige PII de telefone).
 *
 * @returns Lista de conversas + nextCursor para a próxima página.
 */
export async function listConversationsService(
  db: Database,
  actor: ActorContext,
  query: ConversationListQuery,
): Promise<ConversationListResponse> {
  const { organizationId, cityScopeIds } = actor;
  const { status, channelId, assignedUserId, cursor, limit } = query;

  log.debug(
    { organizationId, status, channelId, limit },
    'conversations.service: listConversations',
  );

  const rows = await repoListConversations(db, {
    organizationId,
    cityScopeIds,
    // status omitido = TODOS os status (aba "Todas" do inbox). O repo só aplica
    // o filtro eq(status) quando definido. O front envia 'open' por default;
    // apenas a aba "Todas" omite o param.
    status,
    channelId,
    assignedUserId,
    cursor,
    limit,
  });

  // nextCursor: se retornou `limit` itens, pode haver mais
  const lastRow = rows[rows.length - 1];
  const nextCursor = rows.length === limit && lastRow !== undefined ? lastRow.id : null;

  return {
    data: rows.map(toConversationDto),
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// countConversationsService
// ---------------------------------------------------------------------------

/**
 * Contagem de conversas por status no escopo da organização.
 *
 * Live chat é org-wide (mesmo escopo de `listConversationsService`): city scope
 * não é aplicado ao inbox — apenas organizationId é usado como filtro obrigatório.
 *
 * Filtros opcionais caçam com os filtros da rota GET /conversations para
 * consistência visual (os badges de contagem refletem o filtro ativo na lista).
 *
 * @param db    Instância do banco
 * @param actor Contexto do ator (organizationId obrigatório)
 * @param query Filtros opcionais: channelId, assignedUserId
 * @returns Objeto com contagem por status + total
 */
export async function countConversationsService(
  db: Database,
  actor: ActorContext,
  query: ConversationCountsQuery,
): Promise<ConversationCountsResponse> {
  const { organizationId } = actor;
  const { channelId, assignedUserId } = query;

  log.debug(
    { organizationId, channelId, assignedUserId },
    'conversations.service: countConversations',
  );

  // ConversationCounts (repo) e ConversationCountsResponse (schema) têm a
  // mesma shape — TypeScript aceita via compatibilidade estrutural sem cast.
  return countConversationsByStatus(db, { organizationId, channelId, assignedUserId });
}

// ---------------------------------------------------------------------------
// getConversationDetailService
// ---------------------------------------------------------------------------

/**
 * Busca o detalhe de uma conversa com estado da janela de composição.
 *
 * LGPD: contactPhone decifrado apenas se `hasPhonePermission = true`.
 *
 * @param hasPhonePermission - true se o usuário possui crm:contact:phone:read.
 * @throws NotFoundError se conversa não pertencer à org/escopo do usuário.
 */
export async function getConversationDetailService(
  db: Database,
  actor: ActorContext,
  conversationId: string,
  hasPhonePermission: boolean,
): Promise<{ data: ConversationDetail; composerState: WindowState }> {
  const { organizationId, cityScopeIds } = actor;

  log.debug({ organizationId, conversationId }, 'conversations.service: getConversationDetail');

  // 1. Busca conversa com escopo de cidade (lança NotFoundError se fora do escopo)
  const userCtx: UserScopeCtx = { cityScopeIds };
  const conv = await getConversation(db, conversationId, organizationId, userCtx);

  // 2. Busca canal para calcular composer state
  const channel = await findChannel(db, conv.channelId, organizationId);

  // 3. Calcula estado da janela
  const composerStateRaw = getComposerState(conv, channel);
  const composerState = toWindowStateDto(composerStateRaw);

  // 4. Decifra contactPhone apenas se autorizado (LGPD M1)
  let contactPhone: string | null = null;

  if (hasPhonePermission && conv.contactPhoneEnc !== null && conv.contactPhoneEnc !== undefined) {
    // decryptPii retorna string utf-8 (número E.164)
    // LGPD: não logar o valor decifrado
    contactPhone = await decryptPii(conv.contactPhoneEnc);
  }

  // Enrichece com provider do canal (já carregado no passo 2)
  const convWithProvider: ConversationRow = { ...conv, provider: channel.provider };

  const data: ConversationDetail = {
    ...toConversationDto(convWithProvider),
    contactPhone,
  };

  return { data, composerState };
}

// ---------------------------------------------------------------------------
// getMessagesService
// ---------------------------------------------------------------------------

/**
 * Lista mensagens de uma conversa com paginação por cursor.
 *
 * Ao acessar as mensagens, zera o `unread_count` da conversa e marca
 * as mensagens inbound pendentes como 'read'.
 *
 * LGPD: content é PII — não logado.
 *
 * @throws NotFoundError se conversa não pertencer à org/escopo do usuário.
 */
export async function getMessagesService(
  db: Database,
  actor: ActorContext,
  conversationId: string,
  query: MessageListQuery,
): Promise<MessageListResponse> {
  const { organizationId, cityScopeIds } = actor;
  const { before, limit } = query;

  log.debug({ organizationId, conversationId, limit }, 'conversations.service: getMessages');

  // 1. Verifica que a conversa existe e pertence ao escopo (oracle protection)
  const userCtx: UserScopeCtx = { cityScopeIds };
  await getConversation(db, conversationId, organizationId, userCtx);

  // 2. Busca mensagens paginadas
  const msgs = await repoGetMessages(db, {
    conversationId,
    before,
    limit,
  });

  // 3. Marca mensagens inbound não lidas como 'read' + zera unread_count
  // Fire-and-forget: não bloqueia a resposta. Em caso de falha, o unread_count
  // ficará inconsistente até próximo acesso — aceitável para leitura.
  markConversationRead(db, conversationId, organizationId).catch((err: unknown) => {
    log.warn(
      { organizationId, conversationId, err },
      'conversations.service: falha ao marcar como lido (non-blocking)',
    );
  });

  // nextCursor: se retornou `limit` itens, pode haver mensagens mais antigas
  const firstRow = msgs[0];
  const nextCursor = msgs.length === limit && firstRow !== undefined ? firstRow.id : null;

  return {
    data: msgs.map(toMessageDto),
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// markConversationRead (helper interno)
// ---------------------------------------------------------------------------

/**
 * Zera unread_count da conversa e marca mensagens inbound pendentes como 'read'.
 *
 * Operação não-crítica: falha silenciosa (caller usa .catch()).
 * Sem emissão de eventos de outbox (leitura não tem side-effect de domínio).
 */
async function markConversationRead(
  db: Database,
  conversationId: string,
  organizationId: string,
): Promise<void> {
  // Zera unread_count da conversa (seguro por AND organizationId)
  await db
    .update(conversations)
    .set({ unreadCount: 0, updatedAt: new Date() })
    .where(
      and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)),
    );

  // Marca mensagens inbound com viewStatus null (pending inbound) como 'read'
  // view_status em mensagens inbound: null indica não processado
  await db
    .update(messages)
    .set({ viewStatus: 'read', updatedAt: new Date() })
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.direction, 'in'),
        isNull(messages.viewStatus),
      ),
    );

  // F16-S26: emitir conversation:updated no socket relay para o badge de não-lidas
  // atualizar em tempo real em todos os atendentes (room = workspace:{orgId}).
  // LGPD: payload contém apenas IDs opacos — sem content/PII (doc 17 §8.1).
  // Fire-and-forget: falha de publish não deve interromper o GET /messages.
  await publish(
    QUEUES.socketRelay,
    makeEnvelope(QUEUES.socketRelay, organizationId, {
      room: `workspace:${organizationId}`,
      event: 'conversation:updated',
      data: {
        conversationId,
        unreadCount: 0,
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// getConversationTemplatesService
// ---------------------------------------------------------------------------

/**
 * DTO público de um template aprovado, retornado pelo seletor de template.
 * `body_text` alias de `body` para clareza no contrato frontend.
 */
export interface TemplateDto {
  readonly id: string;
  readonly name: string;
  readonly category: 'utility' | 'marketing' | 'authentication';
  readonly variables: string[];
  /** Corpo do template com placeholders {{1}}, {{2}} etc. */
  readonly body_text: string;
}

export interface ConversationTemplatesResponse {
  readonly data: TemplateDto[];
}

/**
 * Lista templates aprovados para o seletor de template do live chat.
 *
 * Fonte primária: Meta API (WABA) — sempre fresco, sem necessidade de sync prévio.
 * Fallback: banco local (whatsapp_templates status=approved) se a Meta falhar.
 * Efeito colateral: upsert no DB local (fire-and-forget) para manter sincronismo.
 *
 * @throws NotFoundError se conversa não pertencer à org/escopo do usuário.
 */
export async function getConversationTemplatesService(
  db: Database,
  actor: ActorContext,
  conversationId: string,
): Promise<ConversationTemplatesResponse> {
  const { organizationId, cityScopeIds } = actor;

  log.debug({ organizationId, conversationId }, 'conversations.service: getConversationTemplates');

  // 1. Valida que a conversa pertence ao escopo do actor (oracle protection)
  const userCtx: UserScopeCtx = { cityScopeIds };
  const conv = await getConversation(db, conversationId, organizationId, userCtx);

  // 2. Fonte primária: Meta API — puxar templates aprovados diretamente do WABA
  try {
    const metaItems = await fetchApprovedTemplatesFromMeta(conv.organizationId);
    return {
      data: metaItems.map((t) => ({
        id: t.id,
        name: t.name,
        category: t.category,
        variables: t.variables,
        body_text: t.body,
      })),
    };
  } catch (err) {
    log.warn(
      { organizationId: conv.organizationId, err },
      'conversations.service: falha ao buscar templates da Meta — usando DB local como fallback',
    );
  }

  // 3. Fallback: banco local (canal sem credenciais ou Meta indisponível)
  const rows = await db
    .select({
      id: whatsappTemplates.id,
      name: whatsappTemplates.name,
      category: whatsappTemplates.category,
      variables: whatsappTemplates.variables,
      body: whatsappTemplates.body,
    })
    .from(whatsappTemplates)
    .where(
      and(
        eq(whatsappTemplates.organizationId, conv.organizationId),
        eq(whatsappTemplates.status, 'approved'),
      ),
    )
    .orderBy(asc(whatsappTemplates.name));

  return {
    data: rows.map((row) => ({
      id: row.id,
      name: row.name,
      // `as` justificado: Drizzle infere text enum como string genérica; o check DB garante o enum.
      category: row.category as TemplateDto['category'],
      variables: row.variables,
      body_text: row.body,
    })),
  };
}

// ---------------------------------------------------------------------------
// getWindowService
// ---------------------------------------------------------------------------

/**
 * Retorna apenas o estado da janela de composição de uma conversa.
 *
 * Endpoint separado (/window) para o front consultar sem re-buscar
 * todas as mensagens (usado pelo ChatComposer em realtime — S14).
 *
 * @throws NotFoundError se conversa não pertencer à org/escopo do usuário.
 */
export async function getWindowService(
  db: Database,
  actor: ActorContext,
  conversationId: string,
): Promise<WindowState> {
  const { organizationId, cityScopeIds } = actor;

  log.debug({ organizationId, conversationId }, 'conversations.service: getWindow');

  const userCtx: UserScopeCtx = { cityScopeIds };
  const conv = await getConversation(db, conversationId, organizationId, userCtx);
  const channel = await findChannel(db, conv.channelId, organizationId);

  const composerStateRaw = getComposerState(conv, channel);
  return toWindowStateDto(composerStateRaw);
}

// ---------------------------------------------------------------------------
// F16-S23 — linkOrCreateConversationLead
// ---------------------------------------------------------------------------

/**
 * Contexto de ator para operações de escrita no módulo de conversas (lead-link).
 */
export interface LeadLinkActorContext {
  /** UUID do usuario autenticado. null para atores de sistema (alinhado a SendActorContext). */
  readonly userId: string | null;
  readonly organizationId: string;
  readonly role: string;
  readonly cityScopeIds: string[] | null;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

/**
 * Erro 409: a conversa já está vinculada a um lead diferente.
 * Não trocamos vínculo silenciosamente — o agente deve confirmar a ação.
 */
export class ConversationAlreadyLinkedError extends ConflictError {
  constructor(
    public readonly existingLeadId: string,
    public readonly requestedLeadId: string,
  ) {
    super(
      `Conversa já está vinculada ao lead ${existingLeadId}. ` +
        `Não é possível trocar para ${requestedLeadId} silenciosamente.`,
    );
    this.name = 'ConversationAlreadyLinkedError';
  }
}

/**
 * Erro 422: o agente tentou criar um lead novo mas o canal não tem cityId.
 * Tech debt F3-S04: leads.city_id é NOT NULL — criação sem cidade é inválida.
 */
export class MissingChannelCityError extends AppError {
  constructor() {
    super(
      422,
      'VALIDATION_ERROR',
      'Não é possível criar lead: o canal desta conversa não possui cidade configurada. ' +
        'Vincule um lead existente via leadId ou configure a cidade do canal.',
    );
    this.name = 'MissingChannelCityError';
  }
}

/**
 * Vincula a conversa a um lead existente OU cria+vincula um novo lead em 1 clique.
 *
 * Pipeline:
 *   1. Valida conversa no escopo do ator (404 se não existir / fora do escopo).
 *   2. Se body.leadId presente:
 *      a. Idempotência: já vinculado ao MESMO lead → 200 no-op.
 *      b. Já vinculado a DIFERENTE lead → 409 (não troca silenciosamente).
 *      c. Sem vínculo → chama linkConversationLead (livechat/repo).
 *   3. Se body.leadId ausente:
 *      a. Canal sem cityId → 422 (tech debt: leads.city_id NOT NULL).
 *      b. Decifra contactPhoneEnc → E.164 → getOrCreateLead → linkConversationLead.
 *   4. Emite audit log conversation.lead_linked (apenas IDs opacos — LGPD §8.5).
 *   5. Publica socket relay conversation:updated com leadId (sem PII bruta — LGPD §8.1).
 *
 * LGPD (doc 17 §8.1, §8.3, §8.5):
 *   - contactPhoneEnc decifrado apenas internamente — nunca logado.
 *   - Audit log: apenas IDs opacos (conversationId, leadId, channelId).
 *   - Socket payload: apenas IDs opacos.
 */
export async function linkOrCreateConversationLead(
  db: Database,
  actor: LeadLinkActorContext,
  conversationId: string,
  body: LinkLeadBody,
): Promise<LinkLeadResponse> {
  const { organizationId, cityScopeIds } = actor;

  log.debug(
    { organizationId, conversationId, hasLeadId: body.leadId !== undefined },
    'conversations.service: linkOrCreateConversationLead',
  );

  // 1. Valida conversa no escopo do ator
  const userCtx: UserScopeCtx = { cityScopeIds };
  const conv = await getConversation(db, conversationId, organizationId, userCtx);

  let leadId: string;
  let created = false;

  if (body.leadId !== undefined) {
    // Caminho A: vincular lead existente

    if (conv.leadId !== null) {
      // Idempotência: já vinculado ao mesmo lead → 200 no-op
      if (conv.leadId === body.leadId) {
        log.debug(
          { organizationId, conversationId, leadId: body.leadId },
          'conversations.service: já vinculado ao mesmo lead — no-op',
        );
        return { conversationId, leadId: conv.leadId, created: false };
      }
      // Já vinculado a lead DIFERENTE → 409
      throw new ConversationAlreadyLinkedError(conv.leadId, body.leadId);
    }

    // Vínculo novo — chama helper do livechat/repo (F16-S22)
    await linkConversationLead(db, conversationId, organizationId, body.leadId);
    leadId = body.leadId;
    created = false;
  } else {
    // Caminho B: criar + vincular lead novo

    // Idempotência: já tem lead → no-op (não criamos duplicata)
    if (conv.leadId !== null) {
      log.debug(
        { organizationId, conversationId, leadId: conv.leadId },
        'conversations.service: conversa já tem lead — no-op na criação',
      );
      return { conversationId, leadId: conv.leadId, created: false };
    }

    // Busca canal para obter cityId
    // F16-S26: body.cityId permite sobrepor o canal sem cidade configurada.
    // Canal sem cidade E body sem cityId → 422 (leads.city_id é NOT NULL — F3-S04).
    const channel = await findChannel(db, conv.channelId, organizationId);
    const resolvedCityId = body.cityId ?? channel.cityId ?? null;

    if (resolvedCityId === null) {
      throw new MissingChannelCityError();
    }

    // Decifra telefone do contato (LGPD: não logar)
    const phoneDigitRegex = /^\d{10,15}$/;
    let phone: string;

    if (conv.contactPhoneEnc !== null && conv.contactPhoneEnc !== undefined) {
      const decrypted = await decryptPii(conv.contactPhoneEnc);
      phone = decrypted;
    } else if (phoneDigitRegex.test(conv.contactRemoteId)) {
      phone = `+${conv.contactRemoteId}`;
    } else {
      // Provider não fornece telefone (ex: Instagram DM com IGSID)
      throw new AppError(
        422,
        'VALIDATION_ERROR',
        'Não é possível criar lead: o contato desta conversa não possui número de telefone. ' +
          'Vincule um lead existente via leadId.',
      );
    }

    const result = await getOrCreateLead(
      db,
      organizationId,
      {
        phone,
        name: conv.contactName ?? undefined,
        source: 'whatsapp',
        chatwootConversationId: undefined,
        correlationId: undefined,
        cityId: resolvedCityId,
      },
      null,
    );

    await linkConversationLead(db, conversationId, organizationId, result.lead_id);
    leadId = result.lead_id;
    created = result.created;
  }

  // 4. Audit log — apenas IDs opacos (LGPD §8.5)
  // 'as unknown as AuditTx' justificado: db satisfaz a interface AuditTx (insert),
  // mas Drizzle não expõe tipagem compatível diretamente sem cast.
  await auditLog(db as unknown as AuditTx, {
    organizationId,
    actor: {
      userId: actor.userId,
      role: actor.role,
      ip: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
    },
    action: 'conversation.lead_linked',
    resource: { type: 'conversation', id: conversationId },
    after: {
      conversationId,
      leadId,
      created,
      channelId: conv.channelId,
    },
  });

  // 5. Socket relay — conversation:updated com leadId (sem PII bruta — LGPD §8.1)
  await publish(
    QUEUES.socketRelay,
    makeEnvelope(QUEUES.socketRelay, organizationId, {
      room: `workspace:${organizationId}`,
      event: 'conversation:updated',
      data: {
        conversationId,
        leadId,
        organizationId,
      },
    }),
  );

  log.info(
    { organizationId, conversationId, leadId, created },
    'conversations.service: lead vinculado',
  );

  return { conversationId, leadId, created };
}
