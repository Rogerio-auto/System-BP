// =============================================================================
// features/notifications/index.ts — Barrel de exports do domínio notificações.
// =============================================================================

export { NotificationDropdown } from './NotificationDropdown';
export { NotificationItem } from './NotificationItem';
export {
  useNotifications,
  useNotificationsInfinite,
  useMarkRead,
  useMarkAllRead,
  useMarkManyRead,
} from './hooks';
export { useNotificationSocket } from './useNotificationSocket';
export type {
  NotificationSocketPayload,
  NotificationSocketSeverity,
  NotificationToast,
} from './useNotificationSocket';
export {
  resolveNotificationHref,
  getNotificationActionLabel,
  resolveNotificationCategory,
  getNotificationCategoryLabel,
  NOTIFICATION_CATEGORIES,
} from './navigation';
export { SEVERITY_STYLE, SeverityIcon, getSeverityLabel } from './severity';
