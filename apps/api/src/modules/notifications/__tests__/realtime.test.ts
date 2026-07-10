// =============================================================================
// realtime.test.ts — Testes de modules/notifications/realtime.ts (F24-S08).
//
// Cenários cobertos:
//   1. Flag `notifications.realtime.enabled` desabilitada → no-op (não publica).
//   2. Flag habilitada → publica na fila hm.q.socket.relay com room=user:{userId},
//      event='notification.new' e payload mínimo (sem body/PII extra).
//   3. makeEnvelope é chamado com organizationId correto.
//   4. Erro de publish() propaga (caller decide fire-and-forget).
// =============================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks (hoisted)
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  mockRequireFlag: vi.fn(),
  mockPublish: vi.fn(),
}));

vi.mock('../../../lib/featureFlags.js', () => ({
  requireFlag: (...args: unknown[]) => mocks.mockRequireFlag(...args),
}));

vi.mock('../../../lib/queue/index.js', () => ({
  publish: (...args: unknown[]) => mocks.mockPublish(...args),
  makeEnvelope: (type: string, organizationId: string, payload: unknown) => ({
    id: 'envelope-uuid',
    type,
    organizationId,
    payload,
    ts: 1_700_000_000_000,
  }),
}));

vi.mock('../../../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Imports reais (após mocks)
// ---------------------------------------------------------------------------

import type { Database } from '../../../db/client.js';
import { QUEUES } from '../../../lib/queue/topology.js';
import { publishNotificationSocket } from '../realtime.js';

// `as unknown as Database` justificado: publishNotificationSocket apenas repassa
// db para requireFlag (mockado) — nunca executa query real neste teste.
const fakeDb = {} as unknown as Database;

const baseInput = {
  organizationId: 'org-1111-1111-1111-111111111111',
  userId: 'user-2222-2222-2222-222222222222',
  notification: {
    id: 'notif-3333-3333-3333-333333333333',
    type: 'in_app:task.created',
    title: 'Nova tarefa atribuída',
    severity: 'info' as const,
    entityType: 'task',
    entityId: 'task-4444-4444-4444-444444444444',
    createdAt: '2026-07-10T12:00:00.000Z',
  },
};

describe('publishNotificationSocket', () => {
  beforeEach(() => {
    mocks.mockRequireFlag.mockReset();
    mocks.mockPublish.mockReset();
    mocks.mockPublish.mockResolvedValue(undefined);
  });

  it('1. flag desabilitada → não publica (no-op)', async () => {
    mocks.mockRequireFlag.mockResolvedValue(false);

    await publishNotificationSocket(fakeDb, baseInput);

    expect(mocks.mockRequireFlag).toHaveBeenCalledWith(
      fakeDb,
      'notifications.realtime.enabled',
      expect.anything(),
    );
    expect(mocks.mockPublish).not.toHaveBeenCalled();
  });

  it('2. flag habilitada → publica em hm.q.socket.relay com room=user:{userId} e payload mínimo', async () => {
    mocks.mockRequireFlag.mockResolvedValue(true);

    await publishNotificationSocket(fakeDb, baseInput);

    expect(mocks.mockPublish).toHaveBeenCalledOnce();
    const [routingKey, envelope] = mocks.mockPublish.mock.calls[0] as [string, unknown];
    expect(routingKey).toBe(QUEUES.socketRelay);

    const typedEnvelope = envelope as {
      organizationId: string;
      payload: {
        room: string;
        event: string;
        data: Record<string, unknown>;
      };
    };

    expect(typedEnvelope.organizationId).toBe(baseInput.organizationId);
    expect(typedEnvelope.payload.room).toBe(`user:${baseInput.userId}`);
    expect(typedEnvelope.payload.event).toBe('notification.new');
    expect(typedEnvelope.payload.data).toEqual({
      id: baseInput.notification.id,
      type: baseInput.notification.type,
      title: baseInput.notification.title,
      severity: baseInput.notification.severity,
      entityType: baseInput.notification.entityType,
      entityId: baseInput.notification.entityId,
      createdAt: baseInput.notification.createdAt,
    });
    // Sem PII além do título — nenhum campo `body` no payload.
    expect(typedEnvelope.payload.data).not.toHaveProperty('body');
  });

  it('3. respeita entityType/entityId nulos (notificação sem entidade vinculada)', async () => {
    mocks.mockRequireFlag.mockResolvedValue(true);

    await publishNotificationSocket(fakeDb, {
      ...baseInput,
      notification: { ...baseInput.notification, entityType: null, entityId: null },
    });

    const [, envelope] = mocks.mockPublish.mock.calls[0] as [
      string,
      { payload: { data: Record<string, unknown> } },
    ];
    expect(envelope.payload.data['entityType']).toBeNull();
    expect(envelope.payload.data['entityId']).toBeNull();
  });

  it('4. erro de publish() propaga para o caller decidir (fire-and-forget é responsabilidade do chamador)', async () => {
    mocks.mockRequireFlag.mockResolvedValue(true);
    mocks.mockPublish.mockRejectedValue(new Error('broker indisponível'));

    await expect(publishNotificationSocket(fakeDb, baseInput)).rejects.toThrow(
      'broker indisponível',
    );
  });
});
