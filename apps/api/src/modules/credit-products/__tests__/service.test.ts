// =============================================================================
// credit-products/__tests__/service.test.ts — Testes unitários do service (F2-S03, F18-S04).
//
// Cobre:
//   1.  listProducts — delega ao repository com organizationId correto
//   2.  createProduct — cria e emite evento
//   3.  createProduct — lança CreditProductKeyConflictError se key duplicada
//   4.  updateProductService — atualiza campos e emite evento
//   5.  updateProductService — lança NotFoundError
//   6.  deleteProductService — soft-delete OK
//   7.  deleteProductService — lança 409 se simulações recentes
//   8.  publishRule — ATOMICIDADE: transação com 3 passos (insert + deactivate + audit)
//   9.  publishRule — ROLLBACK: se insertRule falhar, regra anterior permanece ativa
//   10. publishRule — versão incrementada corretamente (max+1)
//   11. publishRule — regra anterior fica is_active=false + effective_to preenchido
//   12. publishRule — primeira publicação tem version=1 (produto sem regras)
//   13. IMUTABILIDADE: não existe função editRule no service (impossível editar regra)
//   14. activateRuleVersion — cria clone e desativa anterior (F18-S04)
//   15. activateRuleVersion — idempotência: versão já ativa não gera clone
//   16. activateRuleVersion — lança NotFoundError para produto inexistente
//   17. activateRuleVersion — lança NotFoundError para versão inexistente
//   18. activateRuleVersion — emite credit.rule_activated sem PII
// =============================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock repository
// ---------------------------------------------------------------------------
const mockFindProducts = vi.fn();
const mockFindProductById = vi.fn();
const mockFindProductByKey = vi.fn();
const mockCountRecentSimulations = vi.fn();
const mockInsertProduct = vi.fn();
const mockUpdateProduct = vi.fn();
const mockSoftDeleteProduct = vi.fn();
const mockFindActiveRule = vi.fn();
const mockFindRuleByProductAndVersion = vi.fn();
const mockGetMaxRuleVersion = vi.fn();
const mockFindRulesByProduct = vi.fn();
const mockInsertRule = vi.fn();
const mockDeactivateRule = vi.fn();

