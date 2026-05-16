// =============================================================================
// agents.ts — Agentes de atendimento do Banco do Povo.
//
// Um agente é um funcionário humano que atende leads em uma ou mais cidades.
// Pode (ou não) ter um user_id vinculado — agentes externos ou importados do
// sistema antigo podem existir sem login ativo na plataforma.
//
// Colunas-chave:
//   - user_id:      FK opcional para users. null = agente sem login ativo.
//   - display_name: nome de exibição na UI (pode diferir de users.full_name).
//   - phone:        telefone do agente para contato interno. E.164 normalizado pela app.
//                   Não exposto ao cliente/lead (é dado interno).
//   - is_active:    false = agente inativo (não recebe novos leads, oculto em seletores).
//
// Soft-delete: deleted_at protege histórico de leads atribuídos.
//
// Índice parcial único: (organization_id, user_id) where deleted_at IS NULL
// garante que um user só pode ter 1 perfil de agente ativo por org.
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  foreignKey,
} from 'drizzle-orm/pg-core';

import { organizations } from './organizations';
import { users } from './users';

export const agents = pgTable(
  'agents',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    organizationId: uuid('organization_id').notNull(),

    /**
     * FK opcional para users.
     * null = agente sem login na plataforma (importado, externo, legado).
     * Quando não-null, o user deve pertencer à mesma organização — validado em serviço.
     */
    userId: uuid('user_id'),

    /**
     * Nome exibido na UI (listas de agentes, cards de lead, relatórios).
     * Pode diferir de users.full_name (ex: apelido, nome de guerra).
     */
    displayName: text('display_name').notNull(),

    /**
     * Telefone do agente para contato interno (E.164 normalizado pela app).
     * Não é exposto para leads/clientes — dado interno do time.
     * LGPD: dado pessoal de colaborador; tratamento com base art. 7°, IX (legítimo interesse).
     */
    phone: text('phone'),

    /**
     * false = agente inativo.
     * Leads já atribuídos mantêm a referência; novos leads não são roteados.
     * UI deve filtrar is_active = true em seletores de atribuição.
     */
    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Soft-delete: preserva histórico de leads atribuídos a agentes desligados.
     * Leads históricos mantêm assigned_agent_id mesmo após deleted_at.
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    // FK para organizations (multi-tenant root)
    fkOrg: foreignKey({
      name: 'fk_agents_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    // FK opcional para users (agente pode não ter login)
    fkUser: foreignKey({
      name: 'fk_agents_user',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('set null'),

    // B-tree em FK para joins org → agents
    idxOrg: index('idx_agents_org').on(table.organizationId),

    // B-tree em user_id para lookup "qual agente tem este user?"
    idxUserId: index('idx_agents_user_id').on(table.userId),

    // Unique parcial: um user só tem 1 agente ativo por org.
    // Permite que o mesmo user seja re-cadastrado após soft-delete.
    uqOrgUserActive: uniqueIndex('uq_agents_org_user_active')
      .on(table.organizationId, table.userId)
      .where(sql`${table.deletedAt} IS NULL AND ${table.userId} IS NOT NULL`),
  }),
);

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
