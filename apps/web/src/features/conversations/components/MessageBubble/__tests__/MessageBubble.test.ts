// =============================================================================
// MessageBubble/__tests__/MessageBubble.test.ts — Testes unitários (F16-S17).
//
// Valida:
//   - formatBubbleTime: formatação de horários de mensagem
//   - formatDaySeparator: formatação de separadores de dia
//   - isDifferentDay: detecção de mudança de dia
//
// Nota: testes de renderização React são deixados para E2E / Storybook.
// Aqui validamos apenas a lógica pura das utils.
// =============================================================================

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { formatBubbleTime, formatDaySeparator, isDifferentDay } from '../utils';

// ─── Mock de data fixa ────────────────────────────────────────────────────────

const FIXED_NOW = new Date('2026-06-16T14:30:00.000Z');

beforeEach(() => {
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── formatBubbleTime ─────────────────────────────────────────────────────────

describe('formatBubbleTime', () => {
  it('retorna string vazia para ISO inválida', () => {
    expect(formatBubbleTime('not-a-date')).toBe('');
  });

  it('retorna apenas horário para mensagens de hoje', () => {
    const todayIso = '2026-06-16T10:00:00.000Z';
    const result = formatBubbleTime(todayIso);
    // Deve conter ":" (HH:MM), sem data
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  it('inclui "ontem" para mensagens de ontem', () => {
    const yesterdayIso = '2026-06-15T08:00:00.000Z';
    const result = formatBubbleTime(yesterdayIso);
    expect(result).toContain('ontem');
  });

  it('retorna data curta para mensagens mais antigas', () => {
    const oldIso = '2026-06-01T08:00:00.000Z';
    const result = formatBubbleTime(oldIso);
    // Deve conter "/" (formato pt-BR DD/MM)
    expect(result).toContain('/');
    // Não deve conter "ontem" nem só horário
    expect(result).not.toContain('ontem');
  });
});

// ─── formatDaySeparator ───────────────────────────────────────────────────────

describe('formatDaySeparator', () => {
  it('retorna "Hoje" para data de hoje', () => {
    const todayIso = '2026-06-16T12:00:00.000Z';
    expect(formatDaySeparator(todayIso)).toBe('Hoje');
  });

  it('retorna "Ontem" para data de ontem', () => {
    const yesterdayIso = '2026-06-15T12:00:00.000Z';
    expect(formatDaySeparator(yesterdayIso)).toBe('Ontem');
  });

  it('retorna data formatada para datas mais antigas', () => {
    const oldIso = '2026-06-01T12:00:00.000Z';
    const result = formatDaySeparator(oldIso);
    expect(result).toContain('01');
    expect(result).toContain('06');
    expect(result).toContain('2026');
  });

  it('retorna string vazia para ISO inválida', () => {
    expect(formatDaySeparator('invalid')).toBe('');
  });
});

// ─── isDifferentDay ───────────────────────────────────────────────────────────

describe('isDifferentDay', () => {
  it('retorna false para mensagens no mesmo dia', () => {
    expect(isDifferentDay('2026-06-16T08:00:00Z', '2026-06-16T23:59:00Z')).toBe(false);
  });

  it('retorna true para mensagens em dias diferentes (separação de 24h)', () => {
    // Usa datas claramente em dias diferentes (mais de 24h de distância)
    // para evitar ambiguidade de timezone UTC vs local.
    expect(isDifferentDay('2026-06-14T12:00:00Z', '2026-06-16T12:00:00Z')).toBe(true);
  });

  it('retorna true para mesmo horário em meses diferentes', () => {
    expect(isDifferentDay('2026-05-31T12:00:00Z', '2026-06-01T12:00:00Z')).toBe(true);
  });

  it('retorna true para mesmo dia/mês em anos diferentes', () => {
    expect(isDifferentDay('2025-06-16T12:00:00Z', '2026-06-16T12:00:00Z')).toBe(true);
  });
});
