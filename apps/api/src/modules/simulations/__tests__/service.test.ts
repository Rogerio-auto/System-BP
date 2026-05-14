// =============================================================================
// simulations/__tests__/service.test.ts — Testes unitários do service (F2-S04).
//
// Cobre:
//   1.  createSimulation — caminho feliz Price (retorna simulação completa)
//   2.  createSimulation — caminho feliz SAC
//   3.  createSimulation — lead fora do city scope → ForbiddenError
//   4.  createSimulation — produto inativo → NotFoundError
//   5.  createSimulation — sem regra para cidade → NoActiveRuleForCityError
//   6.  createSimulation — amount abaixo do mínimo → SimulationOutOfRangError
//   7.  createSimulation — amount acima do máximo → SimulationOutOfRangError
//   8.  createSimulation — termMonths abaixo do mínimo → SimulationOutOfRangError
//   9.  createSimulation — termMonths acima do máximo → SimulationOutOfRangError
//   10. createSimulation — calculator chamado com rate snapshot correto
//   11. createSimulation — transação: INSERT + updateLead + updateCard + emit + audit
//   12. createSimulation — outbox payload sem PII (só IDs e números)
//   13. createSimulation — origin='ai' para F2-S05 reuso
// =============================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock repository
// ---------------------------------------------------------------------------
const mockFindLeadForSimulation = vi.fn();
const mockFindActiveProduct = vi.fn();
const mockFindActiveRuleForCity = vi.fn();
const mockInsertSimulation = vi.fn();
const mockUpdateLeadLastSimulation = vi.fn();
const mockUpdateKanbanCardLastSimulation = vi.fn();

vi.mock('../repository.js', () => ({
  findLeadForSimulation: (...args: unknown[]) => mockFindLeadForSimulation(...args),
  findActiveProduct: (...args: unknown[]) => mockFindActiveProduct(...args),
  findActiveRuleForCity: (...args: unknown[]) => mockFindActiveRuleForCity(...args),
  insertSimulation: (...args: unknown[]) => mockInsertSimulation(...args),
  updateLeadLastSimulation: (...args: unknown[]) => mockUpdateLeadLastSimulation(...args),
  updateKanbanCardLastSimulation: (...args: unknown[]) =>
    mockUpdateKanbanCardLastSimulation(...args),
  findSimulationById: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock calculator
// ---------------------------------------------------------------------------
const mockCalculate = vi.fn();

vi.mock('../calculator.js', () => ({
  calculate: (...args: unknown[]) => mockCalculate(...args),
}));

// ---------------------------------------------------------------------------
// Mock emit
// ---------------------------------------------------------------------------
const mockEmit = vi.fn().mockResolvedValue('event-uuid');
vi.mock('../../../events/emit.js', () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
}));

// ---------------------------------------------------------------------------
// Mock auditLog
// ---------------------------------------------------------------------------
const mockAuditLog = vi.fn().mockResolvedValue('audit-uuid');
vi.mock('../../../lib/audit.js', () => ({
  auditLog: (...args: unknown[]) => mockAuditLog(...args),
}));

// ---------------------------------------------------------------------------
// Mock db/client com transaction controlável
// ---------------------------------------------------------------------------
const mockDb = {
  transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    return fn({});
  }),
};

