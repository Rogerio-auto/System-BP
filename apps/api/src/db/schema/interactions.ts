// =============================================================================
// interactions.ts — Interações entre agentes e leads.
//
// Registra cada contato (mensagem, ligação, visita presencial) entre o banco
// e o lead. Integra com Chatwoot (external_ref) e WhatsApp.
//
// Colunas-chave:
//   - channel:      canal usado para a interação.
//   - direction:    'inbound' = lead contatou o banco; 'outbound' = banco contatou.
//   - content:      texto da mensagem ou resumo da interação.
//   - external_ref: ID externo do sistema de origem (Chatwoot conversation_id,
//                   WhatsApp message_id, etc.). Dedupe via unique parcial.
//   - organization_id: denormalizado do lead para city-scope direto sem JOIN.
//
// LGPD (doc 17 §8.5):
//   - content pode conter PII (nome, CPF mencionado em mensagem, etc.).
//   - TODO: cifrar content em coluna separada em fase futura (F2+).
//   - Por ora, texto puro com aviso explícito. DLP deve mascarar antes de LLM.
//
// Dedupe de mensagens externas:
//   - UNIQUE (channel, external_ref) WHERE external_ref IS NOT NULL.
//   - Garante idempotência no webhook do WhatsApp/Chatwoot.
//
// Sem soft-delete: interações são registros de auditoria de comunicação.
// Sem updated_at: interações são imutáveis após criação.
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  foreignKey,
} from 'drizzle-orm/pg-core';

import { leads } from './leads.js';
import { organizations } from './organizations.js';

export const interactions = pgTable(
  'interactions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /**
     * Lead ao qual esta interação pertence.
     * ON DELETE CASCADE: deletar o lead deleta suas interações.
     * Na prática, leads têm soft-delete.
     */
    leadId: uuid('lead_id').notNull(),

    /**
     * Organização do lead. Denormalizado para filtros city-scope diretos.
     * FK ON DELETE RESTRICT: org não pode ser deletada com interações ativas.
     */
    organizationId: uuid('organization_id').notNull(),

    /**
     * Canal da interação.
     * 'whatsapp'   — mensagem via integração WhatsApp Business.
     * 'phone'      — ligação telefônica (registrada manualmente).
     * 'email'      — email (capturado via integração ou manual).
     * 'in_person'  — atendimento presencial na agência.
     * 'chatwoot'   — mensagem via Chatwoot (web chat, inbox, etc.).
     */
    channel: text('channel', {
      enum: ['whatsapp', 'phone', 'email', 'in_person', 'chatwoot'],
    }).notNull(),

    /**
     * Direção da comunicação.
     * 'inbound'  — lead iniciou o contato com o banco.
     * 'outbound' — banco/agente iniciou o contato com o lead.
     */
    direction: text('direction', {
      enum: ['inbound', 'outbound'],
    }).notNull(),

    /**
     * Conteúdo da interação (texto da mensagem, resumo da ligação, etc.).
     *
     * LGPD §8.5 — ATENÇÃO: pode conter PII (nome, CPF mencionado, etc.).
     * TODO: cifrar este campo em fase futura (F2+) para conformidade total.
     * Por ora: texto puro. DLP obrigatório antes de enviar ao gateway LLM.
     * Logs com pino.redact devem mascarar este campo.
     */
    content: text('content').notNull(),

    /**
     * Metadados extras da interação.
     * Exemplos: { message_type, media_url, duration_seconds, chatwoot_agent_id }.
     * Não armazenar PII bruta aqui.
     */
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),

    /**
     * ID externo no sistema de origem.
     * Exemplos: chatwoot_message_id, whatsapp_message_id, email_message_id.
     * Usado para dedupe via unique parcial (channel, external_ref).
     * null = interação criada manualmente (sem ID externo).
     */
    externalRef: text('external_ref'),

    /**
     * Timestamp da interação.
     * Imutável após criação (registro de comunicação).
     */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // -------------------------------------------------------------------------
    // Foreign Keys
    // -------------------------------------------------------------------------

    fkLead: foreignKey({
      name: 'fk_interactions_lead',
      columns: [table.leadId],
      foreignColumns: [leads.id],
    }).onDelete('cascade'),

    fkOrg: foreignKey({
      name: 'fk_interactions_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Timeline de interações do lead.
     * Query principal: "todas as mensagens do lead X, mais recentes primeiro".
     */
    idxLeadCreated: index('idx_interactions_lead_created').on(table.leadId, table.createdAt),

    /**
     * Relatórios por canal: "todas as interações WhatsApp da org X esta semana".
     */
    idxOrgChannelCreated: index('idx_interactions_org_channel_created').on(
      table.organizationId,
      table.channel,
      table.createdAt,
    ),

    /**
     * Dedupe de mensagens externas.
     * Garante que um mesmo message_id do WhatsApp/Chatwoot não seja inserido duas vezes.
     * Parcial: só aplica quando external_ref está presente.
     */
    uqChannelExternalRef: uniqueIndex('uq_interactions_channel_external_ref')
      .on(table.channel, table.externalRef)
      .where(sql`${table.externalRef} IS NOT NULL`),
  }),
);

export type Interaction = typeof interactions.$inferSelect;
export type NewInteraction = typeof interactions.$inferInsert;
