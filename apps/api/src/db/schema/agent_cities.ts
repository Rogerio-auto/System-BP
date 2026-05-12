// =============================================================================
// agent_cities.ts — Atribuições de agente por cidade (N:N com metadado).
//
// Modela o roteamento de leads: cada agente pode cobrir múltiplas cidades,
// e cada cidade pode ter múltiplos agentes.
//
// Colunas-chave:
//   - agent_id:    FK para agents.
//   - city_id:     FK para cities.
//   - is_primary:  true = cidade principal do agente (padrão em roteamento e UI).
//                  Validado em serviço: apenas 1 is_primary por agente na org.
//
// Regras de negócio:
//   - ON DELETE CASCADE em ambas as FKs: se cidade ou agente for deletado,
//     a atribuição some automaticamente (garante consistência sem trigger).
//   - Não tem soft-delete próprio — a tabela é rebuild quando agente/cidade
//     é editado. Histórico de atribuições não é requisito do MVP.
// =============================================================================
import { pgTable, uuid, boolean, primaryKey, foreignKey, index } from 'drizzle-orm/pg-core';

import { agents } from './agents';
import { cities } from './cities';

export const agentCities = pgTable(
  'agent_cities',
  {
    agentId: uuid('agent_id').notNull(),

    cityId: uuid('city_id').notNull(),

    /**
     * true = cidade principal do agente.
     * Usada como padrão em roteamento automático e filtros de UI.
     * Máximo de 1 is_primary por agente — validado em camada de serviço
     * (não em DB para permitir troca atômica na app sem constraint race).
     */
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (table) => [
    // PK composta: cada par (agente, cidade) é único
    primaryKey({ columns: [table.agentId, table.cityId] }),

    // FK → agents com cascade: remoção de agente limpa atribuições
    foreignKey({
      name: 'fk_agent_cities_agent',
      columns: [table.agentId],
      foreignColumns: [agents.id],
    }).onDelete('cascade'),

    // FK → cities com cascade: remoção de cidade limpa atribuições
    foreignKey({
      name: 'fk_agent_cities_city',
      columns: [table.cityId],
      foreignColumns: [cities.id],
    }).onDelete('cascade'),

    // B-tree em city_id para query "quais agentes cobrem esta cidade?"
    index('idx_agent_cities_city').on(table.cityId),
  ],
);

export type AgentCity = typeof agentCities.$inferSelect;
export type NewAgentCity = typeof agentCities.$inferInsert;
