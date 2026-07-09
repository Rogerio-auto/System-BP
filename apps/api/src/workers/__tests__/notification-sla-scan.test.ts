// notification-sla-scan.test.ts -- F24-S07
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    JWT_ACCESS_SECRET: 'a'.repeat(64),
    JWT_REFRESH_SECRET: 'b'.repeat(64),
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '30d',
    API_HOST: '0.0.0.0',
    API_PORT: 3333,
    API_PUBLIC_URL: 'http://localhost:3333',
    CORS_ALLOWED_ORIGINS: ['http://localhost:5173'],
    LANGGRAPH_INTERNAL_TOKEN: 'a'.repeat(33),
    LANGGRAPH_SERVICE_URL: 'http://localhost:8000',
    WHATSAPP_APP_SECRET: 'test-whatsapp-secret-at-least-16ch',
    WHATSAPP_VERIFY_TOKEN: 'test-verify-token',
    FX_BRL_PER_USD: 5.75,
    LGPD_DEDUPE_PEPPER: 'a'.repeat(32),
    FOLLOWUP_SCHEDULER_TICK_MS: undefined,
  },
}));
vi.mock('pg', () => {
  const M = vi
    .fn()
    .mockImplementation(() => ({
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      end: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    }));
  return { Pool: M, default: { Pool: M } };
});
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    eq: vi.fn((_c: unknown, v: unknown) => ({ __eq: v })),
    and: vi.fn((...a: unknown[]) => ({ __and: a })),
    isNotNull: vi.fn(() => ({})),
    lt: vi.fn(() => ({})),
  };
});

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockDb = {
  select: mockSelect,
  insert: mockInsert, // as justificado: mock tipado localmente sem import circular
} as unknown as {
  select: typeof mockSelect;
  insert: typeof mockInsert;
  transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
};
vi.mock('../../db/client.js', () => ({ db: {}, pool: {} }));

const mockFindSlaSources = vi.fn();
vi.mock('../../modules/notification-rules/sla-sources.js', () => ({
  findSlaSources: (...a: unknown[]) => mockFindSlaSources(...a),
}));
const mockResolveRecipients = vi.fn();
vi.mock('../../modules/notification-rules/recipients.js', () => ({
  resolveRuleRecipients: (...a: unknown[]) => mockResolveRecipients(...a),
}));
const mockIsCategoryEnabled = vi.fn();
vi.mock('../../modules/notifications/repository.js', () => ({
  isCategoryChannelEnabled: (...a: unknown[]) => mockIsCategoryEnabled(...a),
}));
const mockSendInApp = vi.fn();
vi.mock('../../modules/notifications/senders/inApp.js', () => ({
  sendInApp: (...a: unknown[]) => mockSendInApp(...a),
}));
const mockSendEmail = vi.fn();
vi.mock('../../modules/notifications/senders/email.js', () => ({
  sendEmail: (...a: unknown[]) => mockSendEmail(...a),
}));

import { buildSlaBucket, runSlaScanTick } from '../../workers/notification-sla-scan.js';

const RULE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const LEAD_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const USER_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const BASE_RULE = {
  id: RULE_ID,
  organizationId: ORG_ID,
  name: 'Inatividade',
  triggerKind: 'stage_inactivity' as const,
  triggerKey: 'Qualificacao',
  category: 'lead',
  thresholdHours: 24,
  cooldownHours: 24,
  enabled: true,
  recipientMode: 'by_role_city' as const,
  recipientRoles: ['agente'],
  channels: ['in_app'],
  titleTemplate: 'Lead parado',
  bodyTemplate: 'Lead {{entity_id}}',
  severity: 'warning' as const,
  filters: {},
  createdBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const BASE_ENTITY = {
  entityId: LEAD_ID,
  entityType: 'lead',
  cityId: null,
  sinceAt: new Date(Date.now() - 48 * 60 * 60 * 1_000),
};

function setupFullFlow(rules: unknown[], hasDelivery: boolean): void {
  let n = 0;
  mockSelect.mockImplementation(() => {
    n++;
    if (n === 1)
      return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(rules) }) };
    return {
      from: vi
        .fn()
        .mockReturnValue({
          where: vi
            .fn()
            .mockReturnValue({
              limit: vi.fn().mockResolvedValue(hasDelivery ? [{ id: 'x' }] : []),
            }),
        }),
    };
  });
  mockInsert.mockReturnValue({
    values: vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindSlaSources.mockResolvedValue([]);
  mockResolveRecipients.mockResolvedValue([]);
  mockIsCategoryEnabled.mockResolvedValue(true);
  mockSendInApp.mockResolvedValue(undefined);
  mockSendEmail.mockResolvedValue(undefined);
});

