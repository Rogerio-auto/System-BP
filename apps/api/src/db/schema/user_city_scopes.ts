// =============================================================================
// user_city_scopes.ts — Controle de acesso geográfico por usuário.
//
// Define quais cidades cada usuário pode acessar (doc 10 §3.4).
//
// Regras de negócio:
//   - roles 'admin' e 'gestor_geral' ignoram esta tabela → acesso global.
//   - 'gestor_regional', 'agente', 'operador', 'leitura' são filtrados por ela.
//   - is_primary indica a cidade principal de trabalho (usada em defaults de UI).
//   - FK city_id → cities adicionada em F1-S05 (0002_cities_agents.sql).
// =============================================================================
import { pgTable, uuid, boolean, primaryKey, foreignKey, index } from 'drizzle-orm/pg-core';

import { cities } from './cities';
import { users } from './users';

export const userCityScopes = pgTable(
  'user_city_scopes',
  {
    userId: uuid('user_id').notNull(),

    /**
     * Referencia cities.id — FK fk_user_city_scopes_city adicionada em F1-S05
     * (0002_cities_agents.sql) para evitar dependência circular no F1-S01.
     */
    cityId: uuid('city_id').notNull(),

    /**
     * true = cidade principal do usuário (default em filtros de UI).
     * Apenas 1 cidade primária por usuário é validado em camada de serviço.
     */
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.cityId] }),

    foreignKey({
      name: 'fk_user_city_scopes_user',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),

    foreignKey({
      name: 'fk_user_city_scopes_city',
      columns: [table.cityId],
      foreignColumns: [cities.id],
    }).onDelete('cascade'),

    // B-tree em city_id para queries "quais usuários têm acesso a esta cidade?"
    index('idx_user_city_scopes_city').on(table.cityId),
  ],
);

export type UserCityScope = typeof userCityScopes.$inferSelect;
export type NewUserCityScope = typeof userCityScopes.$inferInsert;
