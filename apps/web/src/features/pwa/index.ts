// =============================================================================
// features/pwa/index.ts — Barrel de exports do domínio push/PWA (cliente).
// =============================================================================

export { PushOptInCard } from './PushOptInCard';
export { usePushSubscription, pushSubscriptionQueryKey } from './usePushSubscription';
export type { UsePushSubscriptionResult } from './usePushSubscription';
export { detectPushUnsupportedReason, isPushSupported, isStandaloneDisplayMode } from './platform';
export type { PushSupportInput, PushUnsupportedReason } from './platform';
export { urlBase64ToUint8Array } from './vapid';
