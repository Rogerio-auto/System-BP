// =============================================================================
// leads.ts — Tabela central do CRM: leads do Banco do Povo.
//
// Um lead é um potencial cliente que entrou em contato (via WhatsApp, importação,
// manual, Chatwoot ou API) e está sendo qualificado para crédito.
//
// Colunas-chave:
//   - phone_e164:       telefone no formato E.164 (+5511999999999). Validado via check.
//   - phone_normalized: apenas dígitos (5511999999999). Fonte para dedupe.
//   - source:           canal de origem do lead.
//   - status:           pipeline do CRM (new → qualifying → simulation → closed_*).
//   - last_simulation_id: FK virtual para simulations (tabela criada em F1-S22).
//                         Sem FK física aqui para evitar dependência circular de migration.
//   - cpf_encrypted:    bytea reservado para F1-S24 (AES-256-GCM via pgcrypto).
//   - cpf_hash:         HMAC SHA-256 para dedupe seguro de CPF (F1-S24).
//   - email:            citext (case-insensitive, extension citext de 0000_init.sql).
//   - metadata:         jsonb livre para dados extras sem migration (ex: utm_source).
//
// LGPD (doc 17):
//   - name, email, phone_* são PII — não logar em produção (pino.redact).
//   - cpf_* colunas ficam NULL até F1-S24 implementar a criptografia.
//   - content de interactions pode ter PII — cifrar em fase futura (TODO §8.5).
//
// Dedupe:
//   - Índice único parcial (organization_id, phone_normalized) WHERE deleted_at IS NULL.
//   - Permite reutilizar número após soft-delete.
//
// Soft-delete via deleted_at para preservar histórico e lead_history.
//
// Índices:
//   - GIN trgm em name: fuzzy search por nome do cliente (pg_trgm de 0000_init.sql).
//   - (organization_id, status, created_at DESC): listagem por pipeline.
//   - (organization_id, city_id): escopo multi-cidade.
//   - (agent_id) parcial: atendimentos por agente (WHERE agent_id IS NOT NULL).
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
  check,
} from 'drizzle-orm/pg-core';

import { agents } from './agents.js';
import { cities } from './cities.js';
import { organizations } from './organizations.js';

/**
 * citext: tipo PostgreSQL case-insensitive para texto.
 * Requer extension citext (criada em 0000_init.sql).
 * Drizzle não expõe citext nativamente — definido via customType.
 */
const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

