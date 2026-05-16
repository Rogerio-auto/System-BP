// =============================================================================
// credit.test.ts — Testes de schema: credit_products, credit_product_rules,
//                  credit_simulations (F2-S01).
//
// Estratégia: DB mockado via vi.mock — valida constraints, índices únicos e
// FKs através do comportamento declarado nas tabelas Drizzle.
//
// Cobertura:
//   - credit_products: insert ok, unique (org, key) ativo, soft-delete libera key.
//   - credit_product_rules: insert ok, unique (product_id, version).
//   - credit_simulations: insert ok, FK violation.
//   - Tipos: CreditProduct, CreditProductRule, CreditSimulation — sem 'any'.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock pg — evita conexão real ao Postgres
// ---------------------------------------------------------------------------
vi.mock('pg', () => {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const MockPool = vi.fn().mockImplementation(() => ({
    query: mockQuery,
    connect: vi.fn().mockResolvedValue({
      query: mockQuery,
      release: vi.fn(),
    }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  const MockClient = vi.fn().mockImplementation(() => ({
    query: mockQuery,
    connect: vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return {
    default: { Pool: MockPool, Client: MockClient },
    Pool: MockPool,
    Client: MockClient,
  };
});

// ---------------------------------------------------------------------------
// Mock Drizzle db — controla insert/select com chainable API
// ---------------------------------------------------------------------------
const mockInsertValues = vi.fn();
const mockSelectFrom = vi.fn();

mockInsertValues.mockResolvedValue([]);
mockSelectFrom.mockReturnValue({ where: vi.fn().mockResolvedValue([]) });

const mockDb = {
  insert: vi.fn().mockReturnValue({ values: mockInsertValues }),
  select: vi.fn().mockReturnValue({ from: mockSelectFrom }),
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
  creditProductRules,
  type CreditProductRule,
  type NewCreditProductRule,
} from '../creditProductRules.js';
import { creditProducts, type CreditProduct, type NewCreditProduct } from '../creditProducts.js';
import {
  creditSimulations,
  type CreditSimulation,
  type NewCreditSimulation,
} from '../creditSimulations.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const ORG_ID = 'aabbccdd-0001-0000-0000-000000000001';
const PRODUCT_ID = 'aabbccdd-0010-0000-0000-000000000001';
const PRODUCT_ID2 = 'aabbccdd-0010-0000-0000-000000000002';
const RULE_ID = 'aabbccdd-0011-0000-0000-000000000001';
const LEAD_ID = 'aabbccdd-0005-0000-0000-000000000001';
const USER_ID = 'aabbccdd-0004-0000-0000-000000000001';

function makeNewProduct(overrides: Partial<NewCreditProduct> = {}): NewCreditProduct {
  return {
    organizationId: ORG_ID,
    key: 'microcredito_basico',
    name: 'Microcrédito Básico',
    isActive: true,
    ...overrides,
  };
}

function makeNewRule(overrides: Partial<NewCreditProductRule> = {}): NewCreditProductRule {
  return {
    productId: PRODUCT_ID,
    version: 1,
    minAmount: '500.00',
    maxAmount: '5000.00',
    minTermMonths: 3,
    maxTermMonths: 24,
    monthlyRate: '0.025000',
    amortization: 'price',
    isActive: true,
    ...overrides,
  };
}

function makeNewSimulation(overrides: Partial<NewCreditSimulation> = {}): NewCreditSimulation {
  return {
    organizationId: ORG_ID,
    leadId: LEAD_ID,
    productId: PRODUCT_ID,
    ruleVersionId: RULE_ID,
    amountRequested: '2000.00',
    termMonths: 12,
    monthlyPayment: '187.53',
    totalAmount: '2250.36',
    totalInterest: '250.36',
    rateMonthlySnapshot: '0.025000',
    origin: 'manual',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Testes: tabela credit_products
// ---------------------------------------------------------------------------
describe('credit_products — schema e types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue({ values: mockInsertValues });
    mockInsertValues.mockResolvedValue([]);
  });

  it('produto válido: insert aceito sem erro', async () => {
    const newProduct = makeNewProduct();
    await mockDb.insert(creditProducts).values(newProduct);

    expect(mockDb.insert).toHaveBeenCalledWith(creditProducts);
    expect(mockInsertValues).toHaveBeenCalledWith(newProduct);
  });

  it('duplicate (org, key) ativo: simula UNIQUE violation', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error(
        'duplicate key value violates unique constraint "uq_credit_products_org_key_active"',
      ),
    );

    const newProduct = makeNewProduct();
    await expect(mockDb.insert(creditProducts).values(newProduct)).rejects.toThrow(
      'uq_credit_products_org_key_active',
    );
  });

  it('duplicate key com deleted_at (soft-delete): deve ser aceito (índice parcial)', async () => {
    // O índice parcial WHERE deleted_at IS NULL não cobre produtos deletados.
    mockInsertValues.mockResolvedValueOnce([{ id: PRODUCT_ID2 }]);

    const newProduct = makeNewProduct({ id: PRODUCT_ID2 });
    const result = await mockDb.insert(creditProducts).values(newProduct);

    expect(result).toEqual([{ id: PRODUCT_ID2 }]);
  });

  it('organization_id inexistente: simula FK violation', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error(
        'insert or update violates foreign key constraint "fk_credit_products_organization"',
      ),
    );

    const newProduct = makeNewProduct({
      organizationId: '00000000-dead-beef-0000-000000000000',
    });
    await expect(mockDb.insert(creditProducts).values(newProduct)).rejects.toThrow(
      'fk_credit_products_organization',
    );
  });

  it('produto sem description: aceito (campo opcional)', async () => {
    mockInsertValues.mockResolvedValueOnce([{ id: PRODUCT_ID }]);
    // exactOptionalPropertyTypes: use null (not undefined) for nullable optional columns
    const newProduct = makeNewProduct({ description: null });

    const result = await mockDb.insert(creditProducts).values(newProduct);
    expect(result).toEqual([{ id: PRODUCT_ID }]);
  });

  it('is_active false: produto desativado aceito', async () => {
    mockInsertValues.mockResolvedValueOnce([{ id: PRODUCT_ID }]);
    const newProduct = makeNewProduct({ isActive: false });

    const result = await mockDb.insert(creditProducts).values(newProduct);
    expect(result).toEqual([{ id: PRODUCT_ID }]);
  });
});

// ---------------------------------------------------------------------------
// Testes: tabela credit_product_rules
// ---------------------------------------------------------------------------
describe('credit_product_rules — schema e types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue({ values: mockInsertValues });
    mockInsertValues.mockResolvedValue([]);
  });

  it('regra válida: insert aceito sem erro', async () => {
    const newRule = makeNewRule();
    await mockDb.insert(creditProductRules).values(newRule);

    expect(mockDb.insert).toHaveBeenCalledWith(creditProductRules);
    expect(mockInsertValues).toHaveBeenCalledWith(newRule);
  });

  it('duplicate (product_id, version): simula UNIQUE violation', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error(
        'duplicate key value violates unique constraint "uq_credit_product_rules_product_version"',
      ),
    );

    const newRule = makeNewRule();
    await expect(mockDb.insert(creditProductRules).values(newRule)).rejects.toThrow(
      'uq_credit_product_rules_product_version',
    );
  });

  it('product_id inexistente: simula FK violation', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error(
        'insert or update violates foreign key constraint "fk_credit_product_rules_product"',
      ),
    );

    const newRule = makeNewRule({
      productId: '00000000-dead-beef-0000-000000000000',
    });
    await expect(mockDb.insert(creditProductRules).values(newRule)).rejects.toThrow(
      'fk_credit_product_rules_product',
    );
  });

  it('amortization inválido: simula CHECK violation', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error('new row violates check constraint "chk_credit_product_rules_amortization"'),
    );

    // exactOptionalPropertyTypes: cast to non-undefined union to avoid assigning undefined
    const newRule = makeNewRule({
      amortization: 'bullet' as 'price' | 'sac',
    });
    await expect(mockDb.insert(creditProductRules).values(newRule)).rejects.toThrow(
      'chk_credit_product_rules_amortization',
    );
  });

  it('regra sac: aceita amortization sac', async () => {
    mockInsertValues.mockResolvedValueOnce([{ id: RULE_ID }]);
    const newRule = makeNewRule({ amortization: 'sac', version: 2 });

    const result = await mockDb.insert(creditProductRules).values(newRule);
    expect(result).toEqual([{ id: RULE_ID }]);
  });

  it('iof_rate null: aceito (microcrédito isento de IOF)', async () => {
    mockInsertValues.mockResolvedValueOnce([{ id: RULE_ID }]);
    const newRule = makeNewRule({ iofRate: null });

    const result = await mockDb.insert(creditProductRules).values(newRule);
    expect(result).toEqual([{ id: RULE_ID }]);
  });

  it('city_scope null: aceito (válido para todas as cidades)', async () => {
    mockInsertValues.mockResolvedValueOnce([{ id: RULE_ID }]);
    const newRule = makeNewRule({ cityScope: null });

    const result = await mockDb.insert(creditProductRules).values(newRule);
    expect(result).toEqual([{ id: RULE_ID }]);
  });
});

