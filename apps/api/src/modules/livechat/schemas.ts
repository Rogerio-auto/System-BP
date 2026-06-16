// =============================================================================
// livechat/schemas.ts — Zod de filtros e entrada para o domínio do live chat.
//
// Re-usa tipos públicos de packages/shared-schemas (InboundEvent, OutboundJob,
// ViewStatus) e define os schemas de queries/filtros internos à API.
//
// LGPD (doc 17 §8.1):
//   - contactName e contactPhoneEnc são PII — nunca retornar em texto plano.
//   - Os schemas de filtro/resposta NÃO incluem contact_phone_enc — apenas
//     IDs opacos e metadados estruturais.
// =============================================================================

import {
  ChannelProviderSchema,
  type InboundEvent,
  InboundEventSchema,
  MessageTypeSchema,
  ViewStatusSchema,
} from '@elemento/shared-schemas';
import { z } from 'zod';

// Re-exporta os contratos públicos consumidos por workers/rotas
export { InboundEventSchema, ViewStatusSchema, ChannelProviderSchema, MessageTypeSchema };
export type { InboundEvent };

// ---------------------------------------------------------------------------
// ConversationStatus — enum de status de conversa
// ---------------------------------------------------------------------------

export const ConversationStatusSchema = z.enum(['open', 'pending', 'resolved', 'snoozed']);
export type ConversationStatus = z.infer<typeof ConversationStatusSchema>;

// ---------------------------------------------------------------------------
// ConversationKind — enum de tipo de conversa
// ---------------------------------------------------------------------------

export const ConversationKindSchema = z.enum(['dm', 'group', 'comment_thread']);
export type ConversationKind = z.infer<typeof ConversationKindSchema>;

// ---------------------------------------------------------------------------
// ListConversationsFilter — filtro para listagem de conversas
//
// Sem PII: não expõe contact_phone_enc nem contact_name no filtro.
// ---------------------------------------------------------------------------

export const ListConversationsFilterSchema = z.object({
  /** Escopo obrigatório: organização. */
  organizationId: z.string().uuid(),
  /** Escopo regional (null = sem filtro de cidade). */
  cityScopeIds: z.array(z.string().uuid()).nullable(),
  /** Filtrar por canal específico. */
  channelId: z.string().uuid().optional(),
  /** Filtrar por status (default: open). */
  status: ConversationStatusSchema.optional(),
  /** Filtrar por agente responsável. */
  assignedUserId: z.string().uuid().optional(),
  /** Cursor para paginação (conversationId da última página). */
  cursor: z.string().uuid().optional(),
  /** Máximo de registros por página (default: 30). */
  limit: z.number().int().min(1).max(100).default(30),
});
export type ListConversationsFilter = z.infer<typeof ListConversationsFilterSchema>;

// ---------------------------------------------------------------------------
// GetMessagesFilter — paginação por cursor de mensagens
// ---------------------------------------------------------------------------

export const GetMessagesFilterSchema = z.object({
  conversationId: z.string().uuid(),
  /** Cursor: messageId da última mensagem recebida (paginação regressiva). */
  before: z.string().uuid().optional(),
  /** Máximo de registros por página (default: 50). */
  limit: z.number().int().min(1).max(200).default(50),
});
export type GetMessagesFilter = z.infer<typeof GetMessagesFilterSchema>;

// ---------------------------------------------------------------------------
// PersistInboundMessageInput — entrada para persistir mensagem inbound
// ---------------------------------------------------------------------------

export const PersistInboundMessageInputSchema = z.object({
  organizationId: z.string().uuid(),
  channelId: z.string().uuid(),
  conversationId: z.string().uuid(),
  /** ID externo do provider (ex: wamid.xxx) — base do dedupe. */
  externalId: z.string().min(1),
  messageType: MessageTypeSchema,
  /** Conteúdo textual. LGPD: não logar; redact antes de LLM. */
  content: z.string().optional(),
  mediaRef: z
    .object({
      refOrUrl: z.string().min(1),
      mimeType: z.string().optional(),
      sha256: z.string().optional(),
      fileName: z.string().optional(),
    })
    .optional(),
  replyToExternalId: z.string().optional(),
  /** Metadados do provider sem PII bruta. */
  metadata: z.record(z.unknown()).optional(),
  /** Timestamp ISO 8601 do provider. */
  rawTimestamp: z.string().min(1),
});
export type PersistInboundMessageInput = z.infer<typeof PersistInboundMessageInputSchema>;

// ---------------------------------------------------------------------------
// PersistOutboundMessageInput — entrada para persistir mensagem outbound
// ---------------------------------------------------------------------------

export const PersistOutboundMessageInputSchema = z.object({
  organizationId: z.string().uuid(),
  channelId: z.string().uuid(),
  conversationId: z.string().uuid(),
  messageType: MessageTypeSchema,
  content: z.string().optional(),
  mediaUrl: z.string().optional(),
  mediaMime: z.string().optional(),
  interactivePayload: z.record(z.unknown()).optional(),
  replyToExternalId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type PersistOutboundMessageInput = z.infer<typeof PersistOutboundMessageInputSchema>;

// ---------------------------------------------------------------------------
// EnsureContactConversationInput — garante contato/conversa no DB
// ---------------------------------------------------------------------------

export const EnsureContactConversationInputSchema = z.object({
  organizationId: z.string().uuid(),
  channelId: z.string().uuid(),
  /** ID remoto do contato no provider. LGPD: pode ser telefone — não logar. */
  contactRemoteId: z.string().min(1),
  /** Nome do contato (PII — não logar). */
  contactName: z.string().optional(),
  /** Telefone cifrado AES-256-GCM (Buffer) — nunca retornar em texto plano. */
  contactPhoneEnc: z.instanceof(Buffer).optional(),
  /** city_id herdado do canal (para applyCityScope). */
  cityId: z.string().uuid().optional(),
});
export type EnsureContactConversationInput = z.infer<typeof EnsureContactConversationInputSchema>;

// ---------------------------------------------------------------------------
// ComposerState — estado da janela de composição por provider
//
// WA: livre <24h → bloqueia/template além de 24h
// IG: livre <24h → HUMAN_AGENT_TAG entre 24h-7d → bloqueia >7d
// WAHA: sempre livre
// ---------------------------------------------------------------------------

export const ComposerWindowSchema = z.enum(['open', 'human_agent_tag', 'template_only', 'closed']);
export type ComposerWindow = z.infer<typeof ComposerWindowSchema>;

export const ComposerStateSchema = z.object({
  conversationId: z.string().uuid(),
  provider: ChannelProviderSchema,
  window: ComposerWindowSchema,
  /** Timestamp da última mensagem inbound que abriu a janela. */
  lastInboundAt: z.date().nullable(),
  /** Quantos ms restam na janela (null = sem janela / sempre aberto). */
  remainingMs: z.number().nullable(),
});
export type ComposerState = z.infer<typeof ComposerStateSchema>;
