// =============================================================================
// socketEvents.ts - Contratos de socket (Socket.io) do live chat.
// Portado de tagix packages/shared/src/socket-events.ts.
// Nomes de evento identicos ao tagix para facilitar porte do relay + frontend.
//
// ServerToClient: eventos emitidos do servidor para o cliente.
// Rooms: convention de rooms do Socket.io.
// =============================================================================

import type { ViewStatus, ConversationDto, ConversationStatus, MessageDto } from './livechat.js';

// ---------------------------------------------------------------------------
// Payloads por evento
// ---------------------------------------------------------------------------

export interface MessageNewPayload {
  readonly organizationId: string;
  readonly conversationId: string;
  readonly message: MessageDto;
}

export interface MessageStatusChangedPayload {
  readonly conversationId: string;
  readonly messageId: string;
  readonly status: ViewStatus;
}

export interface MessageMediaReadyPayload {
  readonly conversationId: string;
  readonly messageId: string;
  readonly mediaUrl: string;
}

export interface ConversationUpdatedPayload {
  readonly organizationId: string;
  readonly conversation: ConversationDto;
}

export interface ConversationAssignedPayload {
  readonly conversationId: string;
  readonly assignedTo: string | null;
}

export interface ConversationStateChangedPayload {
  readonly conversationId: string;
  readonly status: ConversationStatus;
}

export type ContactPresence = 'typing' | 'recording';

export interface TypingFromContactPayload {
  readonly conversationId: string;
  readonly presence: ContactPresence;
}

// ---------------------------------------------------------------------------
// Mapa de eventos Server -> Client (source of truth para tipagem)
// ---------------------------------------------------------------------------

/**
 * Eventos emitidos do servidor para o cliente.
 * Nomes identicos ao tagix para facilitar porte do relay e do frontend.
 */
export interface ServerToClient {
  'message:new': (payload: MessageNewPayload) => void;
  'message:status_changed': (payload: MessageStatusChangedPayload) => void;
  'message:media_ready': (payload: MessageMediaReadyPayload) => void;
  'conversation:updated': (payload: ConversationUpdatedPayload) => void;
  'conversation:assigned': (payload: ConversationAssignedPayload) => void;
  'conversation:state_changed': (payload: ConversationStateChangedPayload) => void;
  'typing:from_contact': (payload: TypingFromContactPayload) => void;
}

/** Nome de evento Server->Client. */
export type ServerToClientEvent = keyof ServerToClient;

/** Payload de um evento especifico. */
export type ServerToClientPayload<E extends ServerToClientEvent> = Parameters<ServerToClient[E]>[0];

/** Lista de eventos em runtime (para validacao/switch). */
export const SERVER_TO_CLIENT_EVENTS = [
  'message:new',
  'message:status_changed',
  'message:media_ready',
  'conversation:updated',
  'conversation:assigned',
  'conversation:state_changed',
  'typing:from_contact',
] as const satisfies readonly ServerToClientEvent[];

// ---------------------------------------------------------------------------
// Convention de rooms do Socket.io
// ---------------------------------------------------------------------------

/** Room de uma conversa especifica. */
export const conversationRoom = (conversationId: string): string =>
  `conversation:${conversationId}`;

/** Room de toda a organizacao (inbox global). */
export const orgRoom = (organizationId: string): string => `org:${organizationId}`;

/** Room de um usuario especifico (notificacoes pessoais). */
export const userRoom = (userId: string): string => `user:${userId}`;
