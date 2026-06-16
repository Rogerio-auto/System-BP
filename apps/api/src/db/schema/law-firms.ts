// =============================================================================
// law-firms.ts — Escritórios de advocacia parceiros e encaminhamentos de clientes (F19-S01).
//
// Contexto:
//   Fundação do épico de Advocacia (Onda 4). Permite ao Banco do Povo cadastrar
//   escritórios parceiros com cobertura por cidades e registrar encaminhamentos
//   de clientes inadimplentes para cobrança judicial.
//
// Tabelas:
//   law_firms                   — escritórios de advocacia com cidades de atuação
//   customer_law_firm_referrals — histórico de encaminhamentos por cliente
//
// Multi-tenant: organization_id em ambas as tabelas desde o dia 1.
//
// Soft-delete em law_firms (deleted_at): escritório desativado mantém histórico
// de encaminhamentos passados sem perder auditabilidade.
// Sem soft-delete em customer_law_firm_referrals: registro imutável de auditoria.
//
// Cooldown de 7 dias: persistido em cooldown_until para queries diretas sem
// aritmética de data em runtime. Worker/UI pode filtrar WHERE cooldown_until > now()
// para bloquear novo encaminhamento.
//
// LGPD (doc 17):
//   - contact_phone em law_firms é dado público do escritório (CNPJ/PJ) — não é PII pessoal.
//   - notes em ambas as tabelas pode conter descrições de inadimplência — não incluir
//     CPF/dados biométricos em texto livre (validação na borda da aplicação).
//   - customer_id é FK para o titular LGPD — direito de exclusão tratado via
//     customer_law_firm_referrals na retenção por job (doc 17 §8.2).
//
// FKs nomeadas explicitamente (padrão da codebase):
//   fk_law_firms_organization          → organizations.id ON DELETE RESTRICT
//   fk_law_firms_created_by            → users.id         ON DELETE SET NULL
//   fk_referrals_organization          → organizations.id ON DELETE RESTRICT
//   fk_referrals_customer              → customers.id     ON DELETE RESTRICT
//   fk_referrals_law_firm              → law_firms.id     ON DELETE RESTRICT
//   fk_referrals_linked_by             → users.id         ON DELETE SET NULL
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { customers } from './customers.js';
import { organizations } from './organizations.js';
import { users } from './users.js';

// =============================================================================
// law_firms — Escritórios de advocacia cadastrados como parceiros da org.
// =============================================================================

