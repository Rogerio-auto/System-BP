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

export async function queryUserPermissions(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .select({ key: permissions.key })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(userRoles.userId, userId));

  return rows.map((r) => r.key);
}

export async function queryUserRoleKeys(db: Database, userId: string): Promise<string[]> {
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
// Helpers exportados para reutilização no fluxo pre-auth (login/refresh)
// ---------------------------------------------------------------------------

/**
 * Resolve o escopo de cidade do usuário aplicando a regra "role global → null".
 *
 * Recebe os roleKeys já carregados (evita query duplicada quando o chamador
 * já carregou queryUserRoleKeys em paralelo) e faz a query de city scopes
 * apenas se necessário (roles não-globais).
 *
 * Reutilizada pelo auth/service.ts no fluxo pre-auth (login/verify-2fa/refresh)
 * onde request.user ainda não está disponível.
 *
 * @param roleKeys - Array de role keys do usuário (ex: ['gestor_regional'])
 * @returns null para roles globais (admin/gestor_geral); string[] para demais.
 */
export async function queryUserCityScopeIdsResolved(
  db: Database,
  userId: string,
  roleKeys: string[],
): Promise<string[] | null> {
  const hasGlobalScope = roleKeys.some((k) => GLOBAL_SCOPE_ROLES.has(k));
  if (hasGlobalScope) return null;
  return queryUserCityScopeIds(db, userId);
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
    // Role keys mesclados nas permissions para que o frontend e o feature-flag
    // controller possam verificar role (ex: 'admin', 'gestor_geral') via hasPermission.
    permissions: [...userPermissions, ...roleKeys],
    cityScopeIds: hasGlobalScope ? null : cityScopeIds,
  };
}
