// =============================================================================
// cities.ts — Municípios atendidos pelo Banco do Povo.
//
// Multi-tenant: toda cidade pertence a uma organização.
//
// Colunas-chave:
//   - ibge_code:       código IBGE oficial (7 dígitos). Unique por org.
//                      Usado como chave de integração com sistemas externos (SICONV, etc).
//   - name:            nome oficial do município (citext, case-insensitive).
//   - name_normalized: nome sem acentos, lowercase, gerado pela app antes de inserir.
//                      Fonte para o índice GIN trgm — fuzzy match em identify_city.
//   - aliases:         variações de grafia aceitas (ex: ["PVH", "porto velho", "p. velho"]).
//                      Array permite queries GIN sem tabela auxiliar.
//   - state_uf:        UF de 2 letras. Default 'RO' para esta implantação.
//   - is_active:       false = cidade desligada do atendimento (oculta em UI, ignora leads).
//   - slug:            URL-safe gerado pela app (lower + slugify(name)).
//
// Índices:
//   - GIN trgm em name_normalized → trigram similarity para identify_city (F3).
//   - GIN em aliases (text[]) → contains para lookup por variação de nome.
//   - Unique parcial (organization_id, ibge_code) where deleted_at IS NULL.
//   - Unique parcial (organization_id, slug) where deleted_at IS NULL.
//
// Soft-delete via deleted_at para manter histórico de leads de cidades desativadas.
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  varchar,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  foreignKey,
  customType,
} from 'drizzle-orm/pg-core';

import { organizations } from './organizations';

/**
 * citext: tipo PostgreSQL case-insensitive.
 * Requer extension citext (criada em 0000_init.sql).
 */
const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

export const cities = pgTable(
  'cities',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    organizationId: uuid('organization_id').notNull(),

    /**
     * Nome oficial do município (citext — comparação case-insensitive).
     * Ex: "Porto Velho".
     */
    name: citext('name').notNull(),

    /**
     * Nome sem acentos, minúsculas, gerado pela app antes de inserir.
     * Ex: "porto velho". Alimenta o índice GIN trgm para identify_city (F3).
     * Nunca editar diretamente — sempre derivar de name via unaccent + lower na app.
     */
    nameNormalized: text('name_normalized').notNull(),

    /**
     * Variações de grafia aceitas para matching de entrada do usuário.
     * Ex: ['PVH', 'porto velho', 'p. velho', 'portovelho'].
     * GIN index permite `WHERE aliases @> ARRAY['pvh']::text[]`.
     */
    aliases: text('aliases')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    /**
     * URL-safe: lower + slugify(name). Ex: "porto-velho".
     * Gerado pela app. Unique por org (parcial, excluindo soft-deleted).
     */
    slug: text('slug').notNull(),

    /**
     * Código IBGE de 7 dígitos. Ex: "1100205" (Porto Velho).
     * Null permitido em edge cases de importação manual, mas único por org quando presente.
     */
    ibgeCode: text('ibge_code'),

    /**
     * UF de 2 letras. Default 'RO' — implantação Rondônia.
     * varchar(2) garante integridade sem check constraint complexo.
     */
    stateUf: varchar('state_uf', { length: 2 }).notNull().default('RO'),

    /**
     * false = cidade desligada do atendimento.
     * Leads existentes de cidades inativas são preservados (soft-delete de cidade
     * não apaga leads — consultar is_active antes de criar novos leads).
     */
    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    /** Soft-delete: mantém histórico de leads de cidades desativadas. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    // FK explícita para organizations (multi-tenant root)
    fkOrg: foreignKey({
      name: 'fk_cities_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    // B-tree em FK para joins org → cities
    idxOrg: index('idx_cities_org').on(table.organizationId),

    // GIN trigram em name_normalized — fuzzy search para identify_city (F3)
    // Requer: CREATE EXTENSION IF NOT EXISTS pg_trgm (0000_init.sql)
    // NOTA: gin_trgm_ops não é suportado nativamente pelo Drizzle — a migration
    // SQL (0002_cities_agents.sql) foi escrita manualmente com o operator class correto.
    idxNameNormalizedTrgm: index('idx_cities_name_normalized_trgm').using(
      'gin',
      table.nameNormalized,
    ),

    // GIN em aliases[] — lookup por variação de nome
    idxAliasesGin: index('idx_cities_aliases_gin').using('gin', table.aliases),

    // Unique por org+ibge_code (excluindo soft-deleted e nulos tratados separadamente)
    uqOrgIbgeActive: uniqueIndex('uq_cities_org_ibge_active')
      .on(table.organizationId, table.ibgeCode)
      .where(sql`${table.deletedAt} IS NULL AND ${table.ibgeCode} IS NOT NULL`),

    // Unique por org+slug (excluindo soft-deleted)
    uqOrgSlugActive: uniqueIndex('uq_cities_org_slug_active')
      .on(table.organizationId, table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
  }),
);

export type City = typeof cities.$inferSelect;
export type NewCity = typeof cities.$inferInsert;