export const lawFirms = pgTable(
  'law_firms',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Multi-tenant root. Escritório pertence a exatamente uma organização. */
    organizationId: uuid('organization_id').notNull(),

    /**
     * Nome do escritório de advocacia.
     * Ex: "Oliveira & Associados Advogados", "Escritório Jurídico Rondônia".
     * Não normalizado — busca textual feita por GIN trgm na camada de app se necessário.
     */
    name: text('name').notNull(),

    /**
     * Telefone público de contato do escritório (dado de PJ — não é PII pessoal).
     * Formato livre: app normaliza antes de exibir (ex: "(69) 3224-0000").
     * nullable: escritório pode ser cadastrado sem telefone inicialmente.
     */
    contactPhone: text('contact_phone'),

    /**
     * Array de UUIDs das cidades de atuação (IDs da tabela cities).
     * GIN index permite `WHERE coverage_city_ids @> ARRAY[city_id]::uuid[]`.
     * Denormalizado para evitar tabela pivô (M2M) — a lista é pequena por escritório.
     * Atualização via replace completo (não append parcial) para manter consistência.
     */
    coverageCityIds: uuid('coverage_city_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),

    /**
     * Quando true, este escritório é o padrão selecionado automaticamente
     * pela IA ao encaminhar clientes de uma das cidades em coverage_city_ids.
     * Apenas 1 escritório deve ter is_default_for_city = true por cidade por org —
     * constraint de negócio aplicada na camada de aplicação (não há unique no banco
     * pois o escopo é "por cidade dentro do array", não trivialmente constraíble).
     */
    isDefaultForCity: boolean('is_default_for_city').notNull().default(false),

    /**
     * Notas internas sobre o escritório (especialidades, contatos secundários, etc.).
     * Campo livre para gestores — não incluir PII de clientes neste campo.
     */
    notes: text('notes'),

    /**
     * Usuário que cadastrou o escritório.
     * ON DELETE SET NULL: a exclusão do usuário preserva o registro do escritório.
     * null se o cadastro foi feito por migração de dados ou sistema.
     */
    createdBy: uuid('created_by'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Soft-delete: escritório desativado fica auditável e mantém FKs de
     * encaminhamentos passados sem quebrar referências históricas.
     * null = ativo. not-null = desativado.
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    // -------------------------------------------------------------------------
    // Foreign Keys
    // -------------------------------------------------------------------------

    /**
     * Organização dona do escritório.
     * ON DELETE RESTRICT: org com escritórios não pode ser excluída.
     */
    fkOrg: foreignKey({
      name: 'fk_law_firms_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    /**
     * Usuário que cadastrou o escritório.
     * ON DELETE SET NULL: exclusão de usuário não destrói o escritório.
     */
    fkCreatedBy: foreignKey({
      name: 'fk_law_firms_created_by',
      columns: [table.createdBy],
      foreignColumns: [users.id],
    }).onDelete('set null'),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Listagem de escritórios por organização, excluindo soft-deletados.
     * Suporta: tela de gestão de escritórios, dropdown de seleção manual.
     * Composto com deleted_at para que queries com WHERE deleted_at IS NULL
     * usem este índice diretamente.
     */
    idxOrg: index('idx_law_firms_org').on(table.organizationId, table.deletedAt),

    /**
     * GIN index em coverage_city_ids (uuid[]) para busca por cidade de atuação.
     * Permite: `WHERE coverage_city_ids @> ARRAY[city_id]::uuid[]`
     * Suporta: busca do escritório padrão para uma cidade ao encaminhar cliente.
     */
    idxCities: index('idx_law_firms_cities').using('gin', table.coverageCityIds),
  }),
);

export type LawFirm = typeof lawFirms.$inferSelect;
export type NewLawFirm = typeof lawFirms.$inferInsert;

// =============================================================================
// customer_law_firm_referrals — Histórico de encaminhamentos de clientes.
// =============================================================================

export const customerLawFirmReferrals = pgTable(
  'customer_law_firm_referrals',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Multi-tenant root. Encaminhamento pertence a exatamente uma organização. */
    organizationId: uuid('organization_id').notNull(),

    /**
     * Cliente encaminhado ao escritório.
     * ON DELETE RESTRICT: não é possível excluir um cliente com encaminhamentos.
     * Preserva auditoria jurídica de clientes inadimplentes.
     */
    customerId: uuid('customer_id').notNull(),

    /**
     * Escritório que recebeu o encaminhamento.
     * ON DELETE RESTRICT: não é possível excluir escritório com encaminhamentos.
     * Mantém rastreabilidade do destino do processo.
     */
    lawFirmId: uuid('law_firm_id').notNull(),

    /**
     * Usuário que realizou o encaminhamento.
     * null quando channel = 'ai' (encaminhamento automático pelo agente de IA).
     * ON DELETE SET NULL: exclusão de usuário não destrói o histórico de auditoria.
     */
    linkedBy: uuid('linked_by'),

    /**
     * Timestamp do encaminhamento (quando o vínculo foi criado).
     * Distinto de sent_at: o encaminhamento pode ser criado antes do disparo WhatsApp.
     * Imutável após criação — registra o momento da decisão de encaminhar.
     */
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Timestamp do disparo do WhatsApp ao escritório notificando o encaminhamento.
     * null até o worker de notificação disparar a mensagem.
     * Separado de linked_at para rastrear falhas de envio (linked_at != null mas sent_at = null).
     */
    sentAt: timestamp('sent_at', { withTimezone: true }),

    /**
     * Canal que originou o encaminhamento.
     * 'human' → operador/gestor realizou manualmente via UI.
     * 'ai'    → agente LangGraph identificou inadimplência e encaminhou automaticamente.
     * Check constraint garante apenas esses 2 valores no banco.
     */
    channel: text('channel').notNull().$type<'human' | 'ai'>(),

    /**
     * Data/hora até quando um novo encaminhamento deste cliente é bloqueado.
     * Calculado como: linked_at + 7 days. Persistido para queries diretas eficientes.
     * null = sem cooldown ativo (primeiro encaminhamento ou cooldown expirado).
     * Worker e UI consultam: WHERE cooldown_until > now() para bloquear novo envio.
     */
    cooldownUntil: timestamp('cooldown_until', { withTimezone: true }),

    /**
     * Notas sobre o encaminhamento (ex: motivo, acordo proposto, retorno do escritório).
     * Campo de auditoria — não incluir senhas, CPF ou dados biométricos.
     */
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // -------------------------------------------------------------------------
    // Foreign Keys
    // -------------------------------------------------------------------------

    /**
     * Organização dona do encaminhamento.
     * ON DELETE RESTRICT: org com encaminhamentos não pode ser excluída.
     */
    fkOrg: foreignKey({
      name: 'fk_referrals_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    /**
     * Cliente titular do encaminhamento.
     * ON DELETE RESTRICT: customer com encaminhamentos não pode ser excluído.
     * Preserva auditoria jurídica.
     */
    fkCustomer: foreignKey({
      name: 'fk_referrals_customer',
      columns: [table.customerId],
      foreignColumns: [customers.id],
    }).onDelete('restrict'),

    /**
     * Escritório destinatário do encaminhamento.
     * ON DELETE RESTRICT: escritório com encaminhamentos não pode ser excluído.
     * Mantém rastreabilidade mesmo após desativação do escritório.
     */
    fkLawFirm: foreignKey({
      name: 'fk_referrals_law_firm',
      columns: [table.lawFirmId],
      foreignColumns: [lawFirms.id],
    }).onDelete('restrict'),

    /**
     * Usuário que realizou o encaminhamento (null para canal 'ai').
     * ON DELETE SET NULL: auditoria sobrevive à exclusão do usuário.
     */
    fkLinkedBy: foreignKey({
      name: 'fk_referrals_linked_by',
      columns: [table.linkedBy],
      foreignColumns: [users.id],
    }).onDelete('set null'),

    // -------------------------------------------------------------------------
    // Check Constraints
    // -------------------------------------------------------------------------

    /**
     * Canal deve ser 'human' ou 'ai' — domínio fechado.
     * Bloqueia valores inválidos diretamente no banco, independente da aplicação.
     */
    chkChannel: check('chk_referrals_channel', sql`${table.channel} IN ('human', 'ai')`),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Busca de encaminhamentos de um cliente com cooldown ativo.
     * Suporta: verificar se cliente está em cooldown antes de novo encaminhamento.
     * Composto com cooldown_until para filtro: `WHERE customer_id = $1 AND cooldown_until > now()`.
     */
    idxCustomerCooldown: index('idx_law_firm_referrals_customer').on(
      table.customerId,
      table.cooldownUntil,
    ),

    /**
     * Listagem de encaminhamentos por organização e cliente.
     * Suporta: histórico de encaminhamentos na ficha do cliente, relatórios por org.
     */
    idxOrgCustomer: index('idx_law_firm_referrals_org_customer').on(
      table.organizationId,
      table.customerId,
    ),
  }),
);

export type CustomerLawFirmReferral = typeof customerLawFirmReferrals.$inferSelect;
export type NewCustomerLawFirmReferral = typeof customerLawFirmReferrals.$inferInsert;
