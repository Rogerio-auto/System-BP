// =============================================================================
// dashboard/__tests__/service.test.ts — Testes unitários do service (F8-S03).
//
// Estratégia: mocka o repository e auditLog para testar regras de negócio
// isoladas do banco de dados.
//
// Cobre:
//   1. getDashboardMetrics com range default → chama todos os repositories
//   2. getDashboardMetrics com range 'today'
//   3. getDashboardMetrics com range '7d'
//   4. getDashboardMetrics com range 'mtd'
//   5. getDashboardMetrics com range 'ytd'
//   6. cityId dentro do escopo (cityScopeIds inclui o cityId) → não lança erro
//   7. cityId fora do escopo (cityScopeIds não inclui o cityId) → ForbiddenError
//   8. cityId fornecido com cityScopeIds=null (admin global) → permitido
//   9. cityScopeIds=[] (sem cidade) → repositories chamados com escopo vazio
//   10. Resposta nunca contém PII de leads (verifica shape)
// =============================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock repository
// ---------------------------------------------------------------------------
const mockCountTotalLeads = vi.fn().mockResolvedValue(0);
const mockCountNewLeadsInRange = vi.fn().mockResolvedValue(0);
const mockCountLeadsByStatus = vi.fn().mockResolvedValue([]);
const mockCountLeadsByCity = vi.fn().mockResolvedValue([]);
const mockCountLeadsBySource = vi.fn().mockResolvedValue([]);
const mockCountStaleLeads = vi.fn().mockResolvedValue(0);
const mockCountInteractionsInRange = vi.fn().mockResolvedValue(0);
const mockCountInteractionsByChannel = vi.fn().mockResolvedValue([]);
const mockCountInteractionsByDirection = vi.fn().mockResolvedValue({ inbound: 0, outbound: 0 });
const mockCountKanbanCardsByStage = vi.fn().mockResolvedValue([]);
const mockGetAvgDaysInStage = vi.fn().mockResolvedValue([]);
const mockGetTopAgentsByLeadsClosed = vi.fn().mockResolvedValue([]);

vi.mock('../repository.js', () => ({
  countTotalLeads: (...args: unknown[]) => mockCountTotalLeads(...args),
  countNewLeadsInRange: (...args: unknown[]) => mockCountNewLeadsInRange(...args),
  countLeadsByStatus: (...args: unknown[]) => mockCountLeadsByStatus(...args),
  countLeadsByCity: (...args: unknown[]) => mockCountLeadsByCity(...args),
  countLeadsBySource: (...args: unknown[]) => mockCountLeadsBySource(...args),
  countStaleLeads: (...args: unknown[]) => mockCountStaleLeads(...args),
  countInteractionsInRange: (...args: unknown[]) => mockCountInteractionsInRange(...args),
  countInteractionsByChannel: (...args: unknown[]) => mockCountInteractionsByChannel(...args),
  countInteractionsByDirection: (...args: unknown[]) => mockCountInteractionsByDirection(...args),
  countKanbanCardsByStage: (...args: unknown[]) => mockCountKanbanCardsByStage(...args),
  getAvgDaysInStage: (...args: unknown[]) => mockGetAvgDaysInStage(...args),
  getTopAgentsByLeadsClosed: (...args: unknown[]) => mockGetTopAgentsByLeadsClosed(...args),
}));

// ---------------------------------------------------------------------------
// Mock auditLog
// ---------------------------------------------------------------------------
const mockAuditLog = vi.fn().mockResolvedValue('audit-id');

vi.mock('../../../lib/audit.js', () => ({
  auditLog: (...args: unknown[]) => mockAuditLog(...args),
}));

// ---------------------------------------------------------------------------
// Mock db com suporte a transaction
// ---------------------------------------------------------------------------
const mockDb = {
  transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    return fn({});
  }),
};

// ---------------------------------------------------------------------------
// Import service (após mocks)
// ---------------------------------------------------------------------------
import type { ActorContext } from '../service.js';
import { getDashboardMetrics } from '../service.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_USER_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const FIXTURE_CITY_ID_1 = 'cccccccc-0000-0000-0000-000000000001';
const FIXTURE_CITY_ID_2 = 'cccccccc-0000-0000-0000-000000000002';

const ACTOR_ADMIN: ActorContext = {
  userId: FIXTURE_USER_ID,
  organizationId: FIXTURE_ORG_ID,
  role: 'admin',
  cityScopeIds: null, // admin global
  ip: '127.0.0.1',
  userAgent: 'test',
};

