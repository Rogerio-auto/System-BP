// =============================================================================
// features/notifications/deep-link.ts — Resolução pura `entity_type` -> rota.
//
// Fonte única de verdade do deep-link de notificação, SEM dependências
// (nada de `@elemento/shared-schemas`/zod/React/DOM). Isolado de `navigation.ts`
// justamente para poder ser importado no **service worker** (F27-S07,
// `sw/service-worker.ts`) sem arrastar o catálogo/zod pro bundle do SW.
// `navigation.ts` re-exporta esta função para os consumidores do frontend.
// =============================================================================

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
