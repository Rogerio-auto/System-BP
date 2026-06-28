// =============================================================================
// roles/__tests__/service.test.ts — Testes unitários do service de roles.
//
// Cobre:
//   toRoleResponse:
//     1. Mapeia RoleRow com scope=global corretamente (com permissions)
//     2. Mapeia RoleRow com scope=city corretamente (com permissions)
//     3. scope preservado da coluna — sem derivação em runtime por key
//     4. Todas as 6 roles canônicas: mapeamento key→scope conforme doc 10 §3.1
//   listRoles:
//     5. Agrega permissões por role a partir de RoleWithPermissionRow[]
//     6. Role sem permissões retorna permissions: []
//     7. Retorna lista vazia quando não há roles
//   getModuleLabel:
//     8. Prefixos CRM & Leads
//     9. Prefixos Live chat & Canais
//    10. Prefixos Crédito
//    11. Prefixos Contratos, Cobrança, Templates, Tarefas, IA, Relatórios, Administração
//    12. Prefixo desconhecido → 'Outros'
//   listPermissions:
//    13. Enriquece com module e ordena por módulo depois key
//    14. Retorna lista vazia quando catálogo está vazio
// =============================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — repository
// ---------------------------------------------------------------------------

const mockFindAllPermissions = vi.fn();
const mockFindAllRolesWithPermissions = vi.fn();
const mockFindRoleById = vi.fn();
const mockFindPermissionsByKeys = vi.fn();
const mockFindPermissionsByRoleId = vi.fn();
const mockReplaceRolePermissions = vi.fn();

vi.mock('../repository.js', () => ({
  findAllPermissions: (...args: unknown[]) => mockFindAllPermissions(...args),
  findAllRolesWithPermissions: (...args: unknown[]) => mockFindAllRolesWithPermissions(...args),
  findRoleById: (...args: unknown[]) => mockFindRoleById(...args),
  findPermissionsByKeys: (...args: unknown[]) => mockFindPermissionsByKeys(...args),
  findPermissionsByRoleId: (...args: unknown[]) => mockFindPermissionsByRoleId(...args),
  replaceRolePermissions: (...args: unknown[]) => mockReplaceRolePermissions(...args),
  // mantido para compatibilidade com outros módulos que importam via repository.js
  findAllRoles: vi.fn().mockResolvedValue([]),
  findRolesByUserIds: vi.fn().mockResolvedValue([]),
}));

// Mock db/client (necessário pelo Drizzle)
vi.mock('../../../db/client.js', () => ({
  db: {
    transaction: vi
      .fn()
      .mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({})),
  },
  pool: { end: vi.fn() },
}));

// Mock audit
vi.mock('../../../lib/audit.js', () => ({
  auditLog: vi.fn().mockResolvedValue('audit-id'),
}));

// Mock pg
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
// Fixtures
// ---------------------------------------------------------------------------

const BASE_ROLE = {
  id: 'd4e5f6a7-b8c9-0123-defa-234567890123',
  key: 'admin',
  label: 'Administrador',
  description: 'Acesso total ao sistema',
  scope: 'global' as const,
};

// ---------------------------------------------------------------------------
// toRoleResponse
// ---------------------------------------------------------------------------

