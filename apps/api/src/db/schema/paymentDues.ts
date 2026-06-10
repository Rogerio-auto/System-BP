// =============================================================================
// paymentDues.ts — Parcelas a vencer/vencidas por customer (F5-S06).
//
// Representa cada parcela de um contrato de crédito do Banco do Povo.
// É a entidade central da régua de cobrança escalonada (D-3, D+0, D+7, D+15…).
//
// Decisão de design:
//   - customer_id aponta para customers (lead convertido) — nunca para leads.
//     O ciclo de cobrança existe somente após conversão (contrato firmado).
//   - contract_reference é o número do contrato (dado financeiro, não PII estrito).
//     Não contém CPF — a vinculação com o titular é via customer_id.
//   - installment_number + contract_reference formam chave de negócio única
//     (unique constraint) para dedupe em importações repetidas.
//   - amount em numeric(14,2): suporta valores até R$ 999.999.999.999,99.
//     Escolhido sobre money (locale-dependent) e float (imprecisão de ponto flutuante).
//
// Ciclo de vida do status:
//   pending       → parcela cadastrada, ainda não vencida.
//   overdue       → vencida (due_date < today) sem pagamento registrado.
//   paid          → pagamento confirmado — paid_at preenchido.
//   renegotiated  → parcela renegociada/restruturada — substituída por nova.
//   cancelled     → parcela cancelada (contrato rescindido, erro de importação, etc.).
//
// LGPD (doc 17 §14.2 — Art. 7º V — execução de contrato):
//   - Nenhum CPF armazenado nesta tabela — vínculo via customer_id.
//   - contract_reference é dado financeiro operacional, não PII estrito.
//   - Retenção: 5 anos após status='paid'/'renegotiated' (legislação fiscal).
//   - Outbox payloads desta tabela carregam apenas IDs, sem PII bruta.
//
// Índices:
//   - unique (contract_reference, installment_number): dedupe de importação.
//   - parcial (status, due_date) WHERE status IN ('pending','overdue'): scanner do scheduler.
//   - (customer_id, due_date DESC): histórico de parcelas por cliente.
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
import { users } from './users.js';

