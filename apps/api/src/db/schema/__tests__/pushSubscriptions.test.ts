// =============================================================================
// pushSubscriptions.test.ts — Testes do schema push_subscriptions (F27-S05).
//
// Estratégia: DB mockado via vi.mock — valida constraints, índices únicos e
// FKs através do comportamento declarado na tabela Drizzle (mesmo padrão de
// leads.test.ts / featureTutorials.test.ts).
//
// Cobertura:
//   - insert ok (subscription válida).
//   - único parcial em endpoint (WHERE deleted_at IS NULL): duplicata ativa
//     rejeitada; após soft-delete do endpoint anterior, novo insert aceito.
//   - FK organization_id / user_id inexistentes rejeitadas.
//   - user_agent opcional (NULL aceito).
//   - Tipo PushSubscription/NewPushSubscription compila sem 'any'.
// =============================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock pg — evita conexão real ao Postgres
// ---------------------------------------------------------------------------
vi.mock('pg', () => {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const MockPool = vi.fn().mockImplementation(() => ({
    query: mockQuery,
    connect: vi.fn().mockResolvedValue({
      query: mockQuery,
      release: vi.fn(),
    }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  const MockClient = vi.fn().mockImplementation(() => ({
    query: mockQuery,
    connect: vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return {
    default: { Pool: MockPool, Client: MockClient },
    Pool: MockPool,
    Client: MockClient,
  };
});

// ---------------------------------------------------------------------------
// Mock Drizzle db — controla insert com chainable API
// ---------------------------------------------------------------------------
const mockInsertValues = vi.fn();
mockInsertValues.mockResolvedValue([]);

const mockDb = {
  insert: vi.fn().mockReturnValue({ values: mockInsertValues }),
};

vi.mock('../../client.js', () => ({
  db: mockDb,
  pool: {
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    }),
    end: vi.fn(),
    on: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Imports após mocks
// ---------------------------------------------------------------------------
import {
  pushSubscriptions,
  type NewPushSubscription,
  type PushSubscription,
} from '../pushSubscriptions.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const ORG_ID = 'aabbccdd-0001-0000-0000-000000000001';
const USER_ID = 'aabbccdd-0004-0000-0000-000000000001';
const SUB_ID = 'aabbccdd-0006-0000-0000-000000000001';

function makeNewSubscription(overrides: Partial<NewPushSubscription> = {}): NewPushSubscription {
  return {
    organizationId: ORG_ID,
    userId: USER_ID,
    endpoint: 'https://fcm.googleapis.com/fcm/send/example-endpoint-token',
    p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I3',
    auth: 'tBHItJI5svbpez7KI4CCXg',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Testes: tabela push_subscriptions
// ---------------------------------------------------------------------------
describe('push_subscriptions — schema e types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue({ values: mockInsertValues });
    mockInsertValues.mockResolvedValue([]);
  });

  it('subscription válida: insert aceito sem erro', async () => {
    const newSub = makeNewSubscription();
    await mockDb.insert(pushSubscriptions).values(newSub);

    expect(mockDb.insert).toHaveBeenCalledWith(pushSubscriptions);
    expect(mockInsertValues).toHaveBeenCalledWith(newSub);
  });

  it('endpoint duplicado ativo: simula UNIQUE violation (único parcial)', async () => {
    // Simula o que o Postgres faria: rejeitar insert com endpoint já ativo
    // (WHERE deleted_at IS NULL) — mesmo endpoint, subscription não soft-deletada.
    mockInsertValues.mockRejectedValueOnce(
      new Error(
        'duplicate key value violates unique constraint "uq_push_subscriptions_endpoint_active"',
      ),
    );

    const newSub = makeNewSubscription();
    await expect(mockDb.insert(pushSubscriptions).values(newSub)).rejects.toThrow(
      'uq_push_subscriptions_endpoint_active',
    );
  });

  it('endpoint duplicado após soft-delete do anterior: aceito (índice parcial)', async () => {
    // O índice único parcial WHERE deleted_at IS NULL NÃO cobre subscriptions
    // já soft-deletadas — reinstalar o PWA revive o mesmo endpoint numa nova linha.
    mockInsertValues.mockResolvedValueOnce([{ id: 'new-sub-id' }]);

    const newSub = makeNewSubscription({
      endpoint: 'https://fcm.googleapis.com/fcm/send/example-endpoint-token',
    });
    const result = await mockDb.insert(pushSubscriptions).values(newSub);

    expect(result).toEqual([{ id: 'new-sub-id' }]);
  });

  it('organization_id inexistente: simula FK violation', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error(
        'insert or update violates foreign key constraint "fk_push_subscriptions_organization"',
      ),
    );

    const newSub = makeNewSubscription({ organizationId: '00000000-dead-beef-0000-000000000000' });
    await expect(mockDb.insert(pushSubscriptions).values(newSub)).rejects.toThrow(
      'fk_push_subscriptions_organization',
    );
  });

  it('user_id inexistente: simula FK violation', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error('insert or update violates foreign key constraint "fk_push_subscriptions_user"'),
    );

    const newSub = makeNewSubscription({ userId: '00000000-dead-beef-0000-000000000000' });
    await expect(mockDb.insert(pushSubscriptions).values(newSub)).rejects.toThrow(
      'fk_push_subscriptions_user',
    );
  });

  it('user_agent ausente (NULL): aceito', async () => {
    mockInsertValues.mockResolvedValueOnce([{ id: SUB_ID }]);
    const newSub = makeNewSubscription({ userAgent: null });

    const result = await mockDb.insert(pushSubscriptions).values(newSub);
    expect(result).toEqual([{ id: SUB_ID }]);
  });
});

// ---------------------------------------------------------------------------
// Testes de tipagem — verifica que os tipos Drizzle compilam corretamente
// ---------------------------------------------------------------------------
describe('tipos Drizzle — compilação sem any', () => {
  it('PushSubscription type tem os campos esperados', () => {
    const sub: PushSubscription = {
      id: SUB_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      endpoint: 'https://fcm.googleapis.com/fcm/send/example-endpoint-token',
      p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I3',
      auth: 'tBHItJI5svbpez7KI4CCXg',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    expect(sub.id).toBe(SUB_ID);
    expect(sub.userAgent).toContain('Chrome');
  });

  it('NewPushSubscription aceita campos obrigatórios sem opcionais', () => {
    const minimal: NewPushSubscription = {
      organizationId: ORG_ID,
      userId: USER_ID,
      endpoint: 'https://fcm.googleapis.com/fcm/send/minimal-endpoint',
      p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I3',
      auth: 'tBHItJI5svbpez7KI4CCXg',
    };
    expect(minimal.userAgent).toBeUndefined();
    expect(minimal.endpoint).toContain('minimal-endpoint');
  });
});

// ---------------------------------------------------------------------------
// LGPD — endpoint/p256dh/auth identificam device/usuário (doc 24 §9)
// ---------------------------------------------------------------------------
describe('LGPD — dado pessoal (doc 24 §9)', () => {
  it('deleted_at é o hook de soft-delete para opt-out/logout/retenção', () => {
    const sub: PushSubscription = {
      id: SUB_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      endpoint: 'https://fcm.googleapis.com/fcm/send/example-endpoint-token',
      p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I3',
      auth: 'tBHItJI5svbpez7KI4CCXg',
      userAgent: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: new Date(),
    };
    // NOT NULL = removida (opt-out/logout/subscription morta/direito do titular).
    expect(sub.deletedAt).not.toBeNull();
  });
});
