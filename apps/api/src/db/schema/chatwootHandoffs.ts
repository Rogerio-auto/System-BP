// =============================================================================
// chatwootHandoffs.ts — Registro persistente de cada handoff de conversa
//                       enviado ao Chatwoot. (F3-S37)
//
// Um handoff ocorre quando o agente IA decide transferir a conversa a um
// atendente humano (doc 06 §7.4). Esta tabela armazena o estado do handoff
// para auditoria, idempotência e rastreio de SLA.
//
// Regras de negócio:
//   - id é o handoff_id retornado pelo endpoint POST /internal/handoffs.
//   - idempotency_key é UNIQUE parcial por org: reenvio retorna o handoff existente.
//   - status segue o ciclo: requested → accepted → resolved | cancelled.
//   - lead_id e simulation_id são FKs opcionais (ON DELETE SET NULL): o handoff
//     deve ser preservado mesmo se o lead ou simulação for deletado.
//   - assigned_agent_id é FK opcional (ON DELETE SET NULL): agente pode ser
//     desligado sem destruir o histórico de handoffs.
//
// LGPD (doc 17 §8.1, §8.5):
//   - summary (campo sensível): pode conter contexto de atendimento do cliente.
//     Base legal: execução de contrato / legítimo interesse (art. 7º II e IX).
//     Minimização: armazenar apenas o resumo gerado pela IA, não a conversa bruta.
//     Acesso restrito: apenas agentes e admins da organização.
//     Retenção: coberto pela política de retenção geral de dados de atendimento.
//     Redact: pino.redact deve incluir 'summary' antes de logar qualquer objeto
//     que contenha este campo. NUNCA incluir em logs, outbox ou payload externo.
//   - Checklist §14.2:
//     [x] Finalidade: registro de handoff para auditoria, SLA e rastreio.
//     [x] Base legal: execução de contrato (Art. 7º II) + legítimo interesse (Art. 7º IX).
//     [x] Necessidade: todos os campos têm finalidade documentada.
//     [x] PII: summary pode conter contexto do cliente — acesso restrito, redact obrigatório.
//     [x] Retenção: coberta pela política de retenção geral (tabela de atendimento).
//     [x] DLP: caller (LangGraph) deve aplicar DLP antes de preencher summary (doc 06 §8.4).
//
// Multi-tenant: organization_id denormalizado para city-scope sem JOIN.
//
// Soft-delete: deleted_at preserva histórico sem quebrar idempotência.
//
// Índices:
//   - (organization_id, conversation_id): busca de handoffs por conversa na org.
//   - (organization_id, status): listagem por status (SLA dashboard).
//   - UNIQUE parcial (organization_id, idempotency_key): garante idempotência por org.
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { agents } from './agents.js';
import { creditSimulations } from './creditSimulations.js';
import { leads } from './leads.js';
import { organizations } from './organizations.js';

