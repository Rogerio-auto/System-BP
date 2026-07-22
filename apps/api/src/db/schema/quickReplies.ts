// =============================================================================
// quickReplies.ts — Biblioteca de respostas rápidas do live chat (F28-S01).
//
// Contexto: docs/25-respostas-rapidas.md §4 (normativo). Não é um recurso da
// Meta — é um atalho local de composição: no envio, vira uma mensagem `text`
// ou `media` comum (percorrendo o caminho já existente até a API do WhatsApp).
//
// Duas visibilidades:
//   - 'organization' (owner_user_id NULL): curada pela gestão, todos os
//     operadores da org veem.
//   - 'personal' (owner_user_id preenchido): biblioteca própria do operador.
//   A coerência entre visibility e owner_user_id é garantida por CHECK no
//   banco — não por convenção de aplicação (doc 25 §4, contexto do slot).
//
// Mídia é inline (mesmo padrão de messages.ts) — sem tabela separada. Uma
// resposta rápida carrega no máximo uma mídia (imagem, vídeo, áudio ou
// documento) com legenda opcional em `body`.
//
// city_ids é filtro de conveniência de exibição, NÃO fronteira de segurança
// (doc 25 D6) — o live chat é org-wide por design. A fronteira real é
// organization_id. Não replicar aqui a semântica de applyCityScope.
//
// Dois únicos parciais de shortcut (doc 25 §4.1):
//   - org-wide: (organization_id, shortcut) WHERE owner_user_id IS NULL
//   - por dono: (organization_id, owner_user_id, shortcut) WHERE owner_user_id IS NOT NULL
//   O atalho pessoal de um operador PODE sombrear um da organização — na
//   resolução (F28, fora deste slot) o pessoal vence.
//
// Soft-delete via deleted_at: toda query de leitura filtra IS NULL. Os únicos
// parciais também filtram deleted_at IS NULL — permite recriar o mesmo
// shortcut após exclusão.
//
// updated_at: trigger set_updated_at (mesmo padrão de push_subscriptions/
// assistant_conversations/credit_analyses/followup_rules).
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { organizations } from './organizations.js';
import { users } from './users.js';

/**
 * citext: tipo PostgreSQL case-insensitive para texto.
 * Requer extension citext (criada em 0000_init.sql).
 * Drizzle 0.34.x não expõe citext nativamente — definido via customType
 * (mesmo padrão de users.ts / customers.ts / leads.ts).
 */
const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

