// =============================================================================
// featureFlags.ts — Schema Drizzle da tabela feature_flags (F1-S23).
//
// A tabela não é multi-tenant por design:
//   - Feature flags são configurações globais da plataforma (operador).
//   - Cada organização (cidade) herda o estado global.
//   - Extensão futura: audience.city_ids[] para flags por município.
//
// Auditoria: toda mudança via PATCH /admin/feature-flags/:key registra
//   o user ID em updated_by + emite evento feature_flag.changed no outbox.
// =============================================================================
import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Tipos de domínio
// ---------------------------------------------------------------------------

export type FeatureFlagStatus = 'enabled' | 'disabled' | 'internal_only';

/**
 * Filtros de audience.
 * Vazio ({}) = sem restrição — flag visível a todos os usuários autenticados.
 * roles: restringe à lista de roles. city_ids: restringe a lista de cidades.
 */
export interface FeatureFlagAudience {
  roles?: string[] | undefined;
  city_ids?: string[] | undefined;
}

// ---------------------------------------------------------------------------
// Tabela
// ---------------------------------------------------------------------------

export const featureFlags = pgTable(
  'feature_flags',
  {
    /** Chave única da flag. Ex: "followup.enabled". PK de texto. */
    key: text('key').primaryKey(),

    /**
     * Status operacional da flag.
     * 'enabled'       → funcionalidade ativa.
     * 'disabled'      → funcionalidade desativada; se visible=true, exibe badge.
     * 'internal_only' → visível apenas para roles em audience.roles.
     */
    status: text('status', { enum: ['enabled', 'disabled', 'internal_only'] })
      .notNull()
      .default('disabled'),

    /**
     * Controla visibilidade na UI.
     * true  → aparecer com badge "Em desenvolvimento" quando disabled.
     * false → totalmente oculto (rotas e menus não renderizados).
     */
    visible: boolean('visible').notNull().default(true),

    /**
     * Label exibida quando status='disabled' && visible=true.
     * null → componente usa default "Em desenvolvimento".
     */
    uiLabel: text('ui_label'),

    description: text('description'),

    /**
     * Filtros de audience em JSONB.
     * Sem PII — apenas role names e UUIDs de cidade.
     * Default: {} (sem restrição).
     */
    audience: jsonb('audience')
      .$type<FeatureFlagAudience>()
      .notNull()
      .default(sql`'{}'::jsonb`),

    /**
     * UUID do usuário que fez o último toggle.
     * null quando inserido via seed/migration (sem actor humano).
     */
    updatedBy: uuid('updated_by'),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // B-tree por status — queries de lista filtradas por estado
    index('idx_feature_flags_status').on(table.status),
  ],
);

export type FeatureFlag = typeof featureFlags.$inferSelect;
export type NewFeatureFlag = typeof featureFlags.$inferInsert;
