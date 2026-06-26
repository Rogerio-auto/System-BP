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

import { randomUUID } from 'node:crypto';

import type {
  AvatarMime,
  AvatarSignedUrlBody,
  AvatarSignedUrlResponse,
  SetAvatarBody,
} from '@elemento/shared-schemas';
import { AVATAR_EXT_BY_MIME, isAllowedAvatarMime } from '@elemento/shared-schemas';

import type { Database } from '../../db/client.js';
import { auditLog } from '../../lib/audit.js';
import { decryptPii, encryptPii } from '../../lib/crypto/pii.js';
import * as storage from '../../lib/storage/index.js';
import {
  generateOtpauthUri,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCodes,
  matchRecoveryCode,
  verifyTotpCode,
} from '../../lib/totp.js';
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../shared/errors.js';
import { passwordHash, passwordVerify } from '../../shared/password.js';

import {
  activateTotp,
  deleteRecoveryCodes,
  disableTotp,
  findUserProfileById,
  findUserRoleKeys,
  insertRecoveryCodes,
  listAvailableRecoveryCodes,
  markRecoveryCodeUsedAtomic,
  revokeOtherSessions,
  saveTotpSecretPending,
  updateUserAvatarUrl,
  updateUserFullName,
  updateUserPasswordHash,
  updateUserPersonalEmail,
} from './repository.js';
import type {
  ChangePasswordBody,
  ProfileResponse,
  SetPersonalEmailBody,
  TwoFactorActivateBody,
  TwoFactorActivateResponse,
  TwoFactorDisableBody,
  TwoFactorEnrollResponse,
  TwoFactorStatusResponse,
  UpdateProfileBody,
} from './schemas.js';
import { ROLES_REQUIRING_PERSONAL_EMAIL } from './schemas.js';

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
 *
 * F14-S04: `requiresPersonalEmail` é true quando:
 *   - O papel do usuário está na lista ROLES_REQUIRING_PERSONAL_EMAIL, e
 *   - personal_email ainda não foi preenchido (null/undefined).
 * `role` é opcional — sem papel informado, não exige email pessoal (seguro-fail aberto).
 */
function toProfileResponse(
  user: {
    id: string;
    email: string;
    fullName: string;
    organizationId: string;
    personalEmail?: string | null;
    avatarUrl?: string | null;
  },
  role?: string,
): ProfileResponse {
  const roleRequires = role !== undefined && ROLES_REQUIRING_PERSONAL_EMAIL.has(role);
  // personalEmail é null quando não preenchido (coluna citext nullable).
  // Verificação explícita === null para satisfazer eqeqeq (sem usar == null).
  const requiresPersonalEmail =
    roleRequires && (user.personalEmail === null || user.personalEmail === undefined);

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    organizationId: user.organizationId,
    requiresPersonalEmail,
    personalEmail: user.personalEmail ?? null,
    avatarUrl: user.avatarUrl ?? null,
  };
}

// ---------------------------------------------------------------------------
// getProfile
// ---------------------------------------------------------------------------

export async function getProfile(
  db: Database,
  actor: AccountActorContext,
): Promise<ProfileResponse> {
  // Carrega perfil e roles em paralelo (F14-S04: roles necessárias para requires_personal_email)
  const [user, roleKeys] = await Promise.all([
    findUserProfileById(db, actor.userId),
    findUserRoleKeys(db, actor.userId),
  ]);
  if (!user) throw new NotFoundError('Usuário não encontrado');

  // Determina o papel primário para o guard de 1º login.
  // Se o usuário tem múltiplos papéis e qualquer um exige email pessoal → exige.
  const primaryRole = roleKeys.find((k) => ROLES_REQUIRING_PERSONAL_EMAIL.has(k)) ?? roleKeys[0];
  return toProfileResponse(user, primaryRole);
}

// ---------------------------------------------------------------------------
// updateProfile
// ---------------------------------------------------------------------------

export async function updateProfile(
  db: Database,
  actor: AccountActorContext,
  body: UpdateProfileBody,
): Promise<ProfileResponse> {
  const [before, roleKeys] = await Promise.all([
    findUserProfileById(db, actor.userId),
    findUserRoleKeys(db, actor.userId),
  ]);
  if (!before) throw new NotFoundError('Usuário não encontrado');

  const primaryRole = roleKeys.find((k) => ROLES_REQUIRING_PERSONAL_EMAIL.has(k)) ?? roleKeys[0];

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

  return toProfileResponse(after, primaryRole);
}

// ---------------------------------------------------------------------------
// Helper interno
// ---------------------------------------------------------------------------

/**
 * Verifica se um erro é violação de unique constraint do PostgreSQL (code 23505).
 * Usado para mapear constraint parcial de personal_email para ConflictError.
 */
function isPgUniqueViolation(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const code = 'code' in err ? (err as { code: unknown }).code : undefined;
  return code === '23505';
}

