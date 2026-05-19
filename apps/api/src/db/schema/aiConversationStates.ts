// =============================================================================
// aiConversationStates.ts — Estado por conversa do agente LangGraph.
//
// Uma conversa = um estado ativo. Esta tabela é o checkpoint durável que
// permite ao LangGraph retomar qualquer conversa após restart do serviço.
//
// Regras de negócio:
//   - UNIQUE em conversation_id: nunca existe mais de 1 estado ativo por conversa.
//   - O campo `state` jsonb é um snapshot serializado de ConversationState.
//     NÃO deve conter CPF, RG ou document_number em texto puro — usar apenas
//     lead_id / customer_id como referência (LGPD art. 13 §2º minimização).
//   - chatwoot_conversation_id: ID externo no Chatwoot (string, pode ser numérico
//     serializado). Armazenado como text para não assumir tipo do sistema externo.
//   - current_node: nome do nó LangGraph onde a conversa parou (ex: "classify_intent").
//   - graph_version: SemVer do grafo (ex: "v1.0.0"). Permite detectar conversas
//     abertas em versões antigas após deploy.
//   - last_message_at: momento da última mensagem recebida. Usado por jobs de
//     expiração de conversa (sem atividade por N horas → handoff automático).
//
// LGPD (doc 17 §8.4 + §8.12):
//   - state jsonb: NUNCA armazenar CPF/RG/document_number bruto. Apenas IDs internos.
//   - phone: armazenado em formato normalizado (apenas dígitos) — é PII de contato,
//     mas necessário para roteamento (finalidade §3.3 ítem 1). Não logar sem redact.
//   - Retenção: estado de conversas encerradas pode ser purgado após 90 dias
//     (manter apenas ai_decision_logs para auditoria de longo prazo).
//
// Multi-tenant: organization_id denormalizado para city-scope sem JOIN.
//
// Soft-delete: deleted_at para soft-encerrar conversas sem perder o histórico
//   (audit trail de quando a conversa foi encerrada/handoff foi feito).
//
// Índices:
//   - UNIQUE em conversation_id: constraint de negócio crítica (1 estado por conversa).
//   - (lead_id) parcial: conversas de leads identificados.
//   - (organization_id, last_message_at): jobs de expiração por org.
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { customers } from './customers.js';
import { leads } from './leads.js';
import { organizations } from './organizations.js';

export const aiConversationStates = pgTable(
  'ai_conversation_states',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Multi-tenant root. Denormalizado para city-scope sem JOIN. */
    organizationId: uuid('organization_id').notNull(),

    /**
     * Identificador único da conversa (gerado internamente pelo backend).
     * UNIQUE: garante que exista no máximo 1 estado por conversa ativa.
     * LangGraph usa este ID para carregar/salvar o checkpoint.
     */
    conversationId: uuid('conversation_id').notNull(),

    /**
     * ID da conversa no Chatwoot (string porque o Chatwoot usa inteiros mas
     * sistemas externos podem usar outros formatos — não assumir tipo).
     * null = conversa ainda não sincronizada com o Chatwoot.
     */
    chatwootConversationId: text('chatwoot_conversation_id'),

    /**
     * Lead identificado nesta conversa.
     * null = lead ainda não criado (primeiro contato, sem nome ainda).
     * ON DELETE SET NULL: lead deletado não destrói o histórico de conversa.
     * LGPD: referenciar por ID — não copiar dados do lead aqui.
     */
    leadId: uuid('lead_id'),

    /**
     * Cliente identificado (CPF obtido) nesta conversa.
     * null = lead ainda não convertido em customer.
     * ON DELETE SET NULL: customer deletado preserva o histórico de conversa.
     */
    customerId: uuid('customer_id'),

    /**
     * Telefone do interlocutor, apenas dígitos (ex: 5569912345678).
     * Usado para roteamento e exibição antes de lead_id ser criado.
     * LGPD: PII de contato — não incluir em logs sem pino.redact.
     */
    phone: text('phone').notNull(),

    /**
     * Nome do nó LangGraph onde a conversa está pausada.
     * Exemplos: "classify_intent", "collect_missing_profile_data", "generate_simulation".
     * Permite debugging e observabilidade do fluxo.
     */
    currentNode: text('current_node'),

    /**
     * Versão SemVer do grafo LangGraph que gerou este estado.
     * Exemplos: "v1.0.0", "v1.2.3".
     * Permite identificar conversas abertas em versões antigas após deploy.
     * Documentado em doc 06 §9.
     */
    graphVersion: text('graph_version'),

    /**
     * Snapshot serializado do ConversationState (TypedDict do Python).
     * Contém: mensagens recentes, intenção classificada, dados coletados,
     *         flags de fluxo, resultado de tools.
     *
     * LGPD CRÍTICO: NÃO armazenar CPF, RG, document_number em texto puro.
     * Usar apenas IDs internos (lead_id, customer_id). DLP aplicado antes
     * de persistir (doc 17 §8.4). Dado financeiro (valor de simulação) é
     * permitido — não é PII sensível (art. 11 LGPD).
     */
    state: jsonb('state')
      .notNull()
      .default(sql`'{}'::jsonb`),

    /**
     * Momento da última mensagem recebida nesta conversa.
     * Usado por job de expiração: conversas inativas > N horas → handoff automático.
     * null = conversa recém-criada (ainda sem mensagem processada).
     */
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Soft-delete: encerrar conversa sem perder o checkpoint para auditoria.
     * Conversas com deleted_at != null não são carregadas pelo LangGraph.
     * Retenção: purgar state jsonb após 90 dias (manter registro vazio por audit trail).
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    // -------------------------------------------------------------------------
    // Foreign Keys (nomeadas explicitamente, on delete pensado)
    // -------------------------------------------------------------------------

    fkOrg: foreignKey({
      name: 'fk_ai_conv_states_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    fkLead: foreignKey({
      name: 'fk_ai_conv_states_lead',
      columns: [table.leadId],
      foreignColumns: [leads.id],
    }).onDelete('set null'),

    fkCustomer: foreignKey({
      name: 'fk_ai_conv_states_customer',
      columns: [table.customerId],
      foreignColumns: [customers.id],
    }).onDelete('set null'),

    // -------------------------------------------------------------------------
    // Unique Constraints
    // -------------------------------------------------------------------------

    /**
     * Uma conversa = um estado. Regra de negócio crítica.
     * Garante que o LangGraph nunca duplique o checkpoint de uma conversa.
     */
    uqConversationId: uniqueIndex('uq_ai_conv_states_conversation_id').on(table.conversationId),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Conversas ativas de um lead: "todas as conversas abertas do lead X".
     * Parcial: exclui conversas sem lead (fase anterior ao get_or_create_lead).
     */
    idxLeadId: index('idx_ai_conv_states_lead')
      .on(table.leadId)
      .where(sql`${table.leadId} IS NOT NULL`),

    /**
     * Job de expiração por org: "conversas inativas da org X mais antigas que T".
     * Composto: org primeiro para o job escanear apenas a sua própria org.
     */
    idxOrgLastMessage: index('idx_ai_conv_states_org_last_message').on(
      table.organizationId,
      table.lastMessageAt,
    ),
  }),
);

export type AiConversationState = typeof aiConversationStates.$inferSelect;
export type NewAiConversationState = typeof aiConversationStates.$inferInsert;