describe('toRoleResponse', () => {
  it('mapeia RoleRow com scope=global e permissões corretamente', async () => {
    const { toRoleResponse } = await import('../service.js');

    const result = toRoleResponse(BASE_ROLE, ['users:manage', 'audit:read']);

    expect(result).toEqual({
      id: BASE_ROLE.id,
      key: 'admin',
      name: 'Administrador',
      scope: 'global',
      description: 'Acesso total ao sistema',
      permissions: ['users:manage', 'audit:read'],
    });
  });

  it('mapeia RoleRow com scope=city e permissions vazio', async () => {
    const { toRoleResponse } = await import('../service.js');

    const row = {
      id: 'e5f6a7b8-c9d0-1234-efab-345678901234',
      key: 'agente',
      label: 'Agente de Crédito',
      description: null,
      scope: 'city' as const,
    };

    const result = toRoleResponse(row, []);

    expect(result).toEqual({
      id: row.id,
      key: 'agente',
      name: 'Agente de Crédito',
      scope: 'city',
      description: null,
      permissions: [],
    });
  });

  it('preserva scope da coluna independente do key (sem derivação em runtime)', async () => {
    const { toRoleResponse } = await import('../service.js');

    // Simula admin com scope=city persistido no banco — deve ser preservado.
    const row = {
      id: 'f6a7b8c9-d0e1-2345-fabc-456789012345',
      key: 'admin',
      label: 'Admin Limitado',
      description: null,
      scope: 'city' as const,
    };

    const result = toRoleResponse(row, []);
    expect(result.scope).toBe('city');
  });

  it('todas as 6 roles canônicas têm scope correto conforme doc 10 §3.1', async () => {
    const { toRoleResponse } = await import('../service.js');

    const canonicalMapping: Array<{ key: string; scope: 'global' | 'city' }> = [
      { key: 'admin', scope: 'global' },
      { key: 'gestor_geral', scope: 'global' },
      { key: 'gestor_regional', scope: 'city' },
      { key: 'agente', scope: 'city' },
      { key: 'operador', scope: 'city' },
      { key: 'leitura', scope: 'city' },
    ];

    for (const { key, scope } of canonicalMapping) {
      const row = {
        id: crypto.randomUUID(),
        key,
        label: key,
        description: null,
        scope,
      };
      const result = toRoleResponse(row, []);
      expect(result.scope, `key=${key} deve ter scope=${scope} (doc 10 §3.1)`).toBe(scope);
    }
  });
});

// ---------------------------------------------------------------------------
// listRoles
// ---------------------------------------------------------------------------

describe('listRoles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('agrega permissões por role a partir de RoleWithPermissionRow[]', async () => {
    const { listRoles } = await import('../service.js');

    // Simula rows do LEFT JOIN: admin com 2 permissões, agente com 1
    mockFindAllRolesWithPermissions.mockResolvedValue([
      {
        id: 'd4e5f6a7-b8c9-0123-defa-234567890123',
        key: 'admin',
        label: 'Administrador',
        description: 'Acesso total',
        scope: 'global',
        permissionKey: 'audit:read',
      },
      {
        id: 'd4e5f6a7-b8c9-0123-defa-234567890123',
        key: 'admin',
        label: 'Administrador',
        description: 'Acesso total',
        scope: 'global',
        permissionKey: 'users:manage',
      },
      {
        id: 'e5f6a7b8-c9d0-1234-efab-345678901234',
        key: 'agente',
        label: 'Agente',
        description: null,
        scope: 'city',
        permissionKey: 'leads:read',
      },
    ]);

    const result = await listRoles({} as Parameters<typeof listRoles>[0]);

    expect(result.data).toHaveLength(2);

    const adminRole = result.data.find((r) => r.key === 'admin');
    expect(adminRole).toBeDefined();
    expect(adminRole?.permissions).toEqual(['audit:read', 'users:manage']);

    const agenteRole = result.data.find((r) => r.key === 'agente');
    expect(agenteRole).toBeDefined();
    expect(agenteRole?.permissions).toEqual(['leads:read']);
  });

  it('role sem permissões retorna permissions: []', async () => {
    const { listRoles } = await import('../service.js');

    // LEFT JOIN retorna null em permissionKey quando não há permissões
    mockFindAllRolesWithPermissions.mockResolvedValue([
      {
        id: 'e5f6a7b8-c9d0-1234-efab-345678901234',
        key: 'leitura',
        label: 'Leitura',
        description: null,
        scope: 'city',
        permissionKey: null,
      },
    ]);

    const result = await listRoles({} as Parameters<typeof listRoles>[0]);

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.permissions).toEqual([]);
  });

  it('retorna lista vazia quando não há roles', async () => {
    const { listRoles } = await import('../service.js');

    mockFindAllRolesWithPermissions.mockResolvedValue([]);

    const result = await listRoles({} as Parameters<typeof listRoles>[0]);

    expect(result.data).toHaveLength(0);
  });

  it('nenhuma role retorna scope nulo após backfill (invariante doc 10 §3.1)', async () => {
    const { listRoles } = await import('../service.js');

    mockFindAllRolesWithPermissions.mockResolvedValue([
      {
        id: crypto.randomUUID(),
        key: 'admin',
        label: 'Admin',
        description: null,
        scope: 'global',
        permissionKey: null,
      },
      {
        id: crypto.randomUUID(),
        key: 'gestor_geral',
        label: 'Gestor Geral',
        description: null,
        scope: 'global',
        permissionKey: null,
      },
      {
        id: crypto.randomUUID(),
        key: 'gestor_regional',
        label: 'Gestor Regional',
        description: null,
        scope: 'city',
        permissionKey: null,
      },
      {
        id: crypto.randomUUID(),
        key: 'agente',
        label: 'Agente',
        description: null,
        scope: 'city',
        permissionKey: null,
      },
      {
        id: crypto.randomUUID(),
        key: 'operador',
        label: 'Operador',
        description: null,
        scope: 'city',
        permissionKey: null,
      },
      {
        id: crypto.randomUUID(),
        key: 'leitura',
        label: 'Leitura',
        description: null,
        scope: 'city',
        permissionKey: null,
      },
    ]);

    const result = await listRoles({} as Parameters<typeof listRoles>[0]);

    for (const role of result.data) {
      expect(
        role.scope,
        `role key=${role.key} não deve ter scope nulo após backfill`,
      ).toBeDefined();
      expect(['global', 'city']).toContain(role.scope);
    }
  });
});

