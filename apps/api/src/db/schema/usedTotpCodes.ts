// =============================================================================
// usedTotpCodes.ts — Controle de replay de códigos TOTP (F8-S11).
//
// Motivação (doc 10 §4.3 + F7-S03):
//   RFC 6238 permite reutilização do mesmo código dentro da janela de tolerância
//   (±1 step = ±30s). Esta tabela registra códigos já consumidos para prevenir
//   ataques de replay — um atacante que intercepta o código não pode reutilizá-lo.
//
// Fluxo de uso (auth/service.ts):
//   1. Verificar código TOTP via verifyTotpCode() (válido criptograficamente).
//   2. Verificar ausência em used_totp_codes (anti-replay gate).
//   3. Inserir em used_totp_codes dentro da transação de autenticação
//      via ON CONFLICT DO NOTHING + verificar 0 linhas = replay detectado.
//   4. Job de limpeza: purgar WHERE used_at < now() - interval '90 seconds'.
//
// TTL: 90s (3 steps TOTP = janela máxima de tolerância) — dados expiram rápido.
//
// LGPD (doc 17 §3.4):
//   - code_hash: SHA-256 do código de 6 dígitos — não reversível.
//   - user_id: referência opaca — não identifica o indivíduo isoladamente.
//   - Retenção: 90s — eliminação automática por job de limpeza.
//   - Minimização: apenas 3 colunas para o objetivo de prevenção de replay.
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './users.js';

export const usedTotpCodes = pgTable(
  'used_totp_codes',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /**
     * Usuário que utilizou o código TOTP.
     * ON DELETE CASCADE: usuário deletado → replay history irrelevante.
     */
    userId: uuid('user_id').notNull(),

    /**
     * SHA-256 do código TOTP de 6 dígitos consumido.
     * Não armazena o código em claro — apenas o hash para comparação.
     * SHA-256 é suficiente: input é de baixa entropia mas a janela de tempo
     * (90s TTL) é o fator dominante de segurança para este caso de uso.
     */
    codeHash: text('code_hash').notNull(),

    /**
     * Momento em que o código foi consumido com sucesso.
     * Usado pelo job de limpeza (purgar WHERE used_at < now() - '90s')
     * e pela verificação de validade dentro da janela TTL.
     */
    usedAt: timestamp('used_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    // -------------------------------------------------------------------------
    // Foreign Keys
    // -------------------------------------------------------------------------

    fkUser: foreignKey({
      name: 'fk_used_totp_codes_user',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),

    // -------------------------------------------------------------------------
    // Unique Constraints
    // -------------------------------------------------------------------------

    /**
     * Previne inserção duplicada do mesmo código na mesma janela.
     * Condição de corrida: duas requisições paralelas com o mesmo código
     * — ON CONFLICT (user_id, code_hash) garante atomicidade.
     */
    uqUserCode: uniqueIndex('uq_used_totp_codes_user_code').on(table.userId, table.codeHash),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Job de limpeza por used_at (TTL 90s).
     * Permite DELETE ... WHERE used_at < now() - interval '90 seconds' eficiente.
     */
    idxUsedAt: index('idx_used_totp_codes_used_at').on(table.usedAt),
  }),
);

export type UsedTotpCode = typeof usedTotpCodes.$inferSelect;
export type NewUsedTotpCode = typeof usedTotpCodes.$inferInsert;
