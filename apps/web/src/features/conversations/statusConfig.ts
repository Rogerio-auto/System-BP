// =============================================================================
// features/conversations/statusConfig.ts — Configuração canônica de status (F16 UI).
//
// Fonte única de verdade para rótulos e cores dos 4 status de conversa.
// Importado por ChatListFilters (abas) e ContactPanel (controle de status).
//
// Cores: open/pending/snoozed usam valores semânticos compatíveis com light+dark;
// resolved usa var(--brand-azul) (token do DS).
//
// NUNCA duplicar essa paleta em componentes — sempre importar daqui.
// =============================================================================

import type { ConversationStatus } from './types';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface StatusMeta {
  /** Rótulo em português exibido na UI */
  readonly label: string;
  /**
   * Cor canônica do status.
   * open/pending/snoozed: hex contextual (sem equivalente no DS de marca).
   * resolved: var(--brand-azul) (token DS).
   */
  readonly color: string;
}

// ---------------------------------------------------------------------------
// Mapa de configuração
// ---------------------------------------------------------------------------

export const STATUS_CONFIG: Record<ConversationStatus, StatusMeta> = {
  open: { label: 'Aberta', color: '#16a34a' },
  pending: { label: 'Pendente', color: '#d97706' },
  resolved: { label: 'Resolvida', color: 'var(--brand-azul)' },
  snoozed: { label: 'Adiada', color: '#7c3aed' },
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Retorna o rótulo de um status, com fallback seguro. */
export function getStatusLabel(status: ConversationStatus): string {
  return STATUS_CONFIG[status]?.label ?? status;
}

/** Retorna a cor de um status, com fallback seguro. */
export function getStatusColor(status: ConversationStatus): string {
  return STATUS_CONFIG[status]?.color ?? 'var(--text-3)';
}