export const quickReplies = pgTable(
  'quick_replies',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Multi-tenant root — fronteira real de segurança (doc 25 D6). */
    organizationId: uuid('organization_id').notNull(),

    /**
     * Dono do atalho pessoal. NULL ⇒ visibility='organization' (curada pela
     * gestão, org-wide). Preenchido ⇒ visibility='personal' (biblioteca
     * própria do operador). Coerência garantida por CHECK (chkVisibilityOwner).
     * ON DELETE CASCADE: sem o dono, o atalho pessoal perde sentido.
     */
    ownerUserId: uuid('owner_user_id'),

    /** CHECK garante domínio fechado + coerência com owner_user_id. */
    visibility: text('visibility').notNull().default('organization'),

    /**
     * Slug do atalho digitável no composer, sem a barra (ex.: "saudacao").
     * citext: busca/dedupe case-insensitive. Formato validado por CHECK
     * (^[a-z0-9][a-z0-9_-]{0,31}$).
     */
    shortcut: citext('shortcut').notNull(),

    /** Rótulo humano exibido na lista de seleção do composer. */
    title: text('title').notNull(),

    /**
     * Corpo da mensagem com variáveis ({{...}}, catálogo fechado — doc 25
     * §6). Obrigatório se não houver mídia (CHECK chkBodyOrMedia). Quando há
     * mídia, body funciona como legenda opcional.
     */
    body: text('body'),

    /** Agrupador livre na tela de admin (ex.: "Documentos", "Saudações"). */
    category: text('category'),

    /**
     * URL pública estável da mídia (§7 doc 25) — necessária porque a
     * serialização para a Meta usa `link`, não `media_id`.
     */
    mediaUrl: text('media_url'),

    mediaMime: text('media_mime'),

    /** CHECK restringe a image | video | audio | document. */
    mediaKind: text('media_kind'),

    mediaSizeBytes: integer('media_size_bytes'),

    /** Nome exibido quando media_kind='document'. */
    mediaFileName: text('media_file_name'),

    /**
     * Filtro de conveniência de exibição por cidade — vazio = todas.
     * NÃO é fronteira de segurança (doc 25 D6): live chat é org-wide por
     * design. Não aplicar aqui a semântica de applyCityScope.
     */
    cityIds: uuid('city_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),

    isActive: boolean('is_active').notNull().default(true),

    /** Fixação manual das principais respostas na lista (ordenação). */
    sortOrder: integer('sort_order').notNull().default(0),

    /** Telemetria de uso (doc 25 §10). */
    usageCount: integer('usage_count').notNull().default(0),

    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),

    /** ON DELETE SET NULL: preserva a resposta rápida se o criador for removido. */
    createdBy: uuid('created_by'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    /** Soft-delete — toda query de leitura filtra IS NULL. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    // -------------------------------------------------------------------------
    // Foreign Keys
    // -------------------------------------------------------------------------

    fkOrg: foreignKey({
      name: 'fk_quick_replies_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    fkOwner: foreignKey({
      name: 'fk_quick_replies_owner',
      columns: [table.ownerUserId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),

    fkCreatedBy: foreignKey({
      name: 'fk_quick_replies_created_by',
      columns: [table.createdBy],
      foreignColumns: [users.id],
    }).onDelete('set null'),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Único parcial org-wide: atalho único entre respostas curadas pela
     * organização (owner_user_id IS NULL) ativas.
     */
    uqShortcutOrgWide: uniqueIndex('uq_quick_replies_shortcut_org_wide')
      .on(table.organizationId, table.shortcut)
      .where(sql`${table.ownerUserId} IS NULL AND ${table.deletedAt} IS NULL`),

    /**
     * Único parcial por dono: atalho único dentro da biblioteca pessoal de
     * cada operador. Pode legitimamente sombrear um atalho da organização
     * com o mesmo nome — na resolução, o pessoal vence (doc 25 §6.2).
     */
    uqShortcutPerOwner: uniqueIndex('uq_quick_replies_shortcut_per_owner')
      .on(table.organizationId, table.ownerUserId, table.shortcut)
      .where(sql`${table.ownerUserId} IS NOT NULL AND ${table.deletedAt} IS NULL`),

    /** Listagem de respostas ativas da organização (composer/admin). */
    idxOrgActive: index('idx_quick_replies_org_active').on(table.organizationId, table.isActive),

    /** Filtragem por dono (biblioteca pessoal do operador). */
    idxOrgOwner: index('idx_quick_replies_org_owner').on(table.organizationId, table.ownerUserId),

    // -------------------------------------------------------------------------
    // Constraints de integridade (doc 25 §4.1)
    // -------------------------------------------------------------------------

    /** Coerência: visibility='personal' <=> owner_user_id preenchido. */
    chkVisibilityOwner: check(
      'chk_quick_replies_visibility_owner',
      sql`(${table.visibility} = 'personal') = (${table.ownerUserId} IS NOT NULL)`,
    ),

    /** Domínio fechado de visibility. */
    chkVisibilityDomain: check(
      'chk_quick_replies_visibility_domain',
      sql`${table.visibility} IN ('organization', 'personal')`,
    ),

    /** Resposta vazia é inválida: precisa de corpo de texto ou mídia. */
    chkBodyOrMedia: check(
      'chk_quick_replies_body_or_media',
      sql`${table.body} IS NOT NULL OR ${table.mediaUrl} IS NOT NULL`,
    ),

    /** Mídia é tudo-ou-nada: media_url e media_kind aparecem juntos. */
    chkMediaAllOrNothing: check(
      'chk_quick_replies_media_all_or_nothing',
      sql`(${table.mediaUrl} IS NULL) = (${table.mediaKind} IS NULL)`,
    ),

    /** Domínio fechado de media_kind. */
    chkMediaKindDomain: check(
      'chk_quick_replies_media_kind_domain',
      sql`${table.mediaKind} IS NULL OR ${table.mediaKind} IN ('image', 'video', 'audio', 'document')`,
    ),

    /** Formato do atalho: minúsculas/dígitos, começa alfanumérico, até 32 chars. */
    chkShortcutFormat: check(
      'chk_quick_replies_shortcut_format',
      sql`${table.shortcut} ~ '^[a-z0-9][a-z0-9_-]{0,31}$'`,
    ),
  }),
);

export type QuickReply = typeof quickReplies.$inferSelect;
export type NewQuickReply = typeof quickReplies.$inferInsert;
