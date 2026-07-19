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
