// =============================================================================
// featureTutorials.ts — Schema Drizzle da tabela feature_tutorials (F12-S01).
//
// Propósito: registra o vínculo global entre uma feature_key (funcionalidade
// do produto) e o conteúdo de ajuda contextual: vídeo + artigo da Central.
//
// Multi-tenant:
//   organization_id é NULLABLE por design. NULL = registro global, vale para
//   todos os tenants. Um valor preenchido reserva um tutorial específico para
//   uma organização/cidade (override futuro, não usado no MVP).
//   FK ON DELETE CASCADE: se a org for deletada, seus overrides somem junto.
//
// Soft-delete:
//   deleted_at timestamptz NULL. Soft-delete via PATCH (seta deleted_at).
//   O índice único parcial de feature_key filtra WHERE deleted_at IS NULL,
//   o que garante unicidade entre registros ativos e permite "reusar" a key
//   após deletar o tutorial anterior (mesmo comportamento do dedupe de leads).
//
// Timestamps:
//   created_at: setado pelo DB (defaultNow()).
//   updated_at: setado pelo DB no insert (defaultNow()); atualizado pelo app
//   em cada PATCH (SET updated_at = now()). Sem trigger SQL por convenção do
//   projeto (ver outros schemas vizinhos).
//
// FKs nomeadas explicitamente (convenção do projeto — ver leads.ts):
//   fk_feature_tutorials_organization  ON DELETE CASCADE
//   fk_feature_tutorials_created_by    ON DELETE SET NULL
//   (NB: created_by referencia users — autor humano; SET NULL quando user deletado)
//
// Índices:
//   uq_feature_tutorials_key_active    UNIQUE parcial (feature_key) WHERE deleted_at IS NULL
//   idx_feature_tutorials_is_active    B-tree em is_active (queries de listagem pública)
//   idx_feature_tutorials_org          B-tree em organization_id (filtro de tenant)
//
// Catálogo de feature_key:
//   Definido em packages/shared-types/src/featureKeys.ts.
//   O admin escolhe via dropdown — nunca texto livre.
//   Validação Zod do enum é responsabilidade de F12-S02 (módulo de API).
// =============================================================================

