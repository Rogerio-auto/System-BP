// =============================================================================
// kanban-on-qualification.test.ts -- Testes do handler F25-S03.
// =============================================================================
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
  },
}));

vi.mock('pg', () => {
  const MockPool = vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { Pool: MockPool, default: { Pool: MockPool } };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col, val) => ({ __eq: val })),
  and: vi.fn((...args) => ({ __and: args })),
  sql: Object.assign(
    vi.fn(() => ({})),
    { mapWith: vi.fn() },
  ),
  relations: vi.fn().mockReturnValue({}),
  asc: vi.fn().mockReturnValue({}),
  desc: vi.fn().mockReturnValue({}),
  count: vi.fn().mockReturnValue({}),
  inArray: vi.fn().mockReturnValue({}),
  isNull: vi.fn().mockReturnValue({}),
}));

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn().mockReturnValue({}),
}));

vi.mock('../../db/client.js', () => ({ db: {}, pool: {} }));

const mockAuditLog = vi.fn().mockResolvedValue('audit-uuid');
vi.mock('../../lib/audit.js', () => ({
  auditLog: (...args: unknown[]) => mockAuditLog(...args),
}));

import { handleLeadQualified } from '../kanban-on-qualification.js';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const LEAD_ID = '22222222-2222-2222-2222-222222222222';
const CARD_ID = '33333333-3333-3333-3333-333333333333';
const STAGE_PRE_ID = 'aaaa0000-0000-0000-0000-000000000000';
const EVENT_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

function makeEvent(overrides = {}) {
  return {
    id: EVENT_ID,
    organizationId: ORG_ID,
    eventName: 'leads.qualified',
    eventVersion: 1,
    aggregateType: 'lead',
    aggregateId: LEAD_ID,
    payload: {
      lead_id: LEAD_ID,
      organization_id: ORG_ID,
      canonical_role: 'pre_atendimento',
      stage_id: STAGE_PRE_ID,
      card_id: CARD_ID,
    },
    correlationId: null,
    idempotencyKey: 'leads.qualified:' + LEAD_ID,
    attempts: 0,
    lastError: null,
    processedAt: null,
    failedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

const cardPriority0 = {
  id: CARD_ID,
  organizationId: ORG_ID,
  leadId: LEAD_ID,
  stageId: STAGE_PRE_ID,
  assigneeUserId: null,
  priority: 0,
  notes: null,
  enteredStageAt: new Date(),
  productId: null,
  lastSimulationId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const cardPriority1 = { ...cardPriority0, priority: 1 };

function makeMockDb(options: { card?: unknown | null; transactionError?: Error | null }) {
  let selectCall = 0;
  const selectResponses = [options.card !== undefined ? (options.card ? [options.card] : []) : []];

  const mockSelect = () => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(selectResponses[selectCall++] ?? []),
      }),
    }),
  });

  const mockUpdate = vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  });

  const mockInsert = vi.fn().mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined),
  });

  const txMock = { select: mockSelect, update: mockUpdate, insert: mockInsert };

  const mockTransaction = options.transactionError
    ? vi.fn().mockRejectedValue(options.transactionError)
    : vi.fn().mockImplementation(async (fn) => {
        await fn(txMock);
      });

  return {
    select: mockSelect,
    update: mockUpdate,
    insert: mockInsert,
    transaction: mockTransaction,
  };
}

describe('handleLeadQualified', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('eleva priority do card para 1 quando card esta em priority=0', async () => {
    const db = makeMockDb({ card: cardPriority0 }) as unknown as Parameters<
      typeof handleLeadQualified
    >[0];
    await handleLeadQualified(db, makeEvent());

    expect(mockAuditLog).toHaveBeenCalledOnce();
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'kanban.card_qualified_by_ai',
        organizationId: ORG_ID,
        resource: { type: 'kanban_card', id: CARD_ID },
      }),
    );
  });

  it('e no-op idempotente quando card ja tem priority > 0', async () => {
    const db = makeMockDb({ card: cardPriority1 }) as unknown as Parameters<
      typeof handleLeadQualified
    >[0];
    await handleLeadQualified(db, makeEvent());
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  it('faz skip sem erro quando payload nao tem lead_id', async () => {
    const db = makeMockDb({ card: null }) as unknown as Parameters<typeof handleLeadQualified>[0];
    const event = makeEvent({ payload: { organization_id: ORG_ID } });
    await expect(handleLeadQualified(db, event)).resolves.toBeUndefined();
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  it('faz skip sem erro quando card nao existe', async () => {
    const db = makeMockDb({ card: null }) as unknown as Parameters<typeof handleLeadQualified>[0];
    await expect(handleLeadQualified(db, makeEvent())).resolves.toBeUndefined();
    expect(mockAuditLog).not.toHaveBeenCalled();
  });
});
