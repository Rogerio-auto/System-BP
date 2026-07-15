// =============================================================================
// historyFormat.test.ts — Testes unitários da formatação de data da barra
// lateral de histórico do copiloto interno (F6-S29).
// =============================================================================

import { describe, expect, it } from 'vitest';

import { formatConversationDate } from '../historyFormat';

describe('formatConversationDate', () => {
  const now = new Date('2026-07-14T18:30:00.000Z');

  it('mesmo dia (mesmo instante) → HH:MM', () => {
    const result = formatConversationDate(now.toISOString(), now);
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  it('mesmo ano, dia diferente → DD/MM', () => {
    const sameYearDifferentDay = new Date(now);
    sameYearDifferentDay.setDate(sameYearDifferentDay.getDate() - 30);
    const result = formatConversationDate(sameYearDifferentDay.toISOString(), now);
    expect(result).toMatch(/^\d{2}\/\d{2}$/);
    expect(result).not.toMatch(/^\d{2}:\d{2}$/);
  });

  it('ano diferente → DD/MM/AAAA', () => {
    const previousYear = new Date(now);
    previousYear.setFullYear(previousYear.getFullYear() - 1);
    const result = formatConversationDate(previousYear.toISOString(), now);
    expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  it('data inválida → string vazia (defensivo, nunca "Invalid Date" na UI)', () => {
    expect(formatConversationDate('not-a-date', now)).toBe('');
  });
});
