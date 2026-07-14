// =============================================================================
// features/assistant/blocks/variantColors.ts — Mapa de BadgeVariant → CSS var
// de cor (mesmo vocabulário de components/ui/Badge.tsx), usado para tingir o
// ícone de 44×44 no header dos cards de bloco (DS §9.3).
// =============================================================================

import type { BadgeVariant } from '../../../components/ui/Badge';

/** Cor sólida (texto/ícone) por variante — espelha Badge.tsx `textColors`. */
export const BLOCK_VARIANT_COLOR: Record<BadgeVariant, string> = {
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)',
  neutral: 'var(--text-3)',
};
