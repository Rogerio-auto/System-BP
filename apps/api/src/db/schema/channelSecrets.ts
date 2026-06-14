// =============================================================================
// channelSecrets.ts - Tokens cifrados dos canais (F16-S02).
//
// LGPD (doc 17 §8.1): Tokens de acesso (access_token, app_secret, api_key)
// sao credenciais sensiveis — cifrados com AES-256-GCM via encryptPii().
// NUNCA armazenar em texto clano. NUNCA logar.
//
// Separado de channels.ts para permitir acesso restrito ao servico de canal
// (RBAC interno: apenas o canal-adapter le os secrets).
//
// FK ON DELETE CASCADE: segredos sao deletados quando o canal e deletado.
// =============================================================================
import { sql } from 'drizzle-orm';
import { pgTable, uuid, timestamp, customType } from 'drizzle-orm/pg-core';

import { channels } from './channels.js';

/**
 * bytea: tipo PostgreSQL para dados binarios.
 * Usado para colunas *_enc (credenciais cifradas com AES-256-GCM).
 * Nunca expor no DTO — apenas o canal-adapter decifra antes de usar.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const channelSecrets = pgTable('channel_secrets', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),

  /**
   * FK para o canal dono destes segredos.
   * ON DELETE CASCADE: remover o canal remove os segredos.
   */
  channelId: uuid('channel_id')
    .notNull()
    .unique()
    .references(() => channels.id, { onDelete: 'cascade' }),

  /**
   * Access token do provider (cifrado AES-256-GCM via encryptPii).
   * meta_whatsapp: token de sistema (System User Token).
   * meta_instagram: token de page de longa duracao.
   * waha: api_key do servidor WAHA.
   * LGPD: dado altamente sensivel — acesso restrito ao canal-adapter.
   */
  accessTokenEnc: bytea('access_token_enc').notNull(),

  /**
   * App secret do Meta (para validacao de HMAC de webhook).
   * Presente em meta_whatsapp e meta_instagram. NULL para waha.
   * LGPD: sensivel — nunca logar.
   */
  appSecretEnc: bytea('app_secret_enc'),

  /**
   * API key alternativa (ex: WAHA api key ou outro provider futuro).
   * NULL para providers que nao usam api_key.
   */
  apiKeyEnc: bytea('api_key_enc'),

  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export type ChannelSecret = typeof channelSecrets.$inferSelect;
export type NewChannelSecret = typeof channelSecrets.$inferInsert;
