// =============================================================================
// users/service.ts — Regras de negócio para gestão de usuários (F1-S07).
//
// Responsabilidades:
//   - Gerar senha temporária no create
//   - Validar duplicidade de email
//   - Self-protection: admin não pode remover a última role admin
//   - Audit log em todas as mutações
//   - Orquestrar transações Drizzle
//
// LGPD (doc 17):
//   - before/after em auditLog usam redactSensitive para remover campos
//     sensíveis antes de persistir no log.
//   - tempPassword retornado apenas uma vez no create, nunca logado.
// =============================================================================
import { randomBytes } from 'node:crypto';

import type { Database } from '../../db/client.js';
import type { User } from '../../db/schema/users.js';
import { auditLog } from '../../lib/audit.js';
import { ConflictError, NotFoundError, AppError } from '../../shared/errors.js';
import { passwordHash } from '../../shared/password.js';

import {
  countAdminUsers,
  createUser,
  deactivateUser,
  findUserByEmailInOrg,
  findUserById,
  findUserCityScopes,
  findUserRoles,
  findUsers,
  reactivateUser,
  replaceUserCityScopes,
  replaceUserRoles,
  updateUser,
} from './repository.js';
import type {
  CreateUserBody,
  CreateUserResponse,
  ListUsersQuery,
  ListUsersResponse,
  SetCityScopesBody,
  SetRolesBody,
  UpdateUserBody,
  UserResponse,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Código de erro customizado para last-admin protection
// ---------------------------------------------------------------------------

class CannotRemoveLastAdminError extends AppError {
  constructor() {
    super(422, 'VALIDATION_ERROR', 'Não é possível remover a última role admin da organização', {
      code: 'CANNOT_REMOVE_LAST_ADMIN',
    });
    this.name = 'CannotRemoveLastAdminError';
  }
}

// ---------------------------------------------------------------------------
// Contexto do ator (passado pelo controller a partir de request.user)
// ---------------------------------------------------------------------------

export interface ActorContext {
  userId: string;
  organizationId: string;
  /** Role key do ator — snapshot no momento da ação. */
  role: string;
  ip?: string | null;
  userAgent?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Gera senha temporária de 16 chars base64url (aprox 128 bits de entropia). */
function generateTempPassword(): string {
  return randomBytes(12).toString('base64url');
}

/**
 * Redacta campos sensíveis de um objeto de usuário antes de gravar em audit_log.
 * LGPD §8.5 — o caller é responsável por aplicar redact antes de auditLog().
 */
function redactUser(user: User): Record<string, unknown> {
  const { passwordHash: _ph, totpSecret: _ts, ...safe } = user;
  return safe as Record<string, unknown>;
}

/**
 * Serializa um User para o formato de resposta da API.
 * Nunca inclui password_hash, totp_secret (LGPD).
 */
function toUserResponse(user: User): UserResponse {
  return {
    id: user.id,
    organizationId: user.organizationId,
    email: user.email,
    fullName: user.fullName,
    status: user.status,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    deletedAt: user.deletedAt?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listUsers(
  db: Database,
  actor: ActorContext,
  query: ListUsersQuery,
): Promise<ListUsersResponse> {
  const { data, total } = await findUsers(db, actor.organizationId, query);

  return {
    data: data.map(toUserResponse),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createUserService(
  db: Database,
  actor: ActorContext,
  body: CreateUserBody,
): Promise<CreateUserResponse> {
  // 1. Verificar duplicidade de email na org
  const existing = await findUserByEmailInOrg(db, body.email, actor.organizationId);
  if (existing) {
    throw new ConflictError('Email já cadastrado nesta organização');
  }

  // 2. Gerar senha temporária
  const tempPassword = generateTempPassword();
  const hash = await passwordHash(tempPassword);

  // 3. Criar usuário + atribuir roles + city scopes em transação
  const user = await db.transaction(async (tx) => {
    const created = await createUser(tx as unknown as Database, {
      organizationId: actor.organizationId,
      email: body.email,
      passwordHash: hash,
      fullName: body.fullName,
      status: body.status,
    });

    // Atribuir roles
    await replaceUserRoles(tx as unknown as Database, created.id, body.roleIds);

    // Atribuir city scopes
    if (body.cityIds.length > 0) {
      await replaceUserCityScopes(tx as unknown as Database, created.id, body.cityIds);
    }

    // Audit log
    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: { userId: actor.userId, role: actor.role, ip: actor.ip, userAgent: actor.userAgent },
      action: 'users.create',
      resource: { type: 'user', id: created.id },
      before: null,
      after: redactUser(created),
    });

    return created;
  });

  return {
    ...toUserResponse(user),
    tempPassword,
  };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateUserService(
  db: Database,
  actor: ActorContext,
  targetUserId: string,
  body: UpdateUserBody,
): Promise<UserResponse> {
  const before = await findUserById(db, targetUserId, actor.organizationId);
  if (!before) throw new NotFoundError('Usuário não encontrado');

  // Verificar duplicidade de email se alterado
  if (body.email && body.email !== before.email) {
    const existing = await findUserByEmailInOrg(db, body.email, actor.organizationId);
    if (existing) throw new ConflictError('Email já cadastrado nesta organização');
  }

  const after = await db.transaction(async (tx) => {
    const updated = await updateUser(
      tx as unknown as Database,
      targetUserId,
      actor.organizationId,
      {
        ...body,
        updatedAt: new Date(),
      },
    );
    if (!updated) throw new NotFoundError('Usuário não encontrado');

    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: { userId: actor.userId, role: actor.role, ip: actor.ip, userAgent: actor.userAgent },
      action: 'users.update',
      resource: { type: 'user', id: targetUserId },
      before: redactUser(before),
      after: redactUser(updated),
    });

    return updated;
  });

  return toUserResponse(after);
}

// ---------------------------------------------------------------------------
// Deactivate
// ---------------------------------------------------------------------------

export async function deactivateUserService(
  db: Database,
  actor: ActorContext,
  targetUserId: string,
): Promise<void> {
  const before = await findUserById(db, targetUserId, actor.organizationId);
  if (!before) throw new NotFoundError('Usuário não encontrado');

  await db.transaction(async (tx) => {
    const deactivated = await deactivateUser(
      tx as unknown as Database,
      targetUserId,
      actor.organizationId,
    );
    if (!deactivated) throw new NotFoundError('Usuário não encontrado');

    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: { userId: actor.userId, role: actor.role, ip: actor.ip, userAgent: actor.userAgent },
      action: 'users.deactivate',
      resource: { type: 'user', id: targetUserId },
      before: redactUser(before),
      after: redactUser(deactivated),
    });
  });
}

// ---------------------------------------------------------------------------
// Reactivate
// ---------------------------------------------------------------------------

export async function reactivateUserService(
  db: Database,
  actor: ActorContext,
  targetUserId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const reactivated = await reactivateUser(
      tx as unknown as Database,
      targetUserId,
      actor.organizationId,
    );
    if (!reactivated) throw new NotFoundError('Usuário não encontrado');

    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: { userId: actor.userId, role: actor.role, ip: actor.ip, userAgent: actor.userAgent },
      action: 'users.reactivate',
      resource: { type: 'user', id: targetUserId },
      before: null,
      after: redactUser(reactivated),
    });
  });
}

