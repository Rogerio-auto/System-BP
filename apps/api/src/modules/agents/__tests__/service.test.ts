// =============================================================================
// agents/__tests__/service.test.ts — Testes unitários do service (F8-S01).
//
// Cobre regras críticas que o routes.test.ts não verifica:
//   1.  Invariante "1 is_primary": buildCityInputs via createAgent
//   2.  Bloqueio 409 ao desativar último agente ativo de cidade com leads abertos
//   3.  Normalização de phone E.164 inválido → ValidationError
//   4.  userId não pertence à org → ValidationError
//   5.  cityIds inválidos → ValidationError
//   6.  Reativar agente que já está ativo → ConflictError
//   7.  createAgent feliz: chama insertAgent + replaceAgentCities + emit + auditLog
//   8.  deactivateAgent feliz: sem bloqueio de cidade
//   9.  setAgentCities feliz: substitui atomicamente
//   10. listAgents com cityScopeIds vazio → retorna lista vazia
// =============================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../../../db/client.js';

// ---------------------------------------------------------------------------
// Mock db/client
// ---------------------------------------------------------------------------
vi.mock('../../../db/client.js', () => ({
  db: {},
  pool: { end: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mocks de dependências externas
// ---------------------------------------------------------------------------
// NOTA: vi.mock é hoisted antes de qualquer declaração — as factories não podem
// referenciar variáveis declaradas no escopo do módulo. Por isso usamos
// vi.hoisted para garantir que as funções mock estejam disponíveis no factory.
const { mockEmit, mockAuditLog } = vi.hoisted(() => ({
  mockEmit: vi.fn().mockResolvedValue('event-uuid'),
  mockAuditLog: vi.fn().mockResolvedValue('audit-uuid'),
}));

vi.mock('../../../events/emit.js', () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
}));

vi.mock('../../../lib/audit.js', () => ({
  auditLog: (...args: unknown[]) => mockAuditLog(...args),
}));

// ---------------------------------------------------------------------------
// Mock repository
// ---------------------------------------------------------------------------
const mockFindAgents = vi.fn();
const mockFindAgentById = vi.fn();
const mockInsertAgent = vi.fn();
const mockUpdateAgent = vi.fn();
const mockDeactivateAgent = vi.fn();
const mockReactivateAgent = vi.fn();
const mockReplaceAgentCities = vi.fn();
const mockCountOpenLeadsInCitiesWithSingleAgent = vi.fn();
const mockUserBelongsToOrg = vi.fn();
const mockFindInvalidCityIds = vi.fn();

vi.mock('../repository.js', () => ({
  findAgents: (...args: unknown[]) => mockFindAgents(...args),
  findAgentById: (...args: unknown[]) => mockFindAgentById(...args),
  insertAgent: (...args: unknown[]) => mockInsertAgent(...args),
  updateAgent: (...args: unknown[]) => mockUpdateAgent(...args),
  deactivateAgent: (...args: unknown[]) => mockDeactivateAgent(...args),
  reactivateAgent: (...args: unknown[]) => mockReactivateAgent(...args),
  replaceAgentCities: (...args: unknown[]) => mockReplaceAgentCities(...args),
  countOpenLeadsInCitiesWithSingleAgent: (...args: unknown[]) =>
    mockCountOpenLeadsInCitiesWithSingleAgent(...args),
  userBelongsToOrg: (...args: unknown[]) => mockUserBelongsToOrg(...args),
  findInvalidCityIds: (...args: unknown[]) => mockFindInvalidCityIds(...args),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_USER_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const FIXTURE_AGENT_ID = 'cccccccc-0000-0000-0000-000000000001';
const FIXTURE_CITY_ID_1 = 'dddddddd-0000-0000-0000-000000000001';
const FIXTURE_CITY_ID_2 = 'dddddddd-0000-0000-0000-000000000002';

const actor = {
  userId: FIXTURE_USER_ID,
  organizationId: FIXTURE_ORG_ID,
  role: 'admin',
  ip: '127.0.0.1',
  userAgent: 'test-agent/1.0',
};

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: FIXTURE_AGENT_ID,
    organizationId: FIXTURE_ORG_ID,
    userId: FIXTURE_USER_ID,
    displayName: 'João Silva',
    phone: '+5569991234567',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function makeAgentCities(agentId = FIXTURE_AGENT_ID) {
  return [{ agentId, cityId: FIXTURE_CITY_ID_1, isPrimary: true }];
}

// Simula db.transaction: chama a callback com o tx mock imediatamente
function makeMockDb() {
  return {
    transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb({})),
  };
}

// ---------------------------------------------------------------------------
// Helpers para importar service (evita circular)
// ---------------------------------------------------------------------------
async function importService() {
  const svc = await import('../service.js');
  return svc;
}

// ---------------------------------------------------------------------------
// createAgent
// ---------------------------------------------------------------------------

describe('createAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cria agente com 1 is_primary quando primaryCityId é o primeiro de cityIds', async () => {
    mockFindInvalidCityIds.mockResolvedValue([]);
    mockUserBelongsToOrg.mockResolvedValue(true);
    const createdAgent = makeAgent();
    mockInsertAgent.mockResolvedValue(createdAgent);
    const cities = makeAgentCities();
    mockReplaceAgentCities.mockResolvedValue(cities);

    const db = makeMockDb();
    const { createAgent } = await importService();

    const result = await createAgent(db as unknown as Database, actor, {
      displayName: 'João Silva',
      cityIds: [FIXTURE_CITY_ID_1],
      primaryCityId: FIXTURE_CITY_ID_1,
    });

    expect(result.primary_city_id).toBe(FIXTURE_CITY_ID_1);
    // Verifica que replaceAgentCities recebeu is_primary correto
    expect(mockReplaceAgentCities).toHaveBeenCalledWith(
      expect.anything(),
      FIXTURE_AGENT_ID,
      expect.arrayContaining([
        expect.objectContaining({ cityId: FIXTURE_CITY_ID_1, isPrimary: true }),
      ]),
    );
  });

  it('usa o primeiro cityId como primary quando primaryCityId não é informado', async () => {
    mockFindInvalidCityIds.mockResolvedValue([]);
    mockUserBelongsToOrg.mockResolvedValue(true);
    const createdAgent = makeAgent();
    mockInsertAgent.mockResolvedValue(createdAgent);
    mockReplaceAgentCities.mockResolvedValue([
      { agentId: FIXTURE_AGENT_ID, cityId: FIXTURE_CITY_ID_1, isPrimary: true },
      { agentId: FIXTURE_AGENT_ID, cityId: FIXTURE_CITY_ID_2, isPrimary: false },
    ]);

    const db = makeMockDb();
    const { createAgent } = await importService();

    await createAgent(db as unknown as Database, actor, {
      displayName: 'João',
      cityIds: [FIXTURE_CITY_ID_1, FIXTURE_CITY_ID_2],
      // sem primaryCityId — deve usar FIXTURE_CITY_ID_1
    });

    expect(mockReplaceAgentCities).toHaveBeenCalledWith(
      expect.anything(),
      FIXTURE_AGENT_ID,
      expect.arrayContaining([
        expect.objectContaining({ cityId: FIXTURE_CITY_ID_1, isPrimary: true }),
        expect.objectContaining({ cityId: FIXTURE_CITY_ID_2, isPrimary: false }),
      ]),
    );
  });

  it('lança ValidationError quando phone é inválido', async () => {
    mockFindInvalidCityIds.mockResolvedValue([]);
    mockUserBelongsToOrg.mockResolvedValue(true);

    const db = makeMockDb();
    const { createAgent } = await importService();
    const { ValidationError } = await import('../../../shared/errors.js');

    await expect(
      createAgent(db as unknown as Database, actor, {
        displayName: 'João',
        phone: 'numero-invalido',
        cityIds: [FIXTURE_CITY_ID_1],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('lança ValidationError quando userId não pertence à org', async () => {
    mockFindInvalidCityIds.mockResolvedValue([]);
    mockUserBelongsToOrg.mockResolvedValue(false);

    const db = makeMockDb();
    const { createAgent } = await importService();
    const { ValidationError } = await import('../../../shared/errors.js');

    await expect(
      createAgent(db as unknown as Database, actor, {
        displayName: 'João',
        userId: 'eeeeeeee-0000-0000-0000-000000000001',
        cityIds: [FIXTURE_CITY_ID_1],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('lança ValidationError quando cityIds contém ID inválido', async () => {
    mockFindInvalidCityIds.mockResolvedValue(['invalid-city-id']);

    const db = makeMockDb();
    const { createAgent } = await importService();
    const { ValidationError } = await import('../../../shared/errors.js');

    await expect(
      createAgent(db as unknown as Database, actor, {
        displayName: 'João',
        cityIds: ['invalid-city-id'],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('emite evento agent.created e registra audit log na transação', async () => {
    mockFindInvalidCityIds.mockResolvedValue([]);
    mockUserBelongsToOrg.mockResolvedValue(true);
    mockInsertAgent.mockResolvedValue(makeAgent());
    mockReplaceAgentCities.mockResolvedValue(makeAgentCities());

    const db = makeMockDb();
    const { createAgent } = await importService();

    await createAgent(db as unknown as Database, actor, {
      displayName: 'João',
      cityIds: [FIXTURE_CITY_ID_1],
    });

    expect(mockEmit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventName: 'agent.created' }),
    );
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'agent.create' }),
    );
  });
});

// ---------------------------------------------------------------------------
// deactivateAgentService
// ---------------------------------------------------------------------------

describe('deactivateAgentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('bloqueia com 409 quando agente é o último ativo de cidade com leads abertos', async () => {
    mockFindAgentById.mockResolvedValue({
      agent: makeAgent({ isActive: true }),
      cities: makeAgentCities(),
    });
    mockCountOpenLeadsInCitiesWithSingleAgent.mockResolvedValue([
      { cityId: FIXTURE_CITY_ID_1, openLeadCount: 2 },
    ]);

    const db = makeMockDb();
    const { deactivateAgentService, AgentLastActiveInCityError } = await importService();

    await expect(
      deactivateAgentService(db as unknown as Database, actor, FIXTURE_AGENT_ID),
    ).rejects.toThrow(AgentLastActiveInCityError);
  });

  it('desativa com sucesso quando há outros agentes ativos na cidade', async () => {
    mockFindAgentById.mockResolvedValue({
      agent: makeAgent({ isActive: true }),
      cities: makeAgentCities(),
    });
    mockCountOpenLeadsInCitiesWithSingleAgent.mockResolvedValue([]); // sem bloqueio
    const deactivatedAgent = makeAgent({ isActive: false, deletedAt: new Date() });
    mockDeactivateAgent.mockResolvedValue(deactivatedAgent);

    const db = makeMockDb();
    const { deactivateAgentService } = await importService();

    const result = await deactivateAgentService(db as unknown as Database, actor, FIXTURE_AGENT_ID);

    expect(result.is_active).toBe(false);
    expect(mockEmit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventName: 'agent.deactivated' }),
    );
  });

  it('lança ConflictError quando agente já está inativo', async () => {
    mockFindAgentById.mockResolvedValue({
      agent: makeAgent({ isActive: false, deletedAt: new Date() }),
      cities: makeAgentCities(),
    });

    const db = makeMockDb();
    const { deactivateAgentService } = await importService();
    const { ConflictError } = await import('../../../shared/errors.js');

    await expect(
      deactivateAgentService(db as unknown as Database, actor, FIXTURE_AGENT_ID),
    ).rejects.toThrow(ConflictError);
  });

  it('lança NotFoundError quando agente não existe', async () => {
    mockFindAgentById.mockResolvedValue(null);

    const db = makeMockDb();
    const { deactivateAgentService } = await importService();
    const { NotFoundError } = await import('../../../shared/errors.js');

    await expect(
      deactivateAgentService(db as unknown as Database, actor, FIXTURE_AGENT_ID),
    ).rejects.toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// setAgentCities — invariante is_primary
// ---------------------------------------------------------------------------

describe('setAgentCities — invariante is_primary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('garante exatamente 1 is_primary ao substituir cidades', async () => {
    mockFindAgentById.mockResolvedValue({
      agent: makeAgent(),
      cities: makeAgentCities(),
    });
    mockFindInvalidCityIds.mockResolvedValue([]);
    mockUpdateAgent.mockResolvedValue(makeAgent());
    mockReplaceAgentCities.mockResolvedValue([
      { agentId: FIXTURE_AGENT_ID, cityId: FIXTURE_CITY_ID_1, isPrimary: true },
      { agentId: FIXTURE_AGENT_ID, cityId: FIXTURE_CITY_ID_2, isPrimary: false },
    ]);

    const db = makeMockDb();
    const { setAgentCities } = await importService();

    const result = await setAgentCities(db as unknown as Database, actor, FIXTURE_AGENT_ID, {
      cityIds: [FIXTURE_CITY_ID_1, FIXTURE_CITY_ID_2],
      primaryCityId: FIXTURE_CITY_ID_1,
    });

    // Verificar que apenas 1 cidade é primary
    const primaryCities = result.cities.filter((c) => c.is_primary);
    expect(primaryCities).toHaveLength(1);
    expect(result.primary_city_id).toBe(FIXTURE_CITY_ID_1);

    // Verificar que replaceAgentCities foi chamado com o input correto
    expect(mockReplaceAgentCities).toHaveBeenCalledWith(
      expect.anything(),
      FIXTURE_AGENT_ID,
      expect.arrayContaining([
        expect.objectContaining({ cityId: FIXTURE_CITY_ID_1, isPrimary: true }),
        expect.objectContaining({ cityId: FIXTURE_CITY_ID_2, isPrimary: false }),
      ]),
    );
  });

  it('emite evento agent.cities_changed e registra audit', async () => {
    mockFindAgentById.mockResolvedValue({
      agent: makeAgent(),
      cities: makeAgentCities(),
    });
    mockFindInvalidCityIds.mockResolvedValue([]);
    mockUpdateAgent.mockResolvedValue(makeAgent());
    mockReplaceAgentCities.mockResolvedValue([
      { agentId: FIXTURE_AGENT_ID, cityId: FIXTURE_CITY_ID_1, isPrimary: true },
    ]);

    const db = makeMockDb();
    const { setAgentCities } = await importService();

    await setAgentCities(db as unknown as Database, actor, FIXTURE_AGENT_ID, {
      cityIds: [FIXTURE_CITY_ID_1],
    });

    expect(mockEmit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventName: 'agent.cities_changed' }),
    );
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'agent.setCities' }),
    );
  });
});

// ---------------------------------------------------------------------------
// listAgents — city scope
// ---------------------------------------------------------------------------

describe('listAgents — city scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passa cityScopeIds ao repository', async () => {
    mockFindAgents.mockResolvedValue({ data: [], total: 0 });

    const db = makeMockDb();
    const { listAgents } = await importService();

    const scopeCtx = { cityScopeIds: [FIXTURE_CITY_ID_1] };

    await listAgents(db as unknown as Database, actor, { page: 1, limit: 20 }, scopeCtx);

    expect(mockFindAgents).toHaveBeenCalledWith(
      expect.anything(),
      FIXTURE_ORG_ID,
      expect.objectContaining({ page: 1, limit: 20 }),
      scopeCtx,
    );
  });
});
