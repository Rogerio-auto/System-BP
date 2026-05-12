// =============================================================================
// services/imports/registry.ts — Registry de adapters de importação.
//
// Mapeia entity_type → ImportAdapter.
// Novos tipos de entidade (customers, agents) registram aqui.
// =============================================================================
import type { AnyAdapter } from './adapter.js';
import { leadsAdapter } from './adapters/leadsAdapter.js';

const ADAPTERS = new Map<string, AnyAdapter>([['leads', leadsAdapter]]);

/**
 * Retorna o adapter registrado para um entity_type.
 * @throws Error se entity_type não estiver registrado.
 */
export function getAdapter(entityType: string): AnyAdapter {
  const adapter = ADAPTERS.get(entityType);
  if (adapter === undefined) {
    throw new Error(`Adapter não registrado para entity_type: "${entityType}"`);
  }
  return adapter;
}

/** Lista os entity_types suportados. */
export function getSupportedEntityTypes(): string[] {
  return Array.from(ADAPTERS.keys());
}
