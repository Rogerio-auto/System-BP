// =============================================================================
// contracts.ts — Contratos de crédito do Banco do Povo (F17-S01).
//
// Contexto:
//   Antes deste schema, o vínculo entre parcelas e contratos era puramente
//   textual (payment_dues.contract_reference). Esta entidade promove o contrato
//   a primeira classe, permitindo gestão de ciclo de vida, renovações, cálculo
//   de taxa e ligação com product/rule_version de crédito.
//
// Ciclo de vida do status:
//   draft      → criado mas não assinado (rascunho).
//   signed     → assinado, aguardando liberação/desembolso.
//   active     → em andamento (parcelas abertas).
//   settled    → liquidado (todas as parcelas pagas).
//   defaulted  → inadimplente (cobrança judicial ou SPC).
//   cancelled  → cancelado antes do desembolso.
//
// Multi-tenant: organization_id desde o dia 1.
//
// LGPD (doc 17):
//   - contract_reference não contém CPF — vínculo ao titular é via customer_id.
//   - principal_amount é dado financeiro operacional, não PII estrito.
//   - Retenção: 10 anos após status='settled'/'defaulted' (legislação tributária).
//
// FKs:
//   fk_contracts_organization → organizations.id ON DELETE RESTRICT
//   fk_contracts_customer     → customers.id     ON DELETE RESTRICT
//
// Sem FK para credit_products/credit_product_rules neste schema:
//   product_id e rule_version_id são nullable — contratos migrados do legado
//   podem não ter esses vínculos até enriquecimento manual futuro.
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { customers } from './customers.js';
import { organizations } from './organizations.js';

export const contracts = pgTable(
  'contracts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Multi-tenant root. Toda tabela de domínio carrega organization_id. */
    organizationId: uuid('organization_id').notNull(),

    /**
     * Cliente titular do contrato.
     * FK ON DELETE RESTRICT: customer com contratos não pode ser excluído.
     * Preserva histórico contábil e de cobrança.
     */
    customerId: uuid('customer_id').notNull(),

    /**
     * Referência textual do contrato (ex: "BP-2026-00123", "2026/0045").
     * Chave de negócio importada do sistema legado do Banco do Povo.
     * UNIQUE por organização: (organization_id, contract_reference).
     * Não é PII: não contém CPF nem dados biométricos.
     */
    contractReference: text('contract_reference').notNull(),

    /**
     * Produto de crédito vinculado.
     * nullable: contratos migrados do legado podem não ter product_id
     * até enriquecimento manual. Sem FK declarada neste schema —
     * a referência é via texto/lookup no módulo de crédito.
     */
    productId: uuid('product_id'),

    /**
     * Versão de regra de crédito snapshot no momento da assinatura.
     * nullable: contratos do legado não têm rule_version associada.
     * Sem FK: credit_product_rules pode não existir para dados migrados.
     */
    ruleVersionId: uuid('rule_version_id'),

    /**
     * Valor principal do contrato (capital emprestado) em reais.
     * numeric(14,2): precisão exata — nunca float para valores monetários.
     * Suporta até R$ 999.999.999.999,99.
     * Check: deve ser positivo.
     */
    principalAmount: numeric('principal_amount', { precision: 14, scale: 2 }).notNull(),

    /**
     * Prazo do contrato em meses (número de parcelas previstas).
     * Check: deve ser positivo.
     */
    termMonths: integer('term_months').notNull(),

    /**
     * Taxa mensal acordada no momento da assinatura (snapshot imutável).
     * numeric(8,6): precisão para taxas como 0,024500 = 2,45% a.m.
     * nullable: contratos migrados do legado podem não ter taxa registrada.
     */
    monthlyRateSnapshot: numeric('monthly_rate_snapshot', { precision: 8, scale: 6 }),

    /**
     * Estado do contrato no ciclo de vida.
     * 'draft'     → criado mas não assinado.
     * 'signed'    → assinado, aguardando desembolso.
     * 'active'    → em andamento (parcelas abertas).
     * 'settled'   → liquidado (todas as parcelas pagas).
     * 'defaulted' → inadimplente (SPC / cobrança judicial).
     * 'cancelled' → cancelado antes do desembolso.
     * Check constraint garante apenas esses 6 valores no banco.
     */
    status: text('status')
      .notNull()
      .default('draft')
      .$type<'draft' | 'signed' | 'active' | 'settled' | 'defaulted' | 'cancelled'>(),

    /**
     * Momento da assinatura do contrato pelo cliente.
     * null enquanto status = 'draft'. Imutável após preenchido (auditoria).
     */
    signedAt: timestamp('signed_at', { withTimezone: true }),

    /**
     * Data de vencimento da primeira parcela.
     * Desnormalizado de payment_dues para exibição rápida sem JOIN.
     * null para contratos em 'draft' (parcelas ainda não criadas).
     */
    firstDueDate: date('first_due_date'),

    /**
     * Data de vencimento da última parcela.
     * Combinado com first_due_date permite calcular duração total visualmente.
     * null para contratos em 'draft'.
     */
    lastDueDate: date('last_due_date'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // -------------------------------------------------------------------------
    // Foreign Keys
    // -------------------------------------------------------------------------

    /**
     * Organização dona do contrato.
     * ON DELETE RESTRICT: organização com contratos não pode ser excluída.
     */
    fkOrg: foreignKey({
      name: 'fk_contracts_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    /**
     * Cliente titular do contrato.
     * ON DELETE RESTRICT: customer com contratos não pode ser excluído.
     * Protege integridade do histórico contábil e de cobrança.
     */
    fkCustomer: foreignKey({
      name: 'fk_contracts_customer',
      columns: [table.customerId],
      foreignColumns: [customers.id],
    }).onDelete('restrict'),

    // -------------------------------------------------------------------------
    // Check Constraints
    // -------------------------------------------------------------------------

    /**
     * Garante que status é um dos 6 valores do ciclo de vida.
     * Bloqueia inserção de valores inválidos diretamente no banco,
     * independente da camada de aplicação.
     */
    chkStatus: check(
      'chk_contracts_status',
      sql`${table.status} IN ('draft', 'signed', 'active', 'settled', 'defaulted', 'cancelled')`,
    ),

    /**
     * Principal deve ser positivo — contrato de R$ 0,00 não faz sentido.
     */
    chkPrincipalPositive: check(
      'chk_contracts_principal_positive',
      sql`${table.principalAmount} > 0`,
    ),

    /**
     * Prazo deve ser positivo — contrato de 0 meses não faz sentido.
     */
    chkTermPositive: check('chk_contracts_term_positive', sql`${table.termMonths} > 0`),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Chave de negócio única por organização.
     * Mesmo number de contrato não pode aparecer duas vezes na mesma org.
     * Protege contra importações duplicadas do legado.
     */
    uqOrgReference: uniqueIndex('uq_contracts_org_reference').on(
      table.organizationId,
      table.contractReference,
    ),

    /**
     * Contratos por cliente, mais recentes primeiro.
     * Suporta: ficha do cliente, histórico de contratos por pessoa,
     *          listagem em tela de detalhes do customer.
     */
    idxCustomer: index('idx_contracts_customer').on(table.customerId, table.createdAt),

    /**
     * Contratos por organização filtrados por status.
     * Suporta: dashboard de carteira ativa, filtro de inadimplência,
     *          relatório de contratos liquidados, pipeline de renovação.
     */
    idxOrgStatus: index('idx_contracts_org_status').on(table.organizationId, table.status),
  }),
);

export type Contract = typeof contracts.$inferSelect;
export type NewContract = typeof contracts.$inferInsert;
