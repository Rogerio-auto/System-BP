// =============================================================================
// conversations.ts - Conversas do live chat multicanal (F16-S02, decisao D2).
//
// Uma conversa = thread de mensagens com um contato em um canal especifico.
// Status pipeline: open -> pending -> resolved | snoozed.
// Kind: dm (DM), group (grupo WA), comment_thread (thread de comentario IG).
//
// LGPD (doc 17 §8.1):
//   - contact_name: PII — nao logar sem redact.
//   - contact_phone_enc: telefone cifrado AES-256-GCM via encryptPii().
//     Se necessario dedupe de telefone, usar hashDocument() sobre o numero normalizado.
//   - contact_remote_id: pode ser numero de telefone (meta_whatsapp) — PII indireta.
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  customType,
  check,
} from 'drizzle-orm/pg-core';

import { channels } from './channels.js';
import { customers } from './customers.js';
import { leads } from './leads.js';
import { organizations } from './organizations.js';
import { users } from './users.js';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Multi-tenant root. */
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    /** Cidade para escopo regional (NULL = global na org). */
    cityId: uuid('city_id'),

    /** Canal pelo qual a conversa esta acontecendo. */
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'restrict' }),

    /**
     * ID remoto do contato no provider (ex: numero E.164, IGSID, group ID).
     * LGPD: pode ser numero de telefone (PII indireta) — nao logar sem redact.
     */
    contactRemoteId: text('contact_remote_id').notNull(),

    /**
     * Nome do contato (displayName do provider, se disponivel).
     * LGPD: PII — nao logar sem redact.
     */
    contactName: text('contact_name'),

    /**
     * Telefone cifrado AES-256-GCM via encryptPii() (doc 17 §8.1).
     * NULL se provider nao enviar telefone (ex: Instagram DM).
     * Para dedupe: usar hashDocument() sobre o numero normalizado.
     */
    contactPhoneEnc: bytea('contact_phone_enc'),

    /**
     * Lead vinculado (se o contato foi identificado no CRM).
     * NULL = contato desconhecido ou ainda nao vinculado.
     * FK ON DELETE SET NULL: lead deletado nao remove a conversa.
     */
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),

    /**
     * Cliente vinculado (se o lead foi convertido em cliente).
     * FK ON DELETE SET NULL: cliente deletado nao remove a conversa.
     */
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),

    /**
     * Status da conversa no pipeline.
     * Enum de dominio validado por CHECK no DB.
     * open: aguardando resposta do agente.
     * pending: aguardando resposta do contato.
     * resolved: encerrada.
     * snoozed: em pausa temporaria.
     */
    status: text('status').notNull().default('open'),

    /**
     * Tipo de conversa.
     * Enum de dominio validado por CHECK no DB.
     * dm: mensagem direta (1:1).
     * group: grupo (WhatsApp grupos — roadmap).
     * comment_thread: thread de comentario (Instagram).
     */
    kind: text('kind').notNull().default('dm'),

    /**
     * Agente responsavel pelo atendimento.
     * NULL = nao atribuido (inbox nao lido ou roteamento pendente).
     * FK ON DELETE SET NULL: usuario deletado libera a conversa para reatribuicao.
     */
    assignedUserId: uuid('assigned_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    /** Timestamp do ultimo inbound (para SLA e ordenacao por urgencia). */
    lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),

    /** Timestamp da ultima mensagem (inbound ou outbound) — para ordenacao. */
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),

    /** Contador de mensagens nao lidas do contato (incrementado em inbound). */
    unreadCount: integer('unread_count').notNull().default(0),

    /**
     * Timestamp do PRIMEIRO handoff da IA disparado para esta conversa.
     * NULL = handoff ainda nao ocorreu. Setado via UPDATE atomico (WHERE
     * ai_handoff_at IS NULL) em triggerLivechatHandoff — garante disparo
     * unico do fallback + notificacao mesmo sob mensagens concorrentes
     * (migration 0091, correcao do loop de handoff em producao).
     */
    aiHandoffAt: timestamp('ai_handoff_at', { withTimezone: true }),

    /** Metadados extras (ex: referral data, entrypoint). */
    metadata: text('metadata'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    idxOrgChannelLastMsg: index('conversations_org_channel_last_message_idx').on(
      t.organizationId,
      t.channelId,
      t.lastMessageAt,
    ),
    idxOrgStatus: index('conversations_org_status_idx').on(t.organizationId, t.status),
    idxChannelContact: index('conversations_channel_contact_idx').on(
      t.channelId,
      t.contactRemoteId,
    ),
    idxOrgCity: index('conversations_org_city_idx').on(t.organizationId, t.cityId),
    /** CHECK de enum: garante apenas status validos no DB. */
    chkStatus: check(
      'conversations_status_check',
      sql`status IN ('open', 'pending', 'resolved', 'snoozed')`,
    ),
    /** CHECK de enum: garante apenas kinds validos no DB. */
    chkKind: check('conversations_kind_check', sql`kind IN ('dm', 'group', 'comment_thread')`),
  }),
);

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
