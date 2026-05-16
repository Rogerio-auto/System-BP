// =============================================================================
// roles.ts — Catálogo de papéis RBAC.
//
// Papéis são globais (não por organização) — o mapeamento de quais roles
// uma org usa fica em user_roles. Não há exclusão de roles em produção;
// desabilitar usuário ou remover user_roles é suficiente.
//
// Keys canônicas (doc 10 §3.1):
//   admin | gestor_geral | gestor_regional | agente | operador | leitura
//
// Escopo (doc 10 §3.1):
//   global → admin, gestor_geral (acesso a todas as cidades da org)
//   city   → gestor_regional, agente, operador, leitura (filtrado por user_city_scopes)
// =============================================================================
import { sql } from 'drizzle-orm';
import { pgEnum, pgTable, uuid, text, uniqueIndex } from 'drizzle-orm/pg-core';

/** Domínio fechado de escopo de role (doc 10 §3.1). */
export const roleScopeEnum = pgEnum('role_scope', ['global', 'city']);

export const roles = pgTable(
  'roles',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /**
     * Identificador de negócio imutável pós-criação.
     * Usado em código para verificação de permissão.
     * Ex: 'admin', 'gestor_geral', 'agente'.
     */
    key: text('key').notNull(),

    /** Label exibida na UI (pode mudar sem impacto no código). */
    label: text('label').notNull(),

    /** Descrição do escopo do papel para documentação interna. */
    description: text('description'),

    /**
     * Escopo de acesso geográfico da role (doc 10 §3.1).
     * global → acesso a todas as cidades da org (admin, gestor_geral).
     * city   → acesso filtrado por user_city_scopes (gestor_regional, agente, operador, leitura).
     * Persistido como coluna — NOT NULL — não derivado em runtime.
     */
    scope: roleScopeEnum('scope').notNull(),
  },
  (table) => ({
    uqKey: uniqueIndex('uq_roles_key').on(table.key),
  }),
);

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
