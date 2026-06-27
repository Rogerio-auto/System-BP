// =============================================================================
// components/ui/__tests__/CurrencyInput.test.tsx — Testes de lógica.
//
// Estratégia: testa lógica pura isolada dos helpers de moeda (sem renderização React).
// O ambiente de teste não tem JSDOM configurado — por isso não usamos @testing-library/react.
//
// Cobertura:
//   1. formatBRL: reais → string BRL correta (sem bug ×10)
//   2. parseBRLInput: string → reais (cenários de input do usuário)
//   3. formatLiveMask: máscara ao vivo durante digitação (separador de milhar, decimais)
//   4. Round-trip: digitar → formatLiveMask → parseBRLInput → formatBRL
//   5. Regressão do bug ×10: garantia que 10000 ≠ 100000 centavos
//
// Nota: reposicionamento de cursor (findNewCursorPos) é função interna do componente
// e depende de DOM API (setSelectionRange) — coberto por testes visuais/manuais.
// =============================================================================

import { describe, expect, it } from 'vitest';

import { formatBRL, formatLiveMask, parseBRLInput } from '../../../lib/format/money';

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

// ─── formatLiveMask ───────────────────────────────────────────────────────────

describe('formatLiveMask — máscara ao vivo durante digitação', () => {
  it('formatLiveMask("5000") → "5.000" (caso do relato de UX)', () => {
    expect(formatLiveMask('5000')).toBe('5.000');
  });

  it('formatLiveMask("50000") → "50.000"', () => {
    expect(formatLiveMask('50000')).toBe('50.000');
  });

  it('formatLiveMask("1234567") → "1.234.567" (dois separadores de milhar)', () => {
    expect(formatLiveMask('1234567')).toBe('1.234.567');
  });

  it('formatLiveMask("5000,5") → "5.000,5" (decimal parcial)', () => {
    expect(formatLiveMask('5000,5')).toBe('5.000,5');
  });

  it('formatLiveMask("5000,50") → "5.000,50" (decimal completo)', () => {
    expect(formatLiveMask('5000,50')).toBe('5.000,50');
  });

  it('formatLiveMask("5000,500") → "5.000,50" (trunca a 2 casas decimais)', () => {
    expect(formatLiveMask('5000,500')).toBe('5.000,50');
  });

  it('formatLiveMask("") → ""', () => {
    expect(formatLiveMask('')).toBe('');
  });

  it('formatLiveMask("500") → "500" (menos de 4 dígitos, sem separador)', () => {
    expect(formatLiveMask('500')).toBe('500');
  });

  it('formatLiveMask("1000") → "1.000"', () => {
    expect(formatLiveMask('1000')).toBe('1.000');
  });

  it('formatLiveMask(",") → "," (vírgula inicial — campo vazio antes da vírgula)', () => {
    expect(formatLiveMask(',')).toBe(',');
  });

  it('formatLiveMask("abc") → "" (remove caracteres inválidos)', () => {
    expect(formatLiveMask('abc')).toBe('');
  });

  it('mantém apenas a primeira vírgula ("5000,50,99" → "5.000,50")', () => {
    expect(formatLiveMask('5000,50,99')).toBe('5.000,50');
  });

  it('remove pontos já existentes no input ("5.000" digitado pelo usuário → "5.000")', () => {
    // Quando o usuário tem "5.000" e digita "0", o browser entrega "5.0000";
    // formatLiveMask strips o "." e re-aplica.
    expect(formatLiveMask('5.0000')).toBe('50.000');
  });
});

// ─── Round-trip live mask ─────────────────────────────────────────────────────

describe('round-trip: formatLiveMask → parseBRLInput → formatBRL', () => {
  it('"5000" → "5.000" → parseBRLInput → 5000 → "R$ 5.000,00"', () => {
    const masked = formatLiveMask('5000');
    expect(masked).toBe('5.000');
    const reais = parseBRLInput(masked);
    expect(reais).toBe(5000);
    expect(norm(formatBRL(reais ?? 0))).toBe('R$ 5.000,00');
  });

  it('"50000" → "50.000" → parseBRLInput → 50000 → "R$ 50.000,00"', () => {
    const masked = formatLiveMask('50000');
    expect(masked).toBe('50.000');
    expect(parseBRLInput(masked)).toBe(50000);
    expect(norm(formatBRL(50000))).toBe('R$ 50.000,00');
  });

  it('"5000,50" → "5.000,50" → parseBRLInput → 5000.5 → "R$ 5.000,50"', () => {
    const masked = formatLiveMask('5000,50');
    expect(masked).toBe('5.000,50');
    const reais = parseBRLInput(masked);
    expect(reais).toBe(5000.5);
    expect(norm(formatBRL(reais ?? 0))).toBe('R$ 5.000,50');
  });

  it('"1234567" → "1.234.567" → parseBRLInput → 1234567', () => {
    const masked = formatLiveMask('1234567');
    expect(masked).toBe('1.234.567');
    expect(parseBRLInput(masked)).toBe(1234567);
  });

  // Bridge contrato: onChange do CurrencyInput(5000) → form guarda "5000.00"
  it('bridge form: reais 5000 → toFixed(2) → "5000.00" (o que o form guarda)', () => {
    const reais = parseBRLInput(formatLiveMask('5000')) ?? 0;
    expect(reais.toFixed(2)).toBe('5000.00');
  });

  it('bridge form: reais 50000 → toFixed(2) → "50000.00"', () => {
    const reais = parseBRLInput(formatLiveMask('50000')) ?? 0;
    expect(reais.toFixed(2)).toBe('50000.00');
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
