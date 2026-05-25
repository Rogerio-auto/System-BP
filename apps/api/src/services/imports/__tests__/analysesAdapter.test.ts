// =============================================================================
// services/imports/__tests__/analysesAdapter.test.ts
//
// Testes unitários do analysesAdapter (F4-S06).
//
// Estratégia: mocks de db, credit-analyses service e audit para evitar conexão real.
//
// Cenários cobertos:
//   A1.  parseRow — sucesso: lead_id + status + parecer
//   A2.  parseRow — sucesso: aliases alternativos (id_lead, situacao, observacao)
//   A3.  parseRow — erro: lead_ref ausente
//   A4.  parseRow — erro: status ausente
//   B1.  validateRow — sucesso: em_analise com lead por UUID
//   B2.  validateRow — sucesso: lead resolvido por phone_normalized
//   B3.  validateRow — sucesso: status 'aprovado' com campos financeiros
//   B4.  validateRow — erro: status inválido
//   B5.  validateRow — erro: lead não encontrado
//   B6.  validateRow — erro: parecer contém CPF bruto (LGPD)
//   B7.  validateRow — erro: parecer contém RG bruto (LGPD)
//   B8.  validateRow — erro: análise duplicada para o lead
//   B9.  validateRow — erro: aprovado sem campos financeiros
//   B10. validateRow — erro: valor_aprovado inválido
//   B11. validateRow — erro: taxa_mensal inválida
//   B12. validateRow — erro: data_decisao inválida
//   B13. validateRow — analista não encontrado: campo null (sem bloquear)
//   C1.  persistRow — cria análise em_analise via service
//   C2.  persistRow — cria análise aprovado: createAnalysis + addVersion
//   C3.  persistRow — conflito 409 → re-lança AppError
//   D1.  parseBRCurrency — cobre formatos BR e EN
//   D2.  parsePercentToDecimal — cobre formatos com e sem %
//   D3.  parseAnalysisDate — cobre ISO e dd/mm/yyyy
//   D4.  normalizeAnalysisStatus — cobre aliases PT/EN, com e sem acento
//   E1.  registry — 'analyses' está registrado e retorna o adapter correto
// =============================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../../shared/errors.js';
import type { ImportContext } from '../adapter.js';
import {
  analysesAdapter,
  isParseError,
  parseBRCurrency,
  parsePercentToDecimal,
  parseAnalysisDate,
  normalizeAnalysisStatus,
} from '../adapters/analysesAdapter.js';

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
// Mock db — SELECT queries para leads, users, creditAnalyses
// ---------------------------------------------------------------------------
const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();