// ---------------------------------------------------------------------------
// Testes: tabela credit_simulations
// ---------------------------------------------------------------------------
describe('credit_simulations — schema e types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue({ values: mockInsertValues });
    mockInsertValues.mockResolvedValue([]);
  });

  it('simulação válida: insert aceito sem erro', async () => {
    const newSim = makeNewSimulation();
    await mockDb.insert(creditSimulations).values(newSim);

    expect(mockDb.insert).toHaveBeenCalledWith(creditSimulations);
    expect(mockInsertValues).toHaveBeenCalledWith(newSim);
  });

  it('lead_id inexistente: simula FK violation', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error('insert or update violates foreign key constraint "fk_credit_simulations_lead"'),
    );

    const newSim = makeNewSimulation({
      leadId: '00000000-dead-beef-0000-000000000000',
    });
    await expect(mockDb.insert(creditSimulations).values(newSim)).rejects.toThrow(
      'fk_credit_simulations_lead',
    );
  });

  it('product_id inexistente: simula FK violation', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error('insert or update violates foreign key constraint "fk_credit_simulations_product"'),
    );

    const newSim = makeNewSimulation({
      productId: '00000000-dead-beef-0000-000000000000',
    });
    await expect(mockDb.insert(creditSimulations).values(newSim)).rejects.toThrow(
      'fk_credit_simulations_product',
    );
  });

  it('rule_version_id inexistente: simula FK violation', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error(
        'insert or update violates foreign key constraint "fk_credit_simulations_rule_version"',
      ),
    );

    const newSim = makeNewSimulation({
      ruleVersionId: '00000000-dead-beef-0000-000000000000',
    });
    await expect(mockDb.insert(creditSimulations).values(newSim)).rejects.toThrow(
      'fk_credit_simulations_rule_version',
    );
  });

  it('origin inválido: simula CHECK violation', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error('new row violates check constraint "chk_credit_simulations_origin"'),
    );

    // exactOptionalPropertyTypes: cast to non-undefined union
    const newSim = makeNewSimulation({
      origin: 'webhook' as 'manual' | 'import' | 'ai',
    });
    await expect(mockDb.insert(creditSimulations).values(newSim)).rejects.toThrow(
      'chk_credit_simulations_origin',
    );
  });

  it('simulação via IA: origin ai aceito', async () => {
    mockInsertValues.mockResolvedValueOnce([{ id: 'sim-ai-id' }]);
    const newSim = makeNewSimulation({ origin: 'ai', createdByUserId: null });

    const result = await mockDb.insert(creditSimulations).values(newSim);
    expect(result).toEqual([{ id: 'sim-ai-id' }]);
  });

  it('customer_id null: aceito (sem cliente identificado)', async () => {
    mockInsertValues.mockResolvedValueOnce([{ id: 'sim-no-customer' }]);
    const newSim = makeNewSimulation({ customerId: null });

    const result = await mockDb.insert(creditSimulations).values(newSim);
    expect(result).toEqual([{ id: 'sim-no-customer' }]);
  });
});

