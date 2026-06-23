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
import { ConflictError, ForbiddenError, NotFoundError, AppError } from '../../shared/errors.js';
import { passwordHash } from '../../shared/password.js';

import {
  countAdminUsers,
  createUser,
  deactivateUser,
  findRolesByUserIds,
  findUserByEmailInOrg,
  findUserById,
  findUserCityScopes,
  findUserRoles,
  findUsers,
  getRoleKeysByIds,
  reactivateUser,
  replaceUserCityScopes,
  replaceUserRoles,
  updatePersonalEmail,
  updateUser,
} from './repository.js';
import type { UpdateUserInput } from './repository.js';
import type {
  CreateUserBody,
  CreateUserResponse,
  EmbeddedRole,
  ListUsersQuery,
  ListUsersResponse,
  PatchPersonalEmailBody,
  PatchPersonalEmailResponse,
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
// Guard de anti-escalonamento de papéis
// ---------------------------------------------------------------------------

/**
 * Papéis que só o administrador pode atribuir.
 * Qualquer usuário com `users:manage` mas sem `users:assign_privileged_roles`
 * (ex: gestor_geral) é bloqueado ao tentar atribuir estes papéis.
 */
const PRIVILEGED_ROLE_KEYS = ['admin', 'gestor_geral'] as const;
type PrivilegedRoleKey = (typeof PRIVILEGED_ROLE_KEYS)[number];

/**
 * Lança ForbiddenError se o ator não tem permissão para atribuir os roleIds
 * que contêm papéis privilegiados (admin, gestor_geral).
 *
 * Curto-circuita imediatamente se o ator possuir `users:assign_privileged_roles`
 * (somente admin recebe essa permissão pelo seed).
 */
async function assertCanAssignRoles(
  db: Database,
  actor: ActorContext,
  roleIds: string[],
): Promise<void> {
  if (actor.permissions.includes('users:assign_privileged_roles')) return;

  const keys = await getRoleKeysByIds(db, roleIds);
  const blocked = keys.filter((k): k is PrivilegedRoleKey =>
    PRIVILEGED_ROLE_KEYS.includes(k as PrivilegedRoleKey),
  );

  if (blocked.length > 0) {
    throw new ForbiddenError(
      `Você não tem permissão para atribuir os papéis: ${blocked.join(', ')}. Apenas administradores podem atribuir admin ou gestor_geral.`,
    );
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
  /** Permissões do ator (lista de keys do JWT). Usado pelo guard de roles. */
  permissions: string[];
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
 *
 * @param user   - entidade do banco
 * @param roles  - roles do usuário (default: [] para endpoints que não carregam roles)
 */
function toUserResponse(user: User, roles: EmbeddedRole[] = []): UserResponse {
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
    roles,
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

  // Batch-load roles para todos os usuários da página em uma única query (sem N+1).
  // Agrupa as rows por userId para mapeamento O(n).
  const userIds = data.map((u) => u.id);
  const roleRows = await findRolesByUserIds(db, userIds);

  const rolesByUserId = new Map<string, EmbeddedRole[]>();
  for (const row of roleRows) {
    const existing = rolesByUserId.get(row.userId);
    const embedded: EmbeddedRole = { id: row.id, key: row.key, name: row.label };
    if (existing) {
      existing.push(embedded);
    } else {
      rolesByUserId.set(row.userId, [embedded]);
    }
  }

  return {
    data: data.map((u) => toUserResponse(u, rolesByUserId.get(u.id) ?? [])),
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
  // 0. Guard: bloquear atribuição de papéis privilegiados a ator sem permissão
  await assertCanAssignRoles(db, actor, body.roleIds);

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
      actor: {
        userId: actor.userId,
        role: actor.role,
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
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
    // exactOptionalPropertyTypes: build update input without undefined values.
    // body fields are z.infer of optional() → 'string | undefined'; UpdateUserInput
    // uses optional props (can be absent, but not explicitly set to undefined).
    const updateInput: UpdateUserInput = {
      updatedAt: new Date(),
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.fullName !== undefined ? { fullName: body.fullName } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    };
    const updated = await updateUser(
      tx as unknown as Database,
      targetUserId,
      actor.organizationId,
      updateInput,
    );
    if (!updated) throw new NotFoundError('Usuário não encontrado');

    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: {
        userId: actor.userId,
        role: actor.role,
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
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
      actor: {
        userId: actor.userId,
        role: actor.role,
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
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
      actor: {
        userId: actor.userId,
        role: actor.role,
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
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

  // Guard: bloquear atribuição de papéis privilegiados a ator sem permissão
  await assertCanAssignRoles(db, actor, body.roleIds);

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
      actor: {
        userId: actor.userId,
        role: actor.role,
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
      action: 'users.set_roles',
      resource: { type: 'user', id: targetUserId },
      before: { roles: beforeRoles },
      after: { roleIds: newRoleIds },
    });
  });
}

// ---------------------------------------------------------------------------
// Update personal email (self — F18-S09)
// ---------------------------------------------------------------------------

/**
 * Atualiza o personal_email do agente autenticado.
 *
 * Regras:
 *   - Apenas o próprio agente pode alterar o próprio personal_email (userId === actorUserId).
 *   - null = remover o email pessoal existente.
 *   - Unicidade por org garantida pelo índice parcial no banco (F18-S08).
 *     Violação → AppError 409 PERSONAL_EMAIL_DUPLICATE.
 *
 * LGPD (doc 17 §8.1):
 *   - personal_email é PII — auditLog é chamado com o campo redactado.
 *   - O campo não é ecoado na resposta (apenas `{ ok: true }`).
 */
export async function updatePersonalEmailService(
  db: Database,
  actor: ActorContext,
  body: PatchPersonalEmailBody,
): Promise<PatchPersonalEmailResponse> {
  await db.transaction(async (tx) => {
    let result;
    try {
      result = await updatePersonalEmail(
        tx as unknown as Database,
        actor.userId,
        actor.organizationId,
        {
          personalEmail: body.personal_email,
          updatedAt: new Date(),
        },
      );
    } catch (err: unknown) {
      // Unique violation na constraint uq_users_org_personal_email_active
      // Código 23505 do PostgreSQL.
      if (isPersonalEmailUniqueViolation(err)) {
        throw new AppError(
          409,
          'CONFLICT',
          'Este email pessoal já está cadastrado nesta organização',
          {
            code: 'PERSONAL_EMAIL_DUPLICATE',
          },
        );
      }
      throw err;
    }

    if (!result) throw new NotFoundError('Usuário não encontrado');

    // Audit log — LGPD §8.5: personal_email redactado antes de persistir.
    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: {
        userId: actor.userId,
        role: actor.role,
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
      action: 'users.update_personal_email',
      resource: { type: 'user', id: actor.userId },
      before: null,
      // LGPD §8.5: nunca gravar o valor do personal_email no audit log.
      after: { personal_email: '[redacted]' },
    });
  });

  return { ok: true };
}

/**
 * Verifica se o erro é violação de unique constraint do PostgreSQL (23505)
 * para a constraint de personal_email.
 */
function isPersonalEmailUniqueViolation(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const e = err as { code?: unknown; constraint?: unknown };
  return (
    e.code === '23505' &&
    (e.constraint === 'uq_users_org_personal_email_active' ||
      // fallback: qualquer 23505 que envolva personal_email
      e.constraint === undefined)
  );
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
      actor: {
        userId: actor.userId,
        role: actor.role,
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
      action: 'users.set_city_scopes',
      resource: { type: 'user', id: targetUserId },
      before: { cityScopes: beforeScopes },
      after: { cityIds: body.cityIds },
    });
  });
}
