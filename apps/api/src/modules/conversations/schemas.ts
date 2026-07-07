// =============================================================================
// conversations/schemas.ts — Zod de query/response para o módulo de conversas (F16-S12).
//
// Contratos públicos das rotas de leitura:
//   GET /api/conversations             — lista com filtros + cursor
//   GET /api/conversations/:id         — detalhe (+ contactPhone se permissão)
//   GET /api/conversations/:id/messages — histórico paginado por cursor
//   GET /api/conversations/:id/window  — estado da janela de composição
//
// LGPD (doc 17 §8.1):
//   - ConversationListResponseSchema: SEM contactPhone (listagem não exige PII de telefone).
//   - ConversationDetailResponseSchema: com contactPhone — apenas retornado se o
//     handler verificou a permissão crm:contact:phone:read antes de incluí-lo.
//   - MessageResponseSchema: content é PII — não logar sem redact.
//
// Contratos de saída consumidos pelo front (S15):
//   - ConversationListResponse, ConversationDetailResponse, MessageListResponse, WindowResponse.
// =============================================================================

import 'zod-openapi/extend';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Reutilizamos enums do domínio livechat (S07)
// ---------------------------------------------------------------------------

export const ConversationStatusSchema = z.enum(['open', 'pending', 'resolved', 'snoozed']);
export const ConversationKindSchema = z.enum(['dm', 'group', 'comment_thread']);
export const ChannelProviderSchema = z.enum(['meta_whatsapp', 'meta_instagram', 'waha']);
export const MessageTypeSchema = z.enum([
  'text',
  'image',
  'video',
  'audio',
  'voice',
  'document',
  'sticker',
  'location',
  'contact',
  'interactive',
  'template',
  'reaction',
  'system',
  'story_mention',
  'story_reply',
  'share',
  'comment',
  'comment_reply',
  'ig_postback',
  'referral',
]);
export const ViewStatusSchema = z.enum(['pending', 'sent', 'delivered', 'read', 'failed']);
export const ComposerWindowSchema = z.enum(['open', 'human_agent_tag', 'template_only', 'closed']);

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export const ConversationIdParamSchema = z.object({
  id: z.string().uuid().describe('UUID da conversa'),
});
export type ConversationIdParam = z.infer<typeof ConversationIdParamSchema>;

// ---------------------------------------------------------------------------
// Querystrings
// ---------------------------------------------------------------------------

/**
 * Query para listagem de conversas.
 *
 * LGPD: sem filtro por phone (PII cifrada).
 * Filtro `search` por nome: usa ILIKE em contact_name (campo PII — redact nos logs).
 */
export const ConversationListQuerySchema = z
  .object({
    /** Filtrar por status de conversa. Default: open. */
    status: ConversationStatusSchema.optional().describe(
      'Filtrar por status: open|pending|resolved|snoozed. Default: open.',
    ),
    /** Filtrar por canal específico. */
    channelId: z.string().uuid().optional().describe('UUID do canal para filtrar.'),
    /** Filtrar por agente responsável. */
    assignedUserId: z.string().uuid().optional().describe('UUID do agente para filtrar.'),
    /**
     * Cursor para paginação. Valor retornado no campo `nextCursor` da página anterior.
     * Baseado no `id` da última conversa retornada (cursor estável).
     */
    cursor: z.string().uuid().optional().describe('Cursor de paginação (UUID da última conversa).'),
    /** Número máximo de resultados por página. Default: 50. */
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .describe('Limite por página (1–100). Default: 50.'),
  })
  .openapi({
    example: {
      status: 'open',
      limit: 50,
    },
  });
export type ConversationListQuery = z.infer<typeof ConversationListQuerySchema>;

/**
 * Query para paginação de mensagens por cursor.
 */
export const MessageListQuerySchema = z
  .object({
    /**
     * Cursor: UUID da mensagem mais antiga já carregada (página anterior).
     * Retorna mensagens anteriores a esse cursor.
     */
    before: z
      .string()
      .uuid()
      .optional()
      .describe('Cursor: UUID da mensagem para paginação regressiva.'),
    /** Número máximo de resultados por página. Default: 50. */
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .describe('Limite por página (1–100). Default: 50.'),
  })
  .openapi({ example: { limit: 50 } });
