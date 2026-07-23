// =============================================================================
// features/quick-replies/admin/reorder.ts — Lógica pura de reordenação
// (F28-S07, doc 25 §11.2 — "campo de ordem" como alternativa a drag-and-drop).
//
// A reordenação por PATCH /api/quick-replies/reorder só aceita registros de
// visibility='organization' sem owner (repository.ts filtra
// `isNull(quickReplies.ownerUserId)`) e exige `manage` — por isso só é
// oferecida na aba "Organização" para quem tem a permissão.
// =============================================================================
import type { QuickReplyReorderItem } from '../types';

/** Move um item de `fromIndex` para `toIndex`, preservando a ordem dos demais. */
export function moveItem<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return [...items];
  }
  const copy = [...items];
  const moved = copy.splice(fromIndex, 1)[0];
  if (moved === undefined) return copy;
  copy.splice(toIndex, 0, moved);
  return copy;
}

/** Converte a ordem visual (array de ids) no payload de PATCH /reorder (0-based). */
export function toReorderPatch(orderedIds: readonly string[]): QuickReplyReorderItem[] {
  return orderedIds.map((id, index) => ({ id, sortOrder: index }));
}
