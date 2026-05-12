// =============================================================================
// importProcessor.test.ts — Testes do worker import-processor (F1-S17).
//
// Estratégia: mock de db/client + services para testar processUploaded e
// processConfirmed sem conexão real ao banco.
//
// Cenários (>= 5 testes):
//   1. processUploaded → skips quando batch.status !== 'uploaded' (idempotência)
//   2. processUploaded → marca batch 'failed' se parseFile lança erro
//   3. processUploaded → processa corretamente e emite preview_ready
//   4. processConfirmed → skips quando batch.status !== 'confirmed' (idempotência)
//   5. processConfirmed → processa linhas válidas e emite import.completed
// =============================================================================
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock env
// ---------------------------------------------------------------------------
vi.mock('../../../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
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
    WHATSAPP_APP_SECRET: 'test-secret-at-least-16-chars',
    WHATSAPP_VERIFY_TOKEN: 'test-verify-token',
  },
}));

// ---------------------------------------------------------------------------
// Mock pg
// ---------------------------------------------------------------------------
vi.mock('pg', () => {
  const MockPool = vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { Pool: MockPool, default: { Pool: MockPool } };
});

// ---------------------------------------------------------------------------
// Mock drizzle-orm
// ---------------------------------------------------------------------------
vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
  or: vi.fn().mockReturnValue({}),
  lt: vi.fn().mockReturnValue({}),
  isNull: vi.fn().mockReturnValue({}),
  inArray: vi.fn().mockReturnValue({}),
  isNotNull: vi.fn().mockReturnValue({}),
  relations: vi.fn().mockReturnValue({}),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray) => ({ __sql: strings[0] })),
    { mapWith: vi.fn() },
  ),
}));

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn().mockReturnValue({}),
}));

// ---------------------------------------------------------------------------
// Mock db/client
// ---------------------------------------------------------------------------
const capturedBatchUpdates: Array<{ status?: string; values?: Record<string, unknown> }> = [];
const capturedEmittedEvents: unknown[] = [];

const mockTx = {
  update: vi.fn().mockReturnValue({
    set: vi.fn().mockImplementation((values: Record<string, unknown>) => {
      capturedBatchUpdates.push({ values });
      return { where: vi.fn().mockResolvedValue([{ id: 'batch-01', ...values }]) };
    }),
  }),
  insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
};

