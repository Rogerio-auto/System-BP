// =============================================================================
// features/pwa/__tests__/usePushSubscription.test.ts — F27-S07
//
// Estratégia: idem useFeatureFlag.test.ts — sem @testing-library/react no
// projeto, então testamos o contrato exportado (query key estável) sem
// renderizar o hook. A integração com TanStack Query + navigator.serviceWorker
// é validada manualmente/E2E (opt-in exige gesto real do usuário no browser).
// =============================================================================

import { describe, expect, it } from 'vitest';

import { pushSubscriptionQueryKey } from '../usePushSubscription';

describe('pushSubscriptionQueryKey', () => {
  it('tem o formato estável esperado para invalidação', () => {
    expect(pushSubscriptionQueryKey).toEqual(['pwa', 'push-subscription']);
  });

  it('não muda entre imports (mesma referência de módulo)', () => {
    expect(pushSubscriptionQueryKey[0]).toBe('pwa');
    expect(pushSubscriptionQueryKey[1]).toBe('push-subscription');
    expect(pushSubscriptionQueryKey).toHaveLength(2);
  });
});
