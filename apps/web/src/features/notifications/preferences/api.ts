// =============================================================================
// features/notifications/preferences/api.ts — API de preferências de notificação.
//
// Contrato F24-S09:
//   GET /api/notifications/preferences → { data: PreferenceItem[] }
//   PUT /api/notifications/preferences ← { preferences: PreferenceItem[] }
//
// Casing/envelope espelhado do contrato real em
//   apps/api/src/modules/notifications/schemas.ts (NotificationPreferencesListSchema
//   e NotificationPreferencesBatchUpdateSchema).
//
// Canais: in_app | email | whatsapp.
// Categorias: lifecycle_stalled | assignment | credit | billing | handoff | system.
// category = null/ausente → preferência global do canal (default).
// =============================================================================

import type { NotificationCategory } from '@elemento/shared-schemas';

import { api } from '../../../lib/api';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type PreferenceChannel = 'in_app' | 'email' | 'whatsapp';

export interface PreferenceItem {
  channel: PreferenceChannel;
  enabled: boolean;
  category?: NotificationCategory | null;
}

export interface PreferencesResponse {
  data: PreferenceItem[];
}

export interface PreferencesBatchUpdate {
  preferences: Array<{
    channel: PreferenceChannel;
    enabled: boolean;
    category?: NotificationCategory | null;
  }>;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/notifications/preferences
 * Retorna a matriz completa de preferências do usuário autenticado.
 * Sempre inclui os defaults de canal (category = null) e os overrides
 * de categoria configurados pelo usuário.
 */
export async function fetchPreferences(): Promise<PreferencesResponse> {
  return api.get<PreferencesResponse>('/api/notifications/preferences');
}

/**
 * PUT /api/notifications/preferences
 * Upsert em batch de preferências.
 *   - Item sem category (ou category = null) → atualiza o default global do canal.
 *   - Item com category → atualiza o override de categoria específica.
 * Idempotente: re-enviar o mesmo payload não tem efeito colateral.
 */
export async function updatePreferences(
  body: PreferencesBatchUpdate,
): Promise<PreferencesResponse> {
  return api.put<PreferencesResponse>('/api/notifications/preferences', body);
}