vi.mock('../../../db/client.js', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
    transaction: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock credit-analyses service
// ---------------------------------------------------------------------------
const mockCreateAnalysis = vi.fn();
const mockAddVersion = vi.fn();

vi.mock('../../../modules/credit-analyses/service.js', () => ({
  createAnalysis: (...args: unknown[]) => mockCreateAnalysis(...args),
  addVersion: (...args: unknown[]) => mockAddVersion(...args),
}));

// ---------------------------------------------------------------------------
// Mock audit lib
// ---------------------------------------------------------------------------
const mockAuditLog = vi.fn();

vi.mock('../../../lib/audit.js', () => ({
  auditLog: (...args: unknown[]) => mockAuditLog(...args),
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
const LEAD_ID = 'eeeeeeee-0000-0000-0000-000000000001';
const LEAD_ID_2 = 'eeeeeeee-0000-0000-0000-000000000002';
const ANALYSIS_ID = 'cccccccc-0000-0000-0000-000000000001';
const USER_ID = 'dddddddd-0000-0000-0000-000000000001';
const ANALYST_ID = 'ffffffff-0000-0000-0000-000000000001';
const BATCH_ID = 'bbbbbbbb-0000-0000-0000-000000000001';

const CTX: ImportContext = {
  organizationId: ORG_ID,
  userId: USER_ID,
  batchId: BATCH_ID,
  rowIndex: 0,
  ip: '127.0.0.1',
};

const FAKE_TX = {} as Parameters<typeof analysesAdapter.persistRow>[2];

// ---------------------------------------------------------------------------
// Setup de mocks: comportamento padrão (sucesso)
// ---------------------------------------------------------------------------

/**
 * Configura mockDbSelect para responder sequencialmente às queries do validateRow.
 *
 * Ordem de chamadas ao db.select() no validateRow:
 *   1ª → resolveLeadId (por UUID ou phone)
 *   2ª → findExistingActiveAnalysis (apenas se leadId encontrado)
 *   3ª → resolveAnalystId (apenas se analistaRef não-null)
 *
 * @param opts.leadFound       Se o lead deve ser encontrado (default: true)
 * @param opts.analysisExists  Se já existe análise ativa para o lead (default: false)
 * @param opts.withAnalyst     Se o teste inclui analistaRef (default: false)
 * @param opts.analystFound    Se o analista deve ser encontrado (default: true)
 */
function setupDefaultMocks({
  leadFound = true,
  analysisExists = false,
  withAnalyst = false,
  analystFound = true,
} = {}): void {
  const leadResult = leadFound ? [{ id: LEAD_ID }] : [];
  const analysisResult = analysisExists ? [{ id: ANALYSIS_ID }] : [];
  const analystResult = analystFound ? [{ id: ANALYST_ID }] : [];

  let builder = mockDbSelect.mockReturnValueOnce(makeDrizzleSelect(leadResult));

  if (leadFound) {
    // findExistingActiveAnalysis só é chamado se lead for encontrado
    builder = builder.mockReturnValueOnce(makeDrizzleSelect(analysisResult));
  }

  if (withAnalyst) {
    // resolveAnalystId só é chamado se analistaRef presente
    builder.mockReturnValueOnce(makeDrizzleSelect(analystResult));
  }
}

function makeDrizzleSelect(result: unknown[]): unknown {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(result),
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  // Default: createAnalysis sucesso
  mockCreateAnalysis.mockResolvedValue({ id: ANALYSIS_ID });

  // Default: addVersion sucesso
  mockAddVersion.mockResolvedValue({ id: ANALYSIS_ID });

  // Default: auditLog sucesso
  mockAuditLog.mockResolvedValue(undefined);

  // Default: insert sucesso
  mockDbInsert.mockReturnValue({
    values: vi.fn().mockResolvedValue([]),
  });
});

// ===========================================================================
// BLOCO A — parseRow
// ===========================================================================

describe('analysesAdapter.parseRow', () => {
  it('A1. sucesso: lead_id + status + parecer', () => {
    const result = analysesAdapter.parseRow({
      lead_id: LEAD_ID,
      status: 'aprovado',
      parecer: 'Análise concluída com sucesso.',
      valor_aprovado: 'R$ 5.000,00',
      prazo_meses: '12',
      taxa_mensal: '2,5%',
      analista: 'analista@banco.gov.br',
      data_decisao: '2024-03-15',
    });

    expect(isParseError(result)).toBe(false);
    if (!isParseError(result)) {
      expect(result.leadRef).toBe(LEAD_ID);
      expect(result.statusRaw).toBe('aprovado');
      expect(result.parecerText).toBe('Análise concluída com sucesso.');
      expect(result.valorAprovadoRaw).toBe('R$ 5.000,00');
      expect(result.prazoMesesRaw).toBe('12');
      expect(result.taxaMensalRaw).toBe('2,5%');
      expect(result.analistaRef).toBe('analista@banco.gov.br');
      expect(result.dataDecisaoRaw).toBe('2024-03-15');
    }
  });

  it('A2. sucesso: aliases alternativos (id_lead, situacao, observacao)', () => {
    const result = analysesAdapter.parseRow({
      id_lead: LEAD_ID,
      situacao: 'recusado',
      observacao: 'Renda insuficiente para o valor solicitado.',
    });

    expect(isParseError(result)).toBe(false);
    if (!isParseError(result)) {
      expect(result.leadRef).toBe(LEAD_ID);
      expect(result.statusRaw).toBe('recusado');
      expect(result.parecerText).toBe('Renda insuficiente para o valor solicitado.');
    }
  });

  it('A3. erro: lead_ref ausente', () => {
    const result = analysesAdapter.parseRow({ status: 'em_analise', parecer: 'Teste' });
    expect(isParseError(result)).toBe(true);
    if (isParseError(result)) {
      expect(result.error).toMatch(/lead/i);
    }
  });

  it('A4. erro: status ausente', () => {
    const result = analysesAdapter.parseRow({ lead_id: LEAD_ID, parecer: 'Teste' });
    expect(isParseError(result)).toBe(true);
    if (isParseError(result)) {
      expect(result.error).toMatch(/status/i);
    }
  });
});

// ===========================================================================
// BLOCO B — validateRow
// ===========================================================================

describe('analysesAdapter.validateRow', () => {
  it('B1. sucesso: em_analise com lead por UUID', async () => {
    // Sem analistaRef → apenas 2 queries: lead + análise existente
    setupDefaultMocks({ leadFound: true, analysisExists: false, withAnalyst: false });

    const parsed = analysesAdapter.parseRow({
      lead_id: LEAD_ID,
      status: 'em_analise',
      // sem analista — para ter exatamente 2 queries select
    });
    expect(isParseError(parsed)).toBe(false);
    if (isParseError(parsed)) return;

    const result = await analysesAdapter.validateRow(parsed, CTX);

    expect('errors' in result).toBe(false);
    if ('input' in result) {
      expect(result.input.leadId).toBe(LEAD_ID);
      expect(result.input.status).toBe('em_analise');
      // sem analistaRef → null
      expect(result.input.analystUserId).toBeNull();
      // parecer_text usa default quando não informado
      expect(result.input.parecerText).toContain('importada');
    }
  });

  it('B2. sucesso: lead resolvido por phone_normalized', async () => {
    // lead não é UUID — é phone. Sem analista → 2 queries: lead (phone) + análise existente
    mockDbSelect
      .mockReturnValueOnce(makeDrizzleSelect([{ id: LEAD_ID }])) // phone lookup
      .mockReturnValueOnce(makeDrizzleSelect([])); // sem análise existente

    const parsed = analysesAdapter.parseRow({
      lead_phone: '(69) 99123-4567',
      status: 'em_analise',
    });
    expect(isParseError(parsed)).toBe(false);
    if (isParseError(parsed)) return;

    const result = await analysesAdapter.validateRow(parsed, CTX);
    expect('errors' in result).toBe(false);
    if ('input' in result) {
      expect(result.input.leadId).toBe(LEAD_ID);
    }
  });

  it('B3. sucesso: status aprovado com todos os campos financeiros', async () => {
    // Sem analista → 2 queries: lead + análise existente
    setupDefaultMocks({ leadFound: true, analysisExists: false, withAnalyst: false });

    const parsed = analysesAdapter.parseRow({
      lead_id: LEAD_ID,
      status: 'aprovado',
      parecer: 'Análise concluída positivamente após verificação de renda.',
      valor_aprovado: 'R$ 5.000,00',
      prazo_meses: '12',
      taxa_mensal: '2,5%',
    });
    expect(isParseError(parsed)).toBe(false);
    if (isParseError(parsed)) return;

    const result = await analysesAdapter.validateRow(parsed, CTX);

    expect('errors' in result).toBe(false);
    if ('input' in result) {
      expect(result.input.status).toBe('aprovado');
      expect(result.input.approvedAmount).toBe(5000);
      expect(result.input.approvedTermMonths).toBe(12);
      expect(result.input.approvedRateMonthly).toBeCloseTo(0.025);
    }
  });

  it('B4. erro: status inválido', async () => {
    // Status inválido não impede as queries de lead/análise (coleta todos os erros)
    // Sem analista → 2 queries: lead + análise existente
    mockDbSelect
      .mockReturnValueOnce(makeDrizzleSelect([{ id: LEAD_ID }]))
      .mockReturnValueOnce(makeDrizzleSelect([]));

    const parsed = analysesAdapter.parseRow({
      lead_id: LEAD_ID,
      status: 'status_desconhecido',
    });
    expect(isParseError(parsed)).toBe(false);
    if (isParseError(parsed)) return;

    const result = await analysesAdapter.validateRow(parsed, CTX);
    expect('errors' in result).toBe(true);
    if ('errors' in result) {
      expect(result.errors.some((e) => e.toLowerCase().includes('status'))).toBe(true);
    }
  });

  it('B5. erro: lead não encontrado', async () => {
    // Lead não encontrado → 1 query. findExistingActiveAnalysis NÃO é chamado.
    mockDbSelect.mockReturnValueOnce(makeDrizzleSelect([]));

    const parsed = analysesAdapter.parseRow({
      lead_id: '00000000-0000-0000-0000-000000000000',
      status: 'em_analise',
    });
    if (isParseError(parsed)) return;

    const result = await analysesAdapter.validateRow(parsed, CTX);
    expect('errors' in result).toBe(true);
    if ('errors' in result) {
      expect(result.errors.some((e) => e.toLowerCase().includes('lead'))).toBe(true);
    }
  });

  it('B6. erro: parecer contém CPF bruto (LGPD Art. 20 §1º)', async () => {
    // Setup: lead encontrado, sem análise existente (2 queries)
    // DLP detectado em validateRow antes dos checks financeiros e analista
    mockDbSelect
      .mockReturnValueOnce(makeDrizzleSelect([{ id: LEAD_ID }]))
      .mockReturnValueOnce(makeDrizzleSelect([]));

    const parsed = analysesAdapter.parseRow({
      lead_id: LEAD_ID,
      status: 'em_analise',
      parecer: 'Aprovado para CPF 123.456.789-00 conforme análise de renda.',
    });
    if (isParseError(parsed)) return;

    const result = await analysesAdapter.validateRow(parsed, CTX);
    expect('errors' in result).toBe(true);
    if ('errors' in result) {
      expect(result.errors.some((e) => e.includes('CPF'))).toBe(true);
      expect(result.errors.some((e) => e.includes('LGPD'))).toBe(true);
    }
  });

  it('B7. erro: parecer contém RG bruto (LGPD Art. 20 §1º)', async () => {
    // Setup: lead encontrado, sem análise existente (2 queries)
    mockDbSelect
      .mockReturnValueOnce(makeDrizzleSelect([{ id: LEAD_ID }]))
      .mockReturnValueOnce(makeDrizzleSelect([]));

    const parsed = analysesAdapter.parseRow({
      lead_id: LEAD_ID,
      status: 'recusado',
      parecer: 'Recusado: RG 1.234.567-8 com restrição cadastral.',
    });
    if (isParseError(parsed)) return;

    const result = await analysesAdapter.validateRow(parsed, CTX);
    expect('errors' in result).toBe(true);
    if ('errors' in result) {
      expect(result.errors.some((e) => e.includes('RG'))).toBe(true);
    }
  });

  it('B8. erro: análise duplicada para o lead', async () => {
    // Lead encontrado, análise existente encontrada → 2 queries. Resultado: erro.
    mockDbSelect
      .mockReturnValueOnce(makeDrizzleSelect([{ id: LEAD_ID }]))
      .mockReturnValueOnce(makeDrizzleSelect([{ id: ANALYSIS_ID }])); // análise já existe!

    const parsed = analysesAdapter.parseRow({
      lead_id: LEAD_ID,
      status: 'em_analise',
    });
    if (isParseError(parsed)) return;

    const result = await analysesAdapter.validateRow(parsed, CTX);
    expect('errors' in result).toBe(true);
    if ('errors' in result) {
      expect(result.errors.some((e) => e.toLowerCase().includes('duplic'))).toBe(true);
    }
  });

  it('B9. erro: aprovado sem campos financeiros obrigatórios', async () => {
    // Sem analista → 2 queries: lead + análise existente
    setupDefaultMocks({ leadFound: true, analysisExists: false, withAnalyst: false });

    const parsed = analysesAdapter.parseRow({
      lead_id: LEAD_ID,
      status: 'aprovado',
      parecer: 'Aprovado mas sem valores financeiros.',
      // SEM valor_aprovado, prazo_meses, taxa_mensal
    });
    if (isParseError(parsed)) return;

    const result = await analysesAdapter.validateRow(parsed, CTX);
    expect('errors' in result).toBe(true);
    if ('errors' in result) {
      const errStr = result.errors.join(' ');
      expect(errStr).toMatch(/valor_aprovado/);
      expect(errStr).toMatch(/prazo_meses/);
      expect(errStr).toMatch(/taxa_mensal/);
    }
  });

  it('B10. erro: valor_aprovado inválido', async () => {
    // Sem analista → 2 queries: lead + análise existente
    setupDefaultMocks({ leadFound: true, analysisExists: false, withAnalyst: false });

    const parsed = analysesAdapter.parseRow({
      lead_id: LEAD_ID,
      status: 'aprovado',
      parecer: 'Aprovado com valor inválido.',
      valor_aprovado: 'valor-invalido',
      prazo_meses: '12',
      taxa_mensal: '2,5%',
    });
    if (isParseError(parsed)) return;

    const result = await analysesAdapter.validateRow(parsed, CTX);
    expect('errors' in result).toBe(true);
    if ('errors' in result) {
      expect(result.errors.some((e) => e.toLowerCase().includes('valor'))).toBe(true);
    }
  });

  it('B11. erro: taxa_mensal inválida', async () => {
    // Sem analista → 2 queries: lead + análise existente
    setupDefaultMocks({ leadFound: true, analysisExists: false, withAnalyst: false });

    const parsed = analysesAdapter.parseRow({
      lead_id: LEAD_ID,
      status: 'aprovado',
      parecer: 'Aprovado com taxa inválida.',
      valor_aprovado: 'R$ 5.000,00',
      prazo_meses: '12',
      taxa_mensal: 'taxa-invalida',
    });
    if (isParseError(parsed)) return;

    const result = await analysesAdapter.validateRow(parsed, CTX);
    expect('errors' in result).toBe(true);
    if ('errors' in result) {
      expect(result.errors.some((e) => e.toLowerCase().includes('taxa'))).toBe(true);
    }
  });

  it('B12. erro: data_decisao inválida', async () => {
    // Sem analista → 2 queries: lead + análise existente
    setupDefaultMocks({ leadFound: true, analysisExists: false, withAnalyst: false });

    const parsed = analysesAdapter.parseRow({
      lead_id: LEAD_ID,
      status: 'em_analise',
      data_decisao: 'data-invalida-xyz',
    });
    if (isParseError(parsed)) return;

    const result = await analysesAdapter.validateRow(parsed, CTX);
    expect('errors' in result).toBe(true);
    if ('errors' in result) {
      expect(result.errors.some((e) => e.toLowerCase().includes('data'))).toBe(true);
    }
  });

  it('B13. analista não encontrado: campo null (sem bloquear o import)', async () => {
    // Lead encontrado, sem análise existente, analista COM analistaRef mas NÃO encontrado → 3 queries
    mockDbSelect
      .mockReturnValueOnce(makeDrizzleSelect([{ id: LEAD_ID }])) // lead encontrado
      .mockReturnValueOnce(makeDrizzleSelect([])) // sem análise existente
      .mockReturnValueOnce(makeDrizzleSelect([])); // analista NÃO encontrado

    const parsed = analysesAdapter.parseRow({
      lead_id: LEAD_ID,
      status: 'em_analise',
      analista: 'analista-inexistente@banco.gov.br',
    });
    if (isParseError(parsed)) return;

    const result = await analysesAdapter.validateRow(parsed, CTX);
    // NÃO deve ter erro — analista nulo é tolerado (analista pode ter sido desativado)
    expect('errors' in result).toBe(false);
    if ('input' in result) {
      expect(result.input.analystUserId).toBeNull();
    }
  });
});

// ===========================================================================
// BLOCO C — persistRow
// ===========================================================================

describe('analysesAdapter.persistRow', () => {
  it('C1. persistRow — cria análise em_analise via service', async () => {
    const input = {
      leadId: LEAD_ID,
      analystUserId: ANALYST_ID,
      status: 'em_analise' as const,
      parecerText: 'Documentação recebida, aguardando análise.',
      approvedAmount: null,
      approvedTermMonths: null,
      approvedRateMonthly: null,
      createdAt: null,
    };

    const result = await analysesAdapter.persistRow(input, CTX, FAKE_TX);

    expect(result.entityId).toBe(ANALYSIS_ID);
    expect(mockCreateAnalysis).toHaveBeenCalledOnce();

    const createCall = mockCreateAnalysis.mock.calls[0];
    expect(createCall).toBeDefined();
    // origin deve ser 'import'
    expect(createCall?.[2]?.origin).toBe('import');
    // status inicial deve ser 'em_analise'
    expect(createCall?.[2]?.status).toBe('em_analise');

    // addVersion NÃO deve ser chamado para em_analise
    expect(mockAddVersion).not.toHaveBeenCalled();

    // auditLog deve ter sido chamado
    expect(mockAuditLog).toHaveBeenCalledOnce();
    const auditCall = mockAuditLog.mock.calls[0];
    expect(auditCall?.[1]?.action).toBe('import_credit_analyses');
  });

  it('C2. persistRow — status aprovado: createAnalysis + addVersion', async () => {
    const input = {
      leadId: LEAD_ID,
      analystUserId: ANALYST_ID,
      status: 'aprovado' as const,
      parecerText: 'Análise aprovada após verificação completa de renda.',
      approvedAmount: 5000,
      approvedTermMonths: 12,
      approvedRateMonthly: 0.025,
      createdAt: new Date('2024-03-15'),
    };

    const result = await analysesAdapter.persistRow(input, CTX, FAKE_TX);

    expect(result.entityId).toBe(ANALYSIS_ID);

    // createAnalysis chamado com status 'em_analise' (passo inicial)
    expect(mockCreateAnalysis).toHaveBeenCalledOnce();
    expect(mockCreateAnalysis.mock.calls[0]?.[2]?.status).toBe('em_analise');

    // addVersion chamado com status 'aprovado' e campos financeiros
    expect(mockAddVersion).toHaveBeenCalledOnce();
    const addVersionCall = mockAddVersion.mock.calls[0];
    expect(addVersionCall?.[3]?.status).toBe('aprovado');
    expect(addVersionCall?.[3]?.approved_amount).toBe(5000);
    expect(addVersionCall?.[3]?.approved_term_months).toBe(12);
    expect(addVersionCall?.[3]?.approved_rate_monthly).toBe(0.025);
  });

  it('C3. persistRow — conflito 409 → re-lança AppError', async () => {
    mockCreateAnalysis.mockRejectedValue(
      new AppError(409, 'CONFLICT', 'Análise já existe para este lead', {}),
    );

    const input = {
      leadId: LEAD_ID_2,
      analystUserId: null,
      status: 'em_analise' as const,
      parecerText: 'Análise em conflito.',
      approvedAmount: null,
      approvedTermMonths: null,
      approvedRateMonthly: null,
      createdAt: null,
    };

    await expect(analysesAdapter.persistRow(input, CTX, FAKE_TX)).rejects.toBeInstanceOf(AppError);
  });
});

// ===========================================================================
// BLOCO D — funções utilitárias exportadas
// ===========================================================================

describe('parseBRCurrency', () => {
  it('D1. parseia formatos BR e EN corretamente', () => {
    expect(parseBRCurrency('R$ 1.234,56')).toBe(1234.56);
    expect(parseBRCurrency('1234,56')).toBe(1234.56);
    expect(parseBRCurrency('1.234.567,89')).toBeCloseTo(1234567.89);
    expect(parseBRCurrency('1234.56')).toBe(1234.56);
    expect(parseBRCurrency('R$ 5.000,00')).toBe(5000);
    expect(parseBRCurrency('5000')).toBe(5000);
    expect(parseBRCurrency('')).toBeNull();
    expect(parseBRCurrency('-')).toBeNull();
    expect(parseBRCurrency('texto-invalido')).toBeNull();
    expect(parseBRCurrency('-100,00')).toBeNull(); // valor negativo
  });
});

describe('parsePercentToDecimal', () => {
  it('D2. parseia percentuais e decimais corretamente', () => {
    // Com sinal % → sempre divide por 100
    expect(parsePercentToDecimal('2,5%')).toBeCloseTo(0.025);
    expect(parsePercentToDecimal('2.5%')).toBeCloseTo(0.025);
    expect(parsePercentToDecimal('1%')).toBeCloseTo(0.01);
    expect(parsePercentToDecimal('50%')).toBeCloseTo(0.5);
    // Sem sinal %, >1 → interpreta como percentual (divide por 100)
    expect(parsePercentToDecimal('2,5')).toBeCloseTo(0.025);
    // Sem sinal %, ≤1 → já é decimal
    expect(parsePercentToDecimal('0.025')).toBe(0.025);
    // Inválidos
    expect(parsePercentToDecimal('')).toBeNull();
    expect(parsePercentToDecimal('-')).toBeNull();
    expect(parsePercentToDecimal('taxa-invalida')).toBeNull();
    expect(parsePercentToDecimal('0%')).toBeNull(); // zero inválido
    expect(parsePercentToDecimal('200%')).toBeNull(); // > 100% ao mês inválido
  });
});

describe('parseAnalysisDate', () => {
  it('D3. parseia ISO e dd/mm/yyyy corretamente', () => {
    const d1 = parseAnalysisDate('2024-03-15');
    expect(d1).toBeInstanceOf(Date);
    expect(d1?.toISOString()).toMatch(/^2024-03-15/);

    const d2 = parseAnalysisDate('15/03/2024');
    expect(d2).toBeInstanceOf(Date);

    const d3 = parseAnalysisDate('15-03-2024');
    expect(d3).toBeInstanceOf(Date);

    expect(parseAnalysisDate('')).toBeNull();
    expect(parseAnalysisDate('-')).toBeNull();
    expect(parseAnalysisDate('data-invalida')).toBeNull();
  });
});

describe('normalizeAnalysisStatus', () => {
  it('D4. normaliza aliases PT/EN com e sem acento', () => {
    expect(normalizeAnalysisStatus('em_analise')).toBe('em_analise');
    expect(normalizeAnalysisStatus('Em Análise')).toBe('em_analise');
    expect(normalizeAnalysisStatus('EM ANALISE')).toBe('em_analise');
    expect(normalizeAnalysisStatus('novo')).toBe('em_analise');
    expect(normalizeAnalysisStatus('new')).toBe('em_analise');

    expect(normalizeAnalysisStatus('pendente')).toBe('pendente');
    expect(normalizeAnalysisStatus('Pendente')).toBe('pendente');
    expect(normalizeAnalysisStatus('pending')).toBe('pendente');

    expect(normalizeAnalysisStatus('aprovado')).toBe('aprovado');
    expect(normalizeAnalysisStatus('Aprovado')).toBe('aprovado');
    expect(normalizeAnalysisStatus('approved')).toBe('aprovado');
    expect(normalizeAnalysisStatus('APROVAÇÃO')).toBe('aprovado');

    expect(normalizeAnalysisStatus('recusado')).toBe('recusado');
    expect(normalizeAnalysisStatus('reprovado')).toBe('recusado');
    expect(normalizeAnalysisStatus('rejected')).toBe('recusado');
    expect(normalizeAnalysisStatus('negado')).toBe('recusado');

    expect(normalizeAnalysisStatus('cancelado')).toBe('cancelado');
    expect(normalizeAnalysisStatus('cancelled')).toBe('cancelado');

    // Inválidos
    expect(normalizeAnalysisStatus('xyz_invalido')).toBeNull();
    expect(normalizeAnalysisStatus('')).toBeNull();
  });
});

// ===========================================================================
// BLOCO E — registry
// ===========================================================================

describe('registry', () => {
  it('E1. analyses está registrado no registry e retorna o adapter correto', async () => {
    const { getAdapter, getSupportedEntityTypes } = await import('../registry.js');

    expect(getSupportedEntityTypes()).toContain('analyses');

    const adapter = getAdapter('analyses');
    expect(adapter).toBeDefined();
    expect(adapter.entityType).toBe('analyses');
  });
});
