// =============================================================================
// features/assistant/chips.ts — Chips de sugestão do copiloto interno (F6-S12).
//
// Módulo puro (sem React) para ficar trivialmente testável: mapeia permissão
// RBAC → pergunta pronta. O workspace filtra client-side via
// useAuth().hasPermission — é UX (deixar claro o que o assistente pode fazer
// por role), não é a fonte de verdade de autorização (o backend valida de
// novo em cada /api/internal-assistant/query).
// =============================================================================

/** Um chip de sugestão: ícone + pergunta pronta, gated por uma permissão RBAC. */
export interface AssistantSuggestionChip {
  id: string;
  permission: string;
  emoji: string;
  question: string;
}

/**
 * Catálogo de chips por role (doc 22). Ordem fixa — reflete a ordem de
 * prioridade de uso mais comum (funil → leads → análise → cobrança → chat).
 */
export const ASSISTANT_SUGGESTION_CHIPS: readonly AssistantSuggestionChip[] = [
  {
    id: 'dashboard',
    permission: 'dashboard:read',
    emoji: '📊',
    question: 'Métricas do funil dos últimos 30 dias',
  },
  {
    id: 'leads',
    permission: 'leads:read',
    emoji: '👥',
    question: 'Quantos leads novos entraram esta semana?',
  },
  {
    id: 'analyses',
    permission: 'analyses:read',
    emoji: '📋',
    question: 'Qual o status de análise de crédito de um lead?',
  },
  {
    id: 'billing',
    permission: 'billing:read',
    emoji: '💰',
    question: 'Quais as próximas cobranças?',
  },
  {
    id: 'livechat',
    permission: 'livechat:conversation:read',
    emoji: '💬',
    question: 'Resuma a conversa de um lead',
  },
] as const;

/**
 * Filtra o catálogo pelas permissões do usuário atual. Só aparece o chip cuja
 * permissão o usuário tem — usuários sem nenhuma dessas permissões recebem
 * lista vazia (o caller mostra uma mensagem honesta, sem chips).
 */
export function getAvailableAssistantChips(
  hasPermission: (permission: string) => boolean,
): AssistantSuggestionChip[] {
  return ASSISTANT_SUGGESTION_CHIPS.filter((chip) => hasPermission(chip.permission));
}
