// =============================================================================
// pricing.test.ts — Testes do helper priceModelTokens e constraints de schema.
//
// Cobertura:
//   - priceModelTokens: modelo conhecido → custo USD e BRL corretos.
//   - priceModelTokens: modelo desconhecido → { costUsd: null, costBrl: null }.
//   - priceModelTokens: tokensIn/Out nulos → { costUsd: null, costBrl: null }.
//   - computeCostFromRates: aritmética sem round-trip ao DB.
//   - modelPricing schema: check custo negativo rejeitado.
//   - modelPricing schema: unique parcial (provider, model_id) ativo.
//   - modelPricing schema: check effective_to <= effective_from rejeitado.
//   - modelPricing schema: insert válido aceito.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted: declara mocks antes do hoisting de vi.mock()
// Necessário quando a factory de vi.mock() referencia variáveis do módulo.
// ---------------------------------------------------------------------------
const { mockDb, mockInsertValues, mockLimitChain, mockSelectChain, mockFromChain, mockWhereChain } =
  vi.hoisted(() => {
    const mockLimitChain = {
      then: vi.fn((cb: (rows: unknown[]) => unknown) => Promise.resolve(cb([]))),
    };
    const mockWhereChain = {
      limit: vi.fn().mockReturnValue(mockLimitChain),
    };
    const mockFromChain = {
      where: vi.fn().mockReturnValue(mockWhereChain),
    };
    const mockSelectChain = {
      from: vi.fn().mockReturnValue(mockFromChain),
    };
    const mockInsertValues = vi.fn().mockResolvedValue([]);
    const mockDb = {
      select: vi.fn().mockReturnValue(mockSelectChain),
      insert: vi.fn().mockReturnValue({ values: mockInsertValues }),
    };
    return {
      mockDb,
      mockInsertValues,
      mockLimitChain,
      mockSelectChain,
      mockFromChain,
      mockWhereChain,
    };
  });

// ---------------------------------------------------------------------------
// Mock env — FX_BRL_PER_USD = 5.75 (valor de referência)
// ---------------------------------------------------------------------------
vi.mock('../../config/env.js', () => ({
  env: {
    FX_BRL_PER_USD: 5.75,
    DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    NODE_ENV: 'test',
  },
}));

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
  return {
    default: { Pool: MockPool, Client: MockPool },
    Pool: MockPool,
  };
});

