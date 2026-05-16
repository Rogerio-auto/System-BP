// =============================================================================
// users.ts — Usuários da plataforma (funcionários do Banco do Povo).
//
// Não confundir com customers (clientes/leads do banco).
// email usa citext (case-insensitive) — exige extension citext no DB (0000_init).
// password_hash usa bcrypt cost 12; NUNCA aparece em logs (F1-S24 adiciona redact canônico).
// totp_secret armazenado cifrado com AES-256-GCM (F1-S24 — migration 0008).
//   A criptografia é feita na service layer usando encryptPii/decryptPii de lib/crypto/pii.ts.
//   O tipo bytea aqui reflete o armazenamento cifrado em coluna (doc 17 §8.1).
// status: 'active' | 'disabled' | 'pending'
// deleted_at: soft-delete para auditoria e revogação de acesso.
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
  foreignKey,
  customType,
} from 'drizzle-orm/pg-core';

import { organizations } from './organizations';

/**
 * citext: tipo PostgreSQL case-insensitive para texto.
 * Requer extension citext (criada em 0000_init.sql).
 * Drizzle 0.34.x não expõe citext nativamente — definido via customType.
 */
const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

/**
 * bytea: tipo PostgreSQL para dados binários cifrados.
 * Usado para totp_secret (AES-256-GCM via lib/crypto/pii.ts).
 * Node.js serializa como Buffer.
 * Drizzle não expõe bytea nativamente — definido via customType.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const users = pgTable(
  'users',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    organizationId: uuid('organization_id').notNull(),

    /**
     * citext: comparação case-insensitive sem normalizar na app.
     * Unique garantido pelo índice parcial abaixo (soft-delete safe).
     */
    email: citext('email').notNull(),

    /**
     * Hash bcrypt cost 12.
     * NUNCA logar ou serializar em resposta de API.
     * Campo nomeado explicitamente "password_hash" para o pino.redact (F1-S02).
     */
    passwordHash: text('password_hash').notNull(),

    fullName: text('full_name').notNull(),

    /**
     * 'active'   — pode logar.
     * 'disabled' — acesso bloqueado (ex: desligamento).
     * 'pending'  — criado, aguardando primeiro login / confirmação.
     */
    status: text('status', { enum: ['active', 'disabled', 'pending'] })
      .notNull()
      .default('pending'),

    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),

    /**
     * TOTP secret cifrado com AES-256-GCM pela camada de aplicação (F1-S24).
     * Armazenado como bytea — plaintext NUNCA é persistido.
     * Usar encryptPii/decryptPii de lib/crypto/pii.ts para read/write.
     * null = 2FA não configurado.
     */
    totpSecret: bytea('totp_secret'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    /** Soft-delete: registros deletados ficam auditáveis. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    // FK explícita com nome canônico
    fkOrg: foreignKey({
      name: 'fk_users_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    // B-tree em FK para joins eficientes (org → users)
    idxOrg: index('idx_users_org').on(table.organizationId),

    // Unique composto (org, email) apenas para registros não deletados.
    // Permite reutilizar e-mail após soft-delete em orgs diferentes.
    uqOrgEmailActive: uniqueIndex('uq_users_org_email_active')
      .on(table.organizationId, table.email)
      .where(sql`${table.deletedAt} IS NULL`),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
