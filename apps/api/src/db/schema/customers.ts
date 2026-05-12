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
//
// LGPD (doc 17 §8.1 — F1-S24):
//   - document_number: bytea — CPF/CNPJ cifrado com AES-256-GCM.
//     Usar encryptPii/decryptPii de lib/crypto/pii.ts para acesso.
//   - document_hash: text — HMAC-SHA256 do document_number original para dedupe/busca.
//     Usar hashDocument de lib/crypto/pii.ts para gerar.
//     Índice único parcial garante 1 customer por documento por org.
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
  customType,
} from 'drizzle-orm/pg-core';

/**
 * bytea: tipo PostgreSQL para dados binários cifrados.
 * Usado para document_number (AES-256-GCM via lib/crypto/pii.ts).
 * Node.js serializa como Buffer.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

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
     * CPF/CNPJ cifrado com AES-256-GCM (F1-S24 — LGPD doc 17 §8.1).
     * Armazenado como bytea — o plaintext NUNCA é persistido em texto claro.
     * Para ler: decryptPii(customer.documentNumber) da lib/crypto/pii.ts.
     * Para escrever: encryptPii(plainCpf) antes de inserir/atualizar.
     * null = documento ainda não coletado (migração gradual via F1-S25+).
     */
    documentNumber: bytea('document_number'),

    /**
     * Hash HMAC-SHA256 do document_number em claro + LGPD_DEDUPE_PEPPER.
     * Propósito: busca/dedupe de clientes por CPF sem expor o plaintext.
     * Determinístico: hashDocument(plainCpf) sempre produz o mesmo resultado.
     * Para gerar: hashDocument(plainCpf) da lib/crypto/pii.ts.
     * null = documento ainda não coletado.
     */
    documentHash: text('document_hash'),

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

    /**
     * Índice único parcial em (organization_id, document_hash) para dedupe de CPF.
     * WHERE document_hash IS NOT NULL: documentos pendentes (null) não participam
     * da constraint — permite inserção antes do CPF ser coletado.
     * Suporta: busca por CPF hash para verificar duplicidade antes de criar customer.
     */
    uniqueIndex('uq_customers_org_document_hash')
      .on(table.organizationId, table.documentHash)
      .where(sql`${table.documentHash} IS NOT NULL`),
  ],
);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