// ---------------------------------------------------------------------------
// setPersonalEmail (F14-S04)
//
// Cadastra ou atualiza o email pessoal do agente.
// Após salvo, o email é adicionado automaticamente à lista de bloqueio no
// cadastro de lead via leads/repository.isInternalEmail (consulta personal_email
// na mesma query que o email corporativo).
//
// Segurança:
//   - Alvo é sempre request.user.id — nunca aceitar de params/body.
//   - LGPD: personal_email é PII — audit log sem o valor (field-level).
//   - Unique constraint parcial (org, personal_email) tratada como ValidationError.
// ---------------------------------------------------------------------------

export async function setPersonalEmail(
  db: Database,
  actor: AccountActorContext,
  body: SetPersonalEmailBody,
): Promise<ProfileResponse> {
  const [user, roleKeys] = await Promise.all([
    findUserProfileById(db, actor.userId),
    findUserRoleKeys(db, actor.userId),
  ]);
  if (!user) throw new NotFoundError('Usuário não encontrado');

  const primaryRole = roleKeys.find((k) => ROLES_REQUIRING_PERSONAL_EMAIL.has(k)) ?? roleKeys[0];

  const after = await db.transaction(async (tx) => {
    let updated: Awaited<ReturnType<typeof updateUserPersonalEmail>>;
    try {
      updated = await updateUserPersonalEmail(
        tx as unknown as Database,
        actor.userId,
        body.personalEmail,
      );
    } catch (err: unknown) {
      // Unique constraint: outro agente da org já cadastrou esse email pessoal.
      if (isPgUniqueViolation(err)) {
        throw new ConflictError(
          'Este email já está registrado como email pessoal de outro agente desta organização',
          { code: 'PERSONAL_EMAIL_CONFLICT' },
        );
      }
      throw err;
    }

    if (!updated) throw new NotFoundError('Usuário não encontrado');

    // Audit log — LGPD: personal_email é PII, não logamos o valor.
    // Registramos apenas o evento (preenchido / atualizado) para rastreabilidade.
    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: {
        userId: actor.userId,
        role: 'self',
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
      action: 'account.personal_email_set',
      resource: { type: 'user', id: actor.userId },
      before: { personalEmailSet: user.personalEmail !== null },
      after: { personalEmailSet: true },
      // LGPD §8.5: intencionalmente não incluímos o valor do email pessoal no log.
    });

    return updated;
  });

  return toProfileResponse(after, primaryRole);
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
  let recoveryCodeId: string | null = null;

  if (isTotpCode) {
    verifiedOk = verifyTotpCode(secret, body.code);
  } else {
    // Recovery code: buscar todos os disponíveis e comparar hashes
    const availableCodes = await listAvailableRecoveryCodes(db, actor.userId);
    const hashes = availableCodes.map((c) => c.codeHash);
    const matchIdx = await matchRecoveryCode(body.code, hashes);

    if (matchIdx !== -1) {
      verifiedOk = true;
      recoveryCodeId = availableCodes[matchIdx]!.id;
    }
  }

  if (!verifiedOk) {
    throw new UnauthorizedError(
      'Código inválido. Informe o código do app autenticador ou um recovery code válido.',
    );
  }

  // Transação: (se recovery code) gate atômico de consumo + desativar 2FA +
  // deletar recovery codes + audit log.
  //
  // SEGURANÇA (MED-2): o recovery code é consumido atomicamente dentro da mesma
  // transação que desativa o 2FA. Se o gate retornar false (já consumido por
  // requisição concorrente), toda a transação faz rollback — o 2FA permanece ativo.
  await db.transaction(async (tx) => {
    // Gate atômico no recovery code (se o código fornecido era um recovery code)
    if (recoveryCodeId) {
      const consumed = await markRecoveryCodeUsedAtomic(tx as unknown as Database, recoveryCodeId);
      if (!consumed) {
        // Recovery code já foi consumido em requisição concorrente — rejeitar.
        throw new UnauthorizedError(
          'Código inválido. Informe o código do app autenticador ou um recovery code válido.',
        );
      }
    }

    await disableTotp(tx as unknown as Database, actor.userId);
    // deleteRecoveryCodes remove todos os recovery codes restantes (incluindo o
    // que acabou de ser marcado como usado acima — limpeza total ao desativar).
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

// ---------------------------------------------------------------------------
// createAvatarSignedUrl
//
// Gera uma URL pré-assinada PUT (TTL 15min) para o browser enviar a foto de
// perfil diretamente ao R2 sem passar pelo backend.
// NÃO persiste nada — o cliente chama PUT /api/account/avatar após o upload.
// NÃO gera audit log — geração de URL não é mutação de dado.
//
// Segurança:
//   - Mime validado por schema Zod (rota) + isAllowedAvatarMime (defense-in-depth).
//   - Key no R2 não contém PII: avatars/{orgId}/{userId}/{uuid}.{ext}.
// ---------------------------------------------------------------------------

export async function createAvatarSignedUrl(
  _db: Database,
  actor: AccountActorContext,
  body: AvatarSignedUrlBody,
): Promise<AvatarSignedUrlResponse> {
  // Defense-in-depth: schema Zod já valida o mime na borda HTTP, mas
  // verificamos novamente para garantir que um futuro refactor ou bypass
  // de validação não exponha operações de storage com mime não suportado.
  if (!isAllowedAvatarMime(body.mime)) {
    throw new ValidationError([], `Tipo de imagem não suportado: ${body.mime}`);
  }

  // body.mime é AvatarMime após o type guard acima.
  // noUncheckedIndexedAccess: AVATAR_EXT_BY_MIME tem entrada para todo AvatarMime;
  // o ?? 'jpg' é fallback de tipo — inalcançável em runtime.
  const ext = (AVATAR_EXT_BY_MIME as Record<AvatarMime, string>)[body.mime] ?? 'jpg';
  const key = `avatars/${actor.organizationId}/${actor.userId}/${randomUUID()}.${ext}`;
  // Fachada de storage: respeita STORAGE_PROVIDER (r2 | supabase) em runtime.
  const { uploadUrl, publicUrl } = await storage.createSignedUploadUrl(key, body.mime);

  return { uploadUrl, publicUrl, key };
}

// ---------------------------------------------------------------------------
// setAvatar
//
// Persiste a URL pública do avatar após o browser ter feito upload direto ao R2.
// Valida que a URL pertence ao domínio R2 configurado (anti-SSRF/anti-spoof).
// Audit log account.avatar_updated (before/after como booleanos — LGPD: não
// logamos a URL inteira, pois é desnecessário para rastreabilidade).
// ---------------------------------------------------------------------------

export async function setAvatar(
  db: Database,
  actor: AccountActorContext,
  body: SetAvatarBody,
): Promise<ProfileResponse> {
  // Anti-SSRF / anti-spoof: rejeitar qualquer URL que não pertença ao domínio
  // de storage configurado. Usa a fachada de storage (getPublicUrl com key vazia
  // devolve o prefixo público do provider ATIVO — r2 ou supabase), impedindo que
  // o cliente salve uma URL arbitrária de servidor externo.
  const publicBasePrefix = storage.getPublicUrl('');
  if (!body.avatarUrl.startsWith(publicBasePrefix)) {
    throw new ValidationError(
      [],
      'URL de avatar inválida: deve pertencer ao domínio de storage configurado.',
    );
  }

  const [before, roleKeys] = await Promise.all([
    findUserProfileById(db, actor.userId),
    findUserRoleKeys(db, actor.userId),
  ]);
  if (!before) throw new NotFoundError('Usuário não encontrado');

  const primaryRole = roleKeys.find((k) => ROLES_REQUIRING_PERSONAL_EMAIL.has(k)) ?? roleKeys[0];

  const after = await db.transaction(async (tx) => {
    const updated = await updateUserAvatarUrl(
      tx as unknown as Database,
      actor.userId,
      body.avatarUrl,
    );
    if (!updated) throw new NotFoundError('Usuário não encontrado');

    // LGPD §8.5: não logamos a URL inteira do avatar (campo desnecessário para
    // rastreabilidade de auditoria + pode ser longa). Registramos apenas a
    // mudança de estado booleano (tinha/não tinha avatar).
    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: {
        userId: actor.userId,
        role: 'self',
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
      action: 'account.avatar_updated',
      resource: { type: 'user', id: actor.userId },
      before: { hadAvatar: before.avatarUrl !== null },
      after: { hadAvatar: true },
    });

    return updated;
  });

  return toProfileResponse(after, primaryRole);
}

// ---------------------------------------------------------------------------
// removeAvatar
//
// Remove o avatar do usuário (define avatar_url = null no banco).
// O objeto no R2 fica órfão — limpeza eventual é aceitável para MVP.
// Audit log account.avatar_removed.
// ---------------------------------------------------------------------------

export async function removeAvatar(
  db: Database,
  actor: AccountActorContext,
): Promise<ProfileResponse> {
  const [before, roleKeys] = await Promise.all([
    findUserProfileById(db, actor.userId),
    findUserRoleKeys(db, actor.userId),
  ]);
  if (!before) throw new NotFoundError('Usuário não encontrado');

  const primaryRole = roleKeys.find((k) => ROLES_REQUIRING_PERSONAL_EMAIL.has(k)) ?? roleKeys[0];

  const after = await db.transaction(async (tx) => {
    const updated = await updateUserAvatarUrl(tx as unknown as Database, actor.userId, null);
    if (!updated) throw new NotFoundError('Usuário não encontrado');

    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: {
        userId: actor.userId,
        role: 'self',
        ip: actor.ip ?? null,
        userAgent: actor.userAgent ?? null,
      },
      action: 'account.avatar_removed',
      resource: { type: 'user', id: actor.userId },
      before: { hadAvatar: before.avatarUrl !== null },
      after: { hadAvatar: false },
    });

    return updated;
  });

  return toProfileResponse(after, primaryRole);
}
