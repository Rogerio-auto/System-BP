// =============================================================================
// auto-contract-from-analysis.test.ts — Testes do handler F17-S13.
//
// Cenários cobertos (7 mínimos conforme DoD):
//   1.  aprovado sem contrato existente → INSERT draft
//   2.  aprovado com draft existente → UPDATE
//   3.  aprovado com contrato já assinado → skip (não destrói)
//   4.  aprovado sem customer_id → skip com warning
//   5.  recusado com draft existente → cancel
//   6.  recusado sem contrato → skip
//   7.  idempotência: rodar handler 2x com mesmo evento → sem duplicata
//   8.  análise não encontrada (fetch retorna null) → skip com warning
//   9.  approved_amount ausente → skip com warning
//   10. evento de outro status (em_analise) → ignora silenciosamente
//   11. correlationId propagado nos eventos
// =============================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock env
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
  eq: vi.fn((_col: unknown, val: unknown) => ({ __eq: val })),
  and: vi.fn((...args: unknown[]) => ({ __and: args })),
  sql: Object.assign(
    vi.fn(() => ({})),
    { mapWith: vi.fn() },
  ),
  relations: vi.fn().mockReturnValue({}),
  asc: vi.fn().mockReturnValue({}),
  desc: vi.fn().mockReturnValue({}),
  count: vi.fn().mockReturnValue({}),
  inArray: vi.fn().mockReturnValue({}),
  isNotNull: vi.fn().mockReturnValue({}),
  isNull: vi.fn().mockReturnValue({}),
  max: vi.fn().mockReturnValue({}),
}));

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn().mockReturnValue({}),
}));

// ---------------------------------------------------------------------------
// Mock db/client
// ---------------------------------------------------------------------------
vi.mock('../../db/client.js', () => ({
  db: {},
  pool: {},
}));

// ---------------------------------------------------------------------------
// Mock emit + auditLog
// ---------------------------------------------------------------------------
const mockEmit = vi.fn().mockResolvedValue('event-uuid');
vi.mock('../../events/emit.js', () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
}));

const mockAuditLog = vi.fn().mockResolvedValue('audit-uuid');
vi.mock('../../lib/audit.js', () => ({
  auditLog: (...args: unknown[]) => mockAuditLog(...args),
}));

// ---------------------------------------------------------------------------
// Mock contracts/repository
// ---------------------------------------------------------------------------
const mockFindContractByAnalysisId = vi.fn();
const mockCreateAutoContractDraft = vi.fn();
const mockUpdateAutoContractDraft = vi.fn();
const mockCancelAutoContractDraft = vi.fn();

vi.mock('../../modules/contracts/repository.js', () => ({
  findContractByAnalysisId: (...args: unknown[]) => mockFindContractByAnalysisId(...args),
  createAutoContractDraft: (...args: unknown[]) => mockCreateAutoContractDraft(...args),
  updateAutoContractDraft: (...args: unknown[]) => mockUpdateAutoContractDraft(...args),
  cancelAutoContractDraft: (...args: unknown[]) => mockCancelAutoContractDraft(...args),
}));

// ---------------------------------------------------------------------------
// Mock credit-analyses/repository
// ---------------------------------------------------------------------------
const mockFindAnalysisById = vi.fn();

vi.mock('../../modules/credit-analyses/repository.js', () => ({
  findAnalysisById: (...args: unknown[]) => mockFindAnalysisById(...args),
}));

// ---------------------------------------------------------------------------
// Import da função sob teste
// ---------------------------------------------------------------------------
import { handleAutoContractFromAnalysis } from '../auto-contract-from-analysis.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = 'org-00000001-0000-0000-0000-000000000001';
const ANALYSIS_ID = 'ana-00001111-0000-0000-0000-000000000001';
const CUSTOMER_ID = 'cus-00000001-0000-0000-0000-000000000001';
const CONTRACT_ID = 'con-00000001-0000-0000-0000-000000000001';
const LEAD_ID = 'lea-00000001-0000-0000-0000-000000000001';
const VERSION_ID = 'ver-00000001-0000-0000-0000-000000000001';

