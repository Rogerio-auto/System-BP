// =============================================================================
// features/quick-replies/admin/__tests__/reorder.test.ts
// =============================================================================
import { describe, expect, it } from 'vitest';

import { moveItem, toReorderPatch } from '../reorder';

describe('moveItem', () => {
  it('move um item para cima', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('move um item para baixo', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });

  it('índice igual não altera a ordem (nova referência)', () => {
    const input = ['a', 'b', 'c'];
    const result = moveItem(input, 1, 1);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });

  it('índice fora dos limites retorna cópia inalterada', () => {
    expect(moveItem(['a', 'b'], -1, 1)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
  });

  it('não muta o array original', () => {
    const input = ['a', 'b', 'c'];
    moveItem(input, 0, 2);
    expect(input).toEqual(['a', 'b', 'c']);
  });
});

describe('toReorderPatch', () => {
  it('converte ids ordenados em sortOrder 0-based sequencial', () => {
    expect(toReorderPatch(['x', 'y', 'z'])).toEqual([
      { id: 'x', sortOrder: 0 },
      { id: 'y', sortOrder: 1 },
      { id: 'z', sortOrder: 2 },
    ]);
  });

  it('lista vazia retorna array vazio', () => {
    expect(toReorderPatch([])).toEqual([]);
  });
});
