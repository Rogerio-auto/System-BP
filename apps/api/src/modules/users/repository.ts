// =============================================================================
// users/repository.ts — Queries Drizzle para gestão de usuários (F1-S07).
//
// Todas as queries recebem a instância `db` por injeção de dependência
// para facilitar testes unitários (mock do db).
//
// Nota: users não tem campo city_id diretamente — o escopo de cidade está em
// user_city_scopes. O applyCityScope aqui não é usado diretamente (admin vê
// todos os usuários da org), mas as queries respeitam organizationId.
// =============================================================================
import { and, count, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { roles, userCityScopes, userRoles, users } from '../../db/schema/index.js';
import type { User } from '../../db/schema/users.js';

import type { ListUsersQuery } from './schemas.js';

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

export interface PaginatedUsers {
  data: User[];
  total: number;
}

export interface CreateUserInput {
  organizationId: string;
  email: string;
  passwordHash: string;
  fullName: string;
  status: 'active' | 'disabled' | 'pending';
}

export interface UpdateUserInput {
  fullName?: string;
  status?: 'active' | 'disabled' | 'pending';
  email?: string;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Lista usuários da organização com paginação e search opcional.
 * Nunca retorna campos sensíveis — o schema do Drizzle não os inclui aqui.
 */
export async function findUsers(
  db: Database,
  organizationId: string,
  query: ListUsersQuery,
): Promise<PaginatedUsers> {
  const { page, limit, search, active } = query;
  const offset = (page - 1) * limit;

  // Construir condições base
  const conditions = [eq(users.organizationId, organizationId), isNull(users.deletedAt)];

  if (active !== undefined) {
    if (active) {
      conditions.push(
        // `as` justificado: sql`` retorna SQL<unknown> mas é compatível com SQL condition
        sql`${users.status} = 'active'` as ReturnType<typeof eq>,
      );
    } else {
      conditions.push(sql`${users.status} != 'active'` as ReturnType<typeof eq>);
    }
  }

  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      // `as` justificado: or() com ilike retorna SQL compatível com and()
      or(ilike(users.fullName, pattern), ilike(users.email, pattern)) as ReturnType<typeof eq>,
    );
  }

  const where = and(...conditions);

  const [rows, totalRows] = await Promise.all([
    db.select().from(users).where(where).orderBy(users.createdAt).limit(limit).offset(offset),
    db.select({ count: count() }).from(users).where(where),
  ]);

  return {
    data: rows,
    total: totalRows[0]?.count ?? 0,
  };
}

/**
 * Busca um usuário pelo ID dentro da organização.
 * Retorna null se não encontrado ou deletado.
 */
export async function findUserById(
  db: Database,
  id: string,
  organizationId: string,
): Promise<User | null> {
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), eq(users.organizationId, organizationId), isNull(users.deletedAt)))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Busca um usuário pelo email dentro da organização (sem filtro de deletedAt).
 * Usado para verificar duplicidade de email antes de criar.
 */
export async function findUserByEmailInOrg(
  db: Database,
  email: string,
  organizationId: string,
): Promise<User | null> {
  const rows = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.email, email),
        eq(users.organizationId, organizationId),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Cria um usuário.
 * A senha temporária deve ser hasheada ANTES de chamar esta função.
 */
export async function createUser(db: Database, input: CreateUserInput): Promise<User> {
  const rows = await db
    .insert(users)
    .values({
      organizationId: input.organizationId,
      email: input.email,
      passwordHash: input.passwordHash,
      fullName: input.fullName,
      status: input.status,
    })
    .returning();

  const user = rows[0];
  if (!user) throw new Error('Falha ao criar usuário — insert não retornou linha');
  return user;
}

/**
 * Atualiza campos de um usuário.
 * Retorna null se usuário não encontrado.
 */
export async function updateUser(
  db: Database,
  id: string,
  organizationId: string,
  input: UpdateUserInput,
): Promise<User | null> {
  const rows = await db
    .update(users)
    .set(input)
    .where(and(eq(users.id, id), eq(users.organizationId, organizationId), isNull(users.deletedAt)))
    .returning();

  return rows[0] ?? null;
}

/**
 * Deativate (soft-delete) — seta deletedAt e status 'disabled'.
 * Retorna null se não encontrado.
 */