export const chatwootHandoffs = pgTable(
  'chatwoot_handoffs',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Multi-tenant root. Denormalizado para city-scope sem JOIN. */
    organizationId: uuid('organization_id').notNull(),

    /**
     * Lead que originou este handoff.
     * null = handoff sem lead identificado (edge case: conversa anônima encerrada).
     * ON DELETE SET NULL: lead deletado não destrói o histórico de handoff.
     */
    leadId: uuid('lead_id'),

    /**
     * Identificador interno da conversa da IA (ai_conversation_states.conversation_id).
     * null = handoff criado antes de ter um AI conversation UUID (ex: tool call inicial
     *        que passa apenas o Chatwoot conversation ID antes da conversa ser registrada).
     * Não é FK explícita pois a conversa pode ser purgada após 90 dias (LGPD retenção).
     * Referência por valor para manter o histórico do handoff.
     */
    conversationId: uuid('conversation_id'),

    /**
     * ID da conversa no sistema externo Chatwoot (string — não assumir tipo numérico).
     * Armazenado como text para compatibilidade com diferentes versões do Chatwoot.
     */
    chatwootConversationId: text('chatwoot_conversation_id').notNull(),

    /**
     * Motivo do handoff. Catálogo definido em doc 06 §7.4:
     *   - cliente_solicitou_atendente
     *   - topico_fora_do_escopo
     *   - dados_incompletos_repetidos
     *   - simulacao_enviada_sem_resposta
     *   - ai_unavailable (F3-S34: fallback quando agente IA indisponível)
     */
    reason: text('reason').notNull(),

    /**
     * Resumo gerado pela IA para o atendente humano.
     *
     * LGPD CRÍTICO — campo sensível (label lgpd-impact):
     *   Pode conter contexto do cliente (ex: intenção declarada, valores de simulação,
     *   histórico resumido da conversa). É dado interno de atendimento — não é PII
     *   direta, mas pode conter informações do cliente em contexto.
     *
     *   Regras obrigatórias:
     *   1. pino.redact DEVE incluir 'summary' na lista de campos redactados.
     *   2. NUNCA incluir este campo no payload do outbox (violação §8.5).
     *   3. NUNCA logar este campo sem redact.
     *   4. DLP deve ser aplicado pelo caller (LangGraph) antes de enviar (doc 06 §8.4).
     *   5. Acesso restrito: agentes e admins da organização via RBAC.
     *
     * null = handoff sem resumo (criado por fallback ai_unavailable, sem contexto IA).
     */
    summary: text('summary'),

    /**
     * Simulação de crédito relacionada ao handoff, quando aplicável.
     * null = handoff sem simulação associada.
     * ON DELETE SET NULL: simulação deletada não destrói o histórico de handoff.
     */
    simulationId: uuid('simulation_id'),

    /**
     * Agente humano atribuído a esta conversa no Chatwoot.
     * null = ainda não atribuído (handoff recém-criado ou auto-assign pendente).
     * ON DELETE SET NULL: agente desligado não invalida o histórico de handoffs.
     */
    assignedAgentId: uuid('assigned_agent_id'),

    /**
     * Estado do handoff no ciclo de vida:
     *   requested  → handoff solicitado (estado inicial).
     *   accepted   → atendente humano assumiu a conversa.
     *   resolved   → conversa encerrada com sucesso.
     *   cancelled  → handoff cancelado (ex: cliente desistiu).
     */
    status: text('status', {
      enum: ['requested', 'accepted', 'resolved', 'cancelled'],
    })
      .notNull()
      .default('requested'),

    /**
     * Chave de idempotência (header Idempotency-Key do caller).
     * UNIQUE parcial por org: garante que o mesmo caller não crie handoffs duplicados.
     * Permite que o endpoint retorne o handoff existente em caso de reenvio.
     */
    idempotencyKey: text('idempotency_key').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Soft-delete: preserva histórico sem quebrar a constraint de idempotência.
     * Um handoff deletado logicamente ainda bloqueia novos handoffs com a mesma chave
     * (a constraint de idempotência não filtra por deleted_at — comportamento intencional).
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    // -------------------------------------------------------------------------
    // Foreign Keys (todas nomeadas, com on delete explícito)
    // -------------------------------------------------------------------------

    fkOrg: foreignKey({
      name: 'fk_chatwoot_handoffs_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    fkLead: foreignKey({
      name: 'fk_chatwoot_handoffs_lead',
      columns: [table.leadId],
      foreignColumns: [leads.id],
    }).onDelete('set null'),

    fkSimulation: foreignKey({
      name: 'fk_chatwoot_handoffs_simulation',
      columns: [table.simulationId],
      foreignColumns: [creditSimulations.id],
    }).onDelete('set null'),

    fkAssignedAgent: foreignKey({
      name: 'fk_chatwoot_handoffs_assigned_agent',
      columns: [table.assignedAgentId],
      foreignColumns: [agents.id],
    }).onDelete('set null'),

    // -------------------------------------------------------------------------
    // Unique Constraints
    // -------------------------------------------------------------------------

    /**
     * Idempotência por organização.
     * Garante que um mesmo caller não crie dois handoffs com a mesma chave na mesma org.
     * Parcial: inclui todos os registros (mesmo deleted — comportamento intencional).
     */
    uqOrgIdempotencyKey: uniqueIndex('uq_chatwoot_handoffs_org_idempotency').on(
      table.organizationId,
      table.idempotencyKey,
    ),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Busca de handoffs por conversa em uma organização.
     * Query frequente: "handoffs desta conversa na org X".
     */
    idxOrgConversation: index('idx_chatwoot_handoffs_org_conversation').on(
      table.organizationId,
      table.conversationId,
    ),

    /**
     * Listagem por status para dashboard de SLA.
     * Query frequente: "handoffs pendentes (requested) na org X".
     */
    idxOrgStatus: index('idx_chatwoot_handoffs_org_status').on(
      table.organizationId,
      table.status,
    ),
  }),
);

export type ChatwootHandoff = typeof chatwootHandoffs.$inferSelect;
export type NewChatwootHandoff = typeof chatwootHandoffs.$inferInsert;
