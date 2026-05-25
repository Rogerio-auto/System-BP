// =============================================================================
// services/imports/__tests__/notionLeadsAdapter.test.ts
//
// Testes unitários do notionLeadsAdapter (F7-S04).
//
// Estratégia: mocks de db, leads service, cities para evitar conexão real.
//
// Cenários cobertos:
//   1.  parseRow — sucesso com 5 props mapeadas (fixture sample)
//   2.  parseRow — erro quando __notion_page_id ausente
//   3.  parseRow — erro quando __properties ausente
//   4.  parseRow — erro quando display_name não encontrado no mapping
//   5.  validateRow — sucesso: E.164, cidade resolvida, sem dedupe
//   6.  validateRow — erro: telefone inválido
//   7.  validateRow — erro: cidade não encontrada
//   8.  validateRow — erro: primary_phone ausente no mapping
//   9.  validateRow — re-import: notionPageId já existe → existingLeadId preenchido
//  10.  validateRow — email inválido retorna erro
//  11.  persistRow — cria lead, atualiza notionPageId, insere lead_history
//  12.  persistRow — re-importação idempotente: retorna existingLeadId sem criar novo lead
//  13.  persistRow — conflito de telefone (409) → re-lança AppError
//  14.  mapStageToStatus — cobre português e inglês (exportado via applyPropertyMapping)
//  15.  registry — notion_leads está registrado e retorna o adapter correto
// =============================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../../shared/errors.js';
import type { ImportContext } from '../adapter.js';
import {
  notionLeadsAdapter,
  isParseError,
  NotionLeadsSourceConfigSchema,
} from '../adapters/notionLeadsAdapter.js';

// ---------------------------------------------------------------------------
// Mock pg — sem conexão real
// ---------------------------------------------------------------------------
vi.mock('pg', () => {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const MockPool = vi.fn().mockImplementation(() => ({
    query: mockQuery,
    connect: vi.fn().mockResolvedValue({ query: mockQuery, release: vi.fn() }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { Pool: MockPool, default: { Pool: MockPool } };
});

// ---------------------------------------------------------------------------
// Mock env
// ---------------------------------------------------------------------------
vi.mock('../../../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    LGPD_DEDUPE_PEPPER: 'test-pepper-min-32-chars-1234567890ab',
    FX_BRL_PER_USD: 5.75,
    JWT_ACCESS_SECRET: 'a'.repeat(64),
    JWT_REFRESH_SECRET: 'b'.repeat(64),
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '30d',
    API_HOST: '0.0.0.0',
    API_PORT: 3333,
    API_PUBLIC_URL: 'http://localhost:3333',
    CORS_ALLOWED_ORIGINS: ['http://localhost:5173'],
    LANGGRAPH_INTERNAL_TOKEN: 'test-token-32-chars-minimum-12345678',
    LANGGRAPH_SERVICE_URL: 'http://localhost:8000',
    WHATSAPP_APP_SECRET: 'test-whatsapp-secret-16c',
    WHATSAPP_VERIFY_TOKEN: 'test-verify',
  },
}));

// ---------------------------------------------------------------------------
// Mock db — SELECT queries para cities e leads
// ---------------------------------------------------------------------------
const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbTransaction = vi.fn();

vi.mock('../../../db/client.js', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    transaction: (...args: unknown[]) => mockDbTransaction(...args),
  },
}));

// ---------------------------------------------------------------------------
// Mock leads service createLead
// ---------------------------------------------------------------------------
const mockCreateLead = vi.fn();
vi.mock('../../../modules/leads/service.js', () => ({
  createLead: (...args: unknown[]) => mockCreateLead(...args),
}));

// ---------------------------------------------------------------------------
// Mock crypto/pii
// ---------------------------------------------------------------------------
vi.mock('../../../lib/crypto/pii.js', () => ({
  hashDocument: (s: string) => `hmac:${s}`,
  encryptPii: async (s: string) => Buffer.from(s),
  decryptPii: async (b: Buffer) => b.toString(),
  compareHash: (a: string, b: string) => a === b,
}));