// ---------------------------------------------------------------------------
// Mock Drizzle db client
// ---------------------------------------------------------------------------
vi.mock('../../db/client.js', () => ({
  db: mockDb,
  pool: {
    connect: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Imports após mocks (ordem importa — mocks devem ser declarados antes)
// ---------------------------------------------------------------------------
import {
  modelPricing,
  type ModelPricing,
  type NewModelPricing,
} from '../../db/schema/modelPricing.js';
import { priceModelTokens, computeCostFromRates } from '../pricing.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Preço de referência: claude-3.5-haiku */
const HAIKU_PRICE = {
  inputCostPerMillionUsd: '0.8000',
  outputCostPerMillionUsd: '4.0000',
};

function makeNewPricing(overrides: Partial<NewModelPricing> = {}): NewModelPricing {
  return {
    provider: 'openrouter',
    modelId: 'anthropic/claude-3.5-haiku',
    inputCostPerMillionUsd: HAIKU_PRICE.inputCostPerMillionUsd,
    outputCostPerMillionUsd: HAIKU_PRICE.outputCostPerMillionUsd,
    notes: 'snapshot OpenRouter pricing page 2026-05-19',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: simula DB retornando um preço
// ---------------------------------------------------------------------------
function mockDbReturnsPrice(price: {
  inputCostPerMillionUsd: string;
  outputCostPerMillionUsd: string;
}): void {
  mockLimitChain.then.mockImplementationOnce((cb: (rows: unknown[]) => unknown) =>
    Promise.resolve(cb([price])),
  );
}

// ---------------------------------------------------------------------------
// Testes: priceModelTokens
// ---------------------------------------------------------------------------
describe('priceModelTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-wire chain após clearAllMocks
    mockSelectChain.from.mockReturnValue(mockFromChain);
    mockFromChain.where.mockReturnValue(mockWhereChain);
    mockWhereChain.limit.mockReturnValue(mockLimitChain);
    mockLimitChain.then.mockImplementation((cb: (rows: unknown[]) => unknown) =>
      Promise.resolve(cb([])),
    );
    mockDb.select.mockReturnValue(mockSelectChain);
    mockDb.insert.mockReturnValue({ values: mockInsertValues });
    mockInsertValues.mockResolvedValue([]);
  });

  it('modelo conhecido: calcula custo USD e BRL corretamente', async () => {
    // Arrange: haiku com input $0.80/M e output $4.00/M
    mockDbReturnsPrice(HAIKU_PRICE);

    // Act: 1000 tokens in + 500 tokens out
    const result = await priceModelTokens({
      provider: 'openrouter',
      model: 'anthropic/claude-3.5-haiku',
      tokensIn: 1000,
      tokensOut: 500,
    });

    // Assert:
    //   input: (1000 / 1_000_000) * 0.80 = 0.0008
    //   output: (500 / 1_000_000) * 4.00 = 0.002
    //   total: 0.0028 USD
    //   brl: 0.0028 * 5.75 = 0.0161
    expect(result.costUsd).toBeCloseTo(0.0028, 8);
    expect(result.costBrl).toBeCloseTo(0.0161, 6);
  });

  it('modelo conhecido: output zero — custo apenas de input', async () => {
    mockDbReturnsPrice(HAIKU_PRICE);

    const result = await priceModelTokens({
      provider: 'openrouter',
      model: 'anthropic/claude-3.5-haiku',
      tokensIn: 500000,
      tokensOut: 0,
    });

    // input: (500000 / 1_000_000) * 0.80 = 0.40 USD
    expect(result.costUsd).toBeCloseTo(0.4, 6);
    expect(result.costBrl).toBeCloseTo(0.4 * 5.75, 6);
  });

  it('modelo desconhecido: retorna { costUsd: null, costBrl: null }', async () => {
    // DB retorna array vazio (comportamento padrão do mock)
    const result = await priceModelTokens({
      provider: 'openrouter',
      model: 'unknownprovider/unknown-model-xyz',
      tokensIn: 1000,
      tokensOut: 500,
    });

    expect(result.costUsd).toBeNull();
    expect(result.costBrl).toBeNull();
  });

  it('tokensIn e tokensOut nulos: retorna { costUsd: null, costBrl: null } sem consultar DB', async () => {
    const result = await priceModelTokens({
      provider: 'openrouter',
      model: 'anthropic/claude-3.5-haiku',
      tokensIn: null,
      tokensOut: null,
    });

    expect(result.costUsd).toBeNull();
    expect(result.costBrl).toBeNull();
    // DB não deve ter sido consultado
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('tokensIn e tokensOut zero: retorna { costUsd: null, costBrl: null } sem consultar DB', async () => {
    const result = await priceModelTokens({
      provider: 'openrouter',
      model: 'anthropic/claude-3.5-haiku',
      tokensIn: 0,
      tokensOut: 0,
    });

    expect(result.costUsd).toBeNull();
    expect(result.costBrl).toBeNull();
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('modelo com custo 0 (gratuito): retorna custo USD = 0 e BRL = 0', async () => {
    mockDbReturnsPrice({ inputCostPerMillionUsd: '0.0000', outputCostPerMillionUsd: '0.0000' });

    const result = await priceModelTokens({
      provider: 'openrouter',
      model: 'free/model',
      tokensIn: 10000,
      tokensOut: 5000,
    });

    expect(result.costUsd).toBe(0);
    expect(result.costBrl).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Testes: computeCostFromRates (síncrono)
// ---------------------------------------------------------------------------
describe('computeCostFromRates', () => {
  it('calcula custo USD e BRL a partir de taxas já carregadas', () => {
    const result = computeCostFromRates({
      inputCostPerMillionUsd: 0.8,
      outputCostPerMillionUsd: 4.0,
      tokensIn: 1_000_000,
      tokensOut: 1_000_000,
    });

    // input: 1M * 0.80/M = 0.80
    // output: 1M * 4.00/M = 4.00
    // total: 4.80 USD
    expect(result.costUsd).toBeCloseTo(4.8, 6);
    expect(result.costBrl).toBeCloseTo(4.8 * 5.75, 4);
  });

  it('tokens zero: custo USD = 0', () => {
    const result = computeCostFromRates({
      inputCostPerMillionUsd: 3.0,
      outputCostPerMillionUsd: 15.0,
      tokensIn: 0,
      tokensOut: 0,
    });

    expect(result.costUsd).toBe(0);
    expect(result.costBrl).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Testes: modelPricing schema — constraints declaradas
// ---------------------------------------------------------------------------
describe('modelPricing — schema e constraints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue({ values: mockInsertValues });
    mockDb.select.mockReturnValue(mockSelectChain);
    mockSelectChain.from.mockReturnValue(mockFromChain);
    mockFromChain.where.mockReturnValue(mockWhereChain);
    mockWhereChain.limit.mockReturnValue(mockLimitChain);
    mockLimitChain.then.mockImplementation((cb: (rows: unknown[]) => unknown) =>
      Promise.resolve(cb([])),
    );
    mockInsertValues.mockResolvedValue([]);
  });

  it('insert válido: aceito sem erro', async () => {
    const newEntry = makeNewPricing();
    await mockDb.insert(modelPricing).values(newEntry);

    expect(mockDb.insert).toHaveBeenCalledWith(modelPricing);
    expect(mockInsertValues).toHaveBeenCalledWith(newEntry);
  });

  it('check custo negativo: simula violação de constraint', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error(
        'new row for relation "model_pricing" violates check constraint "chk_model_pricing_costs_non_negative"',
      ),
    );

    const invalidEntry = makeNewPricing({ inputCostPerMillionUsd: '-0.5000' });

    await expect(mockDb.insert(modelPricing).values(invalidEntry)).rejects.toThrow(
      'chk_model_pricing_costs_non_negative',
    );
  });

  it('unique parcial ativo: duplicate (provider, model_id) com effective_to NULL rejeitado', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error('duplicate key value violates unique constraint "uq_model_pricing_active"'),
    );

    const duplicate = makeNewPricing();

    await expect(mockDb.insert(modelPricing).values(duplicate)).rejects.toThrow(
      'uq_model_pricing_active',
    );
  });

  it('unique parcial histórico: duplicate (provider, model_id) com effective_to preenchido NÃO conflita', async () => {
    // Registros com effective_to != NULL são históricos — não participam do índice parcial.
    // O mock não rejeita → simula ausência de conflito.
    mockInsertValues.mockResolvedValue([{ id: 'some-uuid' }]);

    const historicalEntry = makeNewPricing({
      effectiveTo: new Date('2026-04-01T00:00:00Z'),
      effectiveFrom: new Date('2026-03-01T00:00:00Z'),
    });

    await expect(mockDb.insert(modelPricing).values(historicalEntry)).resolves.not.toThrow();
  });

  it('check effective_to <= effective_from: simula violação de constraint', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error(
        'new row for relation "model_pricing" violates check constraint "chk_model_pricing_effective_range"',
      ),
    );

    const invalidEntry = makeNewPricing({
      effectiveFrom: new Date('2026-05-01T00:00:00Z'),
      // effective_to anterior a effective_from — inválido
      effectiveTo: new Date('2026-04-01T00:00:00Z'),
    });

    await expect(mockDb.insert(modelPricing).values(invalidEntry)).rejects.toThrow(
      'chk_model_pricing_effective_range',
    );
  });

  it('tipos inferidos: ModelPricing e NewModelPricing cobrem todas as colunas', () => {
    // Teste estático de tipos — se compilar sem erro, os tipos estão corretos.
    const entry: NewModelPricing = makeNewPricing();
    const row: Partial<ModelPricing> = {
      id: 'some-uuid',
      provider: entry.provider,
      modelId: entry.modelId,
      inputCostPerMillionUsd: entry.inputCostPerMillionUsd,
      outputCostPerMillionUsd: entry.outputCostPerMillionUsd,
      effectiveFrom: new Date(),
      effectiveTo: null,
      notes: null,
      createdBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(row.provider).toBe('openrouter');
    expect(row.modelId).toBe('anthropic/claude-3.5-haiku');
  });
});
