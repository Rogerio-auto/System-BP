// =============================================================================
// account/service.ts — Regras de negócio do self-service de conta (F8-S09/S11).
//
// Responsabilidades:
//   getProfile        → retorna perfil do próprio usuário
//   updateProfile     → edita full_name; audit log account.profile_updated
//   changePassword    → verifica senha atual, re-hash, revoga outras sessões,
//                       audit log account.password_changed
//   get2faStatus      → retorna se 2FA está ativo
//   enroll2fa         → gera secret TOTP pendente, retorna otpauth URI
//   activate2fa       → confirma código TOTP, ativa 2FA, gera recovery codes
//   disable2fa        → verifica código/recovery, desativa 2FA
//
// Segurança:
//   - O alvo é SEMPRE o userId vindo de request.user.id — nunca de params/body.
//   - LGPD: totp_secret nunca logado. Recovery codes retornados plaintext UMA VEZ.
//   - Audit log em mutações sensíveis (ativar/desativar 2FA).
// =============================================================================

import type { Database } from '../../db/client.js';
import { auditLog } from '../../lib/audit.js';
import { decryptPii, encryptPii } from '../../lib/crypto/pii.js';
import {
  generateOtpauthUri,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCodes,
  matchRecoveryCode,
  verifyTotpCode,
} from '../../lib/totp.js';
import { NotFoundError, UnauthorizedError } from '../../shared/errors.js';
import { passwordHash, passwordVerify } from '../../shared/password.js';

import {
  activateTotp,
  deleteRecoveryCodes,
  disableTotp,
  findUserProfileById,
  insertRecoveryCodes,
  listAvailableRecoveryCodes,
  revokeOtherSessions,
  saveTotpSecretPending,
  updateUserFullName,
  updateUserPasswordHash,
} from './repository.js';
import type {
  ProfileResponse,
  UpdateProfileBody,
  ChangePasswordBody,
  TwoFactorStatusResponse,
  TwoFactorEnrollResponse,
  TwoFactorActivateBody,
  TwoFactorActivateResponse,
  TwoFactorDisableBody,
} from './schemas.js';

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

// ---------------------------------------------------------------------------
// get2faStatus
// ---------------------------------------------------------------------------

export async function get2faStatus(
  db: Database,
  actor: AccountActorContext,
): Promise<TwoFactorStatusResponse> {
  const user = await findUserProfileById(db, actor.userId);
  if (!user) throw new NotFoundError('Usuário não encontrado');

  return { enabled: user.totpConfirmedAt !== null };
}

// ---------------------------------------------------------------------------
// enroll2fa
//
// Gera um novo secret TOTP e persiste como pendente (sem ativar).
// Retorna o URI otpauth para o frontend renderizar QR e o secret base32
// para entrada manual.
//
// Idempotente: se chamar enroll novamente, sobrescreve o secret pendente
// (sem interferir no 2FA ativo se já estiver ativo).
// ---------------------------------------------------------------------------

export async function enroll2fa(
  db: Database,
  actor: AccountActorContext,
): Promise<TwoFactorEnrollResponse> {
  const user = await findUserProfileById(db, actor.userId);
  if (!user) throw new NotFoundError('Usuário não encontrado');

  // Gerar novo secret
  const secret = generateTotpSecret();

  // Cifrar e salvar como pendente (não ativa o 2FA)
  // encryptPii retorna Uint8Array — converter para Buffer para o Drizzle bytea
  const encrypted = Buffer.from(await encryptPii(secret));
  await saveTotpSecretPending(db, actor.userId, encrypted);

  // Gerar URI para o QR code
  const otpauthUri = generateOtpauthUri(secret, user.email);

  return { otpauthUri, secret };
}

// ---------------------------------------------------------------------------
// activate2fa
//
// Confirma o código TOTP fornecido pelo usuário, ativa o 2FA e gera os
// recovery codes (exibidos UMA ÚNICA VEZ).
//
// Pré-condição: o usuário deve ter chamado enroll antes (secret pendente).
// ---------------------------------------------------------------------------