describe('buildSlaBucket', () => {
  it('mesma janela = mesmo bucket', () => {
    const now = new Date('2026-07-09T10:00:00Z');
    expect(buildSlaBucket(RULE_ID, 24, now)).toBe(buildSlaBucket(RULE_ID, 24, now));
  });
  it('janelas diferentes = buckets diferentes', () => {
    expect(buildSlaBucket(RULE_ID, 24, new Date('2026-07-09T10:00:00Z'))).not.toBe(
      buildSlaBucket(RULE_ID, 24, new Date('2026-07-10T12:00:00Z')),
    );
  });
  it('prefixo sla e ruleId presentes', () => {
    const b = buildSlaBucket(RULE_ID, 24, new Date());
    expect(b).toMatch(/^sla:/);
    expect(b).toContain(RULE_ID);
  });
});

describe('runSlaScanTick', () => {
  it('sem regras ativas -> 0', async () => {
    mockSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }));
    const r = await runSlaScanTick(mockDb);
    expect(r.rulesProcessed).toBe(0);
    expect(r.entitiesEligible).toBe(0);
  });

  it('regra ativa + entidade elegivel -> disparo', async () => {
    setupFullFlow([BASE_RULE], false);
    mockFindSlaSources.mockResolvedValue([BASE_ENTITY]);
    mockResolveRecipients.mockResolvedValue([
      { userId: USER_ID, organizationId: ORG_ID, displayName: 'A', channels: ['in_app' as const] },
    ]);
    const r = await runSlaScanTick(mockDb);
    expect(r.rulesProcessed).toBe(1);
    expect(r.entitiesEligible).toBe(1);
    expect(mockSendInApp).toHaveBeenCalledOnce();
  });

  it('cooldown: ja entregue -> skip', async () => {
    setupFullFlow([BASE_RULE], true);
    mockFindSlaSources.mockResolvedValue([BASE_ENTITY]);
    const r = await runSlaScanTick(mockDb);
    expect(r.rulesProcessed).toBe(1);
    expect(mockSendInApp).not.toHaveBeenCalled();
  });

  it('city_scope: fora do scope -> skip', async () => {
    setupFullFlow([{ ...BASE_RULE, filters: { city_scope: ['city-a'] } }], false);
    mockFindSlaSources.mockResolvedValue([{ ...BASE_ENTITY, cityId: 'city-b' }]);
    await runSlaScanTick(mockDb);
    expect(mockSendInApp).not.toHaveBeenCalled();
  });

  it('sem destinatarios -> sem disparo', async () => {
    setupFullFlow([BASE_RULE], false);
    mockFindSlaSources.mockResolvedValue([BASE_ENTITY]);
    mockResolveRecipients.mockResolvedValue([]);
    await runSlaScanTick(mockDb);
    expect(mockSendInApp).not.toHaveBeenCalled();
  });

  it('canal desabilitado -> sem disparo', async () => {
    setupFullFlow([BASE_RULE], false);
    mockFindSlaSources.mockResolvedValue([BASE_ENTITY]);
    mockResolveRecipients.mockResolvedValue([
      { userId: USER_ID, organizationId: ORG_ID, displayName: 'A', channels: ['in_app' as const] },
    ]);
    mockIsCategoryEnabled.mockResolvedValue(false);
    await runSlaScanTick(mockDb);
    expect(mockSendInApp).not.toHaveBeenCalled();
  });
});
