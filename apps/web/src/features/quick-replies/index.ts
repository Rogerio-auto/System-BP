// =============================================================================
// features/quick-replies/index.ts — Superfície pública da camada de dados de
// respostas rápidas (F28-S05).
//
// Única fonte de query keys, hooks de leitura/mutação, realtime e upload
// consumida pelo composer (F28-S06) e pelo admin (F28-S07). Não importar
// api.ts diretamente fora desta feature — sempre por aqui.
// =============================================================================

// ─── Tipos e contrato compartilhado (re-exportados de @elemento/shared-schemas
//     + complementos locais — ver types.ts) ─────────────────────────────────
export type {
  QuickReplyBody,
  QuickReplyChangedAction,
  QuickReplyChangedPayload,
  QuickReplyCreate,
  QuickReplyInterpolationContext,
  QuickReplyListParams,
  QuickReplyListQuery,
  QuickReplyListResponse,
  QuickReplyMediaKind,
  QuickReplyReorderItem,
  QuickReplyResponse,
  QuickReplyShortcut,
  QuickReplySignedUrlBody,
  QuickReplySignedUrlResponse,
  QuickReplyUpdate,
  QuickReplyUploadResult,
  QuickReplyVariableDefinition,
  QuickReplyVariableKey,
  QuickReplyVariableOccurrence,
  QuickReplyVisibility,
} from './types';

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
} from './types';

// ─── Cliente HTTP (uso avançado — a maioria dos consumidores deve preferir
//     os hooks abaixo) ────────────────────────────────────────────────────
export {
  createQuickReply,
  deleteQuickReply,
  fetchQuickReplies,
  fetchQuickReply,
  markQuickReplyUsed,
  reorderQuickReplies,
  requestQuickReplyUploadSignedUrl,
  updateQuickReply,
} from './api';

// ─── Query keys + hooks TanStack Query (leitura/mutação) ───────────────────
export {
  quickReplyKeys,
  useCreateQuickReply,
  useDeleteQuickReply,
  useMarkQuickReplyUsed,
  useQuickReplies,
  useQuickReply,
  useReorderQuickReplies,
  useUpdateQuickReply,
} from './queries';
export type { UseMarkQuickReplyUsedResult } from './queries';

// ─── Realtime (doc 25 §9) ───────────────────────────────────────────────────
export {
  attachQuickRepliesRealtimeListener,
  QUICK_REPLY_CHANGED_EVENT,
  useQuickRepliesRealtime,
} from './useQuickRepliesRealtime';
export type {
  QuickRepliesRealtimeQueryClient,
  QuickRepliesRealtimeSocket,
} from './useQuickRepliesRealtime';

// ─── Upload de mídia (doc 25 §7) ────────────────────────────────────────────
export { MAX_UPLOAD_BYTES, useUploadQuickReplyMedia } from './useUploadQuickReplyMedia';
export type {
  QuickReplyUploadProgress,
  UseUploadQuickReplyMediaReturn,
} from './useUploadQuickReplyMedia';
