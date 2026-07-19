// =============================================================================
// features/notifications/navigation.ts — Deep-link e ação por entidade (F26-S01).
//
// Fonte única de verdade para "entity_type -> rota" e "entity_type -> rótulo
// de ação". Consumida tanto por `NotificationItem` (lista persistente do
// dropdown) quanto por `useNotificationSocket` (toast em tempo real) — nenhum
// dos dois duplica a lógica de resolução (doc 23 §14, gap G2).
//
// Pegadinha documentada (doc 23 §13): o fan-out de `chatwoot.handoff_requested`
// carimba `entity_type='lead'`/`entity_id=leadId` mesmo o catálogo rotulando o
// gatilho como `entityType: 'conversation'`. O mapeamento abaixo reflete os
// `entity_type` efetivamente persistidos pelos produtores atuais; evoluir para
// o registro exato (ex.: conversa específica) é débito futuro (doc 23 §14).
//
// F26-S04: `resolveNotificationCategory`/`getNotificationCategoryLabel` — a
// linha `notifications` NÃO persiste `category` (só `entity_type`+`severity`,
// F26-S03). A categoria exibida na lista é derivada de `entity_type` via o
// TRIGGER_CATALOG (fonte única, @elemento/shared-schemas) — melhor esforço,
// não é 1:1 exato: alguns `entity_type` aparecem em mais de uma entrada do
// catálogo com categorias diferentes (ex.: 'conversation' é `handoff` em
// chatwoot.handoff_requested/handoff:requested mas `lifecycle_stalled` em
// conversation:no_reply). Resolve para a PRIMEIRA categoria encontrada na
// ordem declarada do catálogo — suficiente para o rótulo informativo da
// central; não usar para lógica de negócio que exija precisão exata.
// =============================================================================

import type { NotificationCategory } from '@elemento/shared-schemas';
import { notificationCategorySchema, TRIGGER_CATALOG } from '@elemento/shared-schemas';

/**
 * Resolve a rota de deep-link a partir de `entity_type`/`entity_id`.
 * Entidades sem rota endereçável por id (drawer inline, ex.: contract/conversation)
 * caem na lista mais próxima. Tipo desconhecido/nulo → sem link (item só expande).
 */
export function resolveNotificationHref(
  entityType: string | null,
  entityId: string | null,
): string | null {
  switch (entityType) {
    case 'customer':
      return entityId !== null ? `/crm/${entityId}` : '/crm';
    case 'credit_analysis':
      return entityId !== null ? `/credit-analyses/${entityId}` : '/credit-analyses';
    case 'simulation':
      return '/simulator';
    case 'task':
      return '/tarefas';
    case 'contract':
      return '/contratos';
    case 'conversation':
      return '/conversas';
    case 'kanban_card':
      return '/crm?view=kanban';
    case 'payment_due':
    case 'billing':
      return '/admin/billing/dues';
    default:
      return null;
  }
}

/**
 * Rótulo do botão de ação explícito por `entity_type` (doc 23 §14, gap G5).
 * Exibido no item expandido da lista do sino — independe do texto livre do
 * corpo (que pode ser genérico até G4/G8 serem resolvidos no backend).
 */
export function getNotificationActionLabel(entityType: string | null): string {
  switch (entityType) {
    case 'customer':
      return 'Abrir lead';
    case 'credit_analysis':
      return 'Abrir análise';
    case 'simulation':
      return 'Ver simulação';
    case 'task':
      return 'Abrir tarefa';
    case 'contract':
      return 'Abrir contrato';
    case 'conversation':
      return 'Abrir conversa';
    case 'kanban_card':
      return 'Abrir no Kanban';
    case 'payment_due':
    case 'billing':
      return 'Ver cobrança';
    default:
      return 'Abrir';
  }
}

// ---------------------------------------------------------------------------
// Categoria (derivada de entity_type, F26-S04 — ver nota de cabeçalho)
// ---------------------------------------------------------------------------

/** entity_type -> categoria (primeira ocorrência no catálogo, ordem declarada). */
const ENTITY_TYPE_CATEGORY_MAP: ReadonlyMap<string, NotificationCategory> = (() => {
  const map = new Map<string, NotificationCategory>();
  for (const entry of TRIGGER_CATALOG) {
    if (!map.has(entry.entityType)) map.set(entry.entityType, entry.category);
  }
  return map;
})();

/**
 * Resolve a categoria funcional (uma das 6 do DS) a partir de `entity_type`.
 * `null` quando o tipo é desconhecido ou não vinculado a entidade.
 */
export function resolveNotificationCategory(
  entityType: string | null,
): NotificationCategory | null {
  if (entityType === null) return null;
  return ENTITY_TYPE_CATEGORY_MAP.get(entityType) ?? null;
}

/**
 * Rótulo PT-BR da categoria — mesma redação usada na matriz de preferências
 * (`preferences/PreferencesMatrix.tsx`), para consistência de vocabulário.
 */
export function getNotificationCategoryLabel(category: NotificationCategory | null): string {
  switch (category) {
    case 'lifecycle_stalled':
      return 'Estagnação de lead';
    case 'assignment':
      return 'Atribuição';
    case 'credit':
      return 'Crédito';
    case 'billing':
      return 'Cobrança';
    case 'handoff':
      return 'Transferência';
    case 'system':
      return 'Sistema';
    default:
      return 'Geral';
  }
}

/** Todas as categorias do catálogo, na ordem canônica do enum — para filtros. */
export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] =
  notificationCategorySchema.options;
