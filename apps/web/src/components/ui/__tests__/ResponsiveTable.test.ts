// =============================================================================
// components/ui/__tests__/ResponsiveTable.test.ts — Testes de lógica pura.
//
// Estratégia: este projeto não tem JSDOM configurado em `vitest` (ver
// CurrencyInput.test.tsx) — por isso testamos apenas os helpers puros
// extraídos de responsive-table/types.ts (sem renderizar React/JSX).
//
// Cobertura:
//   1. hideBelowClassName: mapeia breakpoint -> classe Tailwind correta;
//      undefined quando nenhum breakpoint é informado (coluna sempre visível).
//   2. splitCardColumns: acha a coluna `primary` explícita ou cai para a 1ª;
//      remove a primária e as `hideInCard` do grupo `secondary`; preserva
//      ordem das demais.
// =============================================================================

import { describe, expect, it } from 'vitest';

import type { ResponsiveTableColumn } from '../responsive-table/types';
import { hideBelowClassName, splitCardColumns } from '../responsive-table/types';

// ─── hideBelowClassName ─────────────────────────────────────────────────────

describe('hideBelowClassName', () => {
  it('retorna undefined quando nenhum breakpoint é informado (coluna sempre visível)', () => {
    expect(hideBelowClassName(undefined)).toBeUndefined();
  });

  it('mapeia "md" para "hidden md:table-cell"', () => {
    expect(hideBelowClassName('md')).toBe('hidden md:table-cell');
  });

  it('mapeia "lg" para "hidden lg:table-cell"', () => {
    expect(hideBelowClassName('lg')).toBe('hidden lg:table-cell');
  });

  it('mapeia "xl" para "hidden xl:table-cell"', () => {
    expect(hideBelowClassName('xl')).toBe('hidden xl:table-cell');
  });
});

// ─── splitCardColumns ────────────────────────────────────────────────────────

interface Row {
  id: string;
  name: string;
}

function col(
  overrides: Partial<ResponsiveTableColumn<Row>> & { key: string },
): ResponsiveTableColumn<Row> {
  return {
    header: overrides.key,
    cell: (row) => row.name,
    ...overrides,
  };
}

describe('splitCardColumns', () => {
  it('usa a coluna marcada `primary: true`, mesmo que não seja a primeira', () => {
    const columns = [col({ key: 'a' }), col({ key: 'b', primary: true }), col({ key: 'c' })];
    const { primary, secondary } = splitCardColumns(columns);
    expect(primary?.key).toBe('b');
    expect(secondary.map((c) => c.key)).toEqual(['a', 'c']);
  });

  it('cai para a 1ª coluna quando nenhuma é marcada `primary`', () => {
    const columns = [col({ key: 'a' }), col({ key: 'b' }), col({ key: 'c' })];
    const { primary, secondary } = splitCardColumns(columns);
    expect(primary?.key).toBe('a');
    expect(secondary.map((c) => c.key)).toEqual(['b', 'c']);
  });

  it('remove colunas `hideInCard: true` do grupo secundário', () => {
    const columns = [
      col({ key: 'a', primary: true }),
      col({ key: 'b', hideInCard: true }),
      col({ key: 'c' }),
    ];
    const { secondary } = splitCardColumns(columns);
    expect(secondary.map((c) => c.key)).toEqual(['c']);
  });

  it('retorna primary undefined e secondary vazio para lista de colunas vazia', () => {
    const { primary, secondary } = splitCardColumns<Row>([]);
    expect(primary).toBeUndefined();
    expect(secondary).toEqual([]);
  });

  it('preserva a ordem original das colunas secundárias', () => {
    const columns = [
      col({ key: 'a', primary: true }),
      col({ key: 'z' }),
      col({ key: 'm' }),
      col({ key: 'b' }),
    ];
    const { secondary } = splitCardColumns(columns);
    expect(secondary.map((c) => c.key)).toEqual(['z', 'm', 'b']);
  });
});
