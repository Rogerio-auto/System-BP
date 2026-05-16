// =============================================================================
// roles/__tests__/service.test.ts — Testes unitários do service de roles (F8-S07).
//
// Cobre:
//   1. toRoleResponse mapeia RoleRow → RoleResponse lendo scope da coluna
//   2. scope é preservado conforme o banco (não derivado em runtime por key)
//   3. todas as 6 roles canônicas: mapeamento key→scope conforme doc 10 §3.1
//   4. listRoles agrega rows usando scope da coluna
// =============================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock apenas o repository para testar o service de forma isolada
const mockFindAllRoles = vi.fn();

vi.mock('../repository.js', () => ({
  findAllRoles: (...args: unknown[]) => mockFindAllRoles(...args),
  findRolesByUserIds: vi.fn().mockResolvedValue([]),
}));

// Mock db/client (necessário pelo Drizzle)
vi.mock('../../../db/client.js', () => ({
  db: {},
  pool: { end: vi.fn() },
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
// toRoleResponse — lê scope da coluna (F8-S07: sem derivação por key)
// ---------------------------------------------------------------------------

describe('toRoleResponse', () => {
  it('mapeia RoleRow com scope=global corretamente', async () => {
    const { toRoleResponse } = await import('../service.js');

    const row = {
      id: 'd4e5f6a7-b8c9-0123-defa-234567890123',
      key: 'admin',
      label: 'Administrador',
      description: 'Acesso total ao sistema',
      scope: 'global' as const,
    };

    const result = toRoleResponse(row);
    expect(result).toEqual({
      id: row.id,
      key: 'admin',
      name: 'Administrador',
      scope: 'global',
      description: 'Acesso total ao sistema',
    });
  });

  it('mapeia RoleRow com scope=city corretamente', async () => {
    const { toRoleResponse } = await import('../service.js');

    const row = {
      id: 'e5f6a7b8-c9d0-1234-efab-345678901234',
      key: 'agente',
      label: 'Agente de Crédito',
      description: null,
      scope: 'city' as const,
    };

    const result = toRoleResponse(row);
    expect(result).toEqual({
      id: row.id,
      key: 'agente',
      name: 'Agente de Crédito',
      scope: 'city',
      description: null,
    });
  });

  it('preserva scope da coluna independente do key (sem derivação em runtime)', async () => {
    const { toRoleResponse } = await import('../service.js');

    // Simula uma role com key 'admin' mas scope 'city' persistido no banco.
    // Se houvesse derivação em runtime (como em F8-S06), scope seria sobreescrito para 'global'.
    // Com leitura da coluna (F8-S07), scope='city' deve ser preservado.
    const row = {
      id: 'f6a7b8c9-d0e1-2345-fabc-456789012345',
      key: 'admin',
      label: 'Admin Limitado',
      description: null,
      scope: 'city' as const,
    };

    const result = toRoleResponse(row);
    expect(result.scope).toBe('city');
  });

  it('todas as 6 roles canônicas têm scope correto conforme doc 10 §3.1', async () => {
    const { toRoleResponse } = await import('../service.js');

    // Mapeamento canonical: doc 10 §3.1
    // global: admin, gestor_geral
    // city:   gestor_regional, agente, operador, leitura
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
        // Simula o valor que viria do banco após migration 0021 (backfill conforme doc 10 §3.1)
        scope,
      };
      const result = toRoleResponse(row);
      expect(result.scope, `key=${key} deve ter scope=${scope} (doc 10 §3.1)`).toBe(scope);
    }
  });
});

// ---------------------------------------------------------------------------
// listRoles — agrega rows lidos do banco com scope da coluna
// ---------------------------------------------------------------------------

describe('listRoles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna ListRolesResponse com scope lido da coluna para roles global e city', async () => {
    const { listRoles } = await import('../service.js');

    mockFindAllRoles.mockResolvedValue([
      {
        id: 'd4e5f6a7-b8c9-0123-defa-234567890123',
        key: 'admin',
        label: 'Administrador',
        description: 'Acesso total',
        scope: 'global' as const,
      },
      {
        id: 'e5f6a7b8-c9d0-1234-efab-345678901234',
        key: 'agente',
        label: 'Agente',
        description: null,
        scope: 'city' as const,
      },
    ]);

    const result = await listRoles({} as Parameters<typeof listRoles>[0]);

    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({ key: 'admin', scope: 'global' });
    expect(result.data[1]).toMatchObject({ key: 'agente', scope: 'city' });
  });

  it('retorna lista vazia quando não há roles', async () => {
    const { listRoles } = await import('../service.js');

    mockFindAllRoles.mockResolvedValue([]);

    const result = await listRoles({} as Parameters<typeof listRoles>[0]);

    expect(result.data).toHaveLength(0);
  });

  it('nenhuma role retorna scope nulo após backfill (invariante doc 10 §3.1)', async () => {
    const { listRoles } = await import('../service.js');

    // Simula todas as 6 roles canônicas com scope backfillado
    mockFindAllRoles.mockResolvedValue([
      {
        id: crypto.randomUUID(),
        key: 'admin',
        label: 'Admin',
        description: null,
        scope: 'global' as const,
      },
      {
        id: crypto.randomUUID(),
        key: 'gestor_geral',
        label: 'Gestor Geral',
        description: null,
        scope: 'global' as const,
      },
      {
        id: crypto.randomUUID(),
        key: 'gestor_regional',
        label: 'Gestor Regional',
        description: null,
        scope: 'city' as const,
      },
      {
        id: crypto.randomUUID(),
        key: 'agente',
        label: 'Agente',
        description: null,
        scope: 'city' as const,
      },
      {
        id: crypto.randomUUID(),
        key: 'operador',
        label: 'Operador',
        description: null,
        scope: 'city' as const,
      },
      {
        id: crypto.randomUUID(),
        key: 'leitura',
        label: 'Leitura',
        description: null,
        scope: 'city' as const,
      },
    ]);

    const result = await listRoles({} as Parameters<typeof listRoles>[0]);

    // Nenhuma role pode ter scope undefined/null após migration 0021
    for (const role of result.data) {
      expect(
        role.scope,
        `role key=${role.key} não deve ter scope nulo após backfill`,
      ).toBeDefined();
      expect(['global', 'city']).toContain(role.scope);
    }
  });
});
