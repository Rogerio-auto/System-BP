// =============================================================================
// notifications/__tests__/webPush.sender.test.ts — Testes do sender de Web
// Push (VAPID, F27-S06/F27-S08).
//
// Cobre (DoD F27-S06 + verificação F27-S08):
//   1.  no-op quando NOTIFICATIONS_PUSH_ENABLED=false (env off)
//   2.  no-op quando pwa.enabled=false (flag off, env on)
//   3.  fail-closed: erro ao consultar a flag → não envia
//   4.  no-op quando usuário não tem subscriptions ativas
//   5.  envia via web-push para cada subscription ativa
//   6.  payload enviado é LGPD-mínimo: apenas title/severity/entity_type/entity_id
//   7.  subscription 404 → removida (soft-delete) e não propaga
//   8.  subscription 410 → removida (soft-delete) e não propaga
//   9.  erro genérico (não WebPushError 404/410) → logado, não remove, não propaga
//   10. múltiplas subscriptions: falha isolada por subscription
//   11. (F27-S08) defesa em profundidade anti-SSRF: subscription com endpoint
//       fora da allowlist (linha legada/adulterada) é ignorada no envio —
//       `sendNotification` nunca chamado para ela, sem soft-delete, sem lançar.
// =============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// `WebPushError` importado do módulo real (mockado por vi.mock abaixo, que é
// hoisted acima de todos os imports pelo Vitest) — mesma classe usada pelo
// `instanceof` dentro de senders/webPush.ts.
import { WebPushError as MockWebPushError } from 'web-push';

// ---------------------------------------------------------------------------
// Mocks de infraestrutura — declarados antes dos imports dos módulos testados
// ---------------------------------------------------------------------------

vi.mock('../../../config/env.js', () => ({
  env: {
    LOG_LEVEL: 'silent',
    NOTIFICATIONS_PUSH_ENABLED: true,
    VAPID_PUBLIC_KEY: 'test-public-key',
    VAPID_PRIVATE_KEY: 'test-private-key',
    VAPID_SUBJECT: 'mailto:test@example.com',
  },
}));

const mockRequireFlag = vi.fn();
vi.mock('../../../lib/featureFlags.js', () => ({
  requireFlag: (...args: unknown[]) => mockRequireFlag(...args),
}));

vi.mock('../../../db/client.js', () => ({
  db: {},
}));

const mockGetActiveSubscriptions = vi.fn();
const mockSoftDelete = vi.fn();
vi.mock('../repository.js', () => ({
  getActivePushSubscriptionsByUser: (...args: unknown[]) => mockGetActiveSubscriptions(...args),
  softDeletePushSubscriptionByEndpoint: (...args: unknown[]) => mockSoftDelete(...args),
}));

// web-push mockado — WebPushError precisa ser a MESMA classe usada pelo
// `instanceof` dentro de senders/webPush.ts. Definida DENTRO da factory
// (vi.mock é hoisted ao topo do arquivo — uma classe top-level referenciada
// de fora do factory cai em TDZ).
const mockSendNotification = vi.fn();
const mockSetVapidDetails = vi.fn();
vi.mock('web-push', () => {
  class WebPushError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.name = 'WebPushError';
      this.statusCode = statusCode;
    }
  }
  return {
    sendNotification: (...args: unknown[]) => mockSendNotification(...args),
    setVapidDetails: (...args: unknown[]) => mockSetVapidDetails(...args),
    WebPushError,
  };
});

// ---------------------------------------------------------------------------
// Imports após mocks
// ---------------------------------------------------------------------------

import { env } from '../../../config/env.js';
import { sendWebPush } from '../senders/webPush.js';

/**
 * Helper para construir o WebPushError mockado com a mesma assinatura da lib
 * real (message, statusCode, headers, body, endpoint) — só statusCode importa
 * para o `instanceof` + branch 404/410 dentro de senders/webPush.ts.
 */
