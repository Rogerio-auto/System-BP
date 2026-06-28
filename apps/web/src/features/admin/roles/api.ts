// =============================================================================
// features/admin/roles/api.ts — Tipos e funções de acesso à API de papéis.
//
// Contratos (backend em construção paralela):
//   GET  /api/admin/permissions → { data: PermissionDto[] }
//   GET  /api/admin/roles       → { data: RoleDto[] }
//   PUT  /api/admin/roles/:id/permissions → RoleDto (substituição total)
// =============================================================================

import { api } from '../../../lib/api';

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface PermissionDto {
  key: string;
  description: string;
  module: string;
}

export interface RoleDto {
  id: string;
  key: string;
  name: string;
  scope: 'global' | 'city';
  description: string | null;
  permissions: string[];
}

// ─── API helpers ─────────────────────────────────────────────────────────────

export async function fetchPermissions(): Promise<PermissionDto[]> {
  const res = await api.get<{ data: PermissionDto[] }>('/api/admin/permissions');
  return res.data;
}

export async function fetchRoles(): Promise<RoleDto[]> {
  const res = await api.get<{ data: RoleDto[] }>('/api/admin/roles');
  return res.data;
}

export async function updateRolePermissions(
  roleId: string,
  permissions: string[],
): Promise<RoleDto> {
  return api.put<RoleDto>(`/api/admin/roles/${encodeURIComponent(roleId)}/permissions`, {
    permissions,
  });
}