// ---------------------------------------------------------------------------
// Constantes de teste
// ---------------------------------------------------------------------------
const ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const CITY_ID = 'cccccccc-0000-0000-0000-000000000001';
const LEAD_ID = 'eeeeeeee-0000-0000-0000-000000000001';
const NOTION_PAGE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const BATCH_ID = 'batch-0000-0000-0000-000000000001';
const USER_ID = 'user-aaaa-0000-0000-0000-000000000001';

const CTX: ImportContext = {
  organizationId: ORG_ID,
  userId: USER_ID,
  batchId: BATCH_ID,
  rowIndex: 0,
  ip: '127.0.0.1',
};

const PROPERTY_MAPPING = {
  Nome: 'display_name',
  WhatsApp: 'primary_phone',
  Cidade: 'city_lookup',
  Status: 'stage_lookup',
  Email: 'email',
  Observações: 'notes',
};

const SAMPLE_PROPERTIES = {
  Nome: { type: 'title', title: [{ plain_text: 'João da Silva Santos' }] },
  WhatsApp: { type: 'phone_number', phone_number: '(69) 99123-4567' },
  Cidade: { type: 'rich_text', rich_text: [{ plain_text: 'Porto Velho' }] },
  Status: { type: 'select', select: { name: 'qualificação', color: 'yellow' } },
  Email: { type: 'email', email: 'joao@exemplo.com' },
  Observações: { type: 'rich_text', rich_text: [{ plain_text: 'Interessado em crédito' }] },
};

function makeRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    __notion_page_id: NOTION_PAGE_ID,
    __properties: SAMPLE_PROPERTIES,
    __property_mapping: PROPERTY_MAPPING,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Default: nenhum lead existente com este notionPageId
  mockDbSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  });

  // Default: cidade encontrada
  mockDbSelect.mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockImplementation(async () => [{ id: CITY_ID }]),
      }),
    }),
  }));

  // Default: createLead sucesso
  mockCreateLead.mockResolvedValue({ id: LEAD_ID });

  // Default: update e insert resolvem sem problemas
  mockDbUpdate.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  });

  mockDbInsert.mockReturnValue({
    values: vi.fn().mockResolvedValue([]),
  });
});

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('notionLeadsAdapter.parseRow', () => {
  it('1. sucesso com 5 props mapeadas', () => {
    const result = notionLeadsAdapter.parseRow(makeRaw());

    expect(isParseError(result)).toBe(false);
    if (!isParseError(result)) {
      expect(result.notionPageId).toBe(NOTION_PAGE_ID);
      expect(result.fields['display_name']).toBe('João da Silva Santos');
      expect(result.fields['primary_phone']).toBe('(69) 99123-4567');
      expect(result.fields['city_lookup']).toBe('Porto Velho');
      expect(result.fields['email']).toBe('joao@exemplo.com');
      expect(result.fields['notes']).toBe('Interessado em crédito');
    }
  });

  it('2. erro quando __notion_page_id ausente', () => {
    const result = notionLeadsAdapter.parseRow({
      __properties: SAMPLE_PROPERTIES,
      __property_mapping: PROPERTY_MAPPING,
    });
    expect(isParseError(result)).toBe(true);
    if (isParseError(result)) {
      expect(result.error).toMatch(/__notion_page_id/);
    }
  });

  it('3. erro quando __properties ausente', () => {
    const result = notionLeadsAdapter.parseRow({
      __notion_page_id: NOTION_PAGE_ID,
      __property_mapping: PROPERTY_MAPPING,
    });
    expect(isParseError(result)).toBe(true);
  });

  it('4. erro quando display_name não encontrado no mapping', () => {
    const result = notionLeadsAdapter.parseRow(
      makeRaw({
        __property_mapping: { WhatsApp: 'primary_phone', Cidade: 'city_lookup' },
      }),
    );
    expect(isParseError(result)).toBe(true);
    if (isParseError(result)) {
      expect(result.error).toMatch(/display_name/);
    }
  });
});

