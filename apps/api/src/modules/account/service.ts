// =============================================================================
// account/service.ts — Regras de negócio do self-service de conta (F8-S09).
//
// Responsabilidades:
//   getProfile        → retorna perfil do próprio usuário
//   updateProfile     → edita full_name; audit log account.profile_updated
//   changePassword    → verifica senha atual, re-hash, revoga outras sessões,
//                       audit log account.password_changed
//
// Segurança:
//   - O alvo é SEMPRE o userId vindo de request.user.id — nunca de params/body.
//   - Senha errada → erro genérico (não revela motivo detalhado para o cliente).
//   - LGPD: currentPassword/newPassword NUNCA logados (pino.redact + nunca
//     passados ao auditLog antes ou after).
//   - Revogação de sessões na mesma transação que o re-hash de senha.
//
// Política de senha documentada em schemas.ts.
// =============================================================================

import type { Database } from '../../db/client.js';
import { auditLog } from '../../lib/audit.js';
import { NotFoundError, UnauthorizedError } from '../../shared/errors.js';
import { passwordHash, passwordVerify } from '../../shared/password.js';

import {
  findUserProfileById,
  revokeOtherSessions,
  updateUserFullName,
  updateUserPasswordHash,
} from './repository.js';
import type { ProfileResponse, UpdateProfileBody, ChangePasswordBody } from './schemas.js';

// ---------------------------------------------------------------------------
// Contexto do ator (sempre o próprio usuário — sem role de terceiro)
// ---------------------------------------------------------------------------

export interface AccountActorContext {
  /** request.user.id — o dono do recurso. */
  userId: string;
  organizationId: string;
  /** jti do access token — identifica a sessão atual para não revogar. */
  sessionId: string;
  ip?: string | null;
  userAgent?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Serializa User para ProfileResponse, omitindo campos sensíveis (LGPD).
 * password_hash e totp_secret nunca aparecem.
 */
function toProfileResponse(user: {
  id: string;
  email: string;
  fullName: string;
  organizationId: string;
}): ProfileResponse {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    organizationId: user.organizationId,
  };
}

// ---------------------------------------------------------------------------
// getProfile
// ---------------------------------------------------------------------------

export async function getProfile(
  db: Database,
  actor: AccountActorContext,
): Promise<ProfileResponse> {
  const user = await findUserProfileById(db, actor.userId);
  if (!user) throw new NotFoundError('Usuário não encontrado');

  return toProfileResponse(user);
}

// ---------------------------------------------------------------------------
// updateProfile
// ---------------------------------------------------------------------------

export async function updateProfile(
  db: Database,
  actor: AccountActorContext,
  body: UpdateProfileBody,
): Promise<ProfileResponse> {
  const before = await findUserProfileById(db, actor.userId);
  if (!before) throw new NotFoundError('Usuário não encontrado');

  const after = await db.transaction(async (tx) => {
    const updated = await updateUserFullName(
      tx as unknown as Database,
      actor.userId,
      body.fullName,
    );
    if (!updated) throw new NotFoundError('Usuário não encontrado');

    // Audit log — sem campos sensíveis (sem email em before/after por LGPD;
    // fullName é o único campo de trabalho aqui, aceitável para auditoria)
    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: {
        userId: actor.userId,
        // self-service: o role não está disponível no contexto de account
        // (authenticate() não carrega role diretamente — apenas permissions).
        // Usamos 'self' como marker semântico para auditoria de self-service.
        role: 'self',
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
      action: 'account.profile_updated',
      resource: { type: 'user', id: actor.userId },
      before: { fullName: before.fullName },
      after: { fullName: updated.fullName },
    });

    return updated;
  });

  return toProfileResponse(after);
}

// ---------------------------------------------------------------------------
// changePassword
// ---------------------------------------------------------------------------

export async function changePassword(
  db: Database,
  actor: AccountActorContext,
  body: ChangePasswordBody,
): Promise<void> {
  const user = await findUserProfileById(db, actor.userId);
  // Usuário não encontrado — mesmo erro que senha errada (não revela estado)
  if (!user) throw new UnauthorizedError('Credenciais inválidas');

  // Verificar senha atual
  const passwordOk = await passwordVerify(body.currentPassword, user.passwordHash);
  if (!passwordOk) {
    // Erro genérico — não revelar se foi "usuário não existe" vs "senha errada"
    throw new UnauthorizedError('Credenciais inválidas');
  }

  // Hash da nova senha (bcrypt cost 12 — definido em shared/password.ts)
  const newHash = await passwordHash(body.newPassword);

  // Transação: re-hash + revogar outras sessões + audit log
  await db.transaction(async (tx) => {
    const updated = await updateUserPasswordHash(tx as unknown as Database, actor.userId, newHash);
    if (!updated) throw new UnauthorizedError('Credenciais inválidas');

    // Revogar outras sessões do usuário (exceto a atual)
    await revokeOtherSessions(tx as unknown as Database, actor.userId, actor.sessionId);

    // Audit log — NUNCA incluir currentPassword/newPassword no before/after
    // LGPD (doc 17 §3.4): campo de senha nunca serializado em logs.
    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: {
        userId: actor.userId,
        role: 'self',
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
      action: 'account.password_changed',
      resource: { type: 'user', id: actor.userId },
      before: null,
      after: null, // intencional — nunca registrar hash de senha em audit_log
    });
  });
}
