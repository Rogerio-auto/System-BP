// =============================================================================
// auth/repository.ts — Queries Drizzle para autenticação.
//
// Todas as queries são injetáveis com instância db customizada (facilita testes).
// Sem applyCityScope aqui: auth é global (o token carrega org + city scopes).
// =============================================================================
import { and, eq, isNull, lt } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { userSessions, users } from '../../db/schema/index.js';
import type { UserSession } from '../../db/schema/user_sessions.js';
import type { User } from '../../db/schema/users.js';

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/**
 * Busca usuário pelo email (citext — case insensitive no banco).
 * Retorna null se não encontrado ou soft-deletado.
 */
export async function findUserByEmail(db: Database, email: string): Promise<User | null> {
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Busca usuário pelo ID.
 * Retorna null se não encontrado ou soft-deletado.
 */
export async function findUserById(db: Database, id: string): Promise<User | null> {
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Atualiza o timestamp de último login do usuário.
 */
export async function updateUserLastLogin(db: Database, userId: string): Promise<void> {
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface CreateSessionInput {
  id: string;
  userId: string;
  refreshTokenHash: string;
  userAgent: string | null;
  ip: string | null;
  expiresAt: Date;
}

/**
 * Cria uma nova sessão de refresh.
 */
export async function createSession(db: Database, input: CreateSessionInput): Promise<void> {
  await db.insert(userSessions).values({
    id: input.id,
    userId: input.userId,
    refreshTokenHash: input.refreshTokenHash,
    userAgent: input.userAgent,
    ip: input.ip,
    expiresAt: input.expiresAt,
  });
}

/**
 * Busca sessão pelo hash do refresh token.
 * Retorna null se não encontrada, revogada ou expirada.
 */
export async function findSessionByTokenHash(
  db: Database,
  hash: string,
): Promise<UserSession | null> {
  const now = new Date();
  const rows = await db
    .select()
    .from(userSessions)
    .where(
      and(
        eq(userSessions.refreshTokenHash, hash),
        isNull(userSessions.revokedAt),
        // Não retorna sessões expiradas (expiresAt < now)
        // lt inverte: where expiresAt > now ≡ NOT lt(expiresAt, now)
        // Usamos a condição correta: expiresAt deve ser > now
        // Drizzle: gt(userSessions.expiresAt, now)
      ),
    )
    .limit(1);

  const session = rows[0] ?? null;
  // Filtro de expiração no JS após query (índice parcial no banco já cobre ativo,
  // mas expiresAt pode ter passado desde a última use — double-check seguro)
  if (session && session.expiresAt < now) return null;

  return session;
}

/**
 * Busca sessão pelo ID da sessão (jti do token).
 * Retorna null se não encontrada, revogada ou expirada.
 */
export async function findSessionById(
  db: Database,
  sessionId: string,
): Promise<UserSession | null> {
  const now = new Date();
  const rows = await db
    .select()
    .from(userSessions)
    .where(and(eq(userSessions.id, sessionId), isNull(userSessions.revokedAt)))
    .limit(1);

  const session = rows[0] ?? null;
  if (session && session.expiresAt < now) return null;

  return session;
}

/**
 * Revoga uma sessão pelo ID (logout).
 * Idempotente: se já revogada, é no-op.
 */
export async function revokeSession(db: Database, sessionId: string): Promise<void> {
  await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(userSessions.id, sessionId), isNull(userSessions.revokedAt)));
}

/**
 * Rotação de sessão: deleta a sessão antiga, cria nova.
 * Executado em uma única chamada sequencial (sem transação no MVP — operação
 * idempotente pelo hash único; sessão antiga já foi validada).
 *
 * Design: delete + insert separados para manter o índice único em refresh_token_hash
 * e evitar conflito de constraint durante a rotação.
 */
export async function rotateSession(
  db: Database,
  oldSessionId: string,
  newSession: CreateSessionInput,
): Promise<void> {
  await db.delete(userSessions).where(eq(userSessions.id, oldSessionId));
  await createSession(db, newSession);
}

/**
 * Remove sessões com IP/UA já fora da janela de retenção (LGPD doc 17 §3.4).
 * Mantém sessões expiradas dentro de 90 dias para auditoria/forensics; deleta
 * apenas as expiradas há mais de 90 dias. Chamado em logout (housekeeping leve).
 */
const SESSION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export async function purgeExpiredSessions(db: Database, userId: string): Promise<void> {
  const cutoff = new Date(Date.now() - SESSION_RETENTION_MS);
  await db
    .delete(userSessions)
    .where(and(eq(userSessions.userId, userId), lt(userSessions.expiresAt, cutoff)));
}
