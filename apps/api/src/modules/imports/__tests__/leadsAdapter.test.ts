// =============================================================================
// leadsAdapter.test.ts — Testes unitários do adapter de leads (F1-S17).
//
// Estratégia: mock de db/client para isolamento total.
//
// Cenários (>= 10 testes):
//   1.  parseRow → retorna LeadsParsed com name e phone obrigatórios
//   2.  parseRow → retorna error quando name ausente
//   3.  parseRow → retorna error quando phone ausente
//   4.  parseRow → suporta aliases de colunas (nome, telefone, etc.)
//   5.  parseRow → default source='import' quando não informado
//   6.  parseRow → preserva source válido quando informado
//   7.  validateRow → retorna input quando phone e cidade são válidos
//   8.  validateRow → retorna errors quando phone inválido
//   9.  validateRow → retorna errors quando email inválido
//   10. validateRow → retorna errors quando cidade não encontrada
//   11. validateRow → retorna errors quando phone já existe na org (dedupe)
//   12. isParseError → retorna true para { error: string }
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
// DB mock state — controlado por teste
// ---------------------------------------------------------------------------
interface DbMockState {
  cityResult: Array<{ id: string }>;
  phoneResult: Array<{ id: string }>;
}

const dbState: DbMockState = {
  cityResult: [],
  phoneResult: [],
};

// call counter para distinguir queries de city vs phone
let selectCallCount = 0;

