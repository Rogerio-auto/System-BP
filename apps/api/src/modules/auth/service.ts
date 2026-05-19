// =============================================================================
// auth/service.ts — Regras de negócio de autenticação (F1-S02 / F8-S11).
//
// Responsabilidades:
//   login      → verificar credenciais; se 2FA ativo emite challenge token
//                em vez dos tokens de sessão; sem 2FA emite access + refresh.
//   verify2fa  → troca challenge token + código TOTP/recovery → sessão completa.
//   refresh    → verificar refresh, rotacionar sessão, emitir novo access.
//   logout     → revogar sessão.
//
// Fluxo de login com 2FA:
//   POST /api/auth/login
//     → credenciais OK + 2FA ativo
//     → resposta { status: '2fa_required', challengeToken: '<token>' }
//     → frontend exibe etapa TOTP
//   POST /api/auth/verify-2fa
//     → challenge_token + code
//     → emite access + refresh (sessão completa)
//
// LGPD (doc 17 §3.4):
//   - Nada de senha ou email bruto em logs (coberto por pino.redact em app.ts).
//   - totp_secret e recovery codes nunca logados.
//   - IP e UA armazenados na sessão — retenção 90d após expiração (repository).
// =============================================================================
import { timingSafeEqual } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import { env } from '../../config/env.js';
import type { Database } from '../../db/client.js';
import { decryptPii } from '../../lib/crypto/pii.js';
import {
  generateChallengeToken,
  hashChallengeToken,
  matchRecoveryCode,
  TOTP_CHALLENGE_TTL_MS,
  verifyTotpCode,
} from '../../lib/totp.js';
import { UnauthorizedError } from '../../shared/errors.js';
import {
  hashRefreshToken,
  parseTtlToSeconds,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../shared/jwt.js';
import { passwordVerify } from '../../shared/password.js';
import { listAvailableRecoveryCodes, markRecoveryCodeUsedAtomic } from '../account/repository.js';

import {
  createSession,
  createTotpChallenge,
  findSessionByTokenHash,
  findTotpChallengeByHash,
  findUserByEmail,
  findUserById,
  markTotpChallengeUsedAtomic,
  purgeExpiredSessions,
  rotateSession,
  revokeSession,
  updateUserLastLogin,
} from './repository.js';

/**
 * Comparação timing-safe de strings (defesa contra timing oracle no CSRF).
 * Retorna false imediatamente se comprimentos diferirem.
 */
function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ---------------------------------------------------------------------------
// Tipos de saída
// ---------------------------------------------------------------------------

/**
 * Login com credenciais válidas e 2FA ativo.
 * O frontend deve exibir a etapa de segundo fator antes de emitir a sessão.
 */
export interface LoginResult2faRequired {
  status: '2fa_required';
  /** Token de curta duração (5 min) — usado em POST /api/auth/verify-2fa */
  challengeToken: string;
}

export interface LoginResultOk {
  status: 'ok';
  accessToken: string;
  /** TTL em segundos do access token (para o campo expires_in da resposta). */
  expiresIn: number;
  refreshToken: string;
  /** TTL em segundos do refresh token (para configurar o cookie). */
  refreshExpiresIn: number;
  /** ID da sessão (usado como jti no token e cookie CSRF base). */
  sessionId: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    organizationId: string;
  };
}

export type LoginResult = LoginResult2faRequired | LoginResultOk;

export interface RefreshResult {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresIn: number;
  sessionId: string;
  /** Permite rehidratar o store do frontend no bootstrap pós-reload. */
  user: {
    id: string;
    email: string;
    fullName: string;
    organizationId: string;
  };
}

export interface LoginInput {
  email: string;
  password: string;
  ip: string | null;
  userAgent: string | null;
}

export interface Verify2faInput {
  challengeToken: string;
  /** Código TOTP de 6 dígitos OU recovery code */
  code: string;
  ip: string | null;
  userAgent: string | null;
}

export interface RefreshInput {
  refreshToken: string;
  /** CSRF token vindo do header X-CSRF-Token para validação. */
  csrfToken: string;
  ip: string | null;
  userAgent: string | null;
}

