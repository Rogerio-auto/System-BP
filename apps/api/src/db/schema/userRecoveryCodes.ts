// =============================================================================
// userRecoveryCodes.ts — Recovery codes do 2FA/TOTP (F8-S11).
//
// Cada código é gerado na ativação do 2FA, exibido ao usuário uma única vez
// e armazenado como hash bcrypt (nunca plaintext).
//
// Uso: o usuário pode usar um recovery code como segundo fator no login.
// Após uso, used_at é preenchido (single-use). Nunca deletado — mantido para
// auditoria e cumprimento dos direitos do titular (LGPD doc 17 §14.1).
//
// LGPD: code_hash é um hash bcrypt — irreversível. O plaintext nunca persiste.
// =============================================================================
import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, index, foreignKey } from 'drizzle-orm/pg-core';

import { users } from './users.js';

export const userRecoveryCodes = pgTable(
  'user_recovery_codes',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    userId: uuid('user_id').notNull(),

    /**
     * Hash bcrypt cost 12 do recovery code em texto claro.
     * O plaintext NUNCA é persistido — apenas o hash.
     * Comparação: bcrypt.compare(inputCode, codeHash).
     */
    codeHash: text('code_hash').notNull(),

    /**
     * Quando o código foi usado (single-use).
     * null = disponível para uso.
     * not-null = consumido — não pode ser reutilizado.
     */
    usedAt: timestamp('used_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    fkUser: foreignKey({
      name: 'fk_recovery_codes_user',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),

    idxUserId: index('idx_recovery_codes_user_id').on(table.userId),
  }),
);

export type UserRecoveryCode = typeof userRecoveryCodes.$inferSelect;
export type NewUserRecoveryCode = typeof userRecoveryCodes.$inferInsert;
