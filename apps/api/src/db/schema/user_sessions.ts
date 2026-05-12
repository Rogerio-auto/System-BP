// =============================================================================
// user_sessions.ts — Sessões de refresh token.
//
// Armazena apenas o hash do refresh token (nunca o token em claro).
// Revogar sessão: setar revoked_at = now() ou deletar o registro.
//
// Fluxo (doc 10 §2.2):
//   login        → INSERT session com token hash
//   refresh      → verificar hash + rotacionar (INSERT novo, DELETE antigo)
//   logout       → setar revoked_at = now()
//   tela sessões → listar registros ativos + permitir revogação por id
//
// ip e user_agent são PII leve — cobertos por pino.redact em F1-S02.
// expires_at: token de refresh expira em 30 dias (configurável via env).
// =============================================================================
import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, foreignKey, index } from 'drizzle-orm/pg-core';

import { users } from './users';

export const userSessions = pgTable(
  'user_sessions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    userId: uuid('user_id').notNull(),

    /**
     * SHA-256 do refresh token. Nunca armazenar o token em claro.
     * Índice único garante que 1 hash não seja reutilizado em sessões paralelas.
     */
    refreshTokenHash: text('refresh_token_hash').notNull().unique(),

    /** User-Agent para exibição na tela "Minhas sessões". */
    userAgent: text('user_agent'),

    /**
     * IP de origem do login.
     * Mascarado em logs e listagens (coberto por pino.redact em F1-S02).
     */
    ip: text('ip'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /** Última vez que este token foi usado para refresh. */
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),

    /** Data de expiração natural (30 dias após criação, configurável). */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    /**
     * Preenchido no logout ou revogação manual.
     * Sessões com revoked_at != null são rejeitadas no middleware de auth.
     */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: 'fk_user_sessions_user',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),

    // B-tree para buscar sessões de um usuário (tela "Minhas sessões")
    index('idx_user_sessions_user').on(table.userId),

    // Índice parcial para busca eficiente de sessões ativas (exclui revogadas)
    index('idx_user_sessions_active')
      .on(table.userId, table.expiresAt)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);

export type UserSession = typeof userSessions.$inferSelect;
export type NewUserSession = typeof userSessions.$inferInsert;