export async function activate2fa(
  db: Database,
  actor: AccountActorContext,
  body: TwoFactorActivateBody,
): Promise<TwoFactorActivateResponse> {
  const user = await findUserProfileById(db, actor.userId);
  if (!user) throw new NotFoundError('Usuário não encontrado');

  // Verificar se há secret pendente
  if (!user.totpSecret) {
    throw new UnauthorizedError(
      'Nenhum enrolamento pendente. Inicie o processo de ativação do 2FA.',
    );
  }

  // Decifrar o secret
  const secret = await decryptPii(user.totpSecret);

  // Verificar o código TOTP
  const codeOk = verifyTotpCode(secret, body.code);
  if (!codeOk) {
    throw new UnauthorizedError(
      'Código inválido ou expirado. Verifique o código no seu app autenticador.',
    );
  }

  // Gerar recovery codes (plaintext — retornar ao usuário UMA VEZ)
  const plainCodes = generateRecoveryCodes();
  const hashedCodes = await hashRecoveryCodes(plainCodes);

  // Transação: ativar 2FA + inserir recovery codes + audit log
  await db.transaction(async (tx) => {
    await activateTotp(tx as unknown as Database, actor.userId);

    // Limpar recovery codes antigos (se houver de enrolamentos anteriores)
    await deleteRecoveryCodes(tx as unknown as Database, actor.userId);
    await insertRecoveryCodes(tx as unknown as Database, actor.userId, hashedCodes);

    // Audit log — NUNCA incluir secret nem recovery codes
    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: {
        userId: actor.userId,
        role: 'self',
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
      action: 'account.2fa_enabled',
      resource: { type: 'user', id: actor.userId },
      before: { twoFactorEnabled: false },
      after: { twoFactorEnabled: true },
    });
  });

  return { recoveryCodes: plainCodes };
}

// ---------------------------------------------------------------------------
// disable2fa
//
// Desativa o 2FA após verificar um código TOTP válido OU um recovery code.
// Limpa o secret e os recovery codes.
// ---------------------------------------------------------------------------

export async function disable2fa(
  db: Database,
  actor: AccountActorContext,
  body: TwoFactorDisableBody,
): Promise<void> {
  const user = await findUserProfileById(db, actor.userId);
  if (!user) throw new NotFoundError('Usuário não encontrado');

  // 2FA já desativado — erro idempotente
  if (!user.totpConfirmedAt || !user.totpSecret) {
    throw new UnauthorizedError('O 2FA não está ativo nesta conta.');
  }

  // Decifrar o secret para verificar o código TOTP
  const secret = await decryptPii(user.totpSecret);

  // Determinar o tipo de verificação pelo formato do código:
  //   - 6 dígitos → código TOTP
  //   - qualquer outro formato → recovery code (XXXXX-XXXXX ou 10 chars)
  const isTotpCode = /^\d{6}$/.test(body.code);
  let verifiedOk = false;

  if (isTotpCode) {
    verifiedOk = verifyTotpCode(secret, body.code);
  } else {
    // Recovery code: buscar todos os disponíveis e comparar
    const availableCodes = await listAvailableRecoveryCodes(db, actor.userId);
    const hashes = availableCodes.map((c) => c.codeHash);
    const matchIdx = await matchRecoveryCode(body.code, hashes);

    if (matchIdx !== -1) {
      // Marcar o recovery code como usado antes de desativar
      // (transação garante atomicidade — ver abaixo)
      verifiedOk = true;
    }
  }

  if (!verifiedOk) {
    throw new UnauthorizedError(
      'Código inválido. Informe o código do app autenticador ou um recovery code válido.',
    );
  }

  // Transação: desativar 2FA + limpar secret + limpar recovery codes + audit log
  await db.transaction(async (tx) => {
    await disableTotp(tx as unknown as Database, actor.userId);
    await deleteRecoveryCodes(tx as unknown as Database, actor.userId);

    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: {
        userId: actor.userId,
        role: 'self',
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
      action: 'account.2fa_disabled',
      resource: { type: 'user', id: actor.userId },
      before: { twoFactorEnabled: true },
      after: { twoFactorEnabled: false },
    });
  });
}
