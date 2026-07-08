// =============================================================================
// features/admin/notification-rules/api.ts — HTTP client para regras de
// notificação (F24-S10 / F24-S11).
//
// Endpoints consumidos:
//   GET  /api/notification-rules          — lista paginada com filtros
//   GET  /api/notification-rules/catalog  — catálogo fechado de gatilhos
//   GET  /api/notification-rules/:id      — detalhe de uma regra
//   POST /api/notification-rules          — criar regra
//   PATCH /api/notification-rules/:id     — atualização parcial (toggle enabled / edição)
//   DELETE /api/notification-rules/:id    — remover regra
//   POST /api/notification-rules/:id/test — dry-run: preview de destinatários + render
//
// RBAC: notifications:manage em todas as rotas.
// Único ponto de acesso à rede — nunca useEffect+fetch em componentes.
// =============================================================================
import type {
  NotificationRuleCreate,
  NotificationRuleListResponse,
  NotificationRuleResponse,
  NotificationRuleTestResponse,
  NotificationRuleUpdate,
  TriggerCatalogEntry,
} from '@elemento/shared-schemas';

import { api } from '../../../lib/api';

// ---------------------------------------------------------------------------
// Tipos auxiliares
// ---------------------------------------------------------------------------

export interface ListRulesParams {
  page?: number;
  per_page?: number;
  search?: string;
  /** undefined = todos; true = apenas ativos; false = apenas inativos */
  enabled?: boolean;
}

export interface CatalogResponse {
  data: ReadonlyArray<
    Omit<TriggerCatalogEntry, 'placeholders'> & {
      placeholders: string[];
      timestampSource?: string;
    }
  >;
}

// ---------------------------------------------------------------------------
// Funções de acesso à API
// ---------------------------------------------------------------------------

/**
 * GET /api/notification-rules — lista paginada de regras de notificação.
 * Permissão: notifications:manage
 */
export async function fetchNotificationRules(
  params: ListRulesParams = {},
): Promise<NotificationRuleListResponse> {
  const qs = new URLSearchParams();
  if (params.page !== undefined) qs.set('page', String(params.page));
  if (params.per_page !== undefined) qs.set('per_page', String(params.per_page));
  if (params.search !== undefined && params.search.length > 0) qs.set('search', params.search);
  if (params.enabled !== undefined) qs.set('enabled', String(params.enabled));
  const query = qs.toString();
  return api.get<NotificationRuleListResponse>(
    `/api/notification-rules${query ? `?${query}` : ''}`,
  );
}

/**
 * GET /api/notification-rules/catalog — catálogo fechado de gatilhos.
 * Permissão: notifications:manage
 */
export async function fetchNotificationCatalog(): Promise<CatalogResponse> {
  return api.get<CatalogResponse>('/api/notification-rules/catalog');
}

/**
 * GET /api/notification-rules/:id — detalhe de uma regra.
 * Permissão: notifications:manage
 */
export async function fetchNotificationRule(id: string): Promise<NotificationRuleResponse> {
  return api.get<NotificationRuleResponse>(`/api/notification-rules/${encodeURIComponent(id)}`);
}

/**
 * POST /api/notification-rules — cria nova regra de notificação.
 * Permissão: notifications:manage
 */
export async function createNotificationRule(
  body: NotificationRuleCreate,
): Promise<NotificationRuleResponse> {
  return api.post<NotificationRuleResponse>('/api/notification-rules', body);
}

/**
 * PATCH /api/notification-rules/:id — atualização parcial de regra.
 * Usado para toggle inline de enabled e edição completa via drawer.
 * Permissão: notifications:manage
 */
export async function updateNotificationRule(
  id: string,
  body: NotificationRuleUpdate,
): Promise<NotificationRuleResponse> {
  return api.patch<NotificationRuleResponse>(
    `/api/notification-rules/${encodeURIComponent(id)}`,
    body,
  );
}

/**
 * DELETE /api/notification-rules/:id — remove regra de notificação.
 * Permissão: notifications:manage
 */
export async function deleteNotificationRule(id: string): Promise<void> {
  await api.delete(`/api/notification-rules/${encodeURIComponent(id)}`);
}

/**
 * POST /api/notification-rules/:id/test — dry-run de regra existente.
 * Retorna preview de destinatários resolvidos + template renderizado com dados
 * de exemplo. NÃO envia nenhuma notificação.
 * Permissão: notifications:manage
 */
export async function testNotificationRule(id: string): Promise<NotificationRuleTestResponse> {
  return api.post<NotificationRuleTestResponse>(
    `/api/notification-rules/${encodeURIComponent(id)}/test`,
    {},
  );
}
