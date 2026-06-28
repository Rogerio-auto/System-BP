// =============================================================================
// roles/repository.ts — Queries Drizzle para o módulo de roles.
// =============================================================================
import { asc, eq, inArray } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { permissions, rolePermissions, roles, userRoles } from '../../db/schema/index.js';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface RoleRow {
  id: string;
  key: string;
  label: string;
  description: string | null;
  /** Escopo lido da coluna roles.scope (NOT NULL após migration 0021). */
  scope: 'global' | 'city';
}

export interface RoleWithPermissionRow extends RoleRow {
  /**
   * Chave da permissão atribuída ao role (LEFT JOIN — null quando o role
   * não tem permissões atribuídas, ou quando a linha de rolePermissions
   * não encontrou correspondência em permissions).
   */
  permissionKey: string | null;
}

export interface PermissionRow {
  id: string;
  key: string;
  description: string;
}

export interface UserRoleRow {
  userId: string;
  roleId: string;
  key: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Queries — permissões
// ---------------------------------------------------------------------------

/**
 * Retorna todas as permissões do catálogo, ordenadas por key.
 */
export async function findAllPermissions(db: Database): Promise<PermissionRow[]> {
  return db
    .select({
      id: permissions.id,
      key: permissions.key,
      description: permissions.description,
    })
    .from(permissions)
    .orderBy(asc(permissions.key));
}

/**
 * Retorna permissões cujos keys estão na lista fornecida.
 * Usado para validar keys enviadas pelo cliente e resolver key→id.
 * Retorna vazio imediatamente para lista vazia (evita SQL inválido).
 */
export async function findPermissionsByKeys(
  db: Database,
  keys: string[],
): Promise<Array<{ id: string; key: string }>> {
  if (keys.length === 0) return [];
  return db
    .select({ id: permissions.id, key: permissions.key })
    .from(permissions)
    .where(inArray(permissions.key, keys));
}

/**
 * Retorna as permissões atualmente atribuídas a um role, ordenadas por key.
 * Usado para capturar o estado `before` no audit log de atualização.
 */
export async function findPermissionsByRoleId(
  db: Database,
  roleId: string,
): Promise<Array<{ id: string; key: string }>> {
  return db
    .select({ id: permissions.id, key: permissions.key })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(rolePermissions.roleId, roleId))
    .orderBy(asc(permissions.key));
}

/**
 * Substitui TODAS as permissões de um role em uma única transação:
 *   1. Deleta todos os role_permissions existentes para o roleId.
 *   2. Insere os novos (se houver).
 *
 * Deve ser chamado dentro de uma transação Drizzle ativa.
 * O caller é responsável pelo commit/rollback.
 *
 * @param db         Instância de Database ou transação (tx as unknown as Database).
 * @param roleId     UUID do role a ser atualizado.
 * @param permissionIds  Lista de UUIDs de permissão a atribuir.
 */
export async function replaceRolePermissions(
  db: Database,
  roleId: string,
  permissionIds: string[],
): Promise<void> {
  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));

  if (permissionIds.length > 0) {
    await db
      .insert(rolePermissions)
      .values(permissionIds.map((permissionId) => ({ roleId, permissionId })));
  }
}

// ---------------------------------------------------------------------------
// Queries — roles
// ---------------------------------------------------------------------------

/**
 * Retorna todas as roles com suas permissões via LEFT JOIN (sem N+1).
 *
 * Cada role aparece uma vez por permissão atribuída. Se o role não tiver
 * permissões, aparece uma vez com `permissionKey: null`.
 *
 * O caller deve agregar por `id` para montar o campo `permissions: string[]`.
 */
export async function findAllRolesWithPermissions(db: Database): Promise<RoleWithPermissionRow[]> {
  return db
    .select({
      id: roles.id,
      key: roles.key,
      label: roles.label,
      description: roles.description,
      scope: roles.scope,
      permissionKey: permissions.key,
    })
    .from(roles)
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .orderBy(asc(roles.key), asc(permissions.key));
}

/**
 * Retorna todas as roles da instância, ordenadas por key.
 * Roles são globais (não por organização) — todas estão disponíveis para
 * qualquer org. Ordenadas por key para resposta estável.
 * `scope` é lido diretamente da coluna (não derivado em runtime).
 */
export async function findAllRoles(db: Database): Promise<RoleRow[]> {
  return db
    .select({
      id: roles.id,
      key: roles.key,
      label: roles.label,
      description: roles.description,
      scope: roles.scope,
    })
    .from(roles)
    .orderBy(asc(roles.key));
}

/**
 * Retorna um role pelo UUID. Retorna undefined se não encontrado.
 */
export async function findRoleById(db: Database, id: string): Promise<RoleRow | undefined> {
  const rows = await db
    .select({
      id: roles.id,
      key: roles.key,
      label: roles.label,
      description: roles.description,
      scope: roles.scope,
    })
    .from(roles)
    .where(eq(roles.id, id))
    .limit(1);

  return rows[0];
}

/**
 * Retorna as roles de um conjunto de usuários em uma única query (sem N+1).
 * Usado pela listagem de usuários para incluir roles no payload.
 *
 * @param userIds - lista de IDs de usuário da página atual
 * @returns rows com userId, roleId, key e label para mapeamento no service
 */
export async function findRolesByUserIds(db: Database, userIds: string[]): Promise<UserRoleRow[]> {
  if (userIds.length === 0) return [];

  return (
    db
      .select({
        userId: userRoles.userId,
        roleId: roles.id,
        key: roles.key,
        label: roles.label,
      })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      // `as` justificado: inArray retorna SQL<unknown> mas é condição válida para where()
      .where(inArray(userRoles.userId, userIds) as ReturnType<typeof eq>)
  );
}
