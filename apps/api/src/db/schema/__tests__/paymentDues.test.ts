// =============================================================================
// paymentDues.test.ts — Testes de schema: payment_dues campos de boleto (F5-S10).
//
// Estratégia: DB mockado via vi.mock — valida que as novas colunas de boleto
// (boleto_url, boleto_media_id, boleto_media_expires_at, boleto_digitable_line,
// pix_copia_cola, boleto_filename, boleto_attached_at) existem nos tipos e
// aceitam insert. Todas são nullable (parcela pode não ter boleto).
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock pg — evita conexão real ao Postgres
// ---------------------------------------------------------------------------
vi.mock('pg', () => {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const MockPool = vi.fn().mockImplementation(() => ({
    query: mockQuery,
    connect: vi.fn().mockResolvedValue({ query: mockQuery, release: vi.fn() }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  const MockClient = vi.fn().mockImplementation(() => ({
    query: mockQuery,
    connect: vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { default: { Pool: MockPool, Client: MockClient }, Pool: MockPool, Client: MockClient };
});

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
import { paymentDues, type NewPaymentDue, type PaymentDue } from '../paymentDues.js';

const ORG_ID = 'aabbccdd-0001-0000-0000-000000000001';
const CUSTOMER_ID = 'aabbccdd-0006-0000-0000-000000000001';

function makeNewDue(overrides: Partial<NewPaymentDue> = {}): NewPaymentDue {
  return {
    organizationId: ORG_ID,
    customerId: CUSTOMER_ID,
    contractReference: 'BP-2026-00123',
    installmentNumber: 3,
    dueDate: '2026-07-10',
    amount: '187.53',
    status: 'pending',
    origin: 'import',
    ...overrides,
  };
}

describe('payment_dues — campos de boleto (F5-S10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue({ values: mockInsertValues });
    mockInsertValues.mockResolvedValue([]);
  });

  it('parcela sem boleto: campos omitidos é aceito (todos nullable)', async () => {
    const due = makeNewDue();
    await mockDb.insert(paymentDues).values(due);
    expect(mockInsertValues).toHaveBeenCalledWith(due);
  });

  it('parcela com boleto por URL: aceita boleto_url + linha + pix', async () => {
    const due = makeNewDue({
      boletoUrl: 'https://boletos.bancodopovo.ro.gov.br/signed/abc',
      boletoDigitableLine: '34191.79001 01043.510047 91020.150008 9 99990000018700',
      pixCopiaCola: '00020126...6304ABCD',
      boletoFilename: 'boleto-BP-2026-00123-p3.pdf',
      boletoAttachedAt: new Date('2026-06-10T12:00:00Z'),
    });
    await mockDb.insert(paymentDues).values(due);
    expect(mockInsertValues).toHaveBeenCalledWith(due);
  });

  it('parcela com boleto por media id: aceita boleto_media_id + expiração', async () => {
    const due = makeNewDue({
      boletoMediaId: '1234567890',
      boletoMediaExpiresAt: new Date('2026-07-10T12:00:00Z'),
    });
    await mockDb.insert(paymentDues).values(due);
    expect(mockInsertValues).toHaveBeenCalledWith(due);
  });

  it('tipo PaymentDue expõe as novas colunas de boleto', () => {
    // Asserção de tipo — falha em compile-time se as colunas sumirem (cada
    // acesso é tipado; o array as usa para evitar "declared but never read").
    const row = {} as PaymentDue;
    const cols = {
      boletoUrl: row.boletoUrl,
      boletoMediaId: row.boletoMediaId,
      boletoMediaExpiresAt: row.boletoMediaExpiresAt,
      boletoDigitableLine: row.boletoDigitableLine,
      pixCopiaCola: row.pixCopiaCola,
      boletoFilename: row.boletoFilename,
      boletoAttachedAt: row.boletoAttachedAt,
    } satisfies Record<string, string | Date | null>;
    expect(Object.keys(cols)).toHaveLength(7);
  });
});
