// =============================================================================
// lib/format/money.ts — Helpers canônicos de moeda (BRL) — F13-S01.
//
// Representação interna: CENTAVOS inteiros (decisão D5 do planejamento) — nunca
// float em reais, evitando erros de ponto flutuante.
//
// Convenção de digitação (corrige o bug ×10): o usuário digita o valor em
// REAIS. Ex: digitar "10000" → R$ 10.000,00 (e NÃO R$ 100.000,00).
// =============================================================================

/**
 * Formata centavos inteiros para BRL.
 * formatBRL(1000000) → "R$ 10.000,00"
 */
export function formatBRL(valueInCents: number): string {
  return (valueInCents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

/**
 * Formata um valor já em REAIS (ex: vindo da API como numeric) para BRL.
 * formatBRLNumber(10000) → "R$ 10.000,00"
 */
export function formatBRLNumber(reais: number): string {
  return reais.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

/**
 * Converte um texto digitado/mascarado em CENTAVOS inteiros.
 *
 * Regras:
 *   - O número digitado é interpretado em REAIS (vírgula = separador decimal,
 *     ponto = separador de milhar, convenção pt-BR).
 *   - "10000"      → 1000000 centavos (R$ 10.000,00)
 *   - "10.000,50"  → 1000050 centavos
 *   - "1234,5"     → 123450 centavos
 *   - ""           → null
 *
 * @returns centavos inteiros, ou null se vazio/ inválido.
 */
export function parseBRLToCents(masked: string): number | null {
  if (masked === undefined || masked === null) return null;
  const trimmed = masked.trim();
  if (trimmed === '') return null;

  // Mantém apenas dígitos, vírgula e ponto.
  let s = trimmed.replace(/[^\d,.]/g, '');
  if (s === '') return null;

  // pt-BR: ponto = milhar (removido), vírgula = decimal (→ ponto).
  s = s.replace(/\./g, '').replace(',', '.');

  const reais = Number.parseFloat(s);
  if (Number.isNaN(reais)) return null;

  return Math.round(reais * 100);
}

/** Converte centavos inteiros para reais (number). 1000000 → 10000 */
export function centsToReais(cents: number): number {
  return cents / 100;
}

/** Converte reais (number) para centavos inteiros. 10000 → 1000000 */
export function reaisToCents(reais: number): number {
  return Math.round(reais * 100);
}

/**
 * Representação "editável" (sem R$ nem separador de milhar) de um valor em
 * centavos — usada enquanto o campo está em foco.
 * 1000000 → "10000"  |  1000050 → "10000,50"
 */
export function centsToEditable(cents: number): string {
  const reais = cents / 100;
  return Number.isInteger(reais) ? String(reais) : reais.toFixed(2).replace('.', ',');
}