function makeAnalysis(
  overrides: Partial<{
    customerId: string | null;
    approvedAmount: string | null;
    approvedTermMonths: number | null;
    approvedRateMonthly: string | null;
  }> = {},
) {
  return {
    id: ANALYSIS_ID,
    organizationId: ORG_ID,
    leadId: LEAD_ID,
    customerId: CUSTOMER_ID,
    approvedAmount: '15000.00',
    approvedTermMonths: 24,
    approvedRateMonthly: '0.024500',
    status: 'aprovado',
    ...overrides,
  };
}

function makeContract(status: string = 'draft') {
  return {
    id: CONTRACT_ID,
    organization_id: ORG_ID,
    customer_id: CUSTOMER_ID,
    contract_reference: `ANA-2026-${ANALYSIS_ID.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
    product_id: null,
    rule_version_id: null,
    principal_amount: '15000.00',
    term_months: 24,
    monthly_rate_snapshot: '0.024500',
    status,
    signed_at: null,
    first_due_date: null,
    last_due_date: null,
    analysis_id: ANALYSIS_ID,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function makeAprovadoEvent(correlationId: string | null = null) {
  return {
    eventName: 'credit_analysis.status_changed' as const,
    aggregateType: 'credit_analysis',
    aggregateId: ANALYSIS_ID,
    organizationId: ORG_ID,
    actor: { kind: 'user' as const, id: null, ip: null },
    idempotencyKey: `credit_analysis.status_changed:${ANALYSIS_ID}:aprovado`,
    data: {
      analysis_id: ANALYSIS_ID,
      lead_id: LEAD_ID,
      from_status: 'em_analise',
      to_status: 'aprovado',
      version_id: VERSION_ID,
    },
    ...(correlationId !== null ? { correlationId } : {}),
  };
}

function makeRecusadoEvent() {
  return {
    eventName: 'credit_analysis.status_changed' as const,
    aggregateType: 'credit_analysis',
    aggregateId: ANALYSIS_ID,
    organizationId: ORG_ID,
    actor: { kind: 'user' as const, id: null, ip: null },
    idempotencyKey: `credit_analysis.status_changed:${ANALYSIS_ID}:recusado`,
    data: {
      analysis_id: ANALYSIS_ID,
      lead_id: LEAD_ID,
      from_status: 'em_analise',
      to_status: 'recusado',
      version_id: VERSION_ID,
    },
  };
}

/**
 * Monta instância de db fake com transaction que executa o callback.
 * O mockTx tem todos os métodos necessários para o repository.
 */
function makeDb() {
  const mockTx = {
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  };

  return {
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      await fn(mockTx);
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    _mockTx: mockTx,
  };
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('handleAutoContractFromAnalysis()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Cenário 1: aprovado sem contrato existente → INSERT draft
  // ---------------------------------------------------------------------------
  it('aprovado sem contrato existente → cria draft e emite contract.auto_created', async () => {
    const db = makeDb();
    const analysis = makeAnalysis();
    const contract = makeContract('draft');

    mockFindAnalysisById.mockResolvedValueOnce(analysis);
    mockFindContractByAnalysisId.mockResolvedValueOnce(null);
    mockCreateAutoContractDraft.mockResolvedValueOnce(contract);

    await handleAutoContractFromAnalysis(makeAprovadoEvent(), db as never);

    expect(mockFindAnalysisById).toHaveBeenCalledWith(expect.anything(), ANALYSIS_ID, ORG_ID, null);
    expect(mockFindContractByAnalysisId).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      ANALYSIS_ID,
    );
    expect(mockCreateAutoContractDraft).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG_ID,
        customerId: CUSTOMER_ID,
        principalAmount: '15000.00',
        termMonths: 24,
        monthlyRateSnapshot: '0.024500',
        analysisId: ANALYSIS_ID,
      }),
    );
    expect(mockUpdateAutoContractDraft).not.toHaveBeenCalled();
    expect(mockEmit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventName: 'contract.auto_created',
        data: expect.objectContaining({
          contract_id: CONTRACT_ID,
          analysis_id: ANALYSIS_ID,
          organization_id: ORG_ID,
        }),
      }),
    );
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'contract.auto_created' }),
    );
  });

  // ---------------------------------------------------------------------------
  // Cenário 2: aprovado com draft existente → UPDATE
  // ---------------------------------------------------------------------------
  it('aprovado com draft existente → atualiza e emite contract.auto_updated', async () => {
    const db = makeDb();
    const analysis = makeAnalysis({ approvedAmount: '20000.00', approvedTermMonths: 36 });
    const existingContract = makeContract('draft');
    const updatedContract = { ...existingContract, principal_amount: '20000.00', term_months: 36 };

    mockFindAnalysisById.mockResolvedValueOnce(analysis);
    mockFindContractByAnalysisId.mockResolvedValueOnce(existingContract);
    mockUpdateAutoContractDraft.mockResolvedValueOnce(updatedContract);

    await handleAutoContractFromAnalysis(makeAprovadoEvent(), db as never);

    expect(mockCreateAutoContractDraft).not.toHaveBeenCalled();
    expect(mockUpdateAutoContractDraft).toHaveBeenCalledWith(
      expect.anything(),
      CONTRACT_ID,
      ORG_ID,
      expect.objectContaining({
        principalAmount: '20000.00',
        termMonths: 36,
        monthlyRateSnapshot: '0.024500',
      }),
    );
    expect(mockEmit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventName: 'contract.auto_updated',
        data: expect.objectContaining({
          contract_id: CONTRACT_ID,
          analysis_id: ANALYSIS_ID,
          organization_id: ORG_ID,
        }),
      }),
    );
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'contract.auto_updated' }),
    );
  });

  // ---------------------------------------------------------------------------
  // Cenário 3: aprovado com contrato já assinado → skip (não destrói)
  // ---------------------------------------------------------------------------
  it('aprovado com contrato já assinado (signed) → skip sem mutação', async () => {
    const db = makeDb();
    const analysis = makeAnalysis();
    const signedContract = makeContract('signed');

    mockFindAnalysisById.mockResolvedValueOnce(analysis);
    mockFindContractByAnalysisId.mockResolvedValueOnce(signedContract);

    await handleAutoContractFromAnalysis(makeAprovadoEvent(), db as never);

    expect(mockCreateAutoContractDraft).not.toHaveBeenCalled();
    expect(mockUpdateAutoContractDraft).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockAuditLog).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Cenário 4: aprovado sem customer_id → skip com warning
  // ---------------------------------------------------------------------------
  it('aprovado sem customer_id → skip silencioso sem qualquer mutação', async () => {
    const db = makeDb();
    const analysis = makeAnalysis({ customerId: null });

    mockFindAnalysisById.mockResolvedValueOnce(analysis);

    await handleAutoContractFromAnalysis(makeAprovadoEvent(), db as never);

    expect(mockFindContractByAnalysisId).not.toHaveBeenCalled();
    expect(mockCreateAutoContractDraft).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Cenário 5: recusado com draft existente → cancel
  // ---------------------------------------------------------------------------
  it('recusado com draft existente → cancela e registra audit log', async () => {
    const db = makeDb();
    const draftContract = makeContract('draft');
    const cancelledContract = makeContract('cancelled');

    mockFindContractByAnalysisId.mockResolvedValueOnce(draftContract);
    mockCancelAutoContractDraft.mockResolvedValueOnce(cancelledContract);

    await handleAutoContractFromAnalysis(makeRecusadoEvent(), db as never);

    expect(mockCancelAutoContractDraft).toHaveBeenCalledWith(
      expect.anything(),
      CONTRACT_ID,
      ORG_ID,
    );
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'contract.auto_cancelled',
        resource: { type: 'contract', id: CONTRACT_ID },
      }),
    );
    // Recusa NÃO emite evento outbox (apenas audit log)
    expect(mockEmit).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Cenário 6: recusado sem contrato → skip
  // ---------------------------------------------------------------------------
  it('recusado sem contrato vinculado → skip silencioso', async () => {
    const db = makeDb();

    mockFindContractByAnalysisId.mockResolvedValueOnce(null);

    await handleAutoContractFromAnalysis(makeRecusadoEvent(), db as never);

    expect(mockCancelAutoContractDraft).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockAuditLog).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Cenário 7: idempotência — rodar 2x com mesmo evento aprovado + draft existente
  // ---------------------------------------------------------------------------
  it('idempotência: 2ª execução com draft já existente → UPDATE (não cria duplicata)', async () => {
    const db = makeDb();
    const analysis = makeAnalysis();
    const contract = makeContract('draft');

    // Primeira execução: sem contrato → INSERT
    mockFindAnalysisById.mockResolvedValueOnce(analysis);
    mockFindContractByAnalysisId.mockResolvedValueOnce(null);
    mockCreateAutoContractDraft.mockResolvedValueOnce(contract);

    await handleAutoContractFromAnalysis(makeAprovadoEvent(), db as never);

    expect(mockCreateAutoContractDraft).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();

    // Segunda execução: draft já existe → UPDATE (idempotente)
    mockFindAnalysisById.mockResolvedValueOnce(analysis);
    mockFindContractByAnalysisId.mockResolvedValueOnce(contract);
    mockUpdateAutoContractDraft.mockResolvedValueOnce(contract);

    await handleAutoContractFromAnalysis(makeAprovadoEvent(), db as never);

    expect(mockCreateAutoContractDraft).not.toHaveBeenCalled();
    expect(mockUpdateAutoContractDraft).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Cenário 8: análise não encontrada → skip com warning
  // ---------------------------------------------------------------------------
  it('aprovado com análise não encontrada → skip silencioso', async () => {
    const db = makeDb();

    mockFindAnalysisById.mockResolvedValueOnce(null);

    await handleAutoContractFromAnalysis(makeAprovadoEvent(), db as never);

    expect(mockFindContractByAnalysisId).not.toHaveBeenCalled();
    expect(mockCreateAutoContractDraft).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Cenário 9: approved_amount ausente → skip com warning
  // ---------------------------------------------------------------------------
  it('aprovado sem approved_amount → skip silencioso', async () => {
    const db = makeDb();
    const analysis = makeAnalysis({ approvedAmount: null, approvedTermMonths: null });

    mockFindAnalysisById.mockResolvedValueOnce(analysis);

    await handleAutoContractFromAnalysis(makeAprovadoEvent(), db as never);

    expect(mockFindContractByAnalysisId).not.toHaveBeenCalled();
    expect(mockCreateAutoContractDraft).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Cenário 10: evento de outro status → ignora silenciosamente
  // ---------------------------------------------------------------------------
  it('evento de outro status (em_analise) → ignorado sem qualquer ação', async () => {
    const db = makeDb();
    const event = {
      ...makeAprovadoEvent(),
      data: {
        analysis_id: ANALYSIS_ID,
        lead_id: LEAD_ID,
        from_status: 'pendente',
        to_status: 'em_analise',
        version_id: VERSION_ID,
      },
    };

    await handleAutoContractFromAnalysis(event, db as never);

    expect(mockFindAnalysisById).not.toHaveBeenCalled();
    expect(mockFindContractByAnalysisId).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Cenário 11: correlationId propagado nos eventos
  // ---------------------------------------------------------------------------
  it('correlationId propagado no evento outbox', async () => {
    const db = makeDb();
    const analysis = makeAnalysis();
    const contract = makeContract('draft');

    mockFindAnalysisById.mockResolvedValueOnce(analysis);
    mockFindContractByAnalysisId.mockResolvedValueOnce(null);
    mockCreateAutoContractDraft.mockResolvedValueOnce(contract);

    await handleAutoContractFromAnalysis(makeAprovadoEvent('corr-xyz-123'), db as never);

    expect(mockEmit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        correlationId: 'corr-xyz-123',
      }),
    );
  });

  // ---------------------------------------------------------------------------
  // Cenário extra: recusado com contrato já cancelado → skip (preserva estado)
  // ---------------------------------------------------------------------------
  it('recusado com contrato já cancelado → skip silencioso', async () => {
    const db = makeDb();
    const cancelledContract = makeContract('cancelled');

    mockFindContractByAnalysisId.mockResolvedValueOnce(cancelledContract);

    await handleAutoContractFromAnalysis(makeRecusadoEvent(), db as never);

    expect(mockCancelAutoContractDraft).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockAuditLog).not.toHaveBeenCalled();
  });
});
