import { describe, it, expect } from 'vitest';

import {
  centsToEditable,
  centsToReais,
  formatBRL,
  formatBRLNumber,
  parseBRLToCents,
  reaisToCents,
} from '../money';

// Intl insere um espaco nao-quebravel entre "R$" e o numero. Removemos TODO
// espaco (\s casa o nbsp) antes de comparar, evitando dependencia do char.
const stripWs = (s: string): string => s.replace(/\s/g, '');

describe('money helpers', () => {
  describe('parseBRLToCents — regressao do bug x10 (item 3)', () => {
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

  describe('formatBRL / formatBRLNumber', () => {
    it('1000000 centavos vira R$ 10.000,00', () => {
      expect(stripWs(formatBRL(1000000))).toBe('R$10.000,00');
    });

    it('formatBRLNumber(10000) reais vira R$ 10.000,00', () => {
      expect(stripWs(formatBRLNumber(10000))).toBe('R$10.000,00');
    });

    it('round-trip: digitar "10000" e formatar vira R$ 10.000,00', () => {
      const cents = parseBRLToCents('10000') ?? 0;
      expect(cents).toBe(1000000);
      expect(stripWs(formatBRL(cents))).toBe('R$10.000,00');
    });
  });

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
});
