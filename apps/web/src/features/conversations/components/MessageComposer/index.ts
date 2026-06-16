// =============================================================================
// MessageComposer/index.ts — Barrel de exportações públicas.
// =============================================================================

export { MessageComposer } from './MessageComposer';
export { WindowNotice } from './WindowNotice';
export { useWindowState } from './useWindowState';
export { useSendMessage } from './useSendMessage';
export type { WindowStateResult } from './useWindowState';
export type {
  SendMessagePayload,
  SendMessageResult,
  SendTextPayload,
  SendMediaPayload,
  MediaKind,
} from './useSendMessage';
