// =============================================================================
// messages.ts - Mensagens do live chat multicanal (F16-S02, decisao D2).
//
// Cada linha = uma mensagem enviada ou recebida em uma conversa.
// direction: in (inbound do contato) | out (outbound do agente/sistema).
// type: taxonomia da §3 do planejamento (text, image, audio, ..., system).
// view_status: rastreamento de status de entrega (pending -> sent -> delivered -> read).
//
// LGPD (doc 17 §8.1):
//   - content pode conter PII (texto da mensagem do usuario).
//     Responsabilidade do consumidor fazer redact antes de logar.
//   - media_url: URL de midia (pode ser URL de R2 com nome de arquivo revelador).
//   - interactive_payload: pode conter nomes/telefones em templates.
//   Todos os campos marcados como PII devem ser omitidos em logs de producao.
//   O DLP (lib/dlp.ts) deve ser aplicado antes de qualquer call ao LLM gateway.
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';

import { channels } from './channels.js';
import { conversations } from './conversations.js';

export const messages = pgTable(
  'messages',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Conversa a que esta mensagem pertence. */
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),

    /**
     * Canal pelo qual a mensagem foi enviada/recebida.
     * Desnormalizacao deliberada para facilitar queries de inbox por canal.
     * Deve ser igual ao channel_id da conversa.
     */
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'restrict' }),

    /**
     * Direcao da mensagem. Enum validado por CHECK no DB.
     * in = recebida do contato; out = enviada pelo sistema/agente.
     */
    direction: text('direction').notNull(),

    /**
     * ID externo da mensagem no provider (ex: wamid.xxx para WhatsApp).
     * Usado para dedupe de inbound e rastreamento de status de entrega.
     * NULL para mensagens de sistema (direction=out, type=system).
     */
    externalId: text('external_id'),

    /**
     * Tipo de mensagem (taxonomia §3 do planejamento).
     * text | image | video | audio | voice | document | sticker |
     * location | contact | interactive | template | reaction | system |
     * story_mention | story_reply | share | comment | comment_reply |
     * ig_postback | referral.
     */
    type: text('type').notNull(),

    /**
     * Conteudo textual da mensagem.
     * LGPD: PII — nao logar sem DLP/redact. Aplicar lib/dlp.ts antes de LLM.
     */
    content: text('content'),

    /**
     * URL de midia no R2 (apos download/upload pelo media worker).
     * NULL para mensagens sem midia.
     * LGPD: pode conter info sensivel via nome de arquivo — tratar com cuidado.
     */
    mediaUrl: text('media_url'),

    /** MIME type da midia (ex: image/jpeg, audio/ogg). */
    mediaMime: text('media_mime'),

    /** Tamanho da midia em bytes. */
    mediaSizeBytes: integer('media_size_bytes'),

    /** SHA-256 do arquivo de midia (para verificacao de integridade + dedupe). */
    mediaSha256: text('media_sha256'),

    /**
     * Payload de mensagem interativa (botoes, lista, template — JSON).
     * LGPD: pode conter PII em componentes de template.
     */
    interactivePayload: jsonb('interactive_payload'),

    /**
     * Status de visualizacao/entrega da mensagem.
     * Enum validado por CHECK no DB.
     * pending: enfileirada mas nao enviada.
     * sent: enviada ao provider.
     * delivered: confirmado entregue ao dispositivo.
     * read: lido pelo contato.
     * failed: falha permanente de entrega.
     * NULL para inbound (status nao aplicavel).
     */
    viewStatus: text('view_status'),

    /**
     * ID da mensagem que esta sendo respondida (reply).
     * NULL para mensagens sem citacao.
     */
    replyToExternalId: text('reply_to_external_id'),

    /** Metadados extras do provider (ex: from_me, forwarded, broadcast). */
    metadata: jsonb('metadata'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    idxConversationCreated: index('messages_conversation_created_idx').on(
      t.conversationId,
      t.createdAt,
    ),
    uqChannelExternalId: uniqueIndex('messages_channel_external_id_key')
      .on(t.channelId, t.externalId)
      .where(sql`external_id IS NOT NULL`),
    idxConversationDirection: index('messages_conversation_direction_idx').on(
      t.conversationId,
      t.direction,
    ),
    /** CHECK de enum: garante apenas direcoes validas no DB. */
    chkDirection: check('messages_direction_check', sql`direction IN ('in', 'out')`),
    /** CHECK de enum: garante apenas view_status validos no DB. NULL permitido (inbound). */
    chkViewStatus: check(
      'messages_view_status_check',
      sql`view_status IS NULL OR view_status IN ('pending', 'sent', 'delivered', 'read', 'failed')`,
    ),
  }),
);

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