// ---------------------------------------------------------------------------
// Set Roles
// ---------------------------------------------------------------------------

export async function setUserRolesService(
  db: Database,
  actor: ActorContext,
  targetUserId: string,
  body: SetRolesBody,
): Promise<void> {
  const target = await findUserById(db, targetUserId, actor.organizationId);
  if (!target) throw new NotFoundError('Usuário não encontrado');

  // Self-protection: se o target é admin e o caller está removendo a role admin
  // precisamos garantir que não é o último admin da org.
  const currentRoles = await findUserRoles(db, targetUserId);
  const currentRoleKeys = currentRoles.map((r) => r.key);
  const newRoleIds = body.roleIds;

  // Verificar se estamos removendo 'admin' do usuário
  const isCurrentlyAdmin = currentRoleKeys.includes('admin');

  if (isCurrentlyAdmin) {
    // Verificar se as novas roles NÃO incluem nenhuma das roles com key 'admin'
    // Para isso, precisamos buscar as keys das novas roles
    const currentRoleIdsWithAdminKey = currentRoles
      .filter((r) => r.key === 'admin')
      .map((r) => r.id);

    const removingAdminRole = currentRoleIdsWithAdminKey.every(
      (adminRoleId) => !newRoleIds.includes(adminRoleId),
    );

    if (removingAdminRole) {
      // Contar quantos admins existem na org
      const adminCount = await countAdminUsers(db, actor.organizationId);
      if (adminCount <= 1) {
        throw new CannotRemoveLastAdminError();
      }
    }
  }

  const beforeRoles = currentRoles;

  await db.transaction(async (tx) => {
    await replaceUserRoles(tx as unknown as Database, targetUserId, newRoleIds);

    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: { userId: actor.userId, role: actor.role, ip: actor.ip, userAgent: actor.userAgent },
      action: 'users.set_roles',
      resource: { type: 'user', id: targetUserId },
      before: { roles: beforeRoles },
      after: { roleIds: newRoleIds },
    });
  });
}

// ---------------------------------------------------------------------------
// Set City Scopes
// ---------------------------------------------------------------------------

export async function setUserCityScopesService(
  db: Database,
  actor: ActorContext,
  targetUserId: string,
  body: SetCityScopesBody,
): Promise<void> {
  const target = await findUserById(db, targetUserId, actor.organizationId);
  if (!target) throw new NotFoundError('Usuário não encontrado');

  const beforeScopes = await findUserCityScopes(db, targetUserId);

  await db.transaction(async (tx) => {
    await replaceUserCityScopes(tx as unknown as Database, targetUserId, body.cityIds);

    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: { userId: actor.userId, role: actor.role, ip: actor.ip, userAgent: actor.userAgent },
      action: 'users.set_city_scopes',
      resource: { type: 'user', id: targetUserId },
      before: { cityScopes: beforeScopes },
      after: { cityIds: body.cityIds },
    });
  });
}
