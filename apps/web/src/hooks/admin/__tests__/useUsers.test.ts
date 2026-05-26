// =============================================================================
// __tests__/useUsers.test.ts — Testes do schema Zod de roles (F8-S12).
//
// Estratégia: testa lógica pura do parse de RoleResponseSchema.
// Confirma que o campo `name` (não `label`) é esperado do backend.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Replica do RoleResponseSchema (mesma lógica de useUsers.ts após F8-S12)
// ---------------------------------------------------------------------------

const RoleResponseSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  name: z.string(),
  scope: z.enum(['global', 'city']).optional(),
  description: z.string().nullable().optional(),
});

const RolesListResponseSchema = z.object({
  data: z.array(RoleResponseSchema),
});

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';

// ---------------------------------------------------------------------------
// Testes: RoleResponseSchema
// ---------------------------------------------------------------------------

describe('RoleResponseSchema — campo name (não label)', () => {
  it('aceita payload com campo name (formato canônico do backend)', () => {
    const payload = {
      id: VALID_UUID,
      key: 'admin',
      name: 'Administrador',
    };
    const result = RoleResponseSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Administrador');
    }
  });

  it('aceita payload com name + scope opcional', () => {
    const payload = {
      id: VALID_UUID,
      key: 'gestor_geral',
      name: 'Gestor Geral',
      scope: 'global',
    };
    const result = RoleResponseSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('aceita payload com name + description', () => {
    const payload = {
      id: VALID_UUID,
      key: 'agente',
      name: 'Agente',
      description: 'Agente de atendimento',
    };
    const result = RoleResponseSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('rejeita payload com label em vez de name (bug original F8-S12)', () => {
    const payload = {
      id: VALID_UUID,
      key: 'admin',
      label: 'Administrador', // campo errado — backend retorna `name`
    };
    const result = RoleResponseSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('scope é opcional — aceita sem ele', () => {
    const payload = { id: VALID_UUID, key: 'leitura', name: 'Leitura' };
    const result = RoleResponseSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scope).toBeUndefined();
    }
  });

  it('rejeita scope com valor inválido', () => {
    const payload = { id: VALID_UUID, key: 'leitura', name: 'Leitura', scope: 'invalid' };
    const result = RoleResponseSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Testes: mapeamento name → label (adapter de UI)
// ---------------------------------------------------------------------------

describe('apiListRoles — adapter name→label', () => {
  /** Simula o mapeamento feito em apiListRoles() após fix F8-S12. */
  function mapRolesToOptions(
    data: Array<{ id: string; key: string; name: string }>,
  ): Array<{ id: string; key: string; label: string; isGlobal: boolean }> {
    return data.map((r) => ({
      id: r.id,
      key: r.key,
      label: r.name, // mapeia name→label para a UI
      isGlobal: r.key === 'admin' || r.key === 'gestor_geral',
    }));
  }

  it('mapeia name para label na RoleOption', () => {
    const parsed = [{ id: VALID_UUID, key: 'admin', name: 'Administrador' }];
    const options = mapRolesToOptions(parsed);
    expect(options[0]?.label).toBe('Administrador');
  });

  it('marca admin como isGlobal=true', () => {
    const options = mapRolesToOptions([{ id: VALID_UUID, key: 'admin', name: 'Administrador' }]);
    expect(options[0]?.isGlobal).toBe(true);
  });

  it('marca gestor_geral como isGlobal=true', () => {
    const options = mapRolesToOptions([
      { id: VALID_UUID, key: 'gestor_geral', name: 'Gestor Geral' },
    ]);
    expect(options[0]?.isGlobal).toBe(true);
  });

  it('marca agente como isGlobal=false', () => {
    const options = mapRolesToOptions([{ id: VALID_UUID, key: 'agente', name: 'Agente' }]);
    expect(options[0]?.isGlobal).toBe(false);
  });

  it('retorna lista não-vazia com fixture canônica do backend', () => {
    const backendFixture = [
      { id: VALID_UUID, key: 'admin', name: 'Administrador' },
      { id: '223e4567-e89b-12d3-a456-426614174001', key: 'gestor_geral', name: 'Gestor Geral' },
      { id: '323e4567-e89b-12d3-a456-426614174002', key: 'agente', name: 'Agente' },
    ];
    const options = mapRolesToOptions(backendFixture);
    expect(options).toHaveLength(3);
    expect(options.every((o) => o.label.length > 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Testes: RolesListResponseSchema (full response parse)
// ---------------------------------------------------------------------------

describe('RolesListResponseSchema — parse do payload completo', () => {
  it('parseia lista de roles com campo name', () => {
    const payload = {
      data: [
        { id: VALID_UUID, key: 'admin', name: 'Administrador' },
        { id: '223e4567-e89b-12d3-a456-426614174001', key: 'agente', name: 'Agente' },
      ],
    };
    const result = RolesListResponseSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data).toHaveLength(2);
    }
  });

  it('rejeita se qualquer role tiver label em vez de name', () => {
    const payload = {
      data: [
        { id: VALID_UUID, key: 'admin', label: 'Admin' }, // bug: label em vez de name
      ],
    };
    const result = RolesListResponseSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });
});