/**
 * bytea: tipo PostgreSQL para dados binários (bytes raw).
 * Usado para cpf_encrypted (AES-256-GCM via pgcrypto).
 * Drizzle não expõe bytea nativamente — definido via customType.
 * Node.js serializa como Buffer.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const leads = pgTable(
  'leads',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Multi-tenant root. Todo lead pertence a uma organização. */
    organizationId: uuid('organization_id').notNull(),

    /**
     * Cidade onde o lead será atendido.
     * Determina qual agente (e pool de agentes) pode atender.
     * FK ON DELETE RESTRICT: cidade não pode ser removida se tiver leads.
     */
    cityId: uuid('city_id').notNull(),

    /**
     * Agente responsável pelo atendimento do lead.
     * null = não atribuído (aguardando roteamento ou atribuição manual).
     * FK ON DELETE SET NULL: agente deletado libera o lead para reatribuição.
     */
    agentId: uuid('agent_id'),

    /**
     * Nome completo do lead.
     * LGPD: PII — não incluir em logs sem redact.
     * Alimenta o índice GIN trgm para busca fuzzy por nome.
     */
    name: text('name').notNull(),

    /**
     * Telefone no formato E.164 (+5511999999999).
     * Check constraint garante formato válido: ^\\+\\d{10,15}$.
     * LGPD: PII — canal de comunicação principal.
     */
    phoneE164: text('phone_e164').notNull(),

    /**
     * Telefone apenas dígitos (5511999999999), derivado de phone_e164 pela app.
     * Fonte para o índice único de dedupe.
     * Check constraint garante apenas dígitos: ^\\d{10,15}$.
     */
    phoneNormalized: text('phone_normalized').notNull(),

    /**
     * Canal de origem do lead.
     * 'whatsapp'  — entrou via integração WhatsApp.
     * 'manual'    — criado manualmente por agente/admin.
     * 'import'    — importado via planilha.
     * 'chatwoot'  — capturado via integração Chatwoot.
     * 'api'       — criado via API externa (integração B2B).
     */
    source: text('source', {
      enum: ['whatsapp', 'manual', 'import', 'chatwoot', 'api'],
    }).notNull(),

    /**
     * Status atual no pipeline CRM.
     * 'new'          — recém-criado, aguardando qualificação.
     * 'qualifying'   — em processo de qualificação (documentos, dados).
     * 'simulation'   — simulação de crédito em andamento.
     * 'closed_won'   — aprovado e contratado.
     * 'closed_lost'  — reprovado ou desistiu.
     * 'archived'     — arquivado (sem ação prevista).
     */
    status: text('status', {
      enum: ['new', 'qualifying', 'simulation', 'closed_won', 'closed_lost', 'archived'],
    })
      .notNull()
      .default('new'),

    /**
     * ID da última simulação de crédito associada.
     * FK virtual — tabela simulations será criada em F1-S22.
     * Sem FK física aqui para evitar dependência de migration.
     * Aplicação garante referential integrity via service layer.
     */
    lastSimulationId: uuid('last_simulation_id'),

    /**
     * Email do lead (citext — comparação case-insensitive).
     * Opcional: nem todo lead fornece email no primeiro contato.
     * LGPD: PII — não logar sem redact.
     */
    email: citext('email'),

    /**
     * CPF cifrado com AES-256-GCM via pgcrypto.
     * Preenchido por F1-S24. NULL até lá.
     * LGPD: dado sensível (art. 11 LGPD) — apenas cifrado no banco.
     */
    cpfEncrypted: bytea('cpf_encrypted'),

    /**
     * HMAC SHA-256 do CPF normalizado, para dedupe seguro.
     * Preenchido por F1-S24. NULL até lá.
     * Permite deduplicar sem expor CPF em texto puro.
     */
    cpfHash: text('cpf_hash'),

    /** Notas livres do agente sobre o lead. */
    notes: text('notes'),

    /**
     * Metadados extras sem schema fixo.
     * Exemplos: { utm_source, utm_campaign, chatwoot_contact_id, import_row }.
     * Não armazenar PII bruta aqui — usar colunas dedicadas com proteção.
     */
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Soft-delete: preserva histórico de interações e lead_history.
     * Índice único de dedupe (phone_normalized) é parcial sobre deleted_at IS NULL.
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // -------------------------------------------------------------------------
    // Foreign Keys (nomeadas explicitamente)
    // -------------------------------------------------------------------------

    foreignKey({
      name: 'fk_leads_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    foreignKey({
      name: 'fk_leads_city',
      columns: [table.cityId],
      foreignColumns: [cities.id],
    }).onDelete('restrict'),

    foreignKey({
      name: 'fk_leads_agent',
      columns: [table.agentId],
      foreignColumns: [agents.id],
    }).onDelete('set null'),

    // -------------------------------------------------------------------------
    // Check Constraints
    // -------------------------------------------------------------------------

    /**
     * phone_e164 deve seguir E.164: + seguido de 10-15 dígitos.
     * Exemplos válidos: +5511999999999, +5569912345678.
     */
    check('chk_leads_phone_e164_format', sql`${table.phoneE164} ~ '^\\+\\d{10,15}$'`),

    /**
     * phone_normalized: apenas dígitos, 10-15 caracteres.
     * Derivado de phone_e164 pela app (strip do '+').
     */
    check('chk_leads_phone_normalized_format', sql`${table.phoneNormalized} ~ '^\\d{10,15}$'`),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Dedupe por telefone dentro da organização.
     * Parcial: só bloqueia duplicatas para leads ativos (deleted_at IS NULL).
     * Permite criar novo lead com mesmo número após soft-delete do anterior.
     */
    uniqueIndex('uq_leads_org_phone_active')
      .on(table.organizationId, table.phoneNormalized)
      .where(sql`${table.deletedAt} IS NULL`),

    /**
     * Listagem principal do CRM: por org + status + data (pipeline view).
     * Suporta queries: "todos os leads 'new' da org X, mais recentes primeiro".
     */
    index('idx_leads_org_status_created').on(table.organizationId, table.status, table.createdAt),

    /**
     * Escopo multi-cidade: filtrar leads de uma cidade específica.
     * Usado pelo RBAC/city-scope middleware.
     */
    index('idx_leads_org_city').on(table.organizationId, table.cityId),

    /**
     * Atendimentos por agente: "todos os leads atribuídos ao agente X".
     * Parcial: exclui leads sem agente para manter o índice enxuto.
     */
    index('idx_leads_agent')
      .on(table.agentId)
      .where(sql`${table.agentId} IS NOT NULL`),

    /**
     * Busca fuzzy por nome do lead (GIN trigram).
     * Requer: CREATE EXTENSION IF NOT EXISTS pg_trgm (0000_init.sql).
     * NOTA: gin_trgm_ops não é suportado pelo Drizzle schema — a migration SQL
     * (0007_leads_core.sql) foi ajustada manualmente com o operator class correto.
     */
    index('idx_leads_name_trgm').using('gin', table.name),
  ],
);

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
