// =============================================================================
// features/quick-replies/types.ts — Tipos da camada de dados de respostas
// rápidas (F28-S05).
//
// Reexporta o contrato Zod de @elemento/shared-schemas (fonte única — não
// redeclarar) e complementa apenas o que o pacote compartilhado ainda NÃO
// modela:
//   - QuickReplyListParams — formato ergonômico (boolean) de entrada do
//     cliente HTTP local; o mapeamento para a querystring ('true'/'false')
//     acontece em api.ts. O schema de VALIDAÇÃO da query continua sendo
//     `quickReplyListQuerySchema`, aplicado pelo backend.
//   - QuickReplyReorderItem — o endpoint PATCH /reorder nasce no backend em
//     F28-S03; ainda não tem schema compartilhado.
//   - QuickReplySignedUrlResponse / QuickReplyUploadResult — resposta local
//     de upload, mesmo padrão não-compartilhado de
//     features/conversations/hooks/useUploadMedia.ts.
//
// Doc normativo: docs/25-respostas-rapidas.md §4 (modelo), §6 (variáveis),
// §7 (mídia).
// =============================================================================

export type {
  QuickReplyBody,
  QuickReplyCreate,
  QuickReplyInterpolationContext,
  QuickReplyListQuery,
  QuickReplyListResponse,
  QuickReplyMediaKind,
  QuickReplyResponse,
  QuickReplyShortcut,
  QuickReplySignedUrlBody,
  QuickReplyUpdate,
  QuickReplyVariableDefinition,
  QuickReplyVariableKey,
  QuickReplyVariableOccurrence,
  QuickReplyVisibility,
} from '@elemento/shared-schemas';

export {
  extractQuickReplyErrorCode,
  interpolateQuickReply,
  parseQuickReplyVariables,
  QUICK_REPLY_BODY_MAX_LENGTH,
  QUICK_REPLY_BODY_OR_MEDIA_REQUIRED,
  QUICK_REPLY_MEDIA_INCOMPLETE,
  QUICK_REPLY_MEDIA_TOO_LARGE,
  QUICK_REPLY_MISSING_FALLBACK,
  QUICK_REPLY_SHORTCUT_REGEX,
  QUICK_REPLY_UNKNOWN_VARIABLE,
  QUICK_REPLY_VARIABLES,
  quickReplyCreateSchema,
  quickReplyListQuerySchema,
  quickReplyMediaKindSchema,
  quickReplyShortcutSchema,
  quickReplySignedUrlBodySchema,
  quickReplyUpdateSchema,
  quickReplyVisibilitySchema,
} from '@elemento/shared-schemas';

import type { QuickReplyMediaKind, QuickReplyVisibility } from '@elemento/shared-schemas';

// ---------------------------------------------------------------------------
// Parâmetros de listagem (client-side)
// ---------------------------------------------------------------------------

/**
 * Entrada do cliente HTTP local para GET /api/quick-replies. `isActive` é
 * `boolean` puro aqui (ergonomia do chamador React) — `api.ts` converte para
 * `'true'/'false'` na querystring, onde o backend reaplica
 * `quickReplyListQuerySchema` (fonte única de validação).
 */
export interface QuickReplyListParams {
  readonly search?: string;
  readonly visibility?: QuickReplyVisibility;
  readonly category?: string;
  readonly isActive?: boolean;
  readonly cursor?: string;
  readonly limit?: number;
}

// ---------------------------------------------------------------------------
// Reordenação (doc 25 §4 `sort_order`) — sem schema compartilhado ainda.
// ---------------------------------------------------------------------------

/** Um item do lote de reordenação — camelCase, espelha a coluna `sort_order`. */
export interface QuickReplyReorderItem {
  readonly id: string;
  readonly sortOrder: number;
}

// ---------------------------------------------------------------------------
// Upload de mídia — fase 1/2 (doc 25 §7)
// ---------------------------------------------------------------------------

/** Resposta de POST /api/quick-replies/uploads/signed-url (fase 1). */
export interface QuickReplySignedUrlResponse {
  readonly uploadUrl: string;
  readonly publicMediaUrl: string;
  readonly expiresAt: string;
}

/**
 * Resultado do upload concluído (fase 2) — os campos batem 1:1 com o que
 * `quickReplyCreateSchema`/`quickReplyUpdateSchema` esperam para mídia
 * (mediaUrl/mediaMime/mediaKind/mediaSizeBytes/mediaFileName), para o
 * admin (F28-S07) espalhar direto no corpo do formulário.
 */
export interface QuickReplyUploadResult {
  readonly mediaUrl: string;
  readonly mediaMime: string;
  readonly mediaKind: QuickReplyMediaKind;
  readonly mediaSizeBytes: number;
  readonly mediaFileName: string;
}

// ---------------------------------------------------------------------------
// Realtime (doc 25 §9)
// ---------------------------------------------------------------------------

/** Ação que originou o evento `quick_reply:changed`. */
export type QuickReplyChangedAction = 'created' | 'updated' | 'deleted';

/**
 * Payload de `quick_reply:changed` (doc 25 §9) — deliberadamente SEM
 * `body`/`title`/mídia (mínimo privilégio; o cliente só recebe o sinal e
 * invalida a query).
 */
export interface QuickReplyChangedPayload {
  readonly quickReplyId: string;
  readonly action: QuickReplyChangedAction;
  readonly visibility: QuickReplyVisibility;
}
