// =============================================================================
// features/notifications/index.ts — Barrel de exports do domínio notificações.
// =============================================================================

export { NotificationDropdown } from './NotificationDropdown';
export { NotificationItem } from './NotificationItem';
export { useNotifications, useMarkRead, useMarkAllRead } from './hooks';
export { useNotificationSocket, resolveNotificationHref } from './useNotificationSocket';
export type {
  NotificationSocketPayload,
  NotificationSocketSeverity,
  NotificationToast,
} from './useNotificationSocket';
