// =============================================================================
// MessageComposer/index.ts — Barrel de exportações públicas.
// =============================================================================

export { MessageComposer } from './MessageComposer';
export { QuickReplyPicker } from './QuickReplyPicker';
export { TemplateSelector } from './TemplateSelector';
export { WindowNotice } from './WindowNotice';
export { useWindowState } from './useWindowState';
export { useSendMessage } from './useSendMessage';
export type { TemplateSelectorProps } from './TemplateSelector';
export type { WindowStateResult } from './useWindowState';
export type {
  QuickReplyGroup,
  QuickReplyPickerHandle,
  QuickReplyPickerMode,
  QuickReplyPickerProps,
} from './QuickReplyPicker';
export {
  buildQuickReplySendPayload,
  computeQuickReplyMode,
  filterQuickRepliesByShortcut,
  filterQuickRepliesByText,
  groupQuickRepliesByCategory,
} from './QuickReplyPicker';
export type {
  SendMessagePayload,
  SendMessageResult,
  SendTextPayload,
  SendMediaPayload,
  MediaKind,
} from './useSendMessage';