const ACTOR_AGENT: ActorContext = {
  userId: FIXTURE_USER_ID,
  organizationId: FIXTURE_ORG_ID,
  role: 'agente',
  cityScopeIds: [FIXTURE_CITY_ID_1],
  ip: '127.0.0.1',
  userAgent: 'test',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Re-mock defaults após clearAllMocks
  mockCountTotalLeads.mockResolvedValue(0);
  mockCountNewLeadsInRange.mockResolvedValue(0);
  mockCountLeadsByStatus.mockResolvedValue([]);
  mockCountLeadsByCity.mockResolvedValue([]);
  mockCountLeadsBySource.mockResolvedValue([]);
  mockCountStaleLeads.mockResolvedValue(0);
  mockCountInteractionsInRange.mockResolvedValue(0);
  mockCountInteractionsByChannel.mockResolvedValue([]);
  mockCountInteractionsByDirection.mockResolvedValue({ inbound: 0, outbound: 0 });
  mockCountKanbanCardsByStage.mockResolvedValue([]);
  mockGetAvgDaysInStage.mockResolvedValue([]);
  mockGetTopAgentsByLeadsClosed.mockResolvedValue([]);
  mockDb.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({}));
  mockAuditLog.mockResolvedValue('audit-id');
});

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('getDashboardMetrics — ranges', () => {
  it('range default (30d) — chama todos os repositories e retorna shape completo', async () => {
    // Arrange: dados fictícios sem PII
    mockCountTotalLeads.mockResolvedValue(42);
    mockCountNewLeadsInRange.mockResolvedValue(10);
    mockCountLeadsByStatus.mockResolvedValue([{ status: 'new', count: 20 }]);
    mockCountLeadsByCity.mockResolvedValue([
      { cityId: FIXTURE_CITY_ID_1, cityName: 'Porto Velho', count: 42 },
    ]);

    // Act
    const result = await getDashboardMetrics(
      mockDb as unknown as Parameters<typeof getDashboardMetrics>[0],
      ACTOR_ADMIN,
      { range: '30d' },
    );

    // Assert: shape correto
    expect(result.range.label).toBe('Últimos 30 dias');
    expect(result.leads.total).toBe(42);
    expect(result.leads.newInRange).toBe(10);
    expect(result.leads.byStatus).toEqual([{ status: 'new', count: 20 }]);
    expect(result.leads.byCity[0]?.cityName).toBe('Porto Velho');

    // Todos os repositories foram chamados
    expect(mockCountTotalLeads).toHaveBeenCalledOnce();
    expect(mockCountNewLeadsInRange).toHaveBeenCalledOnce();
    expect(mockCountLeadsByStatus).toHaveBeenCalledOnce();
    expect(mockCountLeadsByCity).toHaveBeenCalledOnce();
    expect(mockCountLeadsBySource).toHaveBeenCalledOnce();
    expect(mockCountStaleLeads).toHaveBeenCalledOnce();
    expect(mockCountInteractionsInRange).toHaveBeenCalledOnce();
    expect(mockCountInteractionsByChannel).toHaveBeenCalledOnce();
    expect(mockCountInteractionsByDirection).toHaveBeenCalledOnce();
    expect(mockCountKanbanCardsByStage).toHaveBeenCalledOnce();
    expect(mockGetAvgDaysInStage).toHaveBeenCalledOnce();
    expect(mockGetTopAgentsByLeadsClosed).toHaveBeenCalledOnce();

    // Audit log foi gerado
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'dashboard.read',
        organizationId: FIXTURE_ORG_ID,
      }),
    );
  });

  it("range 'today' — label é 'Hoje' e from é início do dia", async () => {
    const result = await getDashboardMetrics(
      mockDb as unknown as Parameters<typeof getDashboardMetrics>[0],
      ACTOR_ADMIN,
      { range: 'today' },
    );

    expect(result.range.label).toBe('Hoje');
    const from = new Date(result.range.from);
    const now = new Date();
    // from deve ser meia-noite do dia atual
    expect(from.getHours()).toBe(0);
    expect(from.getMinutes()).toBe(0);
    expect(from.getDate()).toBe(now.getDate());
  });

  it("range '7d' — label é 'Últimos 7 dias' e from é ~7 dias atrás", async () => {
    const result = await getDashboardMetrics(
      mockDb as unknown as Parameters<typeof getDashboardMetrics>[0],
      ACTOR_ADMIN,
      { range: '7d' },
    );

    expect(result.range.label).toBe('Últimos 7 dias');
    const from = new Date(result.range.from);
    const to = new Date(result.range.to);
    const diffDays = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeCloseTo(7, 0);
  });

  it("range 'mtd' — label é 'Mês atual' e from é início do mês", async () => {
    const result = await getDashboardMetrics(
      mockDb as unknown as Parameters<typeof getDashboardMetrics>[0],
      ACTOR_ADMIN,
      { range: 'mtd' },
    );

    expect(result.range.label).toBe('Mês atual');
    const from = new Date(result.range.from);
    expect(from.getDate()).toBe(1);
    expect(from.getHours()).toBe(0);
  });

  it("range 'ytd' — label é 'Ano atual' e from é 1 de janeiro", async () => {
    const result = await getDashboardMetrics(
      mockDb as unknown as Parameters<typeof getDashboardMetrics>[0],
      ACTOR_ADMIN,
      { range: 'ytd' },
    );

    expect(result.range.label).toBe('Ano atual');
    const from = new Date(result.range.from);
    expect(from.getMonth()).toBe(0); // janeiro = 0
    expect(from.getDate()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// City scope
// ---------------------------------------------------------------------------

describe('getDashboardMetrics — city scope', () => {
  it('cityId dentro do escopo → não lança erro e passa cityId ao repository', async () => {
    // ACTOR_AGENT tem cityScopeIds = [FIXTURE_CITY_ID_1]
    await expect(
      getDashboardMetrics(
        mockDb as unknown as Parameters<typeof getDashboardMetrics>[0],
        ACTOR_AGENT,
        { range: '30d', cityId: FIXTURE_CITY_ID_1 },
      ),
    ).resolves.toBeDefined();

    // Verifica que cityId foi passado ao repository
    expect(mockCountTotalLeads).toHaveBeenCalledWith(
      expect.anything(),
      FIXTURE_ORG_ID,
      [FIXTURE_CITY_ID_1],
      FIXTURE_CITY_ID_1,
    );
  });

  it('cityId fora do escopo → lança ForbiddenError (403)', async () => {
    // ACTOR_AGENT tem cityScopeIds = [FIXTURE_CITY_ID_1]
    // FIXTURE_CITY_ID_2 não está no escopo
    const { ForbiddenError } = await import('../../../shared/errors.js');
    await expect(
      getDashboardMetrics(
        mockDb as unknown as Parameters<typeof getDashboardMetrics>[0],
        ACTOR_AGENT,
        { range: '30d', cityId: FIXTURE_CITY_ID_2 },
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it('cityId com admin (cityScopeIds=null) → sempre permitido', async () => {
    // Admin global não tem restrição de cidade
    await expect(
      getDashboardMetrics(
        mockDb as unknown as Parameters<typeof getDashboardMetrics>[0],
        ACTOR_ADMIN,
        { range: '30d', cityId: FIXTURE_CITY_ID_2 },
      ),
    ).resolves.toBeDefined();
  });

  it('cityScopeIds=[] (sem cidade) → repositories chamados com escopo vazio', async () => {
    const actorWithEmptyScope: ActorContext = {
      ...ACTOR_AGENT,
      cityScopeIds: [],
    };

    await getDashboardMetrics(
      mockDb as unknown as Parameters<typeof getDashboardMetrics>[0],
      actorWithEmptyScope,
      { range: '30d' },
    );

    // Repositories devem ser chamados com [] como escopo
    expect(mockCountTotalLeads).toHaveBeenCalledWith(
      expect.anything(),
      FIXTURE_ORG_ID,
      [],
      undefined,
    );
  });
});

// ---------------------------------------------------------------------------
// LGPD — resposta sem PII de leads
// ---------------------------------------------------------------------------

describe('getDashboardMetrics — LGPD', () => {
  it('resposta não contém name, phone_e164, email, cpf de leads', async () => {
    const result = await getDashboardMetrics(
      mockDb as unknown as Parameters<typeof getDashboardMetrics>[0],
      ACTOR_ADMIN,
      { range: '30d' },
    );

    // Serializar resposta para inspecionar todas as chaves
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('phone_e164');
    expect(serialized).not.toContain('phone');
    expect(serialized).not.toContain('cpf');
    // 'name' pode aparecer como 'stageName', 'cityName', 'displayName' (agente) — OK
    // Verificamos que nenhum campo 'name' de lead PII está presente
    // Os únicos 'name' válidos são: stageName, cityName, displayName (colaborador)
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    const leadsSection = parsed['leads'] as Record<string, unknown>;
    // leads não tem campo 'name' — só contagens e IDs
    expect(leadsSection).not.toHaveProperty('name');
    expect(leadsSection).not.toHaveProperty('email');
    expect(leadsSection).not.toHaveProperty('phone_e164');
  });

  it('audit log registra ação dashboard.read com filtros (sem PII)', async () => {
    await getDashboardMetrics(
      mockDb as unknown as Parameters<typeof getDashboardMetrics>[0],
      ACTOR_ADMIN,
      { range: '30d', cityId: FIXTURE_CITY_ID_1 },
    );

    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'dashboard.read',
        organizationId: FIXTURE_ORG_ID,
        actor: expect.objectContaining({ userId: FIXTURE_USER_ID }),
        metadata: expect.objectContaining({
          range: '30d',
          cityId: FIXTURE_CITY_ID_1,
        }),
      }),
    );
  });
});