import { sql } from 'drizzle-orm';
import {
  boolean,
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

// ---------------------------------------------------------------------------
// Tipos de domínio
// ---------------------------------------------------------------------------

/**
 * Provedores de vídeo suportados.
 * youtube  — vídeo não-listado; video_ref é o video ID (ex: dQw4w9WgXcQ).
 * vimeo    — vídeo privado com hash; video_ref é o video ID; video_hash obrigatório.
 * mp4      — arquivo servido do VPS; video_ref é a URL completa.
 */
export type TutorialProvider = 'youtube' | 'vimeo' | 'mp4';

// ---------------------------------------------------------------------------
// Tabela
// ---------------------------------------------------------------------------

export const featureTutorials = pgTable(
  'feature_tutorials',
  {
    /** PK UUID gerado pelo DB via pgcrypto (gen_random_uuid = UUID v4). */
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /**
     * Escopo de organização.
     * NULL  = tutorial global do produto (vale para todos os tenants).
     * UUID  = override específico de uma organização/cidade (MVP: sempre NULL).
     * FK ON DELETE CASCADE: sobras de org deletada não ficam órfãs.
     */
    organizationId: uuid('organization_id'),

    /**
     * Chave de funcionalidade. Valor obrigatório, vem do catálogo fechado em
     * packages/shared-types/src/featureKeys.ts. Convenção: <modulo>.<entidade>.<acao>.
     * Exemplos: crm.lead.create, credit.analysis.create, billing.due.register.
     *
     * Único dentro dos registros ativos (parcial WHERE deleted_at IS NULL).
     * O mesmo feature_key pode existir em registros deletados (histórico).
     */
    featureKey: text('feature_key').notNull(),

    /**
     * Título exibido no drawer de ajuda contextual.
     * Deve ser conciso (≤ 80 chars) e descritivo da funcionalidade.
     */
    title: text('title').notNull(),

    /**
     * Resumo de 2-3 linhas exibido no corpo do drawer, abaixo do player.
     * Complementa o vídeo — não deve ser uma transcrição literal.
     */
    description: text('description').notNull(),

    /**
     * Provedor do vídeo: youtube | vimeo | mp4.
     * Determina como o player renderiza e como interpretar video_ref.
     */
    provider: text('provider', { enum: ['youtube', 'vimeo', 'mp4'] })
      .notNull()
      .$type<TutorialProvider>(),

    /**
     * Referência do vídeo, interpretada conforme provider:
     *   youtube → YouTube video ID (11 chars alfanuméricos, ex: dQw4w9WgXcQ)
     *   vimeo   → Vimeo numeric ID (ex: 123456789)
     *   mp4     → URL completa do arquivo no VPS
     */
    videoRef: text('video_ref').notNull(),

    /**
     * Hash de privacidade do Vimeo (parâmetro h= na URL).
     * Obrigatório quando provider = 'vimeo'; ignorado nos demais.
     * Mantido em coluna separada para não expor na URL pública.
     */
    videoHash: text('video_hash'),

    /**
     * Slug do artigo relacionado na Central de Ajuda (ex: crm/lead-create).
     * Exibido como "Ler mais" no drawer. null = tutorial sem artigo associado.
     * Referência por slug (não FK) — artigos são conteúdo MDX estático.
     */
    articleSlug: text('article_slug'),

    /**
     * Duração do vídeo em segundos.
     * Exibido como badge no ⓘ e no drawer (ex: "2:34").
     * null = duração não informada (campo opcional; não bloqueia publicação).
     * Adicionado em F12-S08 (gap do data model original).
     */
    durationSeconds: integer('duration_seconds'),

    /**
     * Controla visibilidade na UI.
     * false = tutorial existe mas não aparece no ⓘ (rascunho / inativo).
     * true  = drawer renderiza o ⓘ e o conteúdo no drawer.
     * O componente <ContextualHelp> só monta o ícone para registros ativos.
     */
    isActive: boolean('is_active').notNull().default(true),

    /**
     * Usuário que criou o registro.
     * null = inserido via seed/migration (sem ator humano).
     * FK ON DELETE SET NULL: deletar o usuário não apaga o tutorial.
     */
    createdBy: uuid('created_by'),

    /**
     * Timestamps de auditoria.
     * updated_at é atualizado pelo app em cada PATCH (SET updated_at = now()).
     * Não há trigger SQL — convenção do projeto (app-level updates).
     */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Soft-delete: preserva histórico de tutoriais removidos.
     * null = registro ativo. Preenchido pelo app no DELETE lógico.
     * O índice único parcial em feature_key usa WHERE deleted_at IS NULL.
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    // -------------------------------------------------------------------------
    // Foreign Keys (nomeadas explicitamente — padrão do projeto)
    // -------------------------------------------------------------------------

    fkOrganization: foreignKey({
      name: 'fk_feature_tutorials_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),

    fkCreatedBy: foreignKey({
      name: 'fk_feature_tutorials_created_by',
      columns: [table.createdBy],
      foreignColumns: [users.id],
    }).onDelete('set null'),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Unicidade de feature_key entre registros ATIVOS.
     * Parcial (WHERE deleted_at IS NULL): permite criar novo tutorial para a
     * mesma feature_key após soft-delete do registro anterior.
     * Garante que a UI nunca receba dois tutoriais ativos para a mesma key.
     */
    uqFeatureKeyActive: uniqueIndex('uq_feature_tutorials_key_active')
      .on(table.featureKey)
      .where(sql`${table.deletedAt} IS NULL`),

    /**
     * Listagem pública e do admin filtrada por status.
     * GET /api/help/tutorials filtra WHERE is_active = true.
     */
    idxIsActive: index('idx_feature_tutorials_is_active').on(table.isActive),

    /**
     * Filtro por organização: queries de override de tenant.
     * Suporta queries futuras de "tutorial específico desta org".
     */
    idxOrganization: index('idx_feature_tutorials_organization').on(table.organizationId),
  }),
);

// ---------------------------------------------------------------------------
// Tipos Drizzle exportados
// ---------------------------------------------------------------------------

export type FeatureTutorial = typeof featureTutorials.$inferSelect;
export type NewFeatureTutorial = typeof featureTutorials.$inferInsert;