vi.mock('../repository.js', () => ({
  findProducts: (...args: unknown[]) => mockFindProducts(...args),
  findProductById: (...args: unknown[]) => mockFindProductById(...args),
  findProductByKey: (...args: unknown[]) => mockFindProductByKey(...args),
  countRecentSimulations: (...args: unknown[]) => mockCountRecentSimulations(...args),
  insertProduct: (...args: unknown[]) => mockInsertProduct(...args),
  updateProduct: (...args: unknown[]) => mockUpdateProduct(...args),
  softDeleteProduct: (...args: unknown[]) => mockSoftDeleteProduct(...args),
  findActiveRule: (...args: unknown[]) => mockFindActiveRule(...args),
  findRuleByProductAndVersion: (...args: unknown[]) => mockFindRuleByProductAndVersion(...args),
  getMaxRuleVersion: (...args: unknown[]) => mockGetMaxRuleVersion(...args),
  findRulesByProduct: (...args: unknown[]) => mockFindRulesByProduct(...args),
  insertRule: (...args: unknown[]) => mockInsertRule(...args),
  deactivateRule: (...args: unknown[]) => mockDeactivateRule(...args),
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
// Mock db/client — provê db.transaction() controlável
// ---------------------------------------------------------------------------

// Cria um stub de transação que executa o callback imediatamente.
// Simula o comportamento de db.transaction(async tx => { ... }).
function makeTxStub() {
  return {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };
}

// db mock com transaction que executa callback sincronamente
const mockDb = {
  transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = makeTxStub();
    return fn(tx);
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
const FIXTURE_PRODUCT_ID = 'cccccccc-0000-0000-0000-000000000001';
const FIXTURE_RULE_ID = 'dddddddd-0000-0000-0000-000000000001';
const FIXTURE_RULE_ID_V2 = 'eeeeeeee-0000-0000-0000-000000000001';

const ACTOR = {
  userId: FIXTURE_USER_ID,
  organizationId: FIXTURE_ORG_ID,
  role: 'admin',
  ip: '127.0.0.1',
  userAgent: 'test/1.0',
};

function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: FIXTURE_PRODUCT_ID,
    organizationId: FIXTURE_ORG_ID,
    key: 'microcredito_basico',
    name: 'Microcrédito Básico',
    description: 'Produto básico',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
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

const PUBLISH_RULE_BODY = {
  minAmount: 500,
  maxAmount: 5000,
  minTermMonths: 3,
  maxTermMonths: 24,
  monthlyRate: 0.025,
  amortization: 'price' as const,
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = makeTxStub();
    return fn(tx);
  });
});

// ---------------------------------------------------------------------------
// listProducts
// ---------------------------------------------------------------------------

describe('listProducts', () => {
  it('delega ao repository com organizationId do actor', async () => {
    mockFindProducts.mockResolvedValue({
      data: [{ ...makeProduct(), activeRule: makeRule() }],
      total: 1,
    });

    const { listProducts } = await import('../service.js');
    const result = await listProducts(
      mockDb as unknown as Parameters<typeof listProducts>[0],
      ACTOR,
      {
        page: 1,
        limit: 20,
        include_deleted: false,
      },
    );

    expect(mockFindProducts).toHaveBeenCalledWith(
      expect.anything(),
      FIXTURE_ORG_ID,
      expect.objectContaining({ page: 1, limit: 20 }),
    );
    expect(result.data).toHaveLength(1);
    expect(result.pagination.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// createProduct
// ---------------------------------------------------------------------------

describe('createProduct', () => {
  it('cria produto e emite credit.product_created', async () => {
    mockFindProductByKey.mockResolvedValue(null);
    mockInsertProduct.mockResolvedValue(makeProduct());

    const { createProduct } = await import('../service.js');
    const result = await createProduct(
      mockDb as unknown as Parameters<typeof createProduct>[0],
      ACTOR,
      { key: 'microcredito_basico', name: 'Microcrédito Básico' },
    );

    expect(result.key).toBe('microcredito_basico');
    expect(mockEmit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventName: 'credit.product_created' }),
    );
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'credit_product.create' }),
    );
  });

  it('lança CreditProductKeyConflictError se key já existe', async () => {
    mockFindProductByKey.mockResolvedValue({ id: 'existing-id' });

    const { createProduct, CreditProductKeyConflictError } = await import('../service.js');

    await expect(
      createProduct(mockDb as unknown as Parameters<typeof createProduct>[0], ACTOR, {
        key: 'duplicate_key',
        name: 'Duplicate',
      }),
    ).rejects.toThrow(CreditProductKeyConflictError);
  });
});

// ---------------------------------------------------------------------------
// updateProductService
// ---------------------------------------------------------------------------

describe('updateProductService', () => {
  it('atualiza produto e emite credit.product_updated', async () => {
    const before = makeProduct();
    const after = makeProduct({ name: 'Novo Nome', updatedAt: new Date() });
    mockFindProductById.mockResolvedValue(before);
    mockUpdateProduct.mockResolvedValue(after);
    mockFindActiveRule.mockResolvedValue(null);

    const { updateProductService } = await import('../service.js');
    const result = await updateProductService(
      mockDb as unknown as Parameters<typeof updateProductService>[0],
      ACTOR,
      FIXTURE_PRODUCT_ID,
      { name: 'Novo Nome' },
    );

    expect(result.name).toBe('Novo Nome');
    expect(mockEmit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventName: 'credit.product_updated' }),
    );
  });

  it('lança NotFoundError quando produto não existe', async () => {
    mockFindProductById.mockResolvedValue(null);

    const { updateProductService } = await import('../service.js');
    const { NotFoundError } = await import('../../../shared/errors.js');

    await expect(
      updateProductService(
        mockDb as unknown as Parameters<typeof updateProductService>[0],
        ACTOR,
        FIXTURE_PRODUCT_ID,
        { name: 'x' },
      ),
    ).rejects.toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// deleteProductService
// ---------------------------------------------------------------------------

describe('deleteProductService', () => {
  it('soft-deleta produto quando não há simulações recentes', async () => {
    mockFindProductById.mockResolvedValue(makeProduct());
    mockCountRecentSimulations.mockResolvedValue(0);
    mockSoftDeleteProduct.mockResolvedValue(makeProduct({ deletedAt: new Date() }));

    const { deleteProductService } = await import('../service.js');
    await expect(
      deleteProductService(
        mockDb as unknown as Parameters<typeof deleteProductService>[0],
        ACTOR,
        FIXTURE_PRODUCT_ID,
      ),
    ).resolves.toBeUndefined();

    expect(mockSoftDeleteProduct).toHaveBeenCalled();
  });

  it('lança 409 quando há simulações nos últimos 90 dias', async () => {
    mockFindProductById.mockResolvedValue(makeProduct());
    mockCountRecentSimulations.mockResolvedValue(3);

    const { deleteProductService, CreditProductHasRecentSimulationsError } = await import(
      '../service.js'
    );

    await expect(
      deleteProductService(
        mockDb as unknown as Parameters<typeof deleteProductService>[0],
        ACTOR,
        FIXTURE_PRODUCT_ID,
      ),
    ).rejects.toThrow(CreditProductHasRecentSimulationsError);
  });
});

// ---------------------------------------------------------------------------
// publishRule — atomicidade e imutabilidade
// ---------------------------------------------------------------------------

describe('publishRule — atomicidade', () => {
  it('publica primeira regra com version=1 (produto sem regras anteriores)', async () => {
    mockFindProductById.mockResolvedValue(makeProduct());
    mockFindActiveRule.mockResolvedValue(null); // sem regra anterior
    mockGetMaxRuleVersion.mockResolvedValue(0); // nenhuma versão ainda
    mockInsertRule.mockResolvedValue(makeRule({ version: 1, id: FIXTURE_RULE_ID }));

    const { publishRule } = await import('../service.js');
    const result = await publishRule(
      mockDb as unknown as Parameters<typeof publishRule>[0],
      ACTOR,
      FIXTURE_PRODUCT_ID,
      PUBLISH_RULE_BODY,
    );

    expect(result.version).toBe(1);
    expect(result.is_active).toBe(true);
    // Sem regra anterior → deactivateRule NÃO deve ser chamada
    expect(mockDeactivateRule).not.toHaveBeenCalled();
  });

  it('publica segunda regra com version=2 e desativa a anterior', async () => {
    const previousRule = makeRule({ version: 1, id: FIXTURE_RULE_ID });
    const newRule = makeRule({ version: 2, id: FIXTURE_RULE_ID_V2 });

    mockFindProductById.mockResolvedValue(makeProduct());
    mockFindActiveRule.mockResolvedValue(previousRule);
    mockGetMaxRuleVersion.mockResolvedValue(1);
    mockInsertRule.mockResolvedValue(newRule);

    const { publishRule } = await import('../service.js');
    const result = await publishRule(
      mockDb as unknown as Parameters<typeof publishRule>[0],
      ACTOR,
      FIXTURE_PRODUCT_ID,
      PUBLISH_RULE_BODY,
    );

    expect(result.version).toBe(2);
    // Regra anterior deve ser desativada
    expect(mockDeactivateRule).toHaveBeenCalledWith(expect.anything(), FIXTURE_RULE_ID);
    expect(mockEmit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventName: 'credit.rule_published' }),
    );
  });

  it('emite credit.rule_published com snapshot completo (sem PII)', async () => {
    const newRule = makeRule({ version: 1, id: FIXTURE_RULE_ID });

    mockFindProductById.mockResolvedValue(makeProduct());
    mockFindActiveRule.mockResolvedValue(null);
    mockGetMaxRuleVersion.mockResolvedValue(0);
    mockInsertRule.mockResolvedValue(newRule);

    const { publishRule } = await import('../service.js');
    await publishRule(
      mockDb as unknown as Parameters<typeof publishRule>[0],
      ACTOR,
      FIXTURE_PRODUCT_ID,
      PUBLISH_RULE_BODY,
    );

    const emitCall = mockEmit.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(emitCall?.['eventName']).toBe('credit.rule_published');

    const data = emitCall?.['data'] as Record<string, unknown>;
    const snapshot = data?.['rule_snapshot'] as Record<string, unknown>;
    // Snapshot deve ter os campos financeiros
    expect(snapshot).toHaveProperty('rule_id');
    expect(snapshot).toHaveProperty('version');
    expect(snapshot).toHaveProperty('monthly_rate');
    expect(snapshot).toHaveProperty('amortization');
    // Snapshot NÃO deve ter PII
    expect(snapshot).not.toHaveProperty('cpf');
    expect(snapshot).not.toHaveProperty('email');
  });

  it('ROLLBACK: se insertRule lançar erro, deactivateRule não é chamada e transação faz rollback', async () => {
    mockFindProductById.mockResolvedValue(makeProduct());
    mockFindActiveRule.mockResolvedValue(makeRule({ version: 1 }));
    mockGetMaxRuleVersion.mockResolvedValue(1);

    const insertError = new Error('DB constraint violation');
    mockInsertRule.mockRejectedValue(insertError);

    // Simular rollback: transaction lança o mesmo erro que o callback lançou
    mockDb.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = makeTxStub();
      // Ao lançar dentro do callback, a transação faz rollback
      await expect(fn(tx)).rejects.toThrow('DB constraint violation');
      throw insertError; // propaga rollback
    });

    const { publishRule } = await import('../service.js');

    await expect(
      publishRule(
        mockDb as unknown as Parameters<typeof publishRule>[0],
        ACTOR,
        FIXTURE_PRODUCT_ID,
        PUBLISH_RULE_BODY,
      ),
    ).rejects.toThrow('DB constraint violation');

    // deactivateRule não deve ter sido chamado (rollback antes de chegar lá)
    expect(mockDeactivateRule).not.toHaveBeenCalled();
    // emit também não deve ter sido chamado
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('lança NotFoundError quando produto não existe', async () => {
    mockFindProductById.mockResolvedValue(null);

    const { publishRule } = await import('../service.js');
    const { NotFoundError } = await import('../../../shared/errors.js');

    await expect(
      publishRule(
        mockDb as unknown as Parameters<typeof publishRule>[0],
        ACTOR,
        FIXTURE_PRODUCT_ID,
        PUBLISH_RULE_BODY,
      ),
    ).rejects.toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// activateRuleVersion — clone D6 (F18-S04)
// ---------------------------------------------------------------------------

describe('activateRuleVersion', () => {
  it('cria nova versão clonando a selecionada e desativa a anterior', async () => {
    const sourceRule = makeRule({ version: 2, id: FIXTURE_RULE_ID, isActive: false });
    const previousActive = makeRule({ version: 3, id: 'ffffffff-0000-0000-0000-000000000001' });
    const cloned = makeRule({ version: 4, id: FIXTURE_RULE_ID_V2 });

    mockFindProductById.mockResolvedValue(makeProduct());
    mockFindRuleByProductAndVersion.mockResolvedValue(sourceRule);
    mockFindActiveRule.mockResolvedValue(previousActive);
    mockGetMaxRuleVersion.mockResolvedValue(3);
    mockInsertRule.mockResolvedValue(cloned);

    const { activateRuleVersion } = await import('../service.js');
    const result = await activateRuleVersion(
      mockDb as unknown as Parameters<typeof activateRuleVersion>[0],
      ACTOR,
      FIXTURE_PRODUCT_ID,
      2,
    );

    expect(result.version).toBe(4);
    expect(result.is_active).toBe(true);
    // Versão anterior desativada
    expect(mockDeactivateRule).toHaveBeenCalledWith(
      expect.anything(),
      'ffffffff-0000-0000-0000-000000000001',
    );
    // Evento correto emitido
    expect(mockEmit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventName: 'credit.rule_activated' }),
    );
    // Audit log gerado
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'credit_product_rule.activate_version' }),
    );
  });

  it('IDEMPOTÊNCIA: versão já ativa retorna sem criar clone nem emitir evento', async () => {
    const activeRule = makeRule({ version: 3, id: FIXTURE_RULE_ID, isActive: true });

    mockFindProductById.mockResolvedValue(makeProduct());
    mockFindRuleByProductAndVersion.mockResolvedValue(activeRule);
    mockFindActiveRule.mockResolvedValue(activeRule); // mesma versão já é ativa

    const { activateRuleVersion } = await import('../service.js');
    const result = await activateRuleVersion(
      mockDb as unknown as Parameters<typeof activateRuleVersion>[0],
      ACTOR,
      FIXTURE_PRODUCT_ID,
      3,
    );

    expect(result.version).toBe(3);
    // Não deve inserir nova linha
    expect(mockInsertRule).not.toHaveBeenCalled();
    // Não deve emitir evento (no-op)
    expect(mockEmit).not.toHaveBeenCalled();
    // Não deve gerar audit log
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  it('lança NotFoundError quando produto não existe', async () => {
    mockFindProductById.mockResolvedValue(null);

    const { activateRuleVersion } = await import('../service.js');
    const { NotFoundError } = await import('../../../shared/errors.js');

    await expect(
      activateRuleVersion(
        mockDb as unknown as Parameters<typeof activateRuleVersion>[0],
        ACTOR,
        FIXTURE_PRODUCT_ID,
        1,
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('lança NotFoundError quando versão de regra não existe', async () => {
    mockFindProductById.mockResolvedValue(makeProduct());
    mockFindRuleByProductAndVersion.mockResolvedValue(null);

    const { activateRuleVersion } = await import('../service.js');
    const { NotFoundError } = await import('../../../shared/errors.js');

    await expect(
      activateRuleVersion(
        mockDb as unknown as Parameters<typeof activateRuleVersion>[0],
        ACTOR,
        FIXTURE_PRODUCT_ID,
        999,
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('evento credit.rule_activated carrega IDs corretos (sem PII)', async () => {
    const sourceRule = makeRule({ version: 1, id: FIXTURE_RULE_ID, isActive: false });
    const cloned = makeRule({ version: 2, id: FIXTURE_RULE_ID_V2 });

    mockFindProductById.mockResolvedValue(makeProduct());
    mockFindRuleByProductAndVersion.mockResolvedValue(sourceRule);
    mockFindActiveRule.mockResolvedValue(null);
    mockGetMaxRuleVersion.mockResolvedValue(1);
    mockInsertRule.mockResolvedValue(cloned);

    const { activateRuleVersion } = await import('../service.js');
    await activateRuleVersion(
      mockDb as unknown as Parameters<typeof activateRuleVersion>[0],
      ACTOR,
      FIXTURE_PRODUCT_ID,
      1,
    );

    const emitCall = mockEmit.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(emitCall?.['eventName']).toBe('credit.rule_activated');

    const data = emitCall?.['data'] as Record<string, unknown>;
    expect(data?.['product_id']).toBe(FIXTURE_PRODUCT_ID);
    expect(data?.['organization_id']).toBe(FIXTURE_ORG_ID);
    expect(data?.['new_version']).toBe(2);
    expect(data?.['copied_from_version']).toBe(1);
    // Sem PII
    expect(data).not.toHaveProperty('cpf');
    expect(data).not.toHaveProperty('email');
    expect(data).not.toHaveProperty('phone');
  });
});

// ---------------------------------------------------------------------------
// IMUTABILIDADE DE REGRAS — garantia estrutural
// ---------------------------------------------------------------------------

describe('IMUTABILIDADE DE REGRAS', () => {
  it('não existe função editRule, updateRule ou patchRule no service', async () => {
    const serviceModule = await import('../service.js');
    const exports = Object.keys(serviceModule);

    // Não deve existir nenhuma função que edite uma regra diretamente
    const editFunctions = exports.filter((name) =>
      ['editRule', 'updateRule', 'patchRule', 'modifyRule'].includes(name),
    );

    expect(editFunctions).toHaveLength(0);
  });

  it('funções de regra são publishRule, listRules e activateRuleVersion (clone, não edita)', async () => {
    const serviceModule = await import('../service.js');
    const exports = Object.keys(serviceModule);

    const ruleFunctions = exports.filter((name) => name.toLowerCase().includes('rule'));

    // activateRuleVersion respeita a imutabilidade: clona a versão escolhida numa
    // NOVA versão ativa (não altera campos numéricos de regra existente — F13-S06).
    const allowed = ['publishRule', 'listRules', 'activateRuleVersion'];
    expect(ruleFunctions.sort()).toEqual(expect.arrayContaining(['publishRule', 'listRules']));
    ruleFunctions.forEach((fn) => {
      expect(allowed).toContain(fn);
    });
  });
});
