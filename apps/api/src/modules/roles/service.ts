// =============================================================================
// roles/service.ts — Regras de negócio para o módulo de roles (F8-S06).
//
// Responsabilidades:
//   - Derivar `scope` (global | city) a partir do key da role (doc 10 §3.1)
//   - Mapear RoleRow para RoleResponse (label → name)
//   - Nenhuma mutação — GET only, sem audit log
// =============================================================================
import type { Database } from '../../db/client.js';

import { findAllRoles, type RoleRow } from './repository.js';
import type { ListRolesResponse, RoleResponse } from './schemas.js';

// ---------------------------------------------------------------------------
// Keys globais (doc 10 §3.1): têm acesso a todas as cidades da organização.
// Todos os outros keys têm escopo de cidade (filtrado via user_city_scopes).
// ---------------------------------------------------------------------------
const GLOBAL_ROLE_KEYS = new Set(['admin', 'gestor_geral']);

/**
 * Deriva o scope de uma role a partir do seu key.
 * Sem coluna no banco — lógica canônica centralizada aqui.
 */
export function roleKeyToScope(key: string): 'global' | 'city' {
  return GLOBAL_ROLE_KEYS.has(key) ? 'global' : 'city';
}

/**
 * Mapeia RoleRow (DB) → RoleResponse (API).
 * label → name para consistência com a terminologia do frontend.
 */
export function toRoleResponse(row: RoleRow): RoleResponse {
  return {
    id: row.id,
    key: row.key,
    name: row.label,
    scope: roleKeyToScope(row.key),
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
