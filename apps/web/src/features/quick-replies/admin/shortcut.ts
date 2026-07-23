// =============================================================================
// features/quick-replies/admin/shortcut.ts — Sanitização do atalho digitado
// (F28-S07).
//
// Espelha o CHECK do banco / QUICK_REPLY_SHORTCUT_REGEX de
// @elemento/shared-schemas: minúsculo, 1-32 chars, começa por letra/dígito,
// só [a-z0-9_-] depois. Não substitui a validação Zod do form (que continua
// sendo a fonte de verdade) — só evita que o gestor precise digitar
// manualmente em minúsculas/sem acento.
// =============================================================================

/** Normaliza um valor digitado para o formato aceito por `quickReplyShortcutSchema`. */
export function sanitizeShortcutInput(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '') // só [a-z0-9_-]
    .replace(/^[-_]+/, '') // não pode começar por - ou _
    .slice(0, 32);
}