// ---------------------------------------------------------------------------
// getModuleLabel
// ---------------------------------------------------------------------------

describe('getModuleLabel', () => {
  it('mapeia prefixos CRM & Leads', async () => {
    const { getModuleLabel } = await import('../service.js');

    expect(getModuleLabel('leads:read')).toBe('CRM & Leads');
    expect(getModuleLabel('leads:write')).toBe('CRM & Leads');
    expect(getModuleLabel('customers:read')).toBe('CRM & Leads');
    expect(getModuleLabel('kanban:move')).toBe('CRM & Leads');
    expect(getModuleLabel('crm:view')).toBe('CRM & Leads');
  });

  it('mapeia prefixos Live chat & Canais', async () => {
    const { getModuleLabel } = await import('../service.js');

    expect(getModuleLabel('livechat:read')).toBe('Live chat & Canais');
    expect(getModuleLabel('channel.connect')).toBe('Live chat & Canais');
    expect(getModuleLabel('channels:manage')).toBe('Live chat & Canais');
  });

  it('mapeia prefixos Crédito', async () => {
    const { getModuleLabel } = await import('../service.js');

    expect(getModuleLabel('simulations:create')).toBe('Crédito');
    expect(getModuleLabel('credit_analyses:read')).toBe('Crédito');
    expect(getModuleLabel('analyses:write')).toBe('Crédito');
    expect(getModuleLabel('credit_products:read')).toBe('Crédito');
  });

  it('mapeia prefixos Contratos, Cobrança, Templates, Tarefas, IA, Relatórios, Administração', async () => {
    const { getModuleLabel } = await import('../service.js');

    expect(getModuleLabel('contracts:sign')).toBe('Contratos');
    expect(getModuleLabel('billing:view')).toBe('Cobrança & Follow-up');
    expect(getModuleLabel('spc:query')).toBe('Cobrança & Follow-up');
    expect(getModuleLabel('collection:manage')).toBe('Cobrança & Follow-up');
    expect(getModuleLabel('followup:manage')).toBe('Cobrança & Follow-up');
    expect(getModuleLabel('templates:write')).toBe('Templates');
    expect(getModuleLabel('tasks:create')).toBe('Tarefas & Notificações');
    expect(getModuleLabel('notifications:send')).toBe('Tarefas & Notificações');
    expect(getModuleLabel('ai_agent:run')).toBe('IA');
    expect(getModuleLabel('assistant:query')).toBe('IA');
    expect(getModuleLabel('reports:export')).toBe('Relatórios & Dashboard');
    expect(getModuleLabel('dashboard:read')).toBe('Relatórios & Dashboard');
    expect(getModuleLabel('users:manage')).toBe('Administração');
    expect(getModuleLabel('agents:manage')).toBe('Administração');
    expect(getModuleLabel('cities:manage')).toBe('Administração');
    expect(getModuleLabel('flags:manage')).toBe('Administração');
    expect(getModuleLabel('audit:read')).toBe('Administração');
    expect(getModuleLabel('tutorials:manage')).toBe('Administração');
    expect(getModuleLabel('law_firms:read')).toBe('Administração');
    expect(getModuleLabel('imports:run')).toBe('Administração');
    expect(getModuleLabel('dlq:manage')).toBe('Administração');
  });

  it('prefixo desconhecido retorna Outros', async () => {
    const { getModuleLabel } = await import('../service.js');

    expect(getModuleLabel('unknown:action')).toBe('Outros');
    expect(getModuleLabel('xyz:foo')).toBe('Outros');
    expect(getModuleLabel('')).toBe('Outros');
  });
});

