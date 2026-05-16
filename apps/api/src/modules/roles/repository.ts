// =============================================================================
// roles/repository.ts — Queries Drizzle para o módulo de roles (F8-S07).
// =============================================================================
import { asc, eq, inArray } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { roles, userRoles } from '../../db/schema/index.js';

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

export interface UserRoleRow {
  userId: string;
  roleId: string;
  key: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

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