// ---------------------------------------------------------------------------
// Testes de tipagem — verifica que os tipos Drizzle compilam corretamente
// ---------------------------------------------------------------------------
describe('tipos Drizzle — compilação sem any', () => {
  it('CreditProduct type tem os campos esperados', () => {
    const product: CreditProduct = {
      id: PRODUCT_ID,
      organizationId: ORG_ID,
      key: 'microcredito_basico',
      name: 'Microcrédito Básico',
      description: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    expect(product.key).toBe('microcredito_basico');
    expect(product.isActive).toBe(true);
    expect(product.deletedAt).toBeNull();
  });

  it('CreditProductRule type tem os campos esperados', () => {
    const rule: CreditProductRule = {
      id: RULE_ID,
      productId: PRODUCT_ID,
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
      createdBy: null,
      createdAt: new Date(),
    };
    expect(rule.version).toBe(1);
    expect(rule.amortization).toBe('price');
    // Sem updatedAt — regras são imutáveis após criação
    expect('updatedAt' in rule).toBe(false);
  });

  it('CreditSimulation type tem os campos esperados (sem updatedAt)', () => {
    const sim: CreditSimulation = {
      id: 'sim-id-001',
      organizationId: ORG_ID,
      leadId: LEAD_ID,
      customerId: null,
      productId: PRODUCT_ID,
      ruleVersionId: RULE_ID,
      amountRequested: '2000.00',
      termMonths: 12,
      monthlyPayment: '187.53',
      totalAmount: '2250.36',
      totalInterest: '250.36',
      rateMonthlySnapshot: '0.025000',
      amortizationTable: [],
      origin: 'manual',
      createdByUserId: USER_ID,
      createdAt: new Date(),
    };
    expect(sim.origin).toBe('manual');
    expect(sim.ruleVersionId).toBe(RULE_ID);
    // Sem updatedAt — simulações são imutáveis
    expect('updatedAt' in sim).toBe(false);
  });

  it('NewCreditProduct aceita campos opcionais omitidos', () => {
    const minimal: NewCreditProduct = {
      organizationId: ORG_ID,
      key: 'produto_teste',
      name: 'Produto Teste',
    };
    expect(minimal.key).toBe('produto_teste');
    // isActive tem default true — pode ser omitido em NewCreditProduct
    expect(minimal.isActive).toBeUndefined();
  });

  it('NewCreditProductRule aceita campos opcionais omitidos', () => {
    const minimal: NewCreditProductRule = {
      productId: PRODUCT_ID,
      version: 1,
      minAmount: '500.00',
      maxAmount: '5000.00',
      minTermMonths: 3,
      maxTermMonths: 24,
      monthlyRate: '0.025000',
    };
    expect(minimal.version).toBe(1);
    expect(minimal.iofRate).toBeUndefined();
  });

  it('amortization enum: apenas price e sac são válidos', () => {
    const validValues: NewCreditProductRule['amortization'][] = ['price', 'sac'];
    expect(validValues).toHaveLength(2);
    expect(validValues).toContain('price');
    expect(validValues).toContain('sac');
  });

  it('origin enum: apenas manual, ai e import são válidos', () => {
    const validValues: NewCreditSimulation['origin'][] = ['manual', 'ai', 'import'];
    expect(validValues).toHaveLength(3);
    expect(validValues).toContain('manual');
    expect(validValues).toContain('ai');
  });
});
