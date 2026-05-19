// =============================================================================
// totpChallenges.ts — Desafios temporários de 2FA no login (F8-S11).
//
// Quando o login detecta 2FA ativo, não emite access/refresh token diretamente.
// Em vez disso, cria um totp_challenge (TTL 5 min) e retorna um challenge_token
// para o frontend. O frontend troca o challenge_token + código TOTP por uma
// sessão completa via POST /api/auth/verify-2fa.
//
// Segurança:
//   - token_hash: HMAC-SHA256 do challenge_token — nunca armazena o token bruto.
//   - expires_at: 5 minutos após criação — curto para minimizar janela de ataque.
//   - used_at: marcado após uso bem-sucedido — não pode ser reutilizado.
//   - Associado ao user_id — não permite troca de desafio entre usuários.
// =============================================================================
import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, index, foreignKey } from 'drizzle-orm/pg-core';

import { users } from './users.js';

export const totpChallenges = pgTable(
  'totp_challenges',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    userId: uuid('user_id').notNull(),

    /**
     * HMAC-SHA256 hex do challenge token (nunca armazenar o token bruto).
     * Único por constraint — previne colisão de tokens.
     */
    tokenHash: text('token_hash').notNull().unique(),

    /**
     * Expiração do desafio. 5 minutos após criação.
     * Desafios expirados são rejeitados mesmo se não usados.
     */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    /**
     * Quando o desafio foi usado com sucesso.
     * null = disponível; não-null = consumido (idempotente).
     */
    usedAt: timestamp('used_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    fkUser: foreignKey({
      name: 'fk_totp_challenge_user',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),

    // Índice para cleanup de challenges expirados (job de housekeeping)
    idxExpiresAt: index('idx_totp_challenges_expires_at').on(table.expiresAt),
  }),
);

export type TotpChallenge = typeof totpChallenges.$inferSelect;
export type NewTotpChallenge = typeof totpChallenges.$inferInsert;
