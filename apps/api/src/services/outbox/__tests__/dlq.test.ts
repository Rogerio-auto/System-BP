// =============================================================================
// dlq.test.ts — Testes do serviço DLQ (F1-S22).
//
// Casos testados:
//   1. moveToDlq → insere row em event_dlq e atualiza event_outbox.
//   2. replayFromDlq → cria novo evento em event_outbox e marca DLQ como reprocessada.
//   3. replayFromDlq com entry não encontrada → lança Error.
//   4. replayFromDlq com entry já reprocessada → lança Error.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock pg
// ---------------------------------------------------------------------------
vi.mock('pg', () => {
  const mockPool = vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn().mockResolvedValue({ query: vi.fn(), release: vi.fn() }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { default: { Pool: mockPool }, Pool: mockPool };
});

// ---------------------------------------------------------------------------
// Mock db client
// ---------------------------------------------------------------------------

const mockInsertValues = vi.fn().mockResolvedValue(undefined);
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

const mockUpdateSetWhere = vi.fn().mockResolvedValue(undefined);
const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateSetWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

const mockSelectFromWhereLimit = vi.fn();
const mockSelectFromWhere = vi.fn().mockReturnValue({ limit: mockSelectFromWhereLimit });
const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectFromWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

vi.mock('../../../db/client.js', () => ({
  db: {
    insert: mockInsert,
    update: mockUpdate,
    select: mockSelect,
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDlqRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dlq-uuid-0001',
    originalEventId: 'event-uuid-0001',
    organizationId: 'org-uuid-0001',
    eventName: 'leads.created',
    eventVersion: 1,
    aggregateType: 'lead',
    aggregateId: 'lead-uuid-0001',
    payload: { event_id: 'event-uuid-0001', data: { lead_id: 'lead-uuid-0001' } },
    correlationId: null,
    totalAttempts: 5,
    lastError: 'Service Unavailable',
    reprocessed: false,
    reprocessEventId: null,
    movedAt: new Date(),
    reprocessedAt: null,
    ...overrides,
  };
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-uuid-0001',
    organizationId: 'org-uuid-0001',
    eventName: 'leads.created',
    eventVersion: 1,
    aggregateType: 'lead',
    aggregateId: 'lead-uuid-0001',
    payload: { data: { lead_id: 'lead-uuid-0001' } },
    correlationId: null,
    idempotencyKey: 'leads.created:lead-uuid-0001',
    attempts: 4,
    lastError: 'Service Unavailable',
    processedAt: null,
    failedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('moveToDlq', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockReturnValue({ values: mockInsertValues });
    mockInsertValues.mockResolvedValue(undefined);
    mockUpdate.mockReturnValue({ set: mockUpdateSet });
    mockUpdateSet.mockReturnValue({ where: mockUpdateSetWhere });
    mockUpdateSetWhere.mockResolvedValue(undefined);
  });

  it('inserts row into event_dlq and updates event_outbox failed_at', async () => {
    const { moveToDlq } = await import('../dlq.js');

    const event = makeEvent();
    const dlqId = await moveToDlq({ event, lastError: 'Service Unavailable' });

    expect(typeof dlqId).toBe('string');
    expect(dlqId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    // Deve ter chamado insert (para DLQ) e update (para outbox)
    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockInsertValues).toHaveBeenCalledOnce();
    const insertedValues = mockInsertValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertedValues.originalEventId).toBe(event.id);
    expect(insertedValues.lastError).toBe('Service Unavailable');
    expect(insertedValues.totalAttempts).toBe(5); // attempts + 1

    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockUpdateSet).toHaveBeenCalledOnce();
    const updatedFields = mockUpdateSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(updatedFields).toHaveProperty('failedAt');
    expect(updatedFields.attempts).toBe(5);
    expect(updatedFields.lastError).toBe('Service Unavailable');
  });
});

describe('replayFromDlq', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockReturnValue({ values: mockInsertValues });
    mockInsertValues.mockResolvedValue(undefined);
    mockUpdate.mockReturnValue({ set: mockUpdateSet });
    mockUpdateSet.mockReturnValue({ where: mockUpdateSetWhere });
    mockUpdateSetWhere.mockResolvedValue(undefined);
  });

  it('creates new event_outbox entry and marks DLQ as reprocessed', async () => {
    const dlqRow = makeDlqRow();
    mockSelect.mockReturnValue({ from: mockSelectFrom });
    mockSelectFrom.mockReturnValue({ where: mockSelectFromWhere });
    mockSelectFromWhere.mockReturnValue({ limit: mockSelectFromWhereLimit });
    mockSelectFromWhereLimit.mockResolvedValue([dlqRow]);

    const { replayFromDlq } = await import('../dlq.js');

    const result = await replayFromDlq({
      dlqId: 'dlq-uuid-0001',
      actorUserId: 'admin-user-uuid-0001',
    });

    expect(result.newEventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    // insert chamado para novo evento em event_outbox
    expect(mockInsert).toHaveBeenCalledOnce();
    const insertedValues = mockInsertValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertedValues.attempts).toBe(0);
    expect(insertedValues.eventName).toBe('leads.created');
    expect(String(insertedValues.idempotencyKey)).toContain('dlq-replay:dlq-uuid-0001');

    // update chamado para marcar DLQ como reprocessada
    expect(mockUpdate).toHaveBeenCalledOnce();
    const updatedFields = mockUpdateSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(updatedFields.reprocessed).toBe(true);
    expect(updatedFields.reprocessEventId).toBe(result.newEventId);
  });

  it('throws Error when DLQ entry not found', async () => {
    mockSelect.mockReturnValue({ from: mockSelectFrom });
    mockSelectFrom.mockReturnValue({ where: mockSelectFromWhere });
    mockSelectFromWhere.mockReturnValue({ limit: mockSelectFromWhereLimit });
    mockSelectFromWhereLimit.mockResolvedValue([]); // não encontrado

    const { replayFromDlq } = await import('../dlq.js');

    await expect(
      replayFromDlq({ dlqId: 'non-existent-uuid', actorUserId: 'admin-uuid' }),
    ).rejects.toThrow(/DLQ entry not found/);
  });

  it('throws Error when DLQ entry already reprocessed', async () => {
    const dlqRow = makeDlqRow({
      reprocessed: true,
      reprocessEventId: 'prev-event-uuid',
      reprocessedAt: new Date(),
    });
    mockSelect.mockReturnValue({ from: mockSelectFrom });
    mockSelectFrom.mockReturnValue({ where: mockSelectFromWhere });
    mockSelectFromWhere.mockReturnValue({ limit: mockSelectFromWhereLimit });
    mockSelectFromWhereLimit.mockResolvedValue([dlqRow]);

    const { replayFromDlq } = await import('../dlq.js');

    await expect(
      replayFromDlq({ dlqId: 'dlq-uuid-0001', actorUserId: 'admin-uuid' }),
    ).rejects.toThrow(/already reprocessed/);
  });
});
