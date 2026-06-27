// =============================================================================
// lib/format/money.ts — Helpers canônicos de moeda (BRL) — F18-S03.
//
// DECISÃO D5 (revisada F18-S03):
//   Representação interna: REAIS como number (float arredondado a 2 casas).
//   Exibição: Intl.NumberFormat('pt-BR') — fonte única de verdade. SEM toLocaleString ad-hoc.
//
// REGRA DE ENTRADA NO CurrencyInput:
//   O usuário digita o valor em reais. Ex: "10000" → R$ 10.000,00 (NÃO R$ 100.000,00).
//   Separador de milhar = ponto (pt-BR). Separador decimal = vírgula.
// =============================================================================

/**
 * Formata um valor em REAIS para string BRL.
 * Fonte única de verdade para exibição — usa Intl.NumberFormat (não toLocaleString ad-hoc).
 *
 * formatBRL(10000)    → "R$ 10.000,00"
 * formatBRL(10000.50) → "R$ 10.000,50"
 * formatBRL(0)        → "R$ 0,00"
 */
export function formatBRL(reais: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(reais);
}

/**
 * Parseia um texto de input BRL para number em REAIS.
 * Aceita o que o usuário digita (com ou sem máscara).
 *
 * Regras:
 *   - Remove R$, espaços e pontos (separadores de milhar em pt-BR).
 *   - Troca vírgula decimal por ponto.
 *   - "10000"      → 10000    (R$ 10.000,00)
 *   - "10.000,50"  → 10000.50 (R$ 10.000,50)
 *   - "10000,50"   → 10000.50
 *   - ""           → null
 *   - texto inválido → null
 *
 * @returns reais como number arredondado a 2 casas, ou null se vazio/inválido.
 */
export function parseBRLInput(raw: string): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  // Remove símbolo, espaços e separadores de milhar (ponto em pt-BR).
  let s = trimmed
    .replace(/[R$\s]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');

  if (s === '' || s === '-') return null;

  const n = parseFloat(s);
  if (isNaN(n)) return null;

  // Arredonda a 2 casas decimais para evitar problemas de float.
  return Math.round(n * 100) / 100;
}

// ─── Máscara ao vivo ──────────────────────────────────────────────────────────

/**
 * Aplica máscara de milhar ao texto enquanto o usuário digita.
 * Aceita apenas dígitos e UMA vírgula decimal (máximo 2 casas).
 * NÃO adiciona "R$" — exclusivo para o estado focado do CurrencyInput.
 *
 * formatLiveMask("5000")    → "5.000"
 * formatLiveMask("50000")   → "50.000"
 * formatLiveMask("1234567") → "1.234.567"
 * formatLiveMask("5000,5")  → "5.000,5"
 * formatLiveMask("5000,50") → "5.000,50"
 * formatLiveMask("")        → ""
 */
export function formatLiveMask(raw: string): string {
  // Remove tudo que não é dígito nem vírgula
  const onlyDigitsAndComma = raw.replace(/[^\d,]/g, '');
  const commaIdx = onlyDigitsAndComma.indexOf(',');

  let intPart: string;
  let decPart: string | undefined;

  if (commaIdx >= 0) {
    intPart = onlyDigitsAndComma.slice(0, commaIdx);
    // Máximo 2 casas decimais; descarta vírgulas extras que porventura sobrem
    decPart = onlyDigitsAndComma
      .slice(commaIdx + 1)
      .replace(/[^\d]/g, '')
      .slice(0, 2);
  } else {
    intPart = onlyDigitsAndComma;
    decPart = undefined;
  }

  // Insere pontos de milhar na parte inteira
  const formattedInt = intPart.length > 0 ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : '';

  return decPart !== undefined ? `${formattedInt},${decPart}` : formattedInt;
}

// ─── Helpers legados — mantidos por backward-compat com testes existentes ─────

/**
 * @deprecated Usar formatBRL(reais) diretamente.
 * Formata centavos inteiros para BRL (legado de F13-S01).
 * formatBRLFromCents(1000000) → "R$ 10.000,00"
 */
export function formatBRLFromCents(valueInCents: number): string {
  return formatBRL(valueInCents / 100);
}

/**
 * Formata um valor em REAIS (alias semântico — mantém compat com F13-S01).
 * formatBRLNumber(10000) → "R$ 10.000,00"
 */
export function formatBRLNumber(reais: number): string {
  return formatBRL(reais);
}

/**
 * Converte um texto digitado/mascarado em CENTAVOS inteiros (legado F13-S01).
 * Preferir parseBRLInput() que retorna reais.
 *
 * "10000"      → 1000000 centavos (R$ 10.000,00)
 * "10.000,50"  → 1000050 centavos
 */
export function parseBRLToCents(masked: string): number | null {
  const reais = parseBRLInput(masked);
  if (reais === null) return null;
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
 * centavos — usada enquanto o campo está em foco (legado F13-S01).
 * 1000000 → "10000"  |  1000050 → "10000,50"
 */
export function centsToEditable(cents: number): string {
  const reais = cents / 100;
  return Number.isInteger(reais) ? String(reais) : reais.toFixed(2).replace('.', ',');
}