vi.mock('../../../db/client.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockImplementation((values: Record<string, unknown>) => {
        capturedBatchUpdates.push({ values });
        return { where: vi.fn().mockResolvedValue([{ id: 'batch-01', ...values }]) };
      }),
    }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
    transaction: vi
      .fn()
      .mockImplementation(async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx)),
  },
  pool: { end: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mock repository
// ---------------------------------------------------------------------------
const mockFindBatchById = vi.fn();
const mockUpdateBatchStatus = vi.fn();
const mockUpdateBatchCounters = vi.fn();
const mockBulkInsertRows = vi.fn();
const mockFindValidRowsForBatch = vi.fn();
const mockUpdateRowStatus = vi.fn();
const mockIncrementProcessedRows = vi.fn();

vi.mock('../../../modules/imports/repository.js', () => ({
  findBatchById: (...args: unknown[]) => mockFindBatchById(...args),
  updateBatchStatus: (...args: unknown[]) => mockUpdateBatchStatus(...args),
  updateBatchCounters: (...args: unknown[]) => mockUpdateBatchCounters(...args),
  bulkInsertRows: (...args: unknown[]) => mockBulkInsertRows(...args),
  findValidRowsForBatch: (...args: unknown[]) => mockFindValidRowsForBatch(...args),
  updateRowStatus: (...args: unknown[]) => mockUpdateRowStatus(...args),
  incrementProcessedRows: (...args: unknown[]) => mockIncrementProcessedRows(...args),
}));

// ---------------------------------------------------------------------------
// Mock service (getImportFilePath, redactImportRowPii)
// ---------------------------------------------------------------------------
vi.mock('../../../modules/imports/service.js', () => ({
  getImportFilePath: (batchId: string) => `/tmp/imports/${batchId}.bin`,
  redactImportRowPii: (raw: Record<string, unknown>) => raw,
}));

// ---------------------------------------------------------------------------
// Mock fileParser
// ---------------------------------------------------------------------------
const mockParseFile = vi.fn();

vi.mock('../../../services/imports/fileParser.js', () => ({
  parseFile: (...args: unknown[]) => mockParseFile(...args),
}));

// ---------------------------------------------------------------------------
// Mock adapter registry
// ---------------------------------------------------------------------------
const mockParseRow = vi.fn();
const mockValidateRow = vi.fn();
const mockPersistRow = vi.fn();

vi.mock('../../../services/imports/registry.js', () => ({
  getAdapter: vi.fn().mockReturnValue({
    entityType: 'leads',
    parseRow: (...args: unknown[]) => mockParseRow(...args),
    validateRow: (...args: unknown[]) => mockValidateRow(...args),
    persistRow: (...args: unknown[]) => mockPersistRow(...args),
  }),
}));

// ---------------------------------------------------------------------------
// Mock adapter (isParseError)
// ---------------------------------------------------------------------------
vi.mock('../../../services/imports/adapter.js', () => ({
  isParseError: (result: unknown) =>
    typeof result === 'object' && result !== null && 'error' in result,
}));

// ---------------------------------------------------------------------------
// Mock emit
// ---------------------------------------------------------------------------
vi.mock('../../../events/emit.js', () => ({
  emit: vi.fn().mockImplementation((_tx: unknown, event: unknown) => {
    capturedEmittedEvents.push(event);
    return Promise.resolve('event-id');
  }),
}));

// ---------------------------------------------------------------------------
// Mock featureFlags
// ---------------------------------------------------------------------------
vi.mock('../../../lib/featureFlags.js', () => ({
  requireFlag: vi.fn().mockResolvedValue(true),
  featureGate: () => async () => {},
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = 'org-id-0000-0000-0000-000000000001';
const BATCH_ID = 'batch-00-0000-0000-0000-000000000001';

function makeBatch(status = 'uploaded') {
  return {
    id: BATCH_ID,
    organizationId: ORG_ID,
    createdByUserId: 'user-id',
    entityType: 'leads',
    fileName: 'leads.csv',
    fileSize: 1024,
    mimeType: 'text/csv',
    fileHash: 'abc123',
    status,
    totalRows: 0,
    validRows: 0,
    invalidRows: 0,
    processedRows: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    batchId: BATCH_ID,
    rowIndex: 0,
    status: 'valid',
    rawData: { name: 'Maria', phone: '69912345678' },
    normalizedData: { name: 'Maria', phone_e164: '+5569912345678', city_id: 'city-01' },
    validationErrors: null,
    entityId: null,
    createdAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('import-processor worker', () => {
  beforeEach(() => {
    capturedBatchUpdates.length = 0;
    capturedEmittedEvents.length = 0;
    vi.clearAllMocks();
    mockUpdateBatchStatus.mockResolvedValue(makeBatch());
    mockUpdateBatchCounters.mockResolvedValue(makeBatch());
    mockBulkInsertRows.mockResolvedValue(undefined);
    mockFindValidRowsForBatch.mockResolvedValue([]);
    mockUpdateRowStatus.mockResolvedValue(undefined);
    mockIncrementProcessedRows.mockResolvedValue(undefined);
  });

  // ---- 1. Idempotência processUploaded ----
  it('1. processUploaded skips quando batch já foi processado (status != uploaded)', async () => {
    // Batch already in preview_ready
    mockFindBatchById.mockResolvedValue(makeBatch('preview_ready'));

    const { processUploaded } = await import('../../../workers/import-processor.js');
    await processUploaded(BATCH_ID);

    // updateBatchStatus nunca chamado (skip)
    expect(mockUpdateBatchStatus).not.toHaveBeenCalled();
    expect(mockParseFile).not.toHaveBeenCalled();
  });

  // ---- 2. processUploaded marca failed se parseFile lança ----
  it('2. processUploaded marca batch como failed se parseFile lança erro', async () => {
    mockFindBatchById.mockResolvedValue(makeBatch('uploaded'));
    // First call: set to 'parsing'
    mockUpdateBatchStatus.mockResolvedValueOnce(makeBatch('parsing'));
    mockParseFile.mockRejectedValue(new Error('Arquivo corrompido'));

    const { processUploaded } = await import('../../../workers/import-processor.js');
    await processUploaded(BATCH_ID);

    // Should have called updateBatchStatus twice: 'parsing' then 'failed'
    expect(mockUpdateBatchStatus).toHaveBeenCalledWith(expect.anything(), BATCH_ID, 'parsing');
    expect(mockUpdateBatchStatus).toHaveBeenCalledWith(expect.anything(), BATCH_ID, 'failed');
  });

  // ---- 3. processUploaded sucesso → preview_ready ----
  it('3. processUploaded processa corretamente e atualiza para preview_ready', async () => {
    mockFindBatchById.mockResolvedValue(makeBatch('uploaded'));
    mockUpdateBatchStatus.mockResolvedValue(makeBatch('parsing'));
    mockParseFile.mockResolvedValue({
      rows: [
        { name: 'Maria Silva', phone: '69912345678' },
        { name: 'João Santos', phone: 'invalid-phone' },
      ],
      totalRows: 2,
    });

    // Row 1: valid parse + valid validate
    mockParseRow
      .mockReturnValueOnce({ name: 'Maria Silva', phoneRaw: '69912345678' })
      .mockReturnValueOnce({ name: 'João Santos', phoneRaw: 'invalid-phone' });

    mockValidateRow
      .mockResolvedValueOnce({
        input: { name: 'Maria Silva', phone_e164: '+5569912345678', city_id: 'city-01' },
      })
      .mockResolvedValueOnce({ errors: ['Telefone inválido'] });

    const { processUploaded } = await import('../../../workers/import-processor.js');
    await processUploaded(BATCH_ID);

    // bulkInsertRows called with 2 rows
    expect(mockBulkInsertRows).toHaveBeenCalledTimes(1);
    const insertedRows = mockBulkInsertRows.mock.calls[0]?.[1] as Array<{ status: string }>;
    expect(insertedRows).toHaveLength(2);
    expect(insertedRows.filter((r) => r.status === 'valid')).toHaveLength(1);
    expect(insertedRows.filter((r) => r.status === 'invalid')).toHaveLength(1);

    // updateBatchCounters called with preview_ready
    expect(mockUpdateBatchCounters).toHaveBeenCalledWith(
      expect.anything(),
      BATCH_ID,
      expect.objectContaining({ status: 'preview_ready', totalRows: 2 }),
    );
  });

  // ---- 4. Idempotência processConfirmed ----
  it('4. processConfirmed skips quando batch.status != confirmed', async () => {
    mockFindBatchById.mockResolvedValue(makeBatch('processing'));

    const { processConfirmed } = await import('../../../workers/import-processor.js');
    await processConfirmed(BATCH_ID);

    expect(mockUpdateBatchStatus).not.toHaveBeenCalled();
    expect(mockFindValidRowsForBatch).not.toHaveBeenCalled();
  });

  // ---- 5. processConfirmed processa linhas e emite evento ----
  it('5. processConfirmed processa linhas válidas e emite import.completed', async () => {
    mockFindBatchById.mockResolvedValue(makeBatch('confirmed'));
    mockUpdateBatchStatus.mockResolvedValue(makeBatch('processing'));

    const validRows = [makeRow('row-01'), makeRow('row-02', { rowIndex: 1 })];
    mockFindValidRowsForBatch.mockResolvedValue(validRows);
    mockPersistRow.mockResolvedValue({ entityId: 'lead-created-id' });

    const { processConfirmed } = await import('../../../workers/import-processor.js');
    await processConfirmed(BATCH_ID);

    expect(mockPersistRow).toHaveBeenCalledTimes(2);
    expect(mockUpdateRowStatus).toHaveBeenCalledTimes(2);

    // Event emitted via outbox
    const emitFn = (await import('../../../events/emit.js')).emit;
    expect(emitFn).toHaveBeenCalled();
    const emittedEvent = capturedEmittedEvents[0] as {
      eventName: string;
      data: { success_count: number };
    };
    expect(emittedEvent.eventName).toBe('import.completed');
    expect(emittedEvent.data.success_count).toBe(2);
  });
});
