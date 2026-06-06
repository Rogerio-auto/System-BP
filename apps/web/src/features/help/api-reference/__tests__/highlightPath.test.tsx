// =============================================================================
// __tests__/highlightPath.test.tsx — Testes do helper HighlightedPath
// =============================================================================

import { describe, expect, it } from 'vitest';

import { parsePath } from '../highlightPath';

describe('parsePath', () => {
  it('retorna segmento único para path sem variáveis', () => {
    const result = parsePath('/leads');
    expect(result).toEqual([{ text: '/leads', isVar: false }]);
  });

  it('destaca variável :param no estilo Express', () => {
    const result = parsePath('/leads/:id');
    expect(result).toEqual([
      { text: '/leads/', isVar: false },
      { text: ':id', isVar: true },
    ]);
  });

  it('destaca variável {param} no estilo OpenAPI', () => {
    const result = parsePath('/leads/{id}');
    expect(result).toEqual([
      { text: '/leads/', isVar: false },
      { text: ':id', isVar: true },
    ]);
  });

  it('destaca múltiplas variáveis no mesmo path', () => {
    const result = parsePath('/leads/:id/cards/:cardId');
    expect(result).toEqual([
      { text: '/leads/', isVar: false },
      { text: ':id', isVar: true },
      { text: '/cards/', isVar: false },
      { text: ':cardId', isVar: true },
    ]);
  });

  it('retorna array vazio para path vazio', () => {
    const result = parsePath('');
    expect(result).toEqual([]);
  });

  it('trata underscore e números em nomes de variáveis', () => {
    const result = parsePath('/items/:item_id_123');
    expect(result).toEqual([
      { text: '/items/', isVar: false },
      { text: ':item_id_123', isVar: true },
    ]);
  });

  it('prefixo simples sem variáveis retorna inteiro', () => {
    const result = parsePath('/api/v1/leads');
    expect(result).toEqual([{ text: '/api/v1/leads', isVar: false }]);
  });
});
