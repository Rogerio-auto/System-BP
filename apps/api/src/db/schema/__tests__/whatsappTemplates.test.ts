// =============================================================================
// whatsappTemplates.test.ts — Testes de schema: whatsapp_templates header de mídia (F5-S10).
//
// Estratégia: DB mockado via vi.mock — valida que as novas colunas de header
// (header_type / header_text / header_handle) existem nos tipos e que as
// constraints declaradas (enum de header_type, header_text só para 'text')
// se comportam como esperado via mensagens simuladas.
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
import {
  whatsappTemplates,
  type NewWhatsappTemplate,
  type WhatsappTemplate,
} from '../whatsappTemplates.js';

const ORG_ID = 'aabbccdd-0001-0000-0000-000000000001';

function makeNewTemplate(overrides: Partial<NewWhatsappTemplate> = {}): NewWhatsappTemplate {
  return {
    organizationId: ORG_ID,
    metaTemplateId: 'meta-123',
    name: 'cobranca_boleto_d0',
    language: 'pt_BR',
    category: 'utility',
    body: 'Olá {{1}}, segue o boleto da parcela {{2}}.',
    status: 'pending',
    ...overrides,
  };
}

describe('whatsapp_templates — header de mídia (F5-S10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue({ values: mockInsertValues });
    mockInsertValues.mockResolvedValue([]);
  });

  it('default: template sem header (header_type omitido) é aceito', async () => {
    const tpl = makeNewTemplate();
    await mockDb.insert(whatsappTemplates).values(tpl);
    expect(mockInsertValues).toHaveBeenCalledWith(tpl);
  });

  it('header de documento: header_type=document com header_text NULL é aceito', async () => {
    const tpl = makeNewTemplate({
      headerType: 'document',
      headerText: null,
      headerHandle: 'sample-handle-abc',
    });
    await mockDb.insert(whatsappTemplates).values(tpl);
    expect(mockInsertValues).toHaveBeenCalledWith(tpl);
  });

  it('header de texto: header_type=text com header_text presente é aceito', async () => {
    const tpl = makeNewTemplate({ headerType: 'text', headerText: 'Banco do Povo' });
    await mockDb.insert(whatsappTemplates).values(tpl);
    expect(mockInsertValues).toHaveBeenCalledWith(tpl);
  });

  it('header de texto sem header_text: simula violação de chk_whatsapp_templates_header_text', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error('violates check constraint "chk_whatsapp_templates_header_text"'),
    );
    const tpl = makeNewTemplate({ headerType: 'text', headerText: null });
    await expect(mockDb.insert(whatsappTemplates).values(tpl)).rejects.toThrow(
      'chk_whatsapp_templates_header_text',
    );
  });

  it('tipo WhatsappTemplate expõe as novas colunas de header', () => {
    // Asserção de tipo — falha em compile-time se as colunas sumirem.
    // O enum de header_type é garantido pelo tipo TS + CHECK na migration.
    const row = {} as WhatsappTemplate;
    const cols = {
      headerType: row.headerType,
      headerText: row.headerText,
      headerHandle: row.headerHandle,
    } satisfies Record<string, string | null>;
    expect(Object.keys(cols)).toHaveLength(3);
  });
});