export type MessageListQuery = z.infer<typeof MessageListQuerySchema>;

// ---------------------------------------------------------------------------
// DTOs de resposta
// ---------------------------------------------------------------------------

/**
 * Conversa para listagem — SEM contactPhone (LGPD M1).
 *
 * LGPD: A listagem de conversas não requer permissão de PII de telefone.
 * Para obter contactPhone decifrado, use o endpoint de detalhe com
 * permissão crm:contact:phone:read.
 */
export const ConversationSchema = z
  .object({
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    cityId: z.string().uuid().nullable(),
    channelId: z.string().uuid(),
    contactRemoteId: z.string().describe('ID remoto do contato no provider.'),
    contactName: z
      .string()
      .nullable()
      .describe('Nome do contato (pode ser null se não enviado pelo provider).'),
    leadId: z.string().uuid().nullable(),
    customerId: z.string().uuid().nullable(),
    status: ConversationStatusSchema,
    assignedUserId: z.string().uuid().nullable(),
    lastInboundAt: z
      .string()
      .datetime()
      .nullable()
      .describe('Timestamp da última mensagem inbound (abertura da janela).'),
    lastMessageAt: z
      .string()
      .datetime()
      .nullable()
      .describe('Timestamp da última mensagem (inbound ou outbound).'),
    kind: ConversationKindSchema,
    provider: ChannelProviderSchema.describe('Provider do canal da conversa.'),
    unreadCount: z.number().int().min(0).describe('Número de mensagens inbound não lidas.'),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi({
    example: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      organizationId: '550e8400-e29b-41d4-a716-446655440001',
      cityId: null,
      channelId: '550e8400-e29b-41d4-a716-446655440002',
      contactRemoteId: '5521999990001',
      contactName: 'Maria Silva',
      leadId: '550e8400-e29b-41d4-a716-446655440003',
      customerId: null,
      status: 'open',
      assignedUserId: null,
      lastInboundAt: '2026-06-16T10:00:00.000Z',
      lastMessageAt: '2026-06-16T10:00:00.000Z',
      kind: 'dm',
      provider: 'meta_whatsapp',
      unreadCount: 2,
      createdAt: '2026-06-15T08:00:00.000Z',
      updatedAt: '2026-06-16T10:00:00.000Z',
    },
  });

/**
 * Detalhe de conversa — inclui contactPhone decifrado.
 *
 * LGPD M1: Retornado APENAS quando o handler verificou crm:contact:phone:read.
 * NAO usar em listagens. NAO logar sem redact.
 */
export const ConversationDetailSchema = ConversationSchema.extend({
  /**
   * Telefone do contato decifrado.
   * LGPD: PII — presente apenas para usuários com permissão crm:contact:phone:read.
   * null se provider não enviar telefone (ex: Instagram DM) ou campo não preenchido.
   */
  contactPhone: z
    .string()
    .nullable()
    .describe('Telefone decifrado do contato (PII — requer crm:contact:phone:read).'),
}).openapi({
  example: {
    id: '550e8400-e29b-41d4-a716-446655440000',
    organizationId: '550e8400-e29b-41d4-a716-446655440001',
    cityId: null,
    channelId: '550e8400-e29b-41d4-a716-446655440002',
    contactRemoteId: '5521999990001',
    contactName: 'Maria Silva',
    contactPhone: '+5521999990001',
    leadId: '550e8400-e29b-41d4-a716-446655440003',
    customerId: null,
    status: 'open',
    assignedUserId: null,
    lastInboundAt: '2026-06-16T10:00:00.000Z',
    lastMessageAt: '2026-06-16T10:00:00.000Z',
    kind: 'dm',
    provider: 'meta_whatsapp',
    unreadCount: 0,
    createdAt: '2026-06-15T08:00:00.000Z',
    updatedAt: '2026-06-16T10:00:00.000Z',
  },
});
export type ConversationDetail = z.infer<typeof ConversationDetailSchema>;

/**
 * Estado da janela de composição.
 */
export const WindowStateSchema = z
  .object({
    conversationId: z.string().uuid(),
    provider: ChannelProviderSchema,
    window: ComposerWindowSchema.describe(
      'Estado da janela: open=livre, human_agent_tag=tag obrigatória (IG), template_only=apenas templates (WA), closed=fechada.',
    ),
    lastInboundAt: z
      .string()
      .datetime()
      .nullable()
      .describe('Timestamp da última mensagem inbound que abriu a janela.'),
    remainingMs: z
      .number()
      .nullable()
      .describe('Milissegundos restantes na janela (null = sem janela / WAHA).'),
  })
  .openapi({
    example: {
      conversationId: '550e8400-e29b-41d4-a716-446655440000',
      provider: 'meta_whatsapp',
      window: 'open',
      lastInboundAt: '2026-06-16T10:00:00.000Z',
      remainingMs: 82_800_000,
    },
  });
export type WindowState = z.infer<typeof WindowStateSchema>;

/**
 * Mensagem individual — SEM PII de contato.
 *
 * LGPD: `content` é PII (texto da mensagem do usuário). Não logar sem redact.
 * Nunca incluir contactRemoteId ou contactPhone nas mensagens.
 */
export const MessageSchema = z
  .object({
    id: z.string().uuid(),
    conversationId: z.string().uuid(),
    channelId: z.string().uuid(),
    direction: z.enum(['in', 'out']),
    externalId: z.string().nullable().describe('ID externo do provider (wamid, etc.).'),
    type: MessageTypeSchema,
    /** LGPD: PII — não logar em produção. */
    content: z.string().nullable().describe('Conteúdo textual da mensagem (PII — não logar).'),
    mediaUrl: z.string().nullable(),
    mediaMime: z.string().nullable(),
    mediaSizeBytes: z.number().int().nullable(),
    mediaSha256: z.string().nullable(),
    interactivePayload: z.record(z.unknown()).nullable(),
    viewStatus: ViewStatusSchema.nullable(),
    metadata: z.record(z.unknown()),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi({
    example: {
      id: '550e8400-e29b-41d4-a716-446655440010',
      conversationId: '550e8400-e29b-41d4-a716-446655440000',
      channelId: '550e8400-e29b-41d4-a716-446655440002',
      direction: 'in',
      externalId: 'wamid.xxx',
      type: 'text',
      content: 'Olá, preciso de ajuda',
      mediaUrl: null,
      mediaMime: null,
      mediaSizeBytes: null,
      mediaSha256: null,
      interactivePayload: null,
      viewStatus: 'read',
      metadata: {},
      createdAt: '2026-06-16T10:00:00.000Z',
      updatedAt: '2026-06-16T10:00:00.000Z',
    },
  });

// ---------------------------------------------------------------------------
// Schemas de resposta (envelopes)
// ---------------------------------------------------------------------------

/**
 * Resposta da listagem de conversas com cursor de paginação.
 */
export const ConversationListResponseSchema = z
  .object({
    data: z.array(ConversationSchema).describe('Lista de conversas da página atual.'),
    nextCursor: z
      .string()
      .uuid()
      .nullable()
      .describe('Cursor para a próxima página (null = última página).'),
  })
  .openapi({
    example: {
      data: [],
      nextCursor: null,
    },
  });
export type ConversationListResponse = z.infer<typeof ConversationListResponseSchema>;

/**
 * Resposta do detalhe de conversa com estado da janela.
 */
export const ConversationDetailResponseSchema = z.object({
  data: ConversationDetailSchema,
  composerState: WindowStateSchema.describe('Estado atual da janela de composição.'),
});
export type ConversationDetailResponse = z.infer<typeof ConversationDetailResponseSchema>;

/**
 * Resposta da listagem de mensagens com cursor de paginação.
 */
export const MessageListResponseSchema = z
  .object({
    data: z
      .array(MessageSchema)
      .describe('Mensagens da página atual (ordem crescente por created_at).'),
    nextCursor: z
      .string()
      .uuid()
      .nullable()
      .describe('Cursor para carregar mensagens mais antigas (null = início da conversa).'),
  })
  .openapi({
    example: {
      data: [],
      nextCursor: null,
    },
  });
export type MessageListResponse = z.infer<typeof MessageListResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/conversations/counts — contagem por status
// ---------------------------------------------------------------------------

/**
 * Query para contagem de conversas por status.
 * Subconjunto dos filtros de listagem — sem cursor nem limit (é agregação).
 */
export const ConversationCountsQuerySchema = z
  .object({
    /** Filtrar por canal específico. */
    channelId: z.string().uuid().optional().describe('UUID do canal para filtrar (opcional).'),
    /** Filtrar por agente responsável. */
    assignedUserId: z
      .string()
      .uuid()
      .optional()
      .describe('UUID do agente para filtrar (opcional).'),
  })
  .openapi({
    example: { channelId: '550e8400-e29b-41d4-a716-446655440002' },
  });
export type ConversationCountsQuery = z.infer<typeof ConversationCountsQuerySchema>;

/**
 * Resposta do GET /api/conversations/counts.
 *
 * `total` = open + pending + resolved + snoozed (soma calculada no service).
 * Todos os campos começam em 0 para status ausentes no escopo atual.
 */
export const ConversationCountsResponseSchema = z
  .object({
    open: z.number().int().min(0).describe('Conversas em aberto (aguardando agente).'),
    pending: z.number().int().min(0).describe('Conversas pendentes (aguardando contato).'),
    resolved: z.number().int().min(0).describe('Conversas resolvidas/encerradas.'),
    snoozed: z.number().int().min(0).describe('Conversas adiadas/em pausa.'),
    total: z.number().int().min(0).describe('Total de conversas no escopo (soma dos 4 status).'),
  })
  .openapi({
    example: {
      open: 12,
      pending: 3,
      resolved: 45,
      snoozed: 1,
      total: 61,
    },
  });
export type ConversationCountsResponse = z.infer<typeof ConversationCountsResponseSchema>;

// ---------------------------------------------------------------------------
// F16-S23 — PATCH /api/conversations/:id/lead
// ---------------------------------------------------------------------------

/**
 * Body do PATCH /api/conversations/:id/lead.
 *
 * Se `leadId` presente: vincula lead existente.
 * Se `leadId` ausente: cria novo lead via getOrCreateLead usando dados do contato + cityId resolvido.
 *
 * F16-S26: `cityId` opcional no body — usado quando o canal não tem cidade configurada (permite
 * o front oferecer um seletor de cidade sem depender da configuração do canal).
 * Resolução: body.cityId ?? channel.cityId. 422 apenas se ambos ausentes.
 *
 * LGPD (doc 17 §8.1): body não contém PII direta — leadId e cityId são UUIDs opacos.
 */
export const LinkLeadBodySchema = z
  .object({
    leadId: z
      .string()
      .uuid()
      .optional()
      .describe(
        'UUID do lead existente a vincular. Omitir para criar novo lead via dados do contato.',
      ),
    cityId: z
      .string()
      .uuid()
      .optional()
      .describe(
        'UUID da cidade a usar na criação do lead, quando o canal não tem cidade configurada. ' +
          'Sobrepõe channel.cityId. Ignorado quando leadId é fornecido.',
      ),
  })
  .openapi({
    example: { leadId: '550e8400-e29b-41d4-a716-446655440099' },
  });
export type LinkLeadBody = z.infer<typeof LinkLeadBodySchema>;

/**
 * Resposta do PATCH /api/conversations/:id/lead.
 *
 * LGPD: apenas IDs opacos — sem PII.
 */
export const LinkLeadResponseSchema = z
  .object({
    conversationId: z.string().uuid().describe('UUID da conversa.'),
    leadId: z.string().uuid().describe('UUID do lead vinculado.'),
    created: z.boolean().describe('true = lead criado agora; false = lead existente vinculado.'),
  })
  .openapi({
    example: {
      conversationId: '550e8400-e29b-41d4-a716-446655440000',
      leadId: '550e8400-e29b-41d4-a716-446655440099',
      created: false,
    },
  });
export type LinkLeadResponse = z.infer<typeof LinkLeadResponseSchema>;
