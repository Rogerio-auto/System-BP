// channels.ts - Canais de mensagem do live chat multicanal (F16-S02).
// LGPD: display_handle pode ser PII (numero de telefone) — nao logar sem redact.
// Tokens de acesso NUNCA aqui — ficam em channel_secrets (bytea enc).
import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  check,
  customType,
} from 'drizzle-orm/pg-core';

import { organizations } from './organizations.js';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const channels = pgTable(
  'channels',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    cityId: uuid('city_id'),
    /**
     * Provider do canal. Enum de dominio validado por CHECK no DB.
     * meta_whatsapp | meta_instagram | waha
     */
    provider: text('provider').notNull(),
    name: text('name').notNull(),
    displayHandle: text('display_handle').notNull(),
    /**
     * Numero de telefone cifrado AES-256-GCM via encryptPii() (doc 17 §8.1).
     * Pode ser o celular pessoal de um atendente — dado pessoal LGPD.
     * Para busca/dedupe: usar hashDocument() sobre o numero E.164 normalizado.
     * phone_number_id (ID da Meta) continua texto — e ID tecnico, nao PII.
     */
    phoneNumberEnc: bytea('phone_number_enc'),
    phoneNumberId: text('phone_number_id'),
    wabaId: text('waba_id'),
    metaAppId: text('meta_app_id'),
    igUserId: text('ig_user_id'),
    igUsername: text('ig_username'),
    igAccountType: text('ig_account_type'),
    fbPageId: text('fb_page_id'),
    wahaSessionId: text('waha_session_id'),
    isActive: boolean('is_active').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    uqOrgProviderPhone: uniqueIndex('channels_org_provider_phone_number_id_key').on(
      t.organizationId,
      t.provider,
      t.phoneNumberId,
    ),
    idxOrgProvider: index('channels_org_provider_idx').on(t.organizationId, t.provider),
    idxOrgCity: index('channels_org_city_idx').on(t.organizationId, t.cityId),
    /** CHECK de enum: garante apenas providers suportados no DB. */
    chkProviderEnum: check(
      'channels_provider_enum_check',
      sql`provider IN ('meta_whatsapp', 'meta_instagram', 'waha')`,
    ),
    /** CHECK de coerencia por provider: campos obrigatorios por tipo. */
    chkProviderFields: check(
      'channels_provider_fields_check',
      sql`(provider = 'meta_whatsapp' AND phone_number_id IS NOT NULL) OR (provider = 'meta_instagram' AND ig_user_id IS NOT NULL) OR (provider = 'waha' AND waha_session_id IS NOT NULL)`,
    ),
  }),
);

export type Channel = typeof channels.$inferSelect;
export type NewChannel = typeof channels.$inferInsert;