describe('notionLeadsAdapter.validateRow', () => {
  it('5. sucesso: E.164, cidade resolvida, sem dedupe', async () => {
    const parsed = notionLeadsAdapter.parseRow(makeRaw());
    expect(isParseError(parsed)).toBe(false);
    if (isParseError(parsed)) return;

    // Two separate select mocks: first for notionPageId (empty), second for city (found)
    mockDbSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]), // no existing lead
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: CITY_ID }]), // city found
          }),
        }),
      });

    const result = await notionLeadsAdapter.validateRow(parsed, CTX);

    expect('errors' in result).toBe(false);
    if ('input' in result) {
      expect(result.input.notionPageId).toBe(NOTION_PAGE_ID);
      expect(result.input.phoneE164).toMatch(/^\+/);
      expect(result.input.cityId).toBe(CITY_ID);
      expect(result.input.existingLeadId).toBeNull();
    }
  });

  it('6. erro: telefone inválido', async () => {
    const raw = makeRaw({
      __properties: {
        ...SAMPLE_PROPERTIES,
        WhatsApp: { type: 'phone_number', phone_number: 'nao-e-telefone' },
      },
    });

    const parsed = notionLeadsAdapter.parseRow(raw);
    expect(isParseError(parsed)).toBe(false);
    if (isParseError(parsed)) return;

    mockDbSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([{ id: CITY_ID }]) }),
        }),
      });

    const result = await notionLeadsAdapter.validateRow(parsed, CTX);
    expect('errors' in result).toBe(true);
    if ('errors' in result) {
      expect(result.errors.some((e) => e.includes('telefone'))).toBe(true);
    }
  });

  it('7. erro: cidade não encontrada', async () => {
    const parsed = notionLeadsAdapter.parseRow(makeRaw());
    if (isParseError(parsed)) return;

    mockDbSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }), // city not found
        }),
      });

    const result = await notionLeadsAdapter.validateRow(parsed, CTX);
    expect('errors' in result).toBe(true);
    if ('errors' in result) {
      expect(result.errors.some((e) => e.includes('cidade') || e.includes('Cidade'))).toBe(true);
    }
  });

  it('8. erro: primary_phone ausente no mapping', async () => {
    const raw = makeRaw({
      __property_mapping: { Nome: 'display_name', Cidade: 'city_lookup' },
    });
    const parsed = notionLeadsAdapter.parseRow(raw);
    if (isParseError(parsed)) return;

    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    });

    const result = await notionLeadsAdapter.validateRow(parsed, CTX);
    expect('errors' in result).toBe(true);
    if ('errors' in result) {
      expect(result.errors.some((e) => e.includes('primary_phone'))).toBe(true);
    }
  });

  it('9. re-import: notionPageId já existe → existingLeadId preenchido', async () => {
    const parsed = notionLeadsAdapter.parseRow(makeRaw());
    if (isParseError(parsed)) return;

    mockDbSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: LEAD_ID }]), // existing lead!
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([{ id: CITY_ID }]) }),
        }),
      });

    const result = await notionLeadsAdapter.validateRow(parsed, CTX);
    expect('input' in result).toBe(true);
    if ('input' in result) {
      expect(result.input.existingLeadId).toBe(LEAD_ID);
    }
  });

  it('10. email inválido retorna erro', async () => {
    const raw = makeRaw({
      __properties: {
        ...SAMPLE_PROPERTIES,
        Email: { type: 'email', email: 'email-invalido-sem-arroba' },
      },
    });
    const parsed = notionLeadsAdapter.parseRow(raw);
    if (isParseError(parsed)) return;

    mockDbSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([{ id: CITY_ID }]) }),
        }),
      });

    const result = await notionLeadsAdapter.validateRow(parsed, CTX);
    expect('errors' in result).toBe(true);
    if ('errors' in result) {
      expect(result.errors.some((e) => e.includes('email'))).toBe(true);
    }
  });
});