export interface LogoutInput {
  refreshToken: string;
  userId: string;
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export async function login(
  db: Database,
  input: LoginInput,
  log: FastifyBaseLogger,
): Promise<LoginResult> {
  const { email, password, ip, userAgent } = input;

  const user = await findUserByEmail(db, email);

  // Verificação constante mesmo quando user não existe (previne timing attack
  // que revelaria existência do e-mail).
  const dummyHash = '$2a$12$00000000000000000000000000000000000000000000000000000';
  const passwordOk = user
    ? await passwordVerify(password, user.passwordHash)
    : await passwordVerify(password, dummyHash).then(() => false);

  if (!user || !passwordOk) {
    log.warn(
      {
        event: 'auth.login.failed',
        // Não logar email bruto — é PII (doc 17). Logar apenas IP e razão.
        ip,
        reason: user ? 'invalid_password' : 'user_not_found',
      },
      'login attempt failed',
    );

    // Mesma mensagem para ambos os casos (evita enumeração de usuários)
    throw new UnauthorizedError('Credenciais inválidas');
  }

  if (user.status !== 'active') {
    log.warn(
      {
        event: 'auth.login.blocked',
        user_id: user.id,
        status: user.status,
        ip,
      },
      'login blocked: user not active',
    );

    throw new UnauthorizedError('Conta inativa ou pendente. Contate o administrador.');
  }

  // ---------------------------------------------------------------------------
  // 2FA enforcement: se o 2FA estiver ativo, não emite sessão diretamente.
  // Emite um challenge token de curta duração (5 min) — o frontend troca por
  // uma sessão completa via POST /api/auth/verify-2fa.
  // ---------------------------------------------------------------------------
  if (user.totpConfirmedAt !== null) {
    const { token, tokenHash } = generateChallengeToken();
    const expiresAt = new Date(Date.now() + TOTP_CHALLENGE_TTL_MS);

    await createTotpChallenge(db, { userId: user.id, tokenHash, expiresAt });

    log.info(
      {
        event: 'auth.login.2fa_required',
        user_id: user.id,
        ip,
      },
      'login: 2FA required, challenge issued',
    );

    return { status: '2fa_required', challengeToken: token };
  }

  // ---------------------------------------------------------------------------
  // Sem 2FA: emite sessão diretamente (fluxo original)
  // ---------------------------------------------------------------------------
  return _issueSession(db, user, { ip, userAgent }, log);
}

/**
 * Helper interno: gera access + refresh + cria sessão.
 * Reutilizado pelo login sem 2FA e pelo verify2fa.
 */
async function _issueSession(
  db: Database,
  user: { id: string; email: string; fullName: string; organizationId: string },
  context: { ip: string | null; userAgent: string | null },
  log: FastifyBaseLogger,
): Promise<LoginResultOk> {
  const { ip, userAgent } = context;

  const sessionId = crypto.randomUUID();
  const accessTtlSeconds = parseTtlToSeconds(env.JWT_ACCESS_TTL);
  const refreshTtlSeconds = parseTtlToSeconds(env.JWT_REFRESH_TTL);

  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken({ sub: user.id, org: user.organizationId, jti: sessionId }),
    signRefreshToken({ sub: user.id, jti: sessionId }),
  ]);

  const refreshHash = await hashRefreshToken(refreshToken);
  const expiresAt = new Date(Date.now() + refreshTtlSeconds * 1000);

  await createSession(db, {
    id: sessionId,
    userId: user.id,
    refreshTokenHash: refreshHash,
    userAgent,
    ip,
    expiresAt,
  });

  await updateUserLastLogin(db, user.id);

  log.info(
    {
      event: 'auth.login.success',
      user_id: user.id,
      org_id: user.organizationId,
      session_id: sessionId,
      ip,
    },
    'login successful',
  );

  return {
    status: 'ok',
    accessToken,
    expiresIn: accessTtlSeconds,
    refreshToken,
    refreshExpiresIn: refreshTtlSeconds,
    sessionId,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      organizationId: user.organizationId,
    },
  };
}

// ---------------------------------------------------------------------------
// Verify 2FA
// ---------------------------------------------------------------------------

/**
 * Troca um challenge token + código TOTP/recovery por uma sessão completa.
 *
 * Segurança:
 *   - Challenge token é de uso único (marcado como usado após sucesso).
 *   - Código TOTP: ±1 step de janela de tolerância.
 *   - Recovery code: consumível uma única vez (marcado como usado).
 *   - Erros genéricos — não revela o motivo específico da falha.
 *
 * LGPD: totp_secret decifrado apenas em memória — nunca logado.
 */