export const paymentDues = pgTable(
  'payment_dues',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Multi-tenant root. Toda parcela pertence a uma organização. */
    organizationId: uuid('organization_id').notNull(),

    /**
     * Cliente titular desta parcela.
     * FK ON DELETE RESTRICT: customer com parcelas não pode ser excluído.
     * Preserva histórico de cobrança para auditoria fiscal (5 anos).
     */
    customerId: uuid('customer_id').notNull(),

    /**
     * Número identificador do contrato de crédito (dado financeiro operacional).
     * Não é PII estrito — não contém CPF nem dados biométricos.
     * Combinado com installment_number forma a chave de negócio única.
     * Exemplo: "BP-2026-00123", "2026/0045".
     * Importado do sistema legado do Banco do Povo.
     */
    contractReference: text('contract_reference').notNull(),

    /**
     * Número sequencial da parcela dentro do contrato.
     * Ex: 1 (primeira parcela), 12 (última de um contrato de 12 meses).
     * Combinado com contract_reference: unique (contract_reference, installment_number).
     */
    installmentNumber: integer('installment_number').notNull(),

    /**
     * Data de vencimento da parcela (sem hora — dia inteiro).
     * Tipo date do PostgreSQL — sem timezone (vencimento é por data fiscal, não momento).
     * O scheduler usa due_date para calcular scheduled_at dos collection_jobs:
     *   ex: due_date - 3 days (D-3), due_date + 7 days (D+7).
     */
    dueDate: date('due_date').notNull(),

    /**
     * Valor da parcela em reais (R$).
     * numeric(14,2): precisão exata — nunca float para valores monetários.
     * Suporta até R$ 999.999.999.999,99 (suficiente para empréstimos municipais).
     * Check: deve ser positivo — parcelas com valor zero não fazem sentido.
     */
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),

    /**
     * Estado atual da parcela no ciclo de vida de cobrança.
     * 'pending'      → cadastrada, dentro do prazo.
     * 'overdue'      → vencida sem pagamento — worker de cobrança ativa.
     * 'paid'         → pagamento confirmado — paid_at preenchido.
     * 'renegotiated' → restruturada/renegociada — nova(s) parcela(s) substituem esta.
     * 'cancelled'    → cancelada (rescisão contratual, erro de importação, etc.).
     * O collection scheduler somente cria jobs para status IN ('pending','overdue').
     */
    status: text('status', {
      enum: ['pending', 'overdue', 'paid', 'renegotiated', 'cancelled'],
    })
      .notNull()
      .default('pending'),

    /**
     * Timestamp do registro do pagamento.
     * null até status='paid'. Imutável após preenchido (auditoria financeira).
     * Pode ser preenchido retroativamente em importações de extratos bancários.
     */
    paidAt: timestamp('paid_at', { withTimezone: true }),

    /**
     * Origem do registro da parcela.
     * 'manual'  → cadastrado manualmente por agente via UI (F5-S08).
     * 'import'  → importado via planilha/API em lote (F5-S07 ou ETL legado).
     * Usado para rastreabilidade de qualidade de dados e auditoria.
     */
    origin: text('origin', { enum: ['manual', 'import'] }).notNull(),

    /**
     * Usuário que criou o registro (manual ou importação supervisionada).
     * null para importações automáticas sem usuário associado (batch jobs).
     * FK ON DELETE SET NULL: usuário excluído não invalida a parcela.
     * Mantido para auditoria de "quem lançou esta parcela".
     */
    createdBy: uuid('created_by'),

    // -------------------------------------------------------------------------
    // Boleto (F5-S10) — referência para envio na cobrança via WhatsApp.
    //
    // Decisão de produto (2026-06-10): boleto é IMPORTADO/ANEXADO (gerado pelo
    // sistema do Banco do Povo), nunca gerado por nós — sem integração bancária.
    // Armazenamos apenas a REFERÊNCIA, não os bytes do PDF.
    //
    // LGPD (doc 17): o boleto contém PII (nome, CPF, endereço). Por isso:
    //   - boleto_url deve ser controlada/assinada pelo controlador (nunca pública permanente).
    //   - boleto_url / boleto_digitable_line / pix_copia_cola entram no pino.redact.
    //   - outbox jamais carrega esses campos; só IDs.
    //   - retenção alinhada à da parcela (5 anos).
    // -------------------------------------------------------------------------

    /**
     * URL do PDF do boleto. Usada como `document.link` no envio Meta.
     * DEVE ser controlada/assinada pelo controlador (Banco do Povo) — host validado
     * por allowlist no anexo (F5-S13). Nunca uma URL pública permanente com PII.
     */
    boletoUrl: text('boleto_url'),

    /**
     * Media id da Meta quando o arquivo foi enviado via `POST /media`
     * (caminho LGPD-preferido — evita expor URL). Preenchido por F5-S13/S14.
     */
    boletoMediaId: text('boleto_media_id'),

    /**
     * Validade do `boleto_media_id` (a Meta expira media em ~30 dias).
     * O sender (F5-S14) re-faz upload a partir de boleto_url quando expirado.
     */
    boletoMediaExpiresAt: timestamp('boleto_media_expires_at', { withTimezone: true }),

    /**
     * Linha digitável (código de barras) do boleto. Dado financeiro;
     * pode ser enviado como texto no body como fallback. Vai no pino.redact.
     */
    boletoDigitableLine: text('boleto_digitable_line'),

    /**
     * Payload PIX copia-e-cola (BR Code). Idem boleto_digitable_line.
     */
    pixCopiaCola: text('pix_copia_cola'),

    /**
     * Nome amigável exibido no WhatsApp (ex: "boleto-parcela-3.pdf").
     * Nunca incluir CPF no filename.
     */
    boletoFilename: text('boleto_filename'),

    /**
     * Quando o boleto foi anexado (auditoria). NULL = sem boleto.
     */
    boletoAttachedAt: timestamp('boleto_attached_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // -------------------------------------------------------------------------
    // Foreign Keys (nomeadas explicitamente, ON DELETE pensado)
    // -------------------------------------------------------------------------

    fkOrg: foreignKey({
      name: 'fk_payment_dues_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    /**
     * ON DELETE RESTRICT: customer com parcelas não pode ser removido.
     * Protege integridade da régua de cobrança e histórico fiscal.
     */
    fkCustomer: foreignKey({
      name: 'fk_payment_dues_customer',
      columns: [table.customerId],
      foreignColumns: [customers.id],
    }).onDelete('restrict'),

    /**
     * ON DELETE SET NULL: usuário excluído não invalida o registro da parcela.
     * A parcela continua existindo; apenas a rastreabilidade de criador é perdida.
     */
    fkCreatedBy: foreignKey({
      name: 'fk_payment_dues_created_by',
      columns: [table.createdBy],
      foreignColumns: [users.id],
    }).onDelete('set null'),

    // -------------------------------------------------------------------------
    // Check Constraints
    // -------------------------------------------------------------------------

    /**
     * Valor deve ser positivo — parcelas com valor zero ou negativo são inválidas.
     * Evita erros silenciosos em importações de planilhas com valores zerados.
     */
    chkAmount: check('chk_payment_dues_amount_positive', sql`${table.amount} > 0`),

    /**
     * Número da parcela deve ser positivo — parcela 0 não é semanticamente válida.
     */
    chkInstallment: check(
      'chk_payment_dues_installment_positive',
      sql`${table.installmentNumber} > 0`,
    ),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Chave de negócio única: mesmo contrato não pode ter duas parcelas de mesmo número.
     * Proteção contra importações repetidas do mesmo extrato/planilha.
     * Sem WHERE: parcelas canceladas/renegociadas também participam (auditoria completa).
     */
    uqContractInstallment: uniqueIndex('uq_payment_dues_contract_installment').on(
      table.contractReference,
      table.installmentNumber,
    ),

    /**
     * Scanner principal do scheduler de cobrança (F5-S07).
     * Query: SELECT ... WHERE status IN ('pending','overdue') AND due_date <= <threshold>.
     * Índice parcial: exclui paid/renegotiated/cancelled que crescem sem limite.
     * Mantém o índice enxuto — crítico para performance em carteira grande.
     *
     * NOTA: Drizzle não suporta índices parciais nativamente — a migration SQL
     * (0036_collection.sql) define a cláusula WHERE manualmente.
     */
    idxStatusDue: index('idx_payment_dues_status_due').on(table.status, table.dueDate),

    /**
     * Histórico de parcelas por cliente, mais próximas do vencimento primeiro.
     * Query: "todas as parcelas do customer X ordenadas por vencimento desc".
     * Suporta: ficha do cliente em F5-S08, relatório de inadimplência.
     */
    idxCustomerDue: index('idx_payment_dues_customer').on(table.customerId, table.dueDate),

    /**
     * Scanner do collection-sender para parcelas que possuem boleto anexado.
     * Índice PARCIAL `WHERE boleto_url IS NOT NULL OR boleto_media_id IS NOT NULL`
     * — definido na migration SQL (Drizzle não expressa o WHERE nativamente,
     * mesmo padrão de idx_payment_dues_status_due).
     */
    idxWithBoleto: index('idx_payment_dues_with_boleto').on(table.status, table.dueDate),
  }),
);

export type PaymentDue = typeof paymentDues.$inferSelect;
export type NewPaymentDue = typeof paymentDues.$inferInsert;