export async function deactivateUser(
  db: Database,
  id: string,
  organizationId: string,
): Promise<User | null> {
  const rows = await db
    .update(users)
    .set({
      deletedAt: new Date(),
      status: 'disabled',
      updatedAt: new Date(),
    })
    .where(and(eq(users.id, id), eq(users.organizationId, organizationId), isNull(users.deletedAt)))
    .returning();

  return rows[0] ?? null;
}

/**
 * Reativar — limpa deletedAt e seta status 'active'.
 * Busca por id + org, independente de deletedAt (para poder reativar).
 */
export async function reactivateUser(
  db: Database,
  id: string,
  organizationId: string,
): Promise<User | null> {
  const rows = await db
    .update(users)
    .set({
      deletedAt: null,
      status: 'active',
      updatedAt: new Date(),
    })
    .where(and(eq(users.id, id), eq(users.organizationId, organizationId)))
    .returning();

  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/**
 * Retorna as roles de um usuário.
 */
export async function findUserRoles(
  db: Database,
  userId: string,
): Promise<Array<{ id: string; key: string; label: string }>> {
  const rows = await db
    .select({ id: roles.id, key: roles.key, label: roles.label })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));

  return rows;
}

/**
 * Batch-load das roles de múltiplos usuários em uma única query (sem N+1).
 * Usado pela listagem de usuários para incluir roles no payload de cada item.
 *
 * @param userIds - IDs dos usuários da página atual
 * @returns rows com userId + dados da role para agrupamento no service
 */
export async function findRolesByUserIds(
  db: Database,
  userIds: string[],
): Promise<Array<{ userId: string; id: string; key: string; label: string }>> {
  if (userIds.length === 0) return [];

  const rows = await db
    .select({
      userId: userRoles.userId,
      id: roles.id,
      key: roles.key,
      label: roles.label,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    // `as` justificado: inArray retorna SQL<unknown> mas é condição válida para where()
    .where(inArray(userRoles.userId, userIds) as ReturnType<typeof eq>);

  return rows;
}

/**
 * Substitui completamente as roles de um usuário.
 * Deleta todas as roles existentes e insere as novas.
 * Deve ser chamado dentro de uma transação.
 */
export async function replaceUserRoles(
  db: Database,
  userId: string,
  roleIds: string[],
): Promise<void> {
  // Deletar todas as roles existentes do usuário
  await db.delete(userRoles).where(eq(userRoles.userId, userId));

  if (roleIds.length > 0) {
    await db.insert(userRoles).values(roleIds.map((roleId) => ({ userId, roleId })));
  }
}

/**
 * Verifica se uma role existe pelo ID.
 */
export async function roleExistsById(db: Database, roleId: string): Promise<boolean> {
  const rows = await db.select({ id: roles.id }).from(roles).where(eq(roles.id, roleId)).limit(1);

  return rows.length > 0;
}

/**
 * Conta quantos usuários da organização têm a role 'admin'.
 * Usado para a regra de self-protection.
 */
export async function countAdminUsers(db: Database, organizationId: string): Promise<number> {
  const rows = await db
    .select({ count: count() })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .innerJoin(users, eq(userRoles.userId, users.id))
    .where(
      and(
        eq(users.organizationId, organizationId),
        eq(roles.key, 'admin'),
        isNull(users.deletedAt),
      ),
    );

  return rows[0]?.count ?? 0;
}

// ---------------------------------------------------------------------------
// City Scopes
// ---------------------------------------------------------------------------

/**
 * Retorna os city scopes de um usuário.
 */
export async function findUserCityScopes(
  db: Database,
  userId: string,
): Promise<Array<{ cityId: string; isPrimary: boolean }>> {
  const rows = await db
    .select({ cityId: userCityScopes.cityId, isPrimary: userCityScopes.isPrimary })
    .from(userCityScopes)
    .where(eq(userCityScopes.userId, userId));

  return rows;
}

/**
 * Substitui completamente os city scopes de um usuário.
 * O primeiro da lista (se existir) é marcado como isPrimary.
 * Deve ser chamado dentro de uma transação.
 */
export async function replaceUserCityScopes(
  db: Database,
  userId: string,
  cityIds: string[],
): Promise<void> {
  // Deletar todos os scopes existentes
  await db.delete(userCityScopes).where(eq(userCityScopes.userId, userId));

  if (cityIds.length > 0) {
    await db.insert(userCityScopes).values(
      cityIds.map((cityId, idx) => ({
        userId,
        cityId,
        isPrimary: idx === 0,
      })),
    );
  }
}