function makeWebPushError(message: string, statusCode: number): MockWebPushError {
  return new MockWebPushError(message, statusCode, {}, '', '');
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = 'e0000001-0000-0000-0000-000000000001';
const USER_ID = 'e0000002-0000-0000-0000-000000000002';

const BASE_INPUT = {
  organizationId: ORG_ID,
  userId: USER_ID,
  title: 'Nova tarefa atribuída',
  severity: 'info' as const,
  entityType: 'task',
  entityId: 'task-uuid-1',
};

const SUBSCRIPTION_1 = {
  id: 'sub-uuid-1',
  organizationId: ORG_ID,
  userId: USER_ID,
  endpoint: 'https://fcm.googleapis.com/fcm/send/device-1',
  p256dh: 'p256dh-1',
  auth: 'auth-1',
  userAgent: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

const SUBSCRIPTION_2 = {
  ...SUBSCRIPTION_1,
  id: 'sub-uuid-2',
  endpoint: 'https://fcm.googleapis.com/fcm/send/device-2',
  p256dh: 'p256dh-2',
  auth: 'auth-2',
};

describe('sendWebPush()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    env.NOTIFICATIONS_PUSH_ENABLED = true;
    mockRequireFlag.mockResolvedValue(true);
    mockGetActiveSubscriptions.mockResolvedValue([SUBSCRIPTION_1]);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: '', headers: {} });
  });

  afterEach(() => {
    env.NOTIFICATIONS_PUSH_ENABLED = true;
  });

  // ── 1. Env off ─────────────────────────────────────────────────────────────

  it('no-op quando NOTIFICATIONS_PUSH_ENABLED=false (env off)', async () => {
    env.NOTIFICATIONS_PUSH_ENABLED = false;

    await sendWebPush({} as never, BASE_INPUT);

    expect(mockRequireFlag).not.toHaveBeenCalled();
    expect(mockGetActiveSubscriptions).not.toHaveBeenCalled();
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  // ── 2. Flag off ────────────────────────────────────────────────────────────

  it('no-op quando pwa.enabled=false (flag off, env on)', async () => {
    mockRequireFlag.mockResolvedValue(false);

    await sendWebPush({} as never, BASE_INPUT);

    expect(mockGetActiveSubscriptions).not.toHaveBeenCalled();
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  // ── 3. Fail-closed na consulta da flag ────────────────────────────────────

  it('fail-closed: erro ao consultar a flag → não envia', async () => {
    mockRequireFlag.mockRejectedValue(new Error('DB indisponível'));

    await expect(sendWebPush({} as never, BASE_INPUT)).resolves.toBeUndefined();

    expect(mockGetActiveSubscriptions).not.toHaveBeenCalled();
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  // ── 4. Sem subscriptions ativas ────────────────────────────────────────────

  it('no-op quando usuário não tem subscriptions ativas', async () => {
    mockGetActiveSubscriptions.mockResolvedValue([]);

    await sendWebPush({} as never, BASE_INPUT);

    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  // ── 5. Envia para subscription ativa ──────────────────────────────────────

  it('envia via web-push para a subscription ativa do usuário', async () => {
    await sendWebPush({} as never, BASE_INPUT);

    expect(mockGetActiveSubscriptions).toHaveBeenCalledWith({}, ORG_ID, USER_ID);
    expect(mockSendNotification).toHaveBeenCalledTimes(1);

    const [subscriptionArg] = mockSendNotification.mock.calls[0] as [
      { endpoint: string; keys: { p256dh: string; auth: string } },
      string,
    ];
    expect(subscriptionArg).toEqual({
      endpoint: SUBSCRIPTION_1.endpoint,
      keys: { p256dh: SUBSCRIPTION_1.p256dh, auth: SUBSCRIPTION_1.auth },
    });
  });

  // ── 6. Payload LGPD-mínimo ─────────────────────────────────────────────────

  it('payload enviado é LGPD-mínimo: apenas title/severity/entity_type/entity_id', async () => {
    await sendWebPush({} as never, BASE_INPUT);

    const [, payloadArg] = mockSendNotification.mock.calls[0] as [unknown, string];
    const parsedPayload = JSON.parse(payloadArg) as Record<string, unknown>;

    expect(parsedPayload).toEqual({
      title: BASE_INPUT.title,
      severity: BASE_INPUT.severity,
      entity_type: BASE_INPUT.entityType,
      entity_id: BASE_INPUT.entityId,
    });
    // Nunca deve haver campo `body` — LGPD doc 24 §5.3 (payload sem PII).
    expect(parsedPayload).not.toHaveProperty('body');
  });

  // ── 7/8. Subscription morta (404/410) → removida ──────────────────────────

  it.each([404, 410])(
    'subscription %i → removida (soft-delete) e não propaga',
    async (statusCode) => {
      mockSendNotification.mockRejectedValue(makeWebPushError('Gone', statusCode));

      await expect(sendWebPush({} as never, BASE_INPUT)).resolves.toBeUndefined();

      expect(mockSoftDelete).toHaveBeenCalledWith({}, ORG_ID, USER_ID, SUBSCRIPTION_1.endpoint);
    },
  );

  // ── 9. Erro genérico → não remove, não propaga ─────────────────────────────

  it('erro genérico (não 404/410) → logado, não remove subscription, não propaga', async () => {
    mockSendNotification.mockRejectedValue(makeWebPushError('Server error', 500));

    await expect(sendWebPush({} as never, BASE_INPUT)).resolves.toBeUndefined();

    expect(mockSoftDelete).not.toHaveBeenCalled();
  });

  // ── 10. Múltiplas subscriptions — falha isolada ───────────────────────────

  it('múltiplas subscriptions: falha em uma não impede o envio nas demais', async () => {
    mockGetActiveSubscriptions.mockResolvedValue([SUBSCRIPTION_1, SUBSCRIPTION_2]);
    mockSendNotification.mockImplementation((subscription: { endpoint: string }) => {
      if (subscription.endpoint === SUBSCRIPTION_1.endpoint) {
        return Promise.reject(makeWebPushError('Gone', 410));
      }
      return Promise.resolve({ statusCode: 201, body: '', headers: {} });
    });

    await expect(sendWebPush({} as never, BASE_INPUT)).resolves.toBeUndefined();

    expect(mockSendNotification).toHaveBeenCalledTimes(2);
    expect(mockSoftDelete).toHaveBeenCalledWith({}, ORG_ID, USER_ID, SUBSCRIPTION_1.endpoint);
    expect(mockSoftDelete).not.toHaveBeenCalledWith({}, ORG_ID, USER_ID, SUBSCRIPTION_2.endpoint);
  });

  // ── 11. Defesa em profundidade anti-SSRF (F27-S08) ────────────────────────
  //
  // A borda HTTP (Zod refine com isAllowedPushEndpoint, doc 24 §10) já rejeita
  // endpoint fora da allowlist no momento do subscribe — mas o sender aplica a
  // MESMA checagem de novo antes de `sendNotification`, para uma linha legada
  // ou adulterada diretamente no banco não virar proxy de SSRF via `web-push`.

  it('subscription com endpoint fora da allowlist (host arbitrário) é ignorada — sem sendNotification', async () => {
    const rogueSubscription = {
      ...SUBSCRIPTION_1,
      endpoint: 'https://evil.example.com/hook',
    };
    mockGetActiveSubscriptions.mockResolvedValue([rogueSubscription]);

    await expect(sendWebPush({} as never, BASE_INPUT)).resolves.toBeUndefined();

    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it('subscription com endpoint fora da allowlist não é removida (não é 404/410 — só rejeitada na borda de saída)', async () => {
    const rogueSubscription = {
      ...SUBSCRIPTION_1,
      endpoint: 'http://169.254.169.254/latest/meta-data/',
    };
    mockGetActiveSubscriptions.mockResolvedValue([rogueSubscription]);

    await expect(sendWebPush({} as never, BASE_INPUT)).resolves.toBeUndefined();

    expect(mockSendNotification).not.toHaveBeenCalled();
    expect(mockSoftDelete).not.toHaveBeenCalled();
  });

  it('endpoint fora da allowlist entre subscriptions válidas: as válidas ainda recebem o push', async () => {
    const rogueSubscription = {
      ...SUBSCRIPTION_2,
      endpoint: 'https://fcm.googleapis.com.evil.com/fcm/send/spoofed', // host-suffix trick
    };
    mockGetActiveSubscriptions.mockResolvedValue([SUBSCRIPTION_1, rogueSubscription]);

    await expect(sendWebPush({} as never, BASE_INPUT)).resolves.toBeUndefined();

    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    const [subscriptionArg] = mockSendNotification.mock.calls[0] as [{ endpoint: string }];
    expect(subscriptionArg.endpoint).toBe(SUBSCRIPTION_1.endpoint);
  });
});
