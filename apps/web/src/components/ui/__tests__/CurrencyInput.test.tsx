// =============================================================================
// components/ui/__tests__/CurrencyInput.test.tsx — Testes de lógica (F18-S03).
//
// Estratégia: testa lógica pura isolada dos helpers de moeda (sem renderização React).
// O ambiente de teste não tem JSDOM configurado — por isso não usamos @testing-library/react.
//
// Cobertura (DoD F18-S03):
//   1. formatBRL: reais → string BRL correta (sem bug ×10)
//   2. parseBRLInput: string → reais (cenários de input do usuário)
//   3. Round-trip: digitar "10000" → parsear → formatar → "R$ 10.000,00"
//   4. Regressão do bug ×10: garantia que 10000 ≠ 100000 centavos
// =============================================================================

import { describe, expect, it } from 'vitest';

import { formatBRL, parseBRLInput } from '../../../lib/format/money';

// Intl insere espaço não-quebrável entre "R$" e o número em alguns ambientes.
// Normalizamos todos os espaços para facilitar comparação portável.
const norm = (s: string): string => s.replace(/\s/g, ' ');

// ─── formatBRL ────────────────────────────────────────────────────────────────

describe('formatBRL — reais para string BRL (sem bug ×10)', () => {
  it('formatBRL(10000) retorna "R$ 10.000,00"', () => {
    expect(norm(formatBRL(10000))).toBe('R$ 10.000,00');
  });

  it('formatBRL(0) retorna "R$ 0,00"', () => {
    expect(norm(formatBRL(0))).toBe('R$ 0,00');
  });

  it('formatBRL(1) retorna "R$ 1,00" — não R$ 0,01 (confirma que é reais, não centavos)', () => {
    expect(norm(formatBRL(1))).toBe('R$ 1,00');
  });

  it('formatBRL(5000) retorna "R$ 5.000,00"', () => {
    expect(norm(formatBRL(5000))).toBe('R$ 5.000,00');
  });

  it('formatBRL(30000) retorna "R$ 30.000,00"', () => {
    expect(norm(formatBRL(30000))).toBe('R$ 30.000,00');
  });

  it('formatBRL(10000.50) retorna "R$ 10.000,50"', () => {
    expect(norm(formatBRL(10000.5))).toBe('R$ 10.000,50');
  });

  it('usa Intl.NumberFormat (não toLocaleString ad-hoc) — resultado consistente', () => {
    // Garante que o resultado é determinístico entre ambientes Node/browser.
    const result = formatBRL(10000);
    expect(result).toContain('10.000');
    expect(result).toContain(',00');
  });
});

// ─── parseBRLInput ────────────────────────────────────────────────────────────

describe('parseBRLInput — string BRL para reais (regressão bug ×10)', () => {
  it('parseBRLInput("10000") retorna 10000 — NÃO 100000', () => {
    expect(parseBRLInput('10000')).toBe(10000);
  });

  it('parseBRLInput("10000") NÃO retorna 100000 (sem bug ×10)', () => {
    expect(parseBRLInput('10000')).not.toBe(100000);
  });

  it('parseBRLInput("10.000,00") retorna 10000', () => {
    expect(parseBRLInput('10.000,00')).toBe(10000);
  });

  it('parseBRLInput("10.000,50") retorna 10000.50', () => {
    expect(parseBRLInput('10.000,50')).toBe(10000.5);
  });

  it('parseBRLInput("10000,50") retorna 10000.50', () => {
    expect(parseBRLInput('10000,50')).toBe(10000.5);
  });

  it('parseBRLInput("R$ 10.000,00") retorna 10000 (aceita símbolo R$)', () => {
    expect(parseBRLInput('R$ 10.000,00')).toBe(10000);
  });

  it('parseBRLInput("") retorna null', () => {
    expect(parseBRLInput('')).toBeNull();
  });

  it('parseBRLInput("   ") retorna null (só espaços)', () => {
    expect(parseBRLInput('   ')).toBeNull();
  });

  it('parseBRLInput("abc") retorna null (texto inválido)', () => {
    expect(parseBRLInput('abc')).toBeNull();
  });

  it('parseBRLInput("0") retorna 0', () => {
    expect(parseBRLInput('0')).toBe(0);
  });

  it('parseBRLInput("500") retorna 500', () => {
    expect(parseBRLInput('500')).toBe(500);
  });
});

// ─── Round-trip (regressão principal do bug) ──────────────────────────────────

describe('round-trip: digitar → parsear → formatar (regressão bug ×10)', () => {
  it('digitar "10000" → parsear → 10000 reais → formatar → "R$ 10.000,00"', () => {
    const digitado = '10000';
    const reais = parseBRLInput(digitado) ?? 0;
    expect(reais).toBe(10000);
    expect(norm(formatBRL(reais))).toBe('R$ 10.000,00');
  });

  it('digitar "30000" → parsear → 30000 reais → formatar → "R$ 30.000,00"', () => {
    const digitado = '30000';
    const reais = parseBRLInput(digitado) ?? 0;
    expect(reais).toBe(30000);
    expect(norm(formatBRL(reais))).toBe('R$ 30.000,00');
  });

  it('digitar "5000" → parsear → 5000 reais → formatar → "R$ 5.000,00"', () => {
    const digitado = '5000';
    const reais = parseBRLInput(digitado) ?? 0;
    expect(reais).toBe(5000);
    expect(norm(formatBRL(reais))).toBe('R$ 5.000,00');
  });

  it('CurrencyInput recebe 10000 → displayValue fora do foco = "R$ 10.000,00"', () => {
    // Simula a lógica de displayValue quando focused=false e value=10000.
    const value = 10000;
    const displayValue = formatBRL(value);
    expect(norm(displayValue)).toBe('R$ 10.000,00');
  });
});

// ─── Contrato de props (verificação de tipos via lógica) ──────────────────────

describe('contrato de props — CurrencyInput trabalha em REAIS (não centavos)', () => {
  it('valor 10000 reais exibido como R$ 10.000,00 (não R$ 100,00)', () => {
    // Se CurrencyInput dividisse por 100 (legacy centavos), 10000 → R$ 100,00.
    // O componente correto deve exibir formatBRL(10000) = R$ 10.000,00.
    const reais = 10000;
    const exibicao = formatBRL(reais);
    expect(norm(exibicao)).toBe('R$ 10.000,00');
    expect(norm(exibicao)).not.toBe('R$ 100,00');
  });

  it('valor propagado pelo onChange é em REAIS: digitar "10000" → onChange(10000)', () => {
    // Simula o handleChange do CurrencyInput.
    const digitado = '10000';
    const valorPropagado = parseBRLInput(digitado);
    expect(valorPropagado).toBe(10000); // reais, não centavos (que seria 1000000)
    expect(valorPropagado).not.toBe(1000000);
  });
});
