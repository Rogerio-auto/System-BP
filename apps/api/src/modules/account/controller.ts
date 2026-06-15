// =============================================================================
// account/controller.ts — Parsing de request/response para self-service (F8-S09).
//
// Responsabilidades:
//   - Extrair request.user (garantidamente definido após authenticate())
//   - Extrair o sessionId (jti) do access token para revogar outras sessões
//   - Chamar o service correto
//   - Montar resposta tipada
//
// Segurança:
//   - O alvo é SEMPRE request.user.id — nunca aceitar userId de body/params.
//   - sessionId extraído via decodeJwt (sem re-verificar — authenticate() já verificou).
//
// LGPD:
//   - ip/userAgent passados ao service para audit log.
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';
import { decodeJwt } from 'jose';

import { db } from '../../db/client.js';

import type {
  ChangePasswordBody,
  SetPersonalEmailBody,
  TwoFactorActivateBody,
  TwoFactorDisableBody,
  UpdateProfileBody,
} from './schemas.js';
import {
  activate2fa,
  changePassword,
  disable2fa,
  enroll2fa,
  get2faStatus,
  getProfile,
  setPersonalEmail,
  updateProfile,
} from './service.js';

// ---------------------------------------------------------------------------
// Helper: extrair sessionId (jti) do access token
// ---------------------------------------------------------------------------

/**
 * Decodifica o Bearer token SEM verificação criptográfica (já verificado por
 * authenticate()) e extrai o jti (sessionId).
 *
 * Retorna 'unknown' como fallback (não deve acontecer após authenticate() passar,
 * mas garante que a revogação de sessões não barre o fluxo principal).
 */
function extractSessionId(request: FastifyRequest): string {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return 'unknown';

  const token = authHeader.slice('Bearer '.length);
  try {
    const payload = decodeJwt(token);
    return typeof payload.jti === 'string' && payload.jti.length > 0 ? payload.jti : 'unknown';
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// POST /api/account/personal-email (F14-S04)
// ---------------------------------------------------------------------------

export async function setPersonalEmailController(
  request: FastifyRequest<{ Body: SetPersonalEmailBody }>,
  reply: FastifyReply,
): Promise<void> {
  // `!` justificado: authenticate() garante que request.user está definido
  const userId = request.user!.id;
  const organizationId = request.user!.organizationId;
  const sessionId = extractSessionId(request);

  const profile = await setPersonalEmail(
    db,
    {
      userId,
      organizationId,
      sessionId,
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    },
    request.body,
  );

  return reply.status(200).send(profile);
}

// ---------------------------------------------------------------------------
// GET /api/account/profile
// ---------------------------------------------------------------------------

export async function getProfileController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // `!` justificado: authenticate() garante que request.user está definido
  const userId = request.user!.id;
  const organizationId = request.user!.organizationId;
  const sessionId = extractSessionId(request);

  const profile = await getProfile(db, {
    userId,
    organizationId,
    sessionId,
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
  });

  return reply.status(200).send(profile);
}

// ---------------------------------------------------------------------------
// PATCH /api/account/profile
// ---------------------------------------------------------------------------

export async function updateProfileController(
  request: FastifyRequest<{ Body: UpdateProfileBody }>,
  reply: FastifyReply,
): Promise<void> {
  const userId = request.user!.id;
  const organizationId = request.user!.organizationId;
  const sessionId = extractSessionId(request);

  const profile = await updateProfile(
    db,
    {
      userId,
      organizationId,
      sessionId,
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    },
    request.body,
  );

  return reply.status(200).send(profile);
}

// ---------------------------------------------------------------------------
// POST /api/account/password
// ---------------------------------------------------------------------------

export async function changePasswordController(
  request: FastifyRequest<{ Body: ChangePasswordBody }>,
  reply: FastifyReply,
): Promise<void> {
  const userId = request.user!.id;
  const organizationId = request.user!.organizationId;
  const sessionId = extractSessionId(request);

  await changePassword(
    db,
    {
      userId,
      organizationId,
      sessionId,
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    },
    request.body,
  );

  return reply.status(204).send();
}

// ---------------------------------------------------------------------------
// GET /api/account/2fa/status
// ---------------------------------------------------------------------------

export async function get2faStatusController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const userId = request.user!.id;
  const organizationId = request.user!.organizationId;
  const sessionId = extractSessionId(request);

  const status = await get2faStatus(db, { userId, organizationId, sessionId });

  return reply.status(200).send(status);
}

// ---------------------------------------------------------------------------
// POST /api/account/2fa/enroll
// ---------------------------------------------------------------------------

export async function enroll2faController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const userId = request.user!.id;
  const organizationId = request.user!.organizationId;
  const sessionId = extractSessionId(request);

  const result = await enroll2fa(db, {
    userId,
    organizationId,
    sessionId,
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
  });

  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/account/2fa/activate
// ---------------------------------------------------------------------------

export async function activate2faController(
  request: FastifyRequest<{ Body: TwoFactorActivateBody }>,
  reply: FastifyReply,
): Promise<void> {
  const userId = request.user!.id;
  const organizationId = request.user!.organizationId;
  const sessionId = extractSessionId(request);

  const result = await activate2fa(
    db,
    {
      userId,
      organizationId,
      sessionId,
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    },
    request.body,
  );

  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/account/2fa/disable
// ---------------------------------------------------------------------------

export async function disable2faController(
  request: FastifyRequest<{ Body: TwoFactorDisableBody }>,
  reply: FastifyReply,
): Promise<void> {
  const userId = request.user!.id;
  const organizationId = request.user!.organizationId;
  const sessionId = extractSessionId(request);

  await disable2fa(
    db,
    {
      userId,
      organizationId,
      sessionId,
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    },
    request.body,
  );

  return reply.status(204).send();
}
