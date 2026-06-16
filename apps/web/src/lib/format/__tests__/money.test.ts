// =============================================================================
// lib/format/__tests__/money.test.ts — Testes dos helpers de moeda (F18-S03).
//
// F18-S03 atualiza formatBRL para trabalhar em REAIS (não centavos).
// Helpers legados (formatBRLFromCents, parseBRLToCents etc.) mantidos por compat.
// =============================================================================

import { describe, it, expect } from 'vitest';

import {
  centsToEditable,
  centsToReais,
  formatBRL,
  formatBRLFromCents,
  formatBRLNumber,
  parseBRLInput,
  parseBRLToCents,
  reaisToCents,
} from '../money';

// Intl insere um espaço não-quebrável entre "R$" e o número em alguns ambientes.
// Removemos TODOS os espaços (\s casa nbsp) antes de comparar.
const stripWs = (s: string): string => s.replace(/\s/g, '');

// ─── formatBRL (em REAIS — semântica F18-S03) ─────────────────────────────────

describe('formatBRL — REAIS para string BRL (F18-S03)', () => {
  it('formatBRL(10000) retorna "R$ 10.000,00"', () => {
    expect(stripWs(formatBRL(10000))).toBe('R$10.000,00');
  });

  it('formatBRL(0) retorna "R$ 0,00"', () => {
    expect(stripWs(formatBRL(0))).toBe('R$0,00');
  });

  it('formatBRL(1) retorna "R$ 1,00" — confirma que é REAIS não centavos', () => {
    expect(stripWs(formatBRL(1))).toBe('R$1,00');
  });

  it('formatBRL(5000) retorna "R$ 5.000,00"', () => {
    expect(stripWs(formatBRL(5000))).toBe('R$5.000,00');
  });

  it('formatBRL(30000) retorna "R$ 30.000,00"', () => {
    expect(stripWs(formatBRL(30000))).toBe('R$30.000,00');
  });

  it('formatBRLNumber(10000) retorna "R$ 10.000,00" (alias semântico)', () => {
    expect(stripWs(formatBRLNumber(10000))).toBe('R$10.000,00');
  });
});

// ─── formatBRLFromCents (legado — centavos) ───────────────────────────────────

describe('formatBRLFromCents — centavos para string BRL (legado F13-S01)', () => {
  it('1000000 centavos vira R$ 10.000,00', () => {
    expect(stripWs(formatBRLFromCents(1000000))).toBe('R$10.000,00');
  });

  it('round-trip: parseBRLToCents("10000") = 1000000 → formatBRLFromCents → "R$ 10.000,00"', () => {
    const cents = parseBRLToCents('10000') ?? 0;
    expect(cents).toBe(1000000);
    expect(stripWs(formatBRLFromCents(cents))).toBe('R$10.000,00');
  });
});

// ─── parseBRLInput (retorna REAIS — F18-S03) ─────────────────────────────────

describe('parseBRLInput — regressão do bug x10 (F18-S03)', () => {
  it('parseBRLInput("10000") retorna 10000 reais (não 100000)', () => {
    expect(parseBRLInput('10000')).toBe(10000);
  });

  it('NÃO multiplica por 10 — não vira R$ 100.000,00', () => {
    expect(parseBRLInput('10000')).not.toBe(100000);
  });

  it('aceita decimal com vírgula', () => {
    expect(parseBRLInput('10000,50')).toBe(10000.5);
  });

  it('remove separador de milhar (ponto)', () => {
    expect(parseBRLInput('10.000,50')).toBe(10000.5);
  });

  it('aceita símbolo R$', () => {
    expect(parseBRLInput('R$ 10.000,00')).toBe(10000);
  });

  it('vazio retorna null', () => {
    expect(parseBRLInput('')).toBeNull();
  });

  it('só espaços retorna null', () => {
    expect(parseBRLInput('   ')).toBeNull();
  });

  it('texto inválido retorna null', () => {
    expect(parseBRLInput('abc')).toBeNull();
  });
});

// ─── parseBRLToCents (legado — retorna centavos) ─────────────────────────────

describe('parseBRLToCents — legado F13-S01 (ainda funcional)', () => {
  it('interpreta "10000" como R$ 10.000,00 (1000000 centavos)', () => {
    expect(parseBRLToCents('10000')).toBe(1000000);
  });

  it('NAO multiplica por 10 — nao vira R$ 100.000,00', () => {
    expect(parseBRLToCents('10000')).not.toBe(10000000);
  });

  it('aceita decimal com virgula', () => {
    expect(parseBRLToCents('10000,50')).toBe(1000050);
  });

  it('remove separador de milhar (ponto)', () => {
    expect(parseBRLToCents('10.000,50')).toBe(1000050);
  });

  it('vazio ou so espacos retorna null', () => {
    expect(parseBRLToCents('')).toBeNull();
    expect(parseBRLToCents('   ')).toBeNull();
  });

  it('texto invalido retorna null', () => {
    expect(parseBRLToCents('abc')).toBeNull();
  });
});

// ─── Conversões ───────────────────────────────────────────────────────────────

describe('conversoes', () => {
  it('centsToReais(1000000) vira 10000', () => {
    expect(centsToReais(1000000)).toBe(10000);
  });

  it('reaisToCents(10000) vira 1000000', () => {
    expect(reaisToCents(10000)).toBe(1000000);
  });

  it('centsToEditable inteiro vira "10000"', () => {
    expect(centsToEditable(1000000)).toBe('10000');
  });

  it('centsToEditable com centavos vira "10000,50"', () => {
    expect(centsToEditable(1000050)).toBe('10000,50');
  });
});
