// =============================================================================
// whatsappTemplates.ts — Catálogo de templates WhatsApp aprovados pela Meta (F5-S01).
//
// Templates são mensagens pré-aprovadas pela Meta Business Suite.
// Somente templates com status='approved' podem ser enviados em conversas fora
// da janela de 24h (HSM — Highly Structured Messages).
//
// Ciclo de vida de aprovação (controlado pela Meta):
//   pending → approved   (Meta aprovou)
//   pending → rejected   (Meta recusou — revisar conteúdo)
//   approved → paused    (Meta pausou por violação de política)
//   rejected → pending   (após edição e resubmissão)
//
// Regra de negócio:
//   - Um template pertence a uma organização (multi-tenant).
//   - `name` é o slug interno único por organização (ex: "followup_d1").
//   - `meta_template_id` é o ID externo da Meta (opaque string).
//   - `body` contém variáveis no formato {{1}}, {{2}} (Meta template syntax).
//   - `variables` lista os nomes semânticos das variáveis para a app mapear.
//
// Gating: templates são usados por followup_rules, que são gated por
//   followup.enabled=disabled. Templates podem ser cadastrados com a flag
//   desligada (catálogo visual F5-S05), mas nunca disparados.
//
// Índices:
//   - unique (organization_id, name): slug único por org.
//   - idx_templates_meta_id: lookup por ID externo Meta ao receber webhooks.
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { organizations } from './organizations.js';

export const whatsappTemplates = pgTable(
  'whatsapp_templates',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Multi-tenant root. Todo template pertence a uma organização. */
    organizationId: uuid('organization_id').notNull(),

    /**
     * ID opaco do template na Meta Business API.
     * Retornado ao criar/sincronizar templates via API Meta.
     * Usado para correlacionar webhooks de aprovação/rejeição.
     */
    metaTemplateId: text('meta_template_id').notNull(),

    /**
     * Slug interno do template (ex: "followup_d1", "followup_d3").
     * Unique por organização — usado para referenciar em código sem
     * depender do ID externo da Meta (que pode mudar entre ambientes).
     */
    name: text('name').notNull(),

    /**
     * Idioma do template no formato Meta (ex: "pt_BR", "en_US").
     * A Meta exige que o idioma seja especificado ao enviar o template.
     * Default: pt_BR (idioma principal do Banco do Povo / SEDEC-RO).
     */
    language: text('language').notNull().default('pt_BR'),

    /**
     * Categoria do template segundo a política de uso da Meta.
     * 'utility'        → notificações transacionais (confirmações, status).
     * 'marketing'      → ofertas, promoções (custo maior por sessão).
     * 'authentication' → OTPs e verificação de identidade.
     *
     * Para follow-up de crédito: 'utility' (notificação de status de proposta).
     */
    category: text('category', {
      enum: ['utility', 'marketing', 'authentication'],
    }).notNull(),

    /**
     * Corpo do template com placeholders no formato Meta: {{1}}, {{2}}, etc.
     * Ex: "Olá {{1}}, sua proposta de crédito está em análise. Acesse {{2}}."
     *
     * Não armazenar dados pessoais aqui — apenas texto estrutural com variáveis.
     * O preenchimento dos valores das variáveis é feito pelo worker no envio.
     */
    body: text('body').notNull(),

    /**
     * Nomes semânticos das variáveis em ordem posicional ({{1}}, {{2}}, ...).
     * Ex: ["nome_lead", "link_simulacao"]
     * Permite ao worker mapear campos do lead para as variáveis sem hardcode.
     * Default: array vazio (templates sem variáveis).
     */
    variables: text('variables')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),

    /**
     * Status de aprovação pela Meta.
     * 'pending'  → aguardando revisão da Meta (pode levar horas a dias).
     * 'approved' → aprovado — pode ser enviado em janelas fora de 24h.
     * 'rejected' → recusado pela Meta — revisar conteúdo antes de resubmeter.
     * 'paused'   → Meta pausou por violação de política de uso.
     *
     * Somente templates com status='approved' devem ser usados em followup_rules.
     */
    status: text('status', {
      enum: ['pending', 'approved', 'rejected', 'paused'],
    })
      .notNull()
      .default('pending'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // -------------------------------------------------------------------------
    // Foreign Keys (nomeadas explicitamente)
    // -------------------------------------------------------------------------

    fkOrg: foreignKey({
      name: 'fk_whatsapp_templates_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    // -------------------------------------------------------------------------
    // Check Constraints
    // -------------------------------------------------------------------------

    /**
     * language deve seguir o formato BCP-47 simplificado da Meta: ll_CC
     * (2 letras de idioma + _ + 2 letras de país, em maiúsculas).
     * Ex: pt_BR, en_US, es_AR.
     */
    chkLanguage: check(
      'chk_whatsapp_templates_language_format',
      sql`${table.language} ~ '^[a-z]{2}_[A-Z]{2}$'`,
    ),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Slug único por organização.
     * Permite referenciar templates pelo nome em código sem depender do ID externo.
     */
    uqOrgName: uniqueIndex('uq_whatsapp_templates_org_name').on(table.organizationId, table.name),

    /**
     * Lookup por ID externo da Meta.
     * Usado ao processar webhooks de status de aprovação (approved/rejected/paused)
     * enviados pela Meta para sincronizar o status local.
     */
    idxMetaTemplateId: index('idx_templates_meta_id').on(table.metaTemplateId),
  }),
);

export type WhatsappTemplate = typeof whatsappTemplates.$inferSelect;
export type NewWhatsappTemplate = typeof whatsappTemplates.$inferInsert;