vi.mock('../../../db/client.js', () => ({
  db: mockDb,
  pool: { end: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_USER_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const FIXTURE_LEAD_ID = 'cccccccc-0000-0000-0000-000000000001';
const FIXTURE_CITY_ID = 'dddddddd-0000-0000-0000-000000000001';
const FIXTURE_PRODUCT_ID = 'eeeeeeee-0000-0000-0000-000000000001';
const FIXTURE_RULE_ID = 'ffffffff-0000-0000-0000-000000000001';
const FIXTURE_SIMULATION_ID = '11111111-0000-0000-0000-000000000001';

function makeLead(overrides = {}) {
  return {
    id: FIXTURE_LEAD_ID,
    organizationId: FIXTURE_ORG_ID,
    cityId: FIXTURE_CITY_ID,
    name: 'João Silva',
    phoneE164: '+5511999999999',
    phoneNormalized: '5511999999999',
    source: 'manual',
    status: 'new',
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSimulationId: null,
    agentId: null,
    email: null,
    cpfEncrypted: null,
    cpfHash: null,
    metadata: null,
    ...overrides,
  };
}

function makeProduct(overrides = {}) {
  return {
    id: FIXTURE_PRODUCT_ID,
    organizationId: FIXTURE_ORG_ID,
    key: 'microcredito',
    name: 'Microcrédito',
    description: null,
    isActive: true,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRule(overrides: Record<string, unknown> = {}) {
  return {
    id: FIXTURE_RULE_ID,
    productId: FIXTURE_PRODUCT_ID,
    version: 1,
    minAmount: '500.00',
    maxAmount: '5000.00',
    minTermMonths: 3,
    maxTermMonths: 24,
    monthlyRate: '0.025000',
    iofRate: null,
    amortization: 'price',
    cityScope: null,
    effectiveFrom: new Date(),
    effectiveTo: null,
    isActive: true,
    createdBy: FIXTURE_USER_ID,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeSimulationDbRow(overrides = {}) {
  return {
    id: FIXTURE_SIMULATION_ID,
    organizationId: FIXTURE_ORG_ID,
    leadId: FIXTURE_LEAD_ID,
    customerId: null,
    productId: FIXTURE_PRODUCT_ID,
    ruleVersionId: FIXTURE_RULE_ID,
    amountRequested: '2000.00',
    termMonths: 12,
    monthlyPayment: '187.53',
    totalAmount: '2250.36',
    totalInterest: '250.36',
    rateMonthlySnapshot: '0.025000',
    amortizationTable: {},
    origin: 'manual',
    createdByUserId: FIXTURE_USER_ID,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeCalcResult(method: 'price' | 'sac' = 'price') {
  return {
    method,
    amount: 2000,
    termMonths: 12,
    monthlyRate: 0.025,
    installments: [
      { number: 1, payment: 187.53, principal: 137.53, interest: 50, balance: 1862.47 },
      // ...restante omitido para brevidade
    ],
    totalPayment: 2250.36,
    totalInterest: 250.36,
  };
}

const ACTOR = {
  userId: FIXTURE_USER_ID,
  organizationId: FIXTURE_ORG_ID,
  role: 'agent',
  cityScopeIds: null as string[] | null,
  ip: '127.0.0.1',
};

const BODY = {
  leadId: FIXTURE_LEAD_ID,
  productId: FIXTURE_PRODUCT_ID,
  amount: 2000,
  termMonths: 12,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createSimulation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Defaults felizes
    mockFindLeadForSimulation.mockResolvedValue(makeLead());
    mockFindActiveProduct.mockResolvedValue(makeProduct());
    mockFindActiveRuleForCity.mockResolvedValue(makeRule());
    mockCalculate.mockReturnValue(makeCalcResult());
    mockInsertSimulation.mockResolvedValue(makeSimulationDbRow());
    mockUpdateLeadLastSimulation.mockResolvedValue(undefined);
    mockUpdateKanbanCardLastSimulation.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue('event-uuid');
    mockAuditLog.mockResolvedValue('audit-uuid');
  });

  // -------------------------------------------------------------------------
  // 1. Caminho feliz Price
  // -------------------------------------------------------------------------

  it('retorna simulação completa com amortization_method=price', async () => {
    const { createSimulation } = await import('../service.js');
    const result = await createSimulation(mockDb as never, ACTOR, BODY);

    expect(result.id).toBe(FIXTURE_SIMULATION_ID);
    expect(result.amortization_method).toBe('price');
    expect(result.lead_id).toBe(FIXTURE_LEAD_ID);
    expect(result.rule_version_id).toBe(FIXTURE_RULE_ID);
    expect(result.origin).toBe('manual');
    expect(result.created_by_user_id).toBe(FIXTURE_USER_ID);
  });

  // -------------------------------------------------------------------------
  // 2. Caminho feliz SAC
  // -------------------------------------------------------------------------

  it('retorna simulação completa com amortization_method=sac', async () => {
    mockFindActiveRuleForCity.mockResolvedValue(makeRule({ amortization: 'sac' }));
    mockCalculate.mockReturnValue(makeCalcResult('sac'));
    mockInsertSimulation.mockResolvedValue(makeSimulationDbRow({ origin: 'manual' }));

    const { createSimulation } = await import('../service.js');
    const result = await createSimulation(mockDb as never, ACTOR, BODY);

    expect(result.amortization_method).toBe('sac');
    // Verifica que calculator foi chamado com method='sac'
    expect(mockCalculate).toHaveBeenCalledWith(expect.objectContaining({ method: 'sac' }));
  });

  // -------------------------------------------------------------------------
  // 3. Lead fora do city scope
  // -------------------------------------------------------------------------

  it('lança ForbiddenError quando lead está fora do city scope', async () => {
    mockFindLeadForSimulation.mockResolvedValue(null);

    const { createSimulation } = await import('../service.js');
    const { ForbiddenError } = await import('../../../shared/errors.js');

    await expect(createSimulation(mockDb as never, ACTOR, BODY)).rejects.toThrow(ForbiddenError);
  });

  // -------------------------------------------------------------------------
  // 4. Produto inativo
  // -------------------------------------------------------------------------

  it('lança NotFoundError quando produto não está ativo', async () => {
    mockFindActiveProduct.mockResolvedValue(null);

    const { createSimulation } = await import('../service.js');
    const { NotFoundError } = await import('../../../shared/errors.js');

    await expect(createSimulation(mockDb as never, ACTOR, BODY)).rejects.toThrow(NotFoundError);
  });

  // -------------------------------------------------------------------------
  // 5. Sem regra para a cidade
  // -------------------------------------------------------------------------

  it('lança NoActiveRuleForCityError quando não há regra para a cidade do lead', async () => {
    mockFindActiveRuleForCity.mockResolvedValue(null);

    const { createSimulation, NoActiveRuleForCityError } = await import('../service.js');

    await expect(createSimulation(mockDb as never, ACTOR, BODY)).rejects.toThrow(
      NoActiveRuleForCityError,
    );
  });

  // -------------------------------------------------------------------------
  // 6. Amount abaixo do mínimo
  // -------------------------------------------------------------------------

  it('lança SimulationOutOfRangError quando amount < min_amount da regra', async () => {
    const { createSimulation, SimulationOutOfRangError } = await import('../service.js');

    await expect(createSimulation(mockDb as never, ACTOR, { ...BODY, amount: 50 })).rejects.toThrow(
      SimulationOutOfRangError,
    );
  });

  // -------------------------------------------------------------------------
  // 7. Amount acima do máximo
  // -------------------------------------------------------------------------

  it('lança SimulationOutOfRangError quando amount > max_amount da regra', async () => {
    const { createSimulation, SimulationOutOfRangError } = await import('../service.js');

    await expect(
      createSimulation(mockDb as never, ACTOR, { ...BODY, amount: 99999 }),
    ).rejects.toThrow(SimulationOutOfRangError);
  });

  // -------------------------------------------------------------------------
  // 8. termMonths abaixo do mínimo
  // -------------------------------------------------------------------------

  it('lança SimulationOutOfRangError quando termMonths < min_term_months da regra', async () => {
    const { createSimulation, SimulationOutOfRangError } = await import('../service.js');

    await expect(
      createSimulation(mockDb as never, ACTOR, { ...BODY, termMonths: 1 }),
    ).rejects.toThrow(SimulationOutOfRangError);
  });

  // -------------------------------------------------------------------------
  // 9. termMonths acima do máximo
  // -------------------------------------------------------------------------

  it('lança SimulationOutOfRangError quando termMonths > max_term_months da regra', async () => {
    const { createSimulation, SimulationOutOfRangError } = await import('../service.js');

    await expect(
      createSimulation(mockDb as never, ACTOR, { ...BODY, termMonths: 48 }),
    ).rejects.toThrow(SimulationOutOfRangError);
  });

  // -------------------------------------------------------------------------
  // 10. Calculator chamado com rate snapshot correto
  // -------------------------------------------------------------------------

  it('chama calculator com monthlyRate correto do snapshot da regra', async () => {
    mockFindActiveRuleForCity.mockResolvedValue(makeRule({ monthlyRate: '0.030000' }));

    const { createSimulation } = await import('../service.js');
    await createSimulation(mockDb as never, ACTOR, BODY);

    expect(mockCalculate).toHaveBeenCalledWith(expect.objectContaining({ monthlyRate: 0.03 }));
  });

  // -------------------------------------------------------------------------
  // 11. Atomicidade: INSERT + updateLead + updateCard + emit + audit
  // -------------------------------------------------------------------------

  it('chama insertSimulation, updateLead, updateCard, emit e auditLog na transação', async () => {
    const { createSimulation } = await import('../service.js');
    await createSimulation(mockDb as never, ACTOR, BODY);

    expect(mockInsertSimulation).toHaveBeenCalledOnce();
    expect(mockUpdateLeadLastSimulation).toHaveBeenCalledWith(
      expect.anything(),
      FIXTURE_LEAD_ID,
      FIXTURE_SIMULATION_ID,
    );
    expect(mockUpdateKanbanCardLastSimulation).toHaveBeenCalledWith(
      expect.anything(),
      FIXTURE_LEAD_ID,
      FIXTURE_SIMULATION_ID,
    );
    expect(mockEmit).toHaveBeenCalledOnce();
    expect(mockAuditLog).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // 12. Outbox payload sem PII
  // -------------------------------------------------------------------------

  it('emite outbox simulations.generated sem PII — apenas IDs e números', async () => {
    const { createSimulation } = await import('../service.js');
    await createSimulation(mockDb as never, ACTOR, BODY);

    const [, emitArgs] = mockEmit.mock.calls[0] as [
      unknown,
      { eventName: string; data: Record<string, unknown> },
    ];
    expect(emitArgs.eventName).toBe('simulations.generated');

    const data = emitArgs.data;
    // Deve conter IDs e números — não deve conter campos PII
    expect(data).toHaveProperty('simulation_id');
    expect(data).toHaveProperty('lead_id');
    expect(data).toHaveProperty('product_id');
    expect(data).toHaveProperty('rule_version_id');
    expect(data).toHaveProperty('amount');
    expect(data).toHaveProperty('term_months');
    expect(data).toHaveProperty('monthly_payment');
    // Garante ausência de PII
    expect(data).not.toHaveProperty('name');
    expect(data).not.toHaveProperty('phone');
    expect(data).not.toHaveProperty('email');
    expect(data).not.toHaveProperty('cpf');
  });

  // -------------------------------------------------------------------------
  // 13. origin='ai' para F2-S05 reuso
  // -------------------------------------------------------------------------

  it('aceita origin=ai (reuso por F2-S05) e não popula created_by_user_id', async () => {
    mockInsertSimulation.mockResolvedValue(
      makeSimulationDbRow({ origin: 'ai', createdByUserId: null }),
    );

    const { createSimulation } = await import('../service.js');
    const result = await createSimulation(mockDb as never, ACTOR, BODY, {
      origin: 'ai',
    });

    expect(result.origin).toBe('ai');
    expect(result.created_by_user_id).toBeNull();

    // Verifica que insertSimulation recebeu createdByUserId null
    const insertCall = mockInsertSimulation.mock.calls[0] as [
      unknown,
      { createdByUserId: unknown },
    ];
    expect(insertCall[1].createdByUserId).toBeNull();
  });
});