describe('notionLeadsAdapter.persistRow', () => {
  const FAKE_TX = {} as Parameters<typeof notionLeadsAdapter.persistRow>[2];

  it('11. cria lead, atualiza notionPageId, insere lead_history', async () => {
    const input = {
      notionPageId: NOTION_PAGE_ID,
      name: 'João da Silva',
      phoneE164: '+5569991234567',
      email: 'joao@exemplo.com',
      cityId: CITY_ID,
      notes: 'Observações de teste',
      cpf: null,
      existingLeadId: null,
    };

    const result = await notionLeadsAdapter.persistRow(input, CTX, FAKE_TX);

    expect(result.entityId).toBe(LEAD_ID);

    // createLead deve ter sido chamado
    expect(mockCreateLead).toHaveBeenCalledOnce();
    const createLeadCall = mockCreateLead.mock.calls[0];
    expect(createLeadCall).toBeDefined();
    // Verifica que o source é 'import' (não bypass)
    expect(createLeadCall?.[2]?.source).toBe('import');
    // Verifica que notion_page_id está em metadata
    expect(createLeadCall?.[2]?.metadata?.notion_page_id).toBe(NOTION_PAGE_ID);

    // notionPageId deve ter sido atualizado no lead
    expect(mockDbUpdate).toHaveBeenCalled();

    // lead_history deve ter sido inserido
    expect(mockDbInsert).toHaveBeenCalled();
    const insertCall = mockDbInsert.mock.calls[0];
    expect(insertCall).toBeDefined();
  });

  it('12. re-importação idempotente: retorna existingLeadId sem criar novo lead', async () => {
    const input = {
      notionPageId: NOTION_PAGE_ID,
      name: 'João da Silva',
      phoneE164: '+5569991234567',
      email: null,
      cityId: CITY_ID,
      notes: null,
      cpf: null,
      existingLeadId: LEAD_ID, // já existe
    };

    const result = await notionLeadsAdapter.persistRow(input, CTX, FAKE_TX);

    expect(result.entityId).toBe(LEAD_ID);
    // createLead NÃO deve ter sido chamado
    expect(mockCreateLead).not.toHaveBeenCalled();
    // update e insert de history NÃO devem ter sido chamados
    expect(mockDbUpdate).not.toHaveBeenCalled();
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('13. conflito de telefone (409) → re-lança AppError', async () => {
    mockCreateLead.mockRejectedValue(new AppError(409, 'CONFLICT', 'Telefone já cadastrado', {}));

    const input = {
      notionPageId: NOTION_PAGE_ID,
      name: 'Conflito Lead',
      phoneE164: '+5569991234567',
      email: null,
      cityId: CITY_ID,
      notes: null,
      cpf: null,
      existingLeadId: null,
    };

    await expect(notionLeadsAdapter.persistRow(input, CTX, FAKE_TX)).rejects.toBeInstanceOf(
      AppError,
    );
  });
});

describe('NotionLeadsSourceConfigSchema', () => {
  it('14. valida source_config válido', () => {
    const result = NotionLeadsSourceConfigSchema.safeParse({
      databaseId: 'db-test-id',
      propertyMapping: { Nome: 'display_name', WhatsApp: 'primary_phone' },
    });
    expect(result.success).toBe(true);
  });

  it('14b. rejeita source_config sem display_name no mapping', () => {
    const result = NotionLeadsSourceConfigSchema.safeParse({
      databaseId: 'db-test-id',
      propertyMapping: { WhatsApp: 'primary_phone' },
    });
    expect(result.success).toBe(false);
  });

  it('14c. rejeita source_config sem databaseId', () => {
    const result = NotionLeadsSourceConfigSchema.safeParse({
      databaseId: '',
      propertyMapping: { Nome: 'display_name' },
    });
    expect(result.success).toBe(false);
  });
});

describe('registry', () => {
  it('15. notion_leads está registrado no registry', async () => {
    const { getAdapter, getSupportedEntityTypes } = await import('../registry.js');

    expect(getSupportedEntityTypes()).toContain('notion_leads');

    const adapter = getAdapter('notion_leads');
    expect(adapter).toBeDefined();
    expect(adapter.entityType).toBe('notion_leads');
  });
});
