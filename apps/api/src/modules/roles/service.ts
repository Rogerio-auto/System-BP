// =============================================================================
// roles/service.ts — Regras de negócio para o módulo de roles (F8-S07).
//
// Responsabilidades:
//   - Mapear RoleRow para RoleResponse (label → name)
//   - `scope` é lido da coluna roles.scope — NÃO derivado do key em runtime
//   - Nenhuma mutação — GET only, sem audit log
// =============================================================================
import type { Database } from '../../db/client.js';

import { findAllRoles, type RoleRow } from './repository.js';
import type { ListRolesResponse, RoleResponse } from './schemas.js';

/**
 * Mapeia RoleRow (DB) → RoleResponse (API).
 * label → name para consistência com a terminologia do frontend.
 * scope lido diretamente da coluna (migration 0021) — sem derivação por key.
 */
export function toRoleResponse(row: RoleRow): RoleResponse {
  return {
    id: row.id,
    key: row.key,
    name: row.label,
    scope: row.scope,
    description: row.description,
  };
}

// ---------------------------------------------------------------------------
// Service: listar roles
// ---------------------------------------------------------------------------

export async function listRoles(db: Database): Promise<ListRolesResponse> {
  const rows = await findAllRoles(db);
  return { data: rows.map(toRoleResponse) };
}