// ---------------------------------------------------------------------------
// listPermissions
// ---------------------------------------------------------------------------

describe('listPermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enriquece permissões com module e ordena por módulo depois key', async () => {
    const { listPermissions } = await import('../service.js');

    mockFindAllPermissions.mockResolvedValue([
      { id: 'id-1', key: 'users:manage', description: 'Gerenciar usuários' },
      { id: 'id-2', key: 'leads:read', description: 'Listar leads' },
      { id: 'id-3', key: 'audit:read', description: 'Ler logs de auditoria' },
      { id: 'id-4', key: 'simulations:create', description: 'Criar simulações' },
    ]);

    const result = await listPermissions({} as Parameters<typeof listPermissions>[0]);

    expect(result.data).toHaveLength(4);

    // Espera ordenação: CRM & Leads < Crédito < Administração (por localeCompare pt-BR)
    // Dentro de cada módulo, ordenado por key
    const modules = result.data.map((p) => p.module);
    const keys = result.data.map((p) => p.key);

    // Verificar agrupamento correto
    expect(result.data.find((p) => p.key === 'leads:read')?.module).toBe('CRM & Leads');
    expect(result.data.find((p) => p.key === 'simulations:create')?.module).toBe('Crédito');
    expect(result.data.find((p) => p.key === 'users:manage')?.module).toBe('Administração');
    expect(result.data.find((p) => p.key === 'audit:read')?.module).toBe('Administração');

    // Dentro de Administração: audit:read vem antes de users:manage (a < u)
    const adminKeys = result.data.filter((p) => p.module === 'Administração').map((p) => p.key);
    expect(adminKeys).toEqual(['audit:read', 'users:manage']);

    // modules deve estar ordenado (cada item >= anterior)
    for (let i = 1; i < modules.length; i++) {
      const prev = modules[i - 1];
      const curr = modules[i];
      if (prev !== undefined && curr !== undefined) {
        const cmp = prev.localeCompare(curr, 'pt-BR');
        expect(cmp, `módulo "${prev}" deve ser <= "${curr}"`).toBeLessThanOrEqual(0);
      }
    }

    // Verificar description é passada corretamente
    expect(result.data.find((p) => p.key === 'leads:read')?.description).toBe('Listar leads');

    void modules;
    void keys;
  });

  it('retorna lista vazia quando catálogo está vazio', async () => {
    const { listPermissions } = await import('../service.js');

    mockFindAllPermissions.mockResolvedValue([]);

    const result = await listPermissions({} as Parameters<typeof listPermissions>[0]);

    expect(result.data).toHaveLength(0);
  });
});
