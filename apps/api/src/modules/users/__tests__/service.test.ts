// =============================================================================
// users/service.test.ts — Testes unitários do serviço de gestão de usuários.
//
// Estratégia: mocks do repository e db. Sem conexão real com Postgres.
//
// Cobre:
//   - createUserService: 201 com tempPassword, 409 em email duplicado
//   - updateUserService: 200, 404 se não encontrado
//   - deactivateUserService: 204, 404 se não encontrado
//   - reactivateUserService: 204
//   - setUserRolesService: 204, 422 empty, 422 last admin protection
//   - setUserCityScopesService: 204 (substitui completamente)
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock pg — evita conexão real
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
// Mock do repository
// ---------------------------------------------------------------------------
const mockFindUsers = vi.fn();
const mockFindUserById = vi.fn();
const mockFindUserByEmailInOrg = vi.fn();
const mockCreateUser = vi.fn();
const mockUpdateUser = vi.fn();
const mockDeactivateUser = vi.fn();
const mockReactivateUser = vi.fn();
const mockFindUserRoles = vi.fn();
const mockReplaceUserRoles = vi.fn();
const mockCountAdminUsers = vi.fn();
const mockFindUserCityScopes = vi.fn();
const mockReplaceUserCityScopes = vi.fn();

vi.mock('../repository.js', () => ({
  findUsers: (...args: unknown[]) => mockFindUsers(...args),
  findUserById: (...args: unknown[]) => mockFindUserById(...args),
  findUserByEmailInOrg: (...args: unknown[]) => mockFindUserByEmailInOrg(...args),
  createUser: (...args: unknown[]) => mockCreateUser(...args),
  updateUser: (...args: unknown[]) => mockUpdateUser(...args),
  deactivateUser: (...args: unknown[]) => mockDeactivateUser(...args),
  reactivateUser: (...args: unknown[]) => mockReactivateUser(...args),
  findUserRoles: (...args: unknown[]) => mockFindUserRoles(...args),
  replaceUserRoles: (...args: unknown[]) => mockReplaceUserRoles(...args),
  roleExistsById: vi.fn().mockResolvedValue(true),
  countAdminUsers: (...args: unknown[]) => mockCountAdminUsers(...args),
  findUserCityScopes: (...args: unknown[]) => mockFindUserCityScopes(...args),
  replaceUserCityScopes: (...args: unknown[]) => mockReplaceUserCityScopes(...args),
}));

