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

import type { ChangePasswordBody, UpdateProfileBody } from './schemas.js';
import { changePassword, getProfile, updateProfile } from './service.js';

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