export async function verify2fa(
  db: Database,
  input: Verify2faInput,
  log: FastifyBaseLogger,
): Promise<LoginResultOk> {
  const { challengeToken, code, ip, userAgent } = input;

  // 1. Verificar o challenge token
  const tokenHash = hashChallengeToken(challengeToken);
  const challenge = await findTotpChallengeByHash(db, tokenHash);

  if (!challenge) {
    log.warn(
      { event: 'auth.2fa.invalid_challenge', ip },
      '2FA verify: invalid or expired challenge token',
    );
    throw new UnauthorizedError('Código de desafio inválido ou expirado. Faça login novamente.');
  }

  // 2. Buscar o usuário
  const user = await findUserById(db, challenge.userId);
  if (!user || user.status !== 'active') {
    log.warn(
      { event: 'auth.2fa.user_inactive', user_id: challenge.userId, ip },
      '2FA verify: user not found or inactive',
    );
    throw new UnauthorizedError('Credenciais inválidas.');
  }

  if (!user.totpSecret || !user.totpConfirmedAt) {
    log.warn(
      { event: 'auth.2fa.not_configured', user_id: user.id, ip },
      '2FA verify: 2FA not configured for user',
    );
    throw new UnauthorizedError('Credenciais inválidas.');
  }

  // 3. Verificar o código: TOTP (6 dígitos) ou recovery code
  const isTotpCode = /^\d{6}$/.test(code);
  let verifiedOk = false;
  let recoveryCodeId: string | null = null;

  if (isTotpCode) {
    // Decifrar o secret TOTP em memória — NUNCA logar
    const secret = await decryptPii(user.totpSecret);
    verifiedOk = verifyTotpCode(secret, code);
  } else {
    // Recovery code
    const availableCodes = await listAvailableRecoveryCodes(db, user.id);
    const hashes = availableCodes.map((c) => c.codeHash);
    const matchIdx = await matchRecoveryCode(code, hashes);
    if (matchIdx !== -1) {
      verifiedOk = true;
      recoveryCodeId = availableCodes[matchIdx]!.id;
    }
  }

  if (!verifiedOk) {
    log.warn({ event: 'auth.2fa.invalid_code', user_id: user.id, ip }, '2FA verify: invalid code');
    throw new UnauthorizedError('Código inválido ou expirado. Tente novamente.');
  }

  // 4. Marcar challenge + recovery code de forma atômica dentro de uma transação.
  //
  // SEGURANÇA (MED-1): as três operações — marcar challenge, marcar recovery code e
  // emitir sessão — são executadas na MESMA transação de banco com gate CAS.
  //
  // Gate CAS: UPDATE ... WHERE used_at IS NULL RETURNING id.
  //   - Se 0 linhas retornam → challenge/recovery já foi consumido (race condition
  //     ou replay) → rejeitar com 401. Isso impede que duas requisições concorrentes
  //     com o mesmo challenge emitam duas sessões distintas.
  //   - Se a emissão de sessão falhar após o gate, a transação inteira faz rollback
  //     e o challenge volta a estar disponível para nova tentativa legítima.
  return db.transaction(async (tx) => {
    // Gate atômico no challenge
    const challengeConsumed = await markTotpChallengeUsedAtomic(
      tx as unknown as Database,
      challenge.id,
    );
    if (!challengeConsumed) {
      // Challenge já foi consumido em requisição concorrente — rejeitar.
      log.warn(
        { event: 'auth.2fa.challenge_already_used', user_id: user.id, ip },
        '2FA verify: challenge token already consumed (possible replay/race)',
      );
      throw new UnauthorizedError('Código de desafio inválido ou expirado. Faça login novamente.');
    }

    // Gate atômico no recovery code (se aplicável)
    if (recoveryCodeId) {
      const recoveryConsumed = await markRecoveryCodeUsedAtomic(
        tx as unknown as Database,
        recoveryCodeId,
      );
      if (!recoveryConsumed) {
        log.warn(
          { event: 'auth.2fa.recovery_already_used', user_id: user.id, ip },
          '2FA verify: recovery code already consumed (possible replay/race)',
        );
        throw new UnauthorizedError('Código inválido ou expirado. Tente novamente.');
      }

      log.info(
        { event: 'auth.2fa.recovery_code_used', user_id: user.id, ip },
        '2FA verify: recovery code consumed',
      );
    }

    // 5. Emitir sessão completa dentro da mesma transação
    return _issueSession(tx as unknown as Database, user, { ip, userAgent }, log);
  });
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

export async function refresh(
  db: Database,
  input: RefreshInput,
  log: FastifyBaseLogger,
): Promise<RefreshResult> {
  const { refreshToken, csrfToken, ip, userAgent } = input;

  // 1. Verificar assinatura JWT do refresh token
  let tokenPayload: { sub: string; jti: string };
  try {
    tokenPayload = await verifyRefreshToken(refreshToken);
  } catch {
    log.warn({ event: 'auth.refresh.invalid_token', ip }, 'refresh failed: invalid token');
    throw new UnauthorizedError('Refresh token inválido');
  }

  // 2. Validar CSRF: o jti do token é a base do CSRF token esperado.
  //    O cookie CSRF gerado no login é idêntico ao jti — validação simples e segura.
  //    (Padrão "Double Submit Cookie" sem dependência extra.)
  //    Comparação timing-safe para fechar oracle contra atacante com refresh token roubado.
  if (!timingSafeEqualString(csrfToken, tokenPayload.jti)) {
    log.warn(
      {
        event: 'auth.refresh.csrf_mismatch',
        session_id: tokenPayload.jti,
        ip,
      },
      'refresh failed: CSRF mismatch',
    );
    throw new UnauthorizedError('CSRF token inválido');
  }

  // 3. Verificar sessão no banco (revogação + expiração)
  const tokenHash = await hashRefreshToken(refreshToken);
  const session = await findSessionByTokenHash(db, tokenHash);

  if (!session) {
    log.warn(
      {
        event: 'auth.refresh.session_not_found',
        session_id: tokenPayload.jti,
        ip,
      },
      'refresh failed: session not found or revoked',
    );
    throw new UnauthorizedError('Sessão inválida ou revogada');
  }

  // 4. Verificar usuário ainda ativo
  const user = await findUserById(db, session.userId);
  if (!user || user.status !== 'active') {
    log.warn(
      {
        event: 'auth.refresh.user_inactive',
        user_id: session.userId,
        ip,
      },
      'refresh failed: user inactive',
    );
    throw new UnauthorizedError('Usuário inativo');
  }

  // 5. Rotação: novo sessionId para o novo par de tokens
  const newSessionId = crypto.randomUUID();
  const accessTtlSeconds = parseTtlToSeconds(env.JWT_ACCESS_TTL);
  const refreshTtlSeconds = parseTtlToSeconds(env.JWT_REFRESH_TTL);

  const [newAccessToken, newRefreshToken] = await Promise.all([
    signAccessToken({ sub: user.id, org: user.organizationId, jti: newSessionId }),
    signRefreshToken({ sub: user.id, jti: newSessionId }),
  ]);

  const newRefreshHash = await hashRefreshToken(newRefreshToken);
  const newExpiresAt = new Date(Date.now() + refreshTtlSeconds * 1000);

  await rotateSession(db, session.id, {
    id: newSessionId,
    userId: user.id,
    refreshTokenHash: newRefreshHash,
    userAgent,
    ip,
    expiresAt: newExpiresAt,
  });

  log.info(
    {
      event: 'auth.refresh.success',
      user_id: user.id,
      old_session_id: session.id,
      new_session_id: newSessionId,
      ip,
    },
    'token refresh successful',
  );

  return {
    accessToken: newAccessToken,
    expiresIn: accessTtlSeconds,
    refreshToken: newRefreshToken,
    refreshExpiresIn: refreshTtlSeconds,
    sessionId: newSessionId,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      organizationId: user.organizationId,
    },
  };
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

export async function logout(
  db: Database,
  input: LogoutInput,
  log: FastifyBaseLogger,
): Promise<void> {
  const { refreshToken, userId } = input;

  let tokenPayload: { sub: string; jti: string } | null = null;
  try {
    tokenPayload = await verifyRefreshToken(refreshToken);
  } catch {
    // Logout com token inválido: aceitar silenciosamente (idempotente).
    // O cookie será limpo pelo controller mesmo sem sessão válida.
    log.warn({ event: 'auth.logout.invalid_token', user_id: userId }, 'logout with invalid token');
    return;
  }

  await revokeSession(db, tokenPayload.jti);

  // Limpeza de sessões expiradas do usuário (housekeeping LGPD)
  await purgeExpiredSessions(db, userId);

  log.info(
    {
      event: 'auth.logout.success',
      user_id: userId,
      session_id: tokenPayload.jti,
    },
    'logout successful',
  );
}
