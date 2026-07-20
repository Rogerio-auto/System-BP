// =============================================================================
// features/pwa/api.ts — Endpoints de Web Push (F27-S06 backend).
//
// Contrato (apps/api/src/modules/notifications/routes.ts):
//   GET    /api/notifications/push/public-key   → { public_key: string | null }
//   POST   /api/notifications/push/subscription ← { endpoint, keys, userAgent? }
//   DELETE /api/notifications/push/subscription?endpoint=...
//
// Tipos vêm de @elemento/shared-schemas (fonte única do contrato Zod real —
// evita drift front×back, doc feedback_parallel_contract_drift).
// =============================================================================

import type {
  PushPublicKeyResponse,
  PushSubscriptionAck,
  PushSubscriptionRequest,
  PushUnsubscribeAck,
} from '@elemento/shared-schemas';

import { api } from '../../lib/api';

/** GET /api/notifications/push/public-key — chave VAPID (`null` se push indisponível). */
export async function fetchPushPublicKey(): Promise<PushPublicKeyResponse> {
  return api.get<PushPublicKeyResponse>('/api/notifications/push/public-key');
}

/** POST /api/notifications/push/subscription — registra/atualiza a subscription (upsert por endpoint). */
export async function registerPushSubscription(
  body: PushSubscriptionRequest,
): Promise<PushSubscriptionAck> {
  return api.post<PushSubscriptionAck>('/api/notifications/push/subscription', body);
}

/** DELETE /api/notifications/push/subscription — remove a subscription (opt-out). Idempotente. */
export async function removePushSubscription(endpoint: string): Promise<PushUnsubscribeAck> {
  return api.delete<PushUnsubscribeAck>(
    `/api/notifications/push/subscription?endpoint=${encodeURIComponent(endpoint)}`,
  );
}
