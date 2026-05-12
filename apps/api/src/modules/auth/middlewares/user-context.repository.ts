// =============================================================================
// user-context.repository.ts — Queries de suporte ao middleware authenticate.
//
// Responsabilidade única: carregar permissões e escopos de cidade de um
// usuário a partir do banco, para popular `request.user` após validação JWT.
//
// Separado do repository.ts principal para manter a coesão: este arquivo
// pertence à camada de middleware, não à lógica de sessão/login.
//
// Performance: permissões, roles e city_scopes são carregados em paralelo
// (Promise.all) após verificação de status do usuário (early-exit se inativo).
// =============================================================================
import { and, eq, isNull } from 'drizzle-orm';

import type { Database } from '../../../db/client.js';
import {
  permissions,
  rolePermissions,
  roles,
  userCityScopes,
  userRoles,
  users,
} from '../../../db/schema/index.js';

// ---------------------------------------------------------------------------
// Tipos de saída
// ---------------------------------------------------------------------------

export interface UserAuthContext {
  /** Permission keys do usuário via roles (ex: 'leads:read'). */
  permissions: string[];
  /**
   * Escopo de cidade para filtros de repositório:
   *   null     → admin/gestor_geral — sem filtro de cidade (acesso global).
   *   string[] → UUIDs das cidades permitidas (pode ser array vazio se sem escopo).
   *   []       → sem cidade configurada → produz zero linhas em queries filtradas.
   */
  cityScopeIds: string[] | null;
}

// ---------------------------------------------------------------------------
// Roles com acesso global (ignoram user_city_scopes)
// ---------------------------------------------------------------------------

/** Keys de role que têm acesso irrestrito por cidade (doc 10 §3.1). */
const GLOBAL_SCOPE_ROLES = new Set<string>(['admin', 'gestor_geral']);

// ---------------------------------------------------------------------------
// Queries internas
// ---------------------------------------------------------------------------

async function queryUserPermissions(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .select({ key: permissions.key })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(userRoles.userId, userId));

  return rows.map((r) => r.key);
}

async function queryUserRoleKeys(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .select({ key: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));

  return rows.map((r) => r.key);
}

async function queryUserCityScopeIds(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .select({ cityId: userCityScopes.cityId })
    .from(userCityScopes)
    .where(eq(userCityScopes.userId, userId));

  return rows.map((r) => r.cityId);
}

// ---------------------------------------------------------------------------
// Entry point público
// ---------------------------------------------------------------------------

/**
 * Carrega o contexto de autorização completo do usuário a partir do banco.
 *
 * Fluxo:
 *   1. Verifica que o usuário existe, está ativo e não foi soft-deletado.
 *   2. Em paralelo: carrega permissões, role keys e city_scope_ids.
 *   3. Se usuário tem role global (admin/gestor_geral) → cityScopeIds = null.
 *
 * Retorna null se o usuário não existe, está inativo ou foi deletado.
 */
export async function loadUserAuthContext(
  db: Database,
  userId: string,
): Promise<(UserAuthContext & { organizationId: string }) | null> {
  // Early-exit: status + organizationId numa só query
  const statusRows = await db
    .select({ status: users.status, organizationId: users.organizationId })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);

  const userRow = statusRows[0];
  if (!userRow || userRow.status !== 'active') return null;

  const [userPermissions, roleKeys, cityScopeIds] = await Promise.all([
    queryUserPermissions(db, userId),
    queryUserRoleKeys(db, userId),
    queryUserCityScopeIds(db, userId),
  ]);

  const hasGlobalScope = roleKeys.some((k) => GLOBAL_SCOPE_ROLES.has(k));

  return {
    organizationId: userRow.organizationId,
    permissions: userPermissions,
    cityScopeIds: hasGlobalScope ? null : cityScopeIds,
  };
}
