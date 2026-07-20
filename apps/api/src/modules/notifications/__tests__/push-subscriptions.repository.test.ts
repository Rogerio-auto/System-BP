// =============================================================================
// notifications/__tests__/push-subscriptions.repository.test.ts — Testes de
// CRUD de push_subscriptions (F27-S06).
//
// Cobre (DoD F27-S06):
//   1. upsertPushSubscription: insert com onConflictDoUpdate por endpoint
//      (upsert idempotente), target/targetWhere corretos, revive soft-delete.
//   2. softDeletePushSubscriptionByEndpoint: soft-delete escopado por
//      (organizationId, userId, endpoint); idempotente (retorna null se já
//      removida/inexistente); não lança.
//   3. getActivePushSubscriptionsByUser: filtra por org/user/deletedAt IS NULL.
// =============================================================================
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../../../db/client.js';
import {
  getActivePushSubscriptionsByUser,
  softDeletePushSubscriptionByEndpoint,
  upsertPushSubscription,
} from '../repository.js';

const ORG_ID = 'd0000001-0000-0000-0000-000000000001';
const USER_ID = 'd0000002-0000-0000-0000-000000000002';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/test-endpoint-abc123';

/**
 * `as unknown as Database` justificado: os mocks abaixo satisfazem apenas a
 * fatia da interface Drizzle usada por cada função sob teste (insert/update/
 * select encadeados) — mesmo padrão de preferences.test.ts.
 */
function asDb(mock: object): Database {
  return mock as unknown as Database;
}

describe('upsertPushSubscription', () => {
  it('faz insert com onConflictDoUpdate por endpoint e retorna o id', async () => {
    const chain = {
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'sub-uuid-1' }]),
    };
    // Guarda cross-org: select prévio sem linha existente (endpoint livre).
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(selectChain),
      insert: vi.fn().mockReturnValue(chain),
    };

    const result = await upsertPushSubscription(asDb(mockDb), {
      organizationId: ORG_ID,
      userId: USER_ID,
      endpoint: ENDPOINT,
      p256dh: 'p256dh-key',
      auth: 'auth-secret',
      userAgent: 'Chrome/128',
    });

    expect(result).toEqual({ id: 'sub-uuid-1' });
    expect(mockDb.insert).toHaveBeenCalledOnce();
    expect(chain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        userId: USER_ID,
        endpoint: ENDPOINT,
        p256dh: 'p256dh-key',
        auth: 'auth-secret',
        deletedAt: null,
      }),
    );

    // Upsert idempotente: target = endpoint, targetWhere = deletedAt IS NULL
    // (mesmo padrão do índice único parcial uq_push_subscriptions_endpoint_active).
    expect(chain.onConflictDoUpdate).toHaveBeenCalledOnce();
    const conflictArgs = chain.onConflictDoUpdate.mock.calls[0]?.[0] as {
      target: unknown;
      targetWhere: unknown;
      set: Record<string, unknown>;
    };
    expect(conflictArgs.target).toBeDefined();
    expect(conflictArgs.targetWhere).toBeDefined();
    // Set inclui deletedAt: null — revive subscription soft-deleted (reinstalação)
    expect(conflictArgs.set['deletedAt']).toBeNull();
    expect(conflictArgs.set['userId']).toBe(USER_ID);
  });

  it('reenviar a mesma subscription é idempotente (mesmo endpoint → 1 linha)', async () => {
    const chain = {
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'sub-uuid-1' }]),
    };
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(selectChain),
      insert: vi.fn().mockReturnValue(chain),
    };

    const input = {
      organizationId: ORG_ID,
      userId: USER_ID,
      endpoint: ENDPOINT,
      p256dh: 'p256dh-key',
      auth: 'auth-secret',
    };

    const first = await upsertPushSubscription(asDb(mockDb), input);
    const second = await upsertPushSubscription(asDb(mockDb), input);

    expect(first.id).toBe(second.id);
    expect(mockDb.insert).toHaveBeenCalledTimes(2);
  });

  it('rejeita (403) reatribuição de endpoint ativo de OUTRA organização', async () => {
    // Endpoint já pertence a outra org → não pode ser reivindicado (anti-roubo
    // cross-tenant). O índice único em endpoint não é escopado por org, então a
    // guarda é aplicada no app antes de qualquer escrita.
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockResolvedValue([{ organizationId: 'd9999999-0000-0000-0000-000000000099' }]),
    };
    const insertSpy = vi.fn();
    const mockDb = {
      select: vi.fn().mockReturnValue(selectChain),
      insert: insertSpy,
    };

    await expect(
      upsertPushSubscription(asDb(mockDb), {
        organizationId: ORG_ID,
        userId: USER_ID,
        endpoint: ENDPOINT,
        p256dh: 'p256dh-key',
        auth: 'auth-secret',
      }),
    ).rejects.toMatchObject({ statusCode: 403 });

    // Nenhuma escrita ocorre quando a guarda cross-org dispara.
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('permite reatribuição dentro da MESMA organização (terminal compartilhado)', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ organizationId: ORG_ID }]),
    };
    const chain = {
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'sub-uuid-1' }]),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(selectChain),
      insert: vi.fn().mockReturnValue(chain),
    };

    const result = await upsertPushSubscription(asDb(mockDb), {
      organizationId: ORG_ID,
      userId: 'd0000003-0000-0000-0000-000000000003',
      endpoint: ENDPOINT,
      p256dh: 'p256dh-key',
      auth: 'auth-secret',
    });

    expect(result).toEqual({ id: 'sub-uuid-1' });
    expect(mockDb.insert).toHaveBeenCalledOnce();
  });
});

describe('softDeletePushSubscriptionByEndpoint', () => {
  it('retorna o id da subscription removida quando existe ativa', async () => {
    const chain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'sub-uuid-2' }]),
    };
    const mockDb = { update: vi.fn().mockReturnValue(chain) };

    const result = await softDeletePushSubscriptionByEndpoint(
      asDb(mockDb),
      ORG_ID,
      USER_ID,
      ENDPOINT,
    );

    expect(result).toBe('sub-uuid-2');
    expect(chain.set).toHaveBeenCalledWith(
      expect.objectContaining({ deletedAt: expect.any(Date) as Date }),
    );
  });

  it('idempotente: retorna null (sem lançar) quando já removida ou inexistente', async () => {
    const chain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
    };
    const mockDb = { update: vi.fn().mockReturnValue(chain) };

    await expect(
      softDeletePushSubscriptionByEndpoint(asDb(mockDb), ORG_ID, USER_ID, 'nao-existe'),
    ).resolves.toBeNull();
  });
});

describe('getActivePushSubscriptionsByUser', () => {
  it('retorna apenas subscriptions ativas (deletedAt IS NULL) do usuário/org', async () => {
    const activeRows = [
      {
        id: 'sub-1',
        organizationId: ORG_ID,
        userId: USER_ID,
        endpoint: ENDPOINT,
        p256dh: 'p1',
        auth: 'a1',
        userAgent: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ];
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(activeRows),
    };
    const mockDb = { select: vi.fn().mockReturnValue(chain) };

    const result = await getActivePushSubscriptionsByUser(asDb(mockDb), ORG_ID, USER_ID);

    expect(result).toEqual(activeRows);
    expect(mockDb.select).toHaveBeenCalledOnce();
  });

  it('retorna array vazio quando usuário não tem subscriptions ativas', async () => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    const mockDb = { select: vi.fn().mockReturnValue(chain) };

    const result = await getActivePushSubscriptionsByUser(asDb(mockDb), ORG_ID, USER_ID);

    expect(result).toEqual([]);
  });
});
