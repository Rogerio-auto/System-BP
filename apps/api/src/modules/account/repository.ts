// =============================================================================
// account/repository.ts — Queries Drizzle para o self-service de conta (F8-S09/S11).
//
// Não usa applyCityScope — o recurso é o próprio usuário; escopo implícito.
// Todas as queries recebem userId diretamente de request.user.id (controller).
// =============================================================================
import { and, eq, isNull, ne } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { roles, userRecoveryCodes, userRoles, userSessions, users } from '../../db/schema/index.js';
import type { UserRecoveryCode } from '../../db/schema/userRecoveryCodes.js';
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
 * Retorna as role keys do usuário (ex: ['agente', 'supervisor']).
 *
 * Usado para calcular `requires_personal_email` em getProfile (F14-S04).
 * Não aplica filtro de soft-delete em userRoles — o usuário já foi validado
 * como ativo antes desta chamada.
 */
export async function findUserRoleKeys(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .select({ key: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));

  return rows.map((r) => r.key);
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
 * Atualiza o email pessoal do próprio usuário (F14-S04).
 *
 * LGPD (doc 17 §8.1): personal_email é PII — coberto por pino.redact.
 * Retorna o usuário atualizado ou null se não encontrado/deletado.
 *
 * Erros de unique constraint (uq_users_org_personal_email_active) precisam ser
 * capturados pelo caller (service) e convertidos em erro de negócio.
 */
export async function updateUserPersonalEmail(
  db: Database,
  userId: string,
  personalEmail: string,
): Promise<User | null> {
  const rows = await db
    .update(users)
    .set({ personalEmail, updatedAt: new Date() })
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

// ---------------------------------------------------------------------------
// 2FA / TOTP
// ---------------------------------------------------------------------------

/**
 * Salva o TOTP secret pendente (cifrado em bytea) sem ativar o 2FA.
 * O 2FA só é considerado ativo após `confirmTotp` definir `totp_confirmed_at`.
 */
export async function saveTotpSecretPending(
  db: Database,
  userId: string,
  secretEncrypted: Buffer,
): Promise<void> {
  await db
    .update(users)
    .set({ totpSecret: secretEncrypted, totpConfirmedAt: null, updatedAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.deletedAt)));
}

/**
 * Ativa o 2FA: define totp_confirmed_at com o timestamp atual.
 * Chamado após o usuário confirmar o código TOTP com sucesso.
 */
export async function activateTotp(db: Database, userId: string): Promise<void> {
  await db
    .update(users)
    .set({ totpConfirmedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.deletedAt)));
}

/**
 * Desativa o 2FA: zera totp_secret e totp_confirmed_at.
 */
export async function disableTotp(db: Database, userId: string): Promise<void> {
  await db
    .update(users)
    .set({ totpSecret: null, totpConfirmedAt: null, updatedAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.deletedAt)));
}

/**
 * Insere recovery codes (já hashed) para o usuário.
 * Deve ser chamado após deletar os recovery codes antigos (se houver).
 */
export async function insertRecoveryCodes(
  db: Database,
  userId: string,
  codeHashes: string[],
): Promise<void> {
  if (codeHashes.length === 0) return;
  await db.insert(userRecoveryCodes).values(codeHashes.map((hash) => ({ userId, codeHash: hash })));
}

/**
 * Lista os recovery codes disponíveis (ainda não usados) de um usuário.
 */
export async function listAvailableRecoveryCodes(
  db: Database,
  userId: string,
): Promise<UserRecoveryCode[]> {
  return db
    .select()
    .from(userRecoveryCodes)
    .where(and(eq(userRecoveryCodes.userId, userId), isNull(userRecoveryCodes.usedAt)));
}

/**
 * Lista TODOS os recovery codes do usuário (para housekeeping na desativação).
 */
export async function listAllRecoveryCodes(
  db: Database,
  userId: string,
): Promise<UserRecoveryCode[]> {
  return db.select().from(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId));
}

/**
 * Marca um recovery code como usado (single-use enforcement).
 * Idempotente: se já estiver marcado, é no-op.
 */
export async function markRecoveryCodeUsed(db: Database, codeId: string): Promise<void> {
  await db
    .update(userRecoveryCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(userRecoveryCodes.id, codeId), isNull(userRecoveryCodes.usedAt)));
}

/**
 * Marca um recovery code como usado de forma atômica (gate CAS).
 *
 * Executa UPDATE ... WHERE id = $1 AND used_at IS NULL RETURNING id.
 * Retorna true se marcado com sucesso, false se já estava consumido (race condition).
 * O caller deve rejeitar a requisição se retornar false.
 */
export async function markRecoveryCodeUsedAtomic(db: Database, codeId: string): Promise<boolean> {
  const rows = await db
    .update(userRecoveryCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(userRecoveryCodes.id, codeId), isNull(userRecoveryCodes.usedAt)))
    .returning({ id: userRecoveryCodes.id });

  return rows.length > 0;
}

/**
 * Deleta todos os recovery codes do usuário (usado na desativação do 2FA).
 * Soft-delete não é necessário aqui — o audit log cobre o rastro.
 */
export async function deleteRecoveryCodes(db: Database, userId: string): Promise<void> {
  await db.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId));
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
