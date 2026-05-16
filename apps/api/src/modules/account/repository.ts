// =============================================================================
// account/repository.ts — Queries Drizzle para o self-service de conta (F8-S09).
//
// Não usa applyCityScope — o recurso é o próprio usuário; escopo implícito.
// Todas as queries recebem userId diretamente de request.user.id (controller).
// =============================================================================
import { and, eq, isNull, ne } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { userSessions, users } from '../../db/schema/index.js';
import type { User } from '../../db/schema/users.js';

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/**
 * Busca o usuário pelo ID para exibição do perfil (self-service).
 * Retorna null se deletado.
 */
export async function findUserProfileById(db: Database, userId: string): Promise<User | null> {
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Atualiza full_name do próprio usuário.
 * Retorna o usuário atualizado ou null se não encontrado/deletado.
 */
export async function updateUserFullName(
  db: Database,
  userId: string,
  fullName: string,
): Promise<User | null> {
  const rows = await db
    .update(users)
    .set({ fullName, updatedAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .returning();

  return rows[0] ?? null;
}

/**
 * Atualiza o password_hash do próprio usuário.
 * Retorna o usuário atualizado ou null se não encontrado/deletado.
 */
export async function updateUserPasswordHash(
  db: Database,
  userId: string,
  passwordHash: string,
): Promise<User | null> {
  const rows = await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .returning();

  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/**
 * Revoga todas as sessões do usuário EXCETO a sessão atual (identificada
 * pelo sessionId vindo do JWT claim `jti`).
 *
 * Prática de segurança padrão após troca de senha: as outras sessões
 * (outros dispositivos/browsers) são invalidadas imediatamente.
 *
 * O caller da sessão atual permanece logado — reduz fricção UX sem
 * comprometer a segurança (o ator já provou a identidade ao fornecer
 * a senha atual correta).
 */
export async function revokeOtherSessions(
  db: Database,
  userId: string,
  currentSessionId: string,
): Promise<void> {
  await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(userSessions.userId, userId),
        ne(userSessions.id, currentSessionId),
        isNull(userSessions.revokedAt),
      ),
    );
}
