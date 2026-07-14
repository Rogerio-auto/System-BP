// =============================================================================
// blocks/__tests__/format.test.ts — Testes unitários dos formatadores locais
// dos cards de bloco do copiloto interno (F6-S22).
// =============================================================================

import { describe, expect, it } from 'vitest';

import { formatDateBR, formatDwellHours, formatPercent, formatTimeBR } from '../format';

describe('formatDateBR', () => {
  it('formata ISO para dd/mm/aaaa', () => {
    expect(formatDateBR('2026-07-10T12:00:00Z')).toBe('10/07/2026');
  });

  it('retorna — para data inválida', () => {
    expect(formatDateBR('não-é-data')).toBe('—');
  });
});

describe('formatTimeBR', () => {
  it('retorna — para data inválida', () => {
    expect(formatTimeBR('não-é-data')).toBe('—');
  });
});

describe('formatDwellHours', () => {
  it('retorna — para null', () => {
    expect(formatDwellHours(null)).toBe('—');
  });

  it('formata número com sufixo h', () => {
    expect(formatDwellHours(12.5)).toBe('12,5h');
  });

  it('formata inteiro sem casas decimais desnecessárias', () => {
    expect(formatDwellHours(10)).toBe('10h');
  });
});

describe('formatPercent', () => {
  it('formata taxa já em escala 0-100', () => {
    expect(formatPercent(66.67)).toBe('66,7%');
  });

  it('formata zero', () => {
    expect(formatPercent(0)).toBe('0%');
  });
});
