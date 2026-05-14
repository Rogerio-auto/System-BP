// =============================================================================
// creditProducts.ts — Catálogo de produtos de crédito do Banco do Povo.
//
// Decisão de design:
//   - credit_products é o "contrato" público de um produto (nome, chave, ativo).
//   - Os parâmetros numéricos (taxas, prazos, limites) ficam em credit_product_rules,
//     versionados. Isso permite publicar novas condições sem recriar o produto.
//
// Soft-delete via deleted_at: produtos históricos são preservados para auditoria
// de simulações antigas (simulation.product_id aponta para product).
//
// Multi-tenant: organization_id em toda tabela de domínio (CLAUDE.md regra 8).
//
// Índices:
//   - Unique parcial (organization_id, key) WHERE deleted_at IS NULL: slug único
//     por organização entre produtos ativos. Permite reutilizar slug após exclusão.
//   - (organization_id, is_active): listagem de produtos ativos da organização.
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { organizations } from './organizations.js';

export const creditProducts = pgTable(
  'credit_products',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Multi-tenant root. */
    organizationId: uuid('organization_id').notNull(),

    /**
     * Slug único do produto dentro da organização (ex: "microcredito_basico").
     * Usado como referência estável em feature flags e integrações.
     * Apenas minúsculas, underscores e hífens. Validado pela app.
     */
    key: text('key').notNull(),

    /** Nome legível do produto para exibição (ex: "Microcrédito Básico"). */
    name: text('name').notNull(),

    /**
     * Descrição do produto para agentes e clientes.
     * Opcional — nem todo produto precisa de descrição elaborada.
     */
    description: text('description'),

    /**
     * Indica se o produto está disponível para novas simulações.
     * false = produto inativo/descontinuado (histórico preservado).
     * Regra: somente um produto ativo pode ter regras ativas em vigor.
     */
    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Soft-delete: preserva o produto para histórico de simulações.
     * Simulações antigas apontam para product_id que pode estar deletado.
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // -------------------------------------------------------------------------
    // Foreign Keys
    // -------------------------------------------------------------------------

    foreignKey({
      name: 'fk_credit_products_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Slug único por organização entre produtos ativos.
     * WHERE deleted_at IS NULL: produtos deletados não participam da constraint.
     * Permite criar novo produto com mesmo slug após soft-delete.
     */
    uniqueIndex('uq_credit_products_org_key_active')
      .on(table.organizationId, table.key)
      .where(sql`${table.deletedAt} IS NULL`),

    /**
     * Listagem de produtos da org com filtro de ativo/inativo.
     * Suporta: "todos os produtos ativos da org X".
     */
    index('idx_credit_products_org_active').on(table.organizationId, table.isActive),
  ],
);

export type CreditProduct = typeof creditProducts.$inferSelect;
export type NewCreditProduct = typeof creditProducts.$inferInsert;