// ---------------------------------------------------------------------------
// Mock do audit helper
// ---------------------------------------------------------------------------
vi.mock('../../../lib/audit.js', () => ({
  auditLog: vi.fn().mockResolvedValue('audit-id'),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const FIXTURE_USER_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const FIXTURE_TARGET_USER_ID = 'c3d4e5f6-a7b8-9012-cdef-123456789012';
const FIXTURE_ROLE_ID = 'd4e5f6a7-b8c9-0123-defa-234567890123';
const FIXTURE_ADMIN_ROLE_ID = 'e5f6a7b8-c9d0-1234-efab-345678901234';
const FIXTURE_CITY_ID = 'f6a7b8c9-d0e1-2345-fabc-456789012345';

const makeUser = (overrides?: Record<string, unknown>) => ({
  id: FIXTURE_TARGET_USER_ID,
  organizationId: FIXTURE_ORG_ID,
  email: 'target@bdp.ro.gov.br',
  passwordHash: '$2b$12$hash',
  fullName: 'Target User',
  status: 'active' as const,
  lastLoginAt: null,
  totpSecret: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  deletedAt: null,
  ...overrides,
});

const actor = {
  userId: FIXTURE_USER_ID,
  organizationId: FIXTURE_ORG_ID,
  role: 'admin',
  ip: '127.0.0.1',
  userAgent: 'vitest',
};

// ---------------------------------------------------------------------------
// Mock do db com transaction
// ---------------------------------------------------------------------------

function makeMockDb() {
  const tx = {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };
  return {
    transaction: vi.fn().mockImplementation(async (cb: (tx: typeof tx) => Promise<unknown>) => {
      return cb(tx);
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests: createUserService
// ---------------------------------------------------------------------------

describe('createUserService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cria usuário e retorna tempPassword quando email único', async () => {
    const { createUserService } = await import('../service.js');
    const mockDb = makeMockDb();

    mockFindUserByEmailInOrg.mockResolvedValue(null);
    mockCreateUser.mockResolvedValue(makeUser());
    mockReplaceUserRoles.mockResolvedValue(undefined);
    mockReplaceUserCityScopes.mockResolvedValue(undefined);

    const result = await createUserService(
      mockDb as unknown as Parameters<typeof createUserService>[0],
      actor,
      {
        email: 'novo@bdp.ro.gov.br',
        fullName: 'Novo Usuario',
        status: 'pending',
        roleIds: [FIXTURE_ROLE_ID],
        cityIds: [FIXTURE_CITY_ID],
      },
    );

    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('tempPassword');
    expect(typeof result.tempPassword).toBe('string');
    expect(result.tempPassword.length).toBeGreaterThan(8);
    // Nunca retorna password_hash
    expect(result).not.toHaveProperty('passwordHash');
    expect(mockDb.transaction).toHaveBeenCalledOnce();
  });

  it('lança 409 quando email já existe na organização', async () => {
    const { createUserService } = await import('../service.js');
    const mockDb = makeMockDb();

    mockFindUserByEmailInOrg.mockResolvedValue(makeUser({ email: 'duplicado@bdp.ro.gov.br' }));

    await expect(
      createUserService(mockDb as unknown as Parameters<typeof createUserService>[0], actor, {
        email: 'duplicado@bdp.ro.gov.br',
        fullName: 'Duplicado',
        status: 'pending',
        roleIds: [FIXTURE_ROLE_ID],
        cityIds: [],
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(mockDb.transaction).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: updateUserService
// ---------------------------------------------------------------------------

describe('updateUserService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('atualiza usuário e retorna 200', async () => {
    const { updateUserService } = await import('../service.js');
    const mockDb = makeMockDb();
    const updated = makeUser({ fullName: 'Nome Atualizado' });

    mockFindUserById.mockResolvedValue(makeUser());
    mockFindUserByEmailInOrg.mockResolvedValue(null);
    mockUpdateUser.mockResolvedValue(updated);

    const result = await updateUserService(
      mockDb as unknown as Parameters<typeof updateUserService>[0],
      actor,
      FIXTURE_TARGET_USER_ID,
      { fullName: 'Nome Atualizado' },
    );

    expect(result.fullName).toBe('Nome Atualizado');
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('lança 404 quando usuário não encontrado', async () => {
    const { updateUserService } = await import('../service.js');
    const mockDb = makeMockDb();

    mockFindUserById.mockResolvedValue(null);

    await expect(
      updateUserService(
        mockDb as unknown as Parameters<typeof updateUserService>[0],
        actor,
        FIXTURE_TARGET_USER_ID,
        { fullName: 'Nome' },
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ---------------------------------------------------------------------------
// Tests: deactivateUserService
// ---------------------------------------------------------------------------

describe('deactivateUserService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('desativa usuário e não retorna body', async () => {
    const { deactivateUserService } = await import('../service.js');
    const mockDb = makeMockDb();
    const deactivated = makeUser({ status: 'disabled', deletedAt: new Date() });

    mockFindUserById.mockResolvedValue(makeUser());
    mockDeactivateUser.mockResolvedValue(deactivated);

    await expect(
      deactivateUserService(
        mockDb as unknown as Parameters<typeof deactivateUserService>[0],
        actor,
        FIXTURE_TARGET_USER_ID,
      ),
    ).resolves.toBeUndefined();
  });

  it('lança 404 quando usuário não encontrado', async () => {
    const { deactivateUserService } = await import('../service.js');
    const mockDb = makeMockDb();

    mockFindUserById.mockResolvedValue(null);

    await expect(
      deactivateUserService(
        mockDb as unknown as Parameters<typeof deactivateUserService>[0],
        actor,
        FIXTURE_TARGET_USER_ID,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ---------------------------------------------------------------------------
// Tests: reactivateUserService
// ---------------------------------------------------------------------------

describe('reactivateUserService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reativa usuário', async () => {
    const { reactivateUserService } = await import('../service.js');
    const mockDb = makeMockDb();
    const reactivated = makeUser({ status: 'active', deletedAt: null });

    mockReactivateUser.mockResolvedValue(reactivated);

    await expect(
      reactivateUserService(
        mockDb as unknown as Parameters<typeof reactivateUserService>[0],
        actor,
        FIXTURE_TARGET_USER_ID,
      ),
    ).resolves.toBeUndefined();
  });

  it('lança 404 quando usuário não encontrado', async () => {
    const { reactivateUserService } = await import('../service.js');
    const mockDb = makeMockDb();

    mockReactivateUser.mockResolvedValue(null);

    await expect(
      reactivateUserService(
        mockDb as unknown as Parameters<typeof reactivateUserService>[0],
        actor,
        FIXTURE_TARGET_USER_ID,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ---------------------------------------------------------------------------
// Tests: setUserRolesService
// ---------------------------------------------------------------------------

describe('setUserRolesService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('substitui roles do usuário', async () => {
    const { setUserRolesService } = await import('../service.js');
    const mockDb = makeMockDb();

    mockFindUserById.mockResolvedValue(makeUser());
    mockFindUserRoles.mockResolvedValue([{ id: FIXTURE_ROLE_ID, key: 'agente', label: 'Agente' }]);
    mockReplaceUserRoles.mockResolvedValue(undefined);

    await expect(
      setUserRolesService(
        mockDb as unknown as Parameters<typeof setUserRolesService>[0],
        actor,
        FIXTURE_TARGET_USER_ID,
        { roleIds: [FIXTURE_ROLE_ID] },
      ),
    ).resolves.toBeUndefined();

    expect(mockDb.transaction).toHaveBeenCalledOnce();
  });

  it('lança 422 ao tentar remover última role admin da organização', async () => {
    const { setUserRolesService } = await import('../service.js');
    const mockDb = makeMockDb();

    mockFindUserById.mockResolvedValue(makeUser());
    // Usuário target é admin
    mockFindUserRoles.mockResolvedValue([
      { id: FIXTURE_ADMIN_ROLE_ID, key: 'admin', label: 'Admin' },
    ]);
    // Apenas 1 admin na org
    mockCountAdminUsers.mockResolvedValue(1);

    // Tentando setar uma role que não é admin (removendo admin)
    await expect(
      setUserRolesService(
        mockDb as unknown as Parameters<typeof setUserRolesService>[0],
        actor,
        FIXTURE_TARGET_USER_ID,
        { roleIds: [FIXTURE_ROLE_ID] }, // FIXTURE_ROLE_ID não é admin
      ),
    ).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'CANNOT_REMOVE_LAST_ADMIN' },
    });
  });

  it('permite remover role admin quando há mais de 1 admin', async () => {
    const { setUserRolesService } = await import('../service.js');
    const mockDb = makeMockDb();

    mockFindUserById.mockResolvedValue(makeUser());
    mockFindUserRoles.mockResolvedValue([
      { id: FIXTURE_ADMIN_ROLE_ID, key: 'admin', label: 'Admin' },
    ]);
    // Há 2 admins na org
    mockCountAdminUsers.mockResolvedValue(2);
    mockReplaceUserRoles.mockResolvedValue(undefined);

    await expect(
      setUserRolesService(
        mockDb as unknown as Parameters<typeof setUserRolesService>[0],
        actor,
        FIXTURE_TARGET_USER_ID,
        { roleIds: [FIXTURE_ROLE_ID] },
      ),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: setUserCityScopesService
// ---------------------------------------------------------------------------

describe('setUserCityScopesService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('substitui city scopes completamente', async () => {
    const { setUserCityScopesService } = await import('../service.js');
    const mockDb = makeMockDb();

    mockFindUserById.mockResolvedValue(makeUser());
    mockFindUserCityScopes.mockResolvedValue([{ cityId: 'old-city-id', isPrimary: true }]);
    mockReplaceUserCityScopes.mockResolvedValue(undefined);

    await expect(
      setUserCityScopesService(
        mockDb as unknown as Parameters<typeof setUserCityScopesService>[0],
        actor,
        FIXTURE_TARGET_USER_ID,
        { cityIds: [FIXTURE_CITY_ID] },
      ),
    ).resolves.toBeUndefined();

    expect(mockDb.transaction).toHaveBeenCalledOnce();
  });

  it('aceita lista vazia de cidades (remove todos os escopos)', async () => {
    const { setUserCityScopesService } = await import('../service.js');
    const mockDb = makeMockDb();

    mockFindUserById.mockResolvedValue(makeUser());
    mockFindUserCityScopes.mockResolvedValue([]);
    mockReplaceUserCityScopes.mockResolvedValue(undefined);

    await expect(
      setUserCityScopesService(
        mockDb as unknown as Parameters<typeof setUserCityScopesService>[0],
        actor,
        FIXTURE_TARGET_USER_ID,
        { cityIds: [] },
      ),
    ).resolves.toBeUndefined();
  });
});
