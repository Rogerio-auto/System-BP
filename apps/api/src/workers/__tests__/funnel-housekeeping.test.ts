// funnel-housekeeping.test.ts -- F25-S05
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../../db/client.js';
import { runFunnelHousekeepingTick } from '../funnel-housekeeping.js';

// ---------------------------------------------------------------------------
// Mocks de modulos
// ---------------------------------------------------------------------------
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
  const M = vi.fn().mockImplementation(() => ({
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
    eq: vi.fn((_c, v) => ({ __eq: v })),
    and: vi.fn((...a) => ({ __and: a })),
    inArray: vi.fn(() => ({})),
    notInArray: vi.fn(() => ({})),
    isNull: vi.fn(() => ({})),
    lt: vi.fn(() => ({})),
  };
});

const mockEmit = vi.fn();
vi.mock('../../events/emit.js', () => ({ emit: (...a: unknown[]) => mockEmit(...a) }));
const mockAuditLog = vi.fn();
vi.mock('../../lib/audit.js', () => ({ auditLog: (...a: unknown[]) => mockAuditLog(...a) }));

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockTransaction = vi.fn();
// as justificado: mock parcial — NodePgDatabase requer muitos metodos; so usamos 4.
const mockDb = {
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  transaction: mockTransaction,
} as unknown as Database;
vi.mock('../../db/client.js', () => ({ db: {}, pool: {} }));

const ORG_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const LEAD_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const STAGE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CARD_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const BASE_SETTINGS = {
  organizationId: ORG_ID,
  stagnantAfterDays: 7,
  abandonAfterDays: 30,
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const OLD_STAGNANT = new Date(Date.now() - 10 * 24 * 60 * 60 * 1_000);
const OLD_ABANDON = new Date(Date.now() - 35 * 24 * 60 * 60 * 1_000);
const BASE_LEAD = {
  leadId: LEAD_ID,
  orgId: ORG_ID,
  cityId: null,
  stageId: STAGE_ID,
  cardId: CARD_ID,
  canonicalRole: 'pre_atendimento',
  updatedAt: OLD_STAGNANT,
};

// F25-S10: processStagnant/processAbandon fazem uma pre-checagem
// `tx.select(...).from(eventOutbox)...limit(1)` antes de emit+auditLog. O mock
// de tx.select retorna `existingRows` (vazio por padrao = 1o tick, sem dup).
function makeTx(existingRows: unknown[] = []) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(existingRows),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEmit.mockResolvedValue('e-id');
  mockAuditLog.mockResolvedValue('a-id');
  mockTransaction.mockImplementation(async (fn) => fn(makeTx()));
  mockInsert.mockReturnValue({
    values: vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }),
  });
});

function setupSelectSeq(settingsRows: unknown[], leadsRows: unknown[]) {
  let n = 0;
  mockSelect.mockImplementation(() => {
    n++;
    if (n === 1)
      return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(settingsRows) }) };
    // n=2: findEligibleLeads (leads JOIN kanban_cards JOIN kanban_stages)
    return {
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(leadsRows) }),
        }),
      }),
    };
  });
}

describe('runFunnelHousekeepingTick', () => {
  it('sem orgs enabled=true -> 0', async () => {
    mockSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }));
    const r = await runFunnelHousekeepingTick(mockDb);
    expect(r.orgsProcessed).toBe(0);
  });

  it('lead alem de stagnant -> stagnant emitido', async () => {
    setupSelectSeq([BASE_SETTINGS], [BASE_LEAD]);
    const r = await runFunnelHousekeepingTick(mockDb);
    expect(r.stagnantEmitted).toBe(1);
    expect(r.abandonedEmitted).toBe(0);
    expect(mockTransaction).toHaveBeenCalledOnce();
  });

  it('lead alem de abandon -> abandoned emitido', async () => {
    setupSelectSeq([BASE_SETTINGS], [{ ...BASE_LEAD, updatedAt: OLD_ABANDON }]);
    const r = await runFunnelHousekeepingTick(mockDb);
    expect(r.stagnantEmitted).toBe(0);
    expect(r.abandonedEmitted).toBe(1);
    expect(mockTransaction).toHaveBeenCalledOnce();
  });

  it('idempotencia: emit chamado com onConflictDoNothing (dedup no outbox)', async () => {
    // A idempotencia e garantida pelo onConflictDoNothing no emit() com idempotencyKey unica.
    // Este teste verifica que emit e chamado com a flag correta.
    setupSelectSeq([BASE_SETTINGS], [BASE_LEAD]);
    const r = await runFunnelHousekeepingTick(mockDb);
    expect(r.stagnantEmitted).toBe(1);
    expect(mockEmit).toHaveBeenCalledOnce();
    // as justificado: vitest mock.calls tipado como (unknown[] | undefined)[] — assertamos existencia antes.
    const emitArgs = mockEmit.mock.calls[0] as unknown[];
    // Segundo argumento: o evento; terceiro: opts com onConflictDoNothing
    expect(emitArgs[1]).toMatchObject({
      eventName: 'leads.stagnant',
      idempotencyKey: expect.stringContaining('funnel-stagnant:'),
    });
    expect(emitArgs[2]).toMatchObject({ onConflictDoNothing: true });
  });

  it('F25-S10: 2o tick (idempotencyKey ja no outbox) pula emit E audit', async () => {
    // Pre-checagem encontra a idempotencyKey ja emitida -> nem emit nem
    // auditLog devem ser chamados para este lead (nao infla audit_logs).
    setupSelectSeq([BASE_SETTINGS], [BASE_LEAD]);
    mockTransaction.mockImplementation(async (fn) => fn(makeTx([{ id: 'existing-event-id' }])));
    const r = await runFunnelHousekeepingTick(mockDb);
    expect(r.stagnantEmitted).toBe(1); // contador do tick nao gateia no resultado do pre-check
    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  it('erro por lead isolado nao interrompe org', async () => {
    let n = 0;
    mockSelect.mockImplementation(() => {
      n++;
      if (n === 1)
        return {
          from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([BASE_SETTINGS]) }),
        };
      return {
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([BASE_LEAD, { ...BASE_LEAD, leadId: 'lead-2' }]),
            }),
          }),
        }),
      };
    });
    mockTransaction.mockRejectedValueOnce(new Error('DB error')).mockResolvedValue(undefined);
    const r = await runFunnelHousekeepingTick(mockDb);
    expect(r.orgsProcessed).toBe(1);
  });
});
