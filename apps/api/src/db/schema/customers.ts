// =============================================================================
// customers.ts — Clientes do Banco do Povo (leads convertidos).
//
// Um customer é criado quando um lead avança para 'closed_won' — ou seja,
// obteve aprovação de crédito e contratou. Há exatamente 1 customer por
// lead primário (garantido pelo UNIQUE em primary_lead_id).
//
// Decisão de design:
//   - Não duplicamos dados do lead em customers. O customer é uma "marker" de
//     conversão apontando para o lead original, que continua sendo a fonte de
//     verdade de dados de contato, histórico e interações.
//   - metadata: jsonb para dados específicos de clientes (ex: número de contrato,
//     dados de liberação de crédito) sem precisar de migration a cada evolução.
//
// Multi-tenant: organization_id denormalizado (redundante com o lead, mas
// necessário para que o city-scope middleware filtre diretamente sem JOIN).
//
// Sem soft-delete: customer é permanente (registro contábil/auditoria).
// Se precisar invalidar, usar metadata.{ status: 'inactive' } como escape hatch.
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  foreignKey,
} from 'drizzle-orm/pg-core';

import { leads } from './leads.js';
import { organizations } from './organizations.js';

export const customers = pgTable(
  'customers',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Multi-tenant root. Denormalizado do lead para filtros diretos por org. */
    organizationId: uuid('organization_id').notNull(),

    /**
     * Lead que originou este cliente.
     * UNIQUE: cada lead pode ser convertido em exatamente 1 customer.
     * FK ON DELETE RESTRICT: não é possível deletar o lead enquanto houver customer.
     */
    primaryLeadId: uuid('primary_lead_id').notNull(),

    /**
     * Momento da conversão (quando o lead foi marcado como 'closed_won').
     * Default now() — definido pela app ao criar o customer.
     * Imutável após criação (auditoria financeira).
     */
    convertedAt: timestamp('converted_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Dados adicionais do cliente sem schema fixo.
     * Exemplos: { contract_number, loan_amount_brl, disbursed_at, bank_account }.
     * PII: dados financeiros sensíveis — não logar sem redact.
     */
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // -------------------------------------------------------------------------
    // Foreign Keys
    // -------------------------------------------------------------------------

    foreignKey({
      name: 'fk_customers_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    foreignKey({
      name: 'fk_customers_lead',
      columns: [table.primaryLeadId],
      foreignColumns: [leads.id],
    }).onDelete('restrict'),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Um lead pode ser convertido em no máximo 1 customer.
     * Garante idempotência na conversão (chamadas duplicadas são seguras).
     */
    uniqueIndex('uq_customers_primary_lead').on(table.primaryLeadId),

    /**
     * Listagem de clientes por org, mais recentes primeiro.
     * Suporta: dashboard de conversões, relatório de clientes ativos.
     */
    index('idx_customers_org_converted').on(table.organizationId, table.convertedAt),
  ],
);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