vi.mock('../../../db/client.js', () => ({
  db: {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(() => {
            const n = selectCallCount++;
            // primeira call: city lookup; segunda: phone dedupe
            return Promise.resolve(n === 0 ? dbState.cityResult : dbState.phoneResult);
          }),
        }),
      }),
    })),
  },
  pool: { end: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mock leads service (persistRow)
// ---------------------------------------------------------------------------
const mockCreateLead = vi.fn().mockResolvedValue({ id: 'lead-persisted-id' });

vi.mock('../../../modules/leads/service.js', () => ({
  createLead: (...args: unknown[]) => mockCreateLead(...args),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = 'org-id-0000-0000-0000-000000000001';
const BATCH_ID = 'batch-00-0000-0000-0000-000000000001';
const CITY_ID = 'city-00-0000-0000-0000-000000000001';

const VALID_CTX = {
  organizationId: ORG_ID,
  userId: 'user-id',
  batchId: BATCH_ID,
  rowIndex: 0,
  ip: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('leadsAdapter', () => {
  beforeEach(() => {
    selectCallCount = 0;
    dbState.cityResult = [{ id: CITY_ID }];
    dbState.phoneResult = [];
    mockCreateLead.mockClear();
  });

  // ---- parseRow ----

  it('1. parseRow retorna LeadsParsed com name e phone obrigatórios', async () => {
    const { leadsAdapter } = await import('../../../services/imports/adapters/leadsAdapter.js');

    const result = leadsAdapter.parseRow({ name: 'Maria Silva', phone: '69912345678' });
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.name).toBe('Maria Silva');
      expect(result.phoneRaw).toBe('69912345678');
    }
  });

  it('2. parseRow retorna error quando name ausente', async () => {
    const { leadsAdapter } = await import('../../../services/imports/adapters/leadsAdapter.js');

    const result = leadsAdapter.parseRow({ phone: '69912345678' });
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('nome');
    }
  });

  it('3. parseRow retorna error quando phone ausente', async () => {
    const { leadsAdapter } = await import('../../../services/imports/adapters/leadsAdapter.js');

    const result = leadsAdapter.parseRow({ name: 'Maria Silva' });
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('telefone');
    }
  });

  it('4. parseRow suporta aliases de colunas (nome, telefone)', async () => {
    const { leadsAdapter } = await import('../../../services/imports/adapters/leadsAdapter.js');

    const result = leadsAdapter.parseRow({
      nome: 'João Santos',
      telefone: '(69) 9 9123-4567',
      cidade: 'Porto Velho',
    });
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.name).toBe('João Santos');
      expect(result.phoneRaw).toBe('(69) 9 9123-4567');
      expect(result.cityName).toBe('Porto Velho');
    }
  });

  it('5. parseRow usa default source=import quando não informado', async () => {
    const { leadsAdapter } = await import('../../../services/imports/adapters/leadsAdapter.js');

    const result = leadsAdapter.parseRow({ name: 'Ana', phone: '69912345678' });
    if (!('error' in result)) {
      expect(result.source).toBe('import');
    }
  });

  it('6. parseRow preserva source válido quando informado', async () => {
    const { leadsAdapter } = await import('../../../services/imports/adapters/leadsAdapter.js');

    const result = leadsAdapter.parseRow({ name: 'Ana', phone: '69912345678', source: 'whatsapp' });
    if (!('error' in result)) {
      expect(result.source).toBe('whatsapp');
    }
  });

  // ---- validateRow ----

  it('7. validateRow retorna input quando phone e cidade são válidos', async () => {
    const { leadsAdapter } = await import('../../../services/imports/adapters/leadsAdapter.js');

    const parsed = {
      name: 'Maria Silva',
      phoneRaw: '+5569912345678',
      email: null,
      cityName: 'Porto Velho',
      source: 'import',
      cpf: null,
      notes: null,
    };

    const result = await leadsAdapter.validateRow(parsed, VALID_CTX);

    expect('input' in result).toBe(true);
    if ('input' in result) {
      expect(result.input.phone_e164).toBe('+5569912345678');
      expect(result.input.city_id).toBe(CITY_ID);
      expect(result.input.source).toBe('import');
      expect(result.input.status).toBe('new');
    }
  });

  it('8. validateRow retorna errors quando phone inválido', async () => {
    const { leadsAdapter } = await import('../../../services/imports/adapters/leadsAdapter.js');

    // Reset: cidade sem resultados para não interferir (phone fail first)
    dbState.cityResult = [];

    const parsed = {
      name: 'Maria Silva',
      phoneRaw: 'invalid-phone-000',
      email: null,
      cityName: 'Porto Velho',
      source: 'import',
      cpf: null,
      notes: null,
    };

    const result = await leadsAdapter.validateRow(parsed, VALID_CTX);

    expect('errors' in result).toBe(true);
    if ('errors' in result) {
      expect(result.errors.some((e) => e.includes('Telefone inválido'))).toBe(true);
    }
  });

  it('9. validateRow retorna errors quando email inválido', async () => {
    const { leadsAdapter } = await import('../../../services/imports/adapters/leadsAdapter.js');

    const parsed = {
      name: 'Maria Silva',
      phoneRaw: '+5569912345678',
      email: 'not-an-email',
      cityName: 'Porto Velho',
      source: 'import',
      cpf: null,
      notes: null,
    };

    const result = await leadsAdapter.validateRow(parsed, VALID_CTX);

    expect('errors' in result).toBe(true);
    if ('errors' in result) {
      expect(result.errors.some((e) => e.includes('Email inválido'))).toBe(true);
    }
  });

  it('10. validateRow retorna errors quando cidade não encontrada', async () => {
    const { leadsAdapter } = await import('../../../services/imports/adapters/leadsAdapter.js');

    // City not found
    dbState.cityResult = [];

    const parsed = {
      name: 'Maria Silva',
      phoneRaw: '+5569912345678',
      email: null,
      cityName: 'CidadeInexistente',
      source: 'import',
      cpf: null,
      notes: null,
    };

    const result = await leadsAdapter.validateRow(parsed, VALID_CTX);

    expect('errors' in result).toBe(true);
    if ('errors' in result) {
      expect(result.errors.some((e) => e.includes('Cidade não encontrada'))).toBe(true);
    }
  });

  it('11. validateRow retorna errors quando phone já existe na org (dedupe)', async () => {
    const { leadsAdapter } = await import('../../../services/imports/adapters/leadsAdapter.js');

    // Phone exists in org
    dbState.phoneResult = [{ id: 'existing-lead' }];

    const parsed = {
      name: 'Maria Silva',
      phoneRaw: '+5569912345678',
      email: null,
      cityName: 'Porto Velho',
      source: 'import',
      cpf: null,
      notes: null,
    };

    const result = await leadsAdapter.validateRow(parsed, VALID_CTX);

    expect('errors' in result).toBe(true);
    if ('errors' in result) {
      expect(result.errors.some((e) => e.includes('Telefone já cadastrado'))).toBe(true);
    }
  });

  // ---- isParseError ----

  it('12. isParseError retorna true para { error: string } e false para dados válidos', async () => {
    const { isParseError } = await import('../../../services/imports/adapters/leadsAdapter.js');

    expect(isParseError({ error: 'Campo obrigatório ausente' })).toBe(true);
    expect(isParseError({ name: 'Maria', phoneRaw: '69912345678' })).toBe(false);
    expect(isParseError(null)).toBe(false);
    expect(isParseError(undefined)).toBe(false);
  });
});
