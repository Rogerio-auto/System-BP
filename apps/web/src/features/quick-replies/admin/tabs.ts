// =============================================================================
// features/quick-replies/admin/tabs.ts — Tipo compartilhado das abas do admin
// (F28-S07, doc 25 §11.2 — "Organização | Minhas").
// =============================================================================

/** Aba ativa na tela de administração — mapeia 1:1 para `QuickReplyVisibility`. */
export type QuickReplyTab = 'organization' | 'personal';
