// =============================================================================
// auth/service.ts — Regras de negócio de autenticação.
//
// Responsabilidades:
//   login    → verificar credenciais, emitir access + refresh, criar sessão
//   refresh  → verificar refresh, rotacionar sessão, emitir novo access
//   logout   → revogar sessão
//
// Audit log: via Pino estruturado até F1-S16 prover auditLog().
// Decision: audit via pino até F1-S16 prover auditLog()
//
// LGPD (doc 17 §3.4):
//   - Nada de senha ou email bruto em logs (coberto por pino.redact em app.ts).
//   - cpf_hash usado para identificação em logs de falha (nunca CPF bruto).
//   - IP e UA armazenados na sessão — retenção 90d após expiração (repository).
// =============================================================================
import type { FastifyBaseLogger } from 'fastify';

import type { Database } from '../../db/client.js';
import { UnauthorizedError } from '../../shared/errors.js';
import { hashRefreshToken, parseTtlToSeconds, signAccessToken, signRefreshToken, verifyRefreshToken } from '../../shared/jwt.js';
import { passwordVerify } from '../../shared/password.js';
import { env } from '../../config/env.js';
import {
  createSession,
  findSessionByTokenHash,
  findUserByEmail,
  findUserById,
  purgeExpiredSessions,
  rotateSession,
  revokeSession,
  updateUserLastLogin,
} from './repository.js';

// ---------------------------------------------------------------------------
// Tipos de saída
// ---------------------------------------------------------------------------

export interface LoginResult {
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

export interface RefreshResult {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresIn: number;
  sessionId: string;
}

export interface LoginInput {
  email: string;
  password: string;
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
    log.warn({
      event: 'auth.login.failed',
      // Não logar email bruto — é PII (doc 17). Logar apenas IP e razão.
      ip,
      reason: user ? 'invalid_password' : 'user_not_found',
    }, 'login attempt failed');

    // Mesma mensagem para ambos os casos (evita enumeração de usuários)
    throw new UnauthorizedError('Credenciais inválidas');
  }

  if (user.status !== 'active') {
    log.warn({
      event: 'auth.login.blocked',
      user_id: user.id,
      status: user.status,
      ip,
    }, 'login blocked: user not active');

    throw new UnauthorizedError('Conta inativa ou pendente. Contate o administrador.');
  }

  // Geração do par access+refresh
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

  log.info({
    event: 'auth.login.success',
    user_id: user.id,
    org_id: user.organizationId,
    session_id: sessionId,
    ip,
  }, 'login successful');

  return {
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
  if (csrfToken !== tokenPayload.jti) {
    log.warn({
      event: 'auth.refresh.csrf_mismatch',
      session_id: tokenPayload.jti,
      ip,
    }, 'refresh failed: CSRF mismatch');
    throw new UnauthorizedError('CSRF token inválido');
  }

  // 3. Verificar sessão no banco (revogação + expiração)
  const tokenHash = await hashRefreshToken(refreshToken);
  const session = await findSessionByTokenHash(db, tokenHash);

  if (!session) {
    log.warn({
      event: 'auth.refresh.session_not_found',
      session_id: tokenPayload.jti,
      ip,
    }, 'refresh failed: session not found or revoked');
    throw new UnauthorizedError('Sessão inválida ou revogada');
  }

  // 4. Verificar usuário ainda ativo
  const user = await findUserById(db, session.userId);
  if (!user || user.status !== 'active') {
    log.warn({
      event: 'auth.refresh.user_inactive',
      user_id: session.userId,
      ip,
    }, 'refresh failed: user inactive');
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

  log.info({
    event: 'auth.refresh.success',
    user_id: user.id,
    old_session_id: session.id,
    new_session_id: newSessionId,
    ip,
  }, 'token refresh successful');

  return {
    accessToken: newAccessToken,
    expiresIn: accessTtlSeconds,
    refreshToken: newRefreshToken,
    refreshExpiresIn: refreshTtlSeconds,
    sessionId: newSessionId,
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

  log.info({
    event: 'auth.logout.success',
    user_id: userId,
    session_id: tokenPayload.jti,
  }, 'logout successful');
}
