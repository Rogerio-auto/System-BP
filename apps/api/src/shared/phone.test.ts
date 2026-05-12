// =============================================================================
// Testes unitários: normalizePhone()
// Função pura — sem dependências externas, sem mocks necessários.
// Cobre: E.164 brasileiro (celular/fixo), internacional, vazio, lixo,
//        número sem máscara, número já normalizado, fixo 8 dígitos.
// =============================================================================
import { describe, expect, it } from 'vitest';

import { normalizePhone } from './phone.js';

describe('normalizePhone', () => {
  // ── Entradas inválidas / vazias ──────────────────────────────────────────
  it('retorna isValid:false para string vazia', () => {
    const result = normalizePhone('');
    expect(result).toEqual({ e164: null, normalized: null, isValid: false });
  });

  it('retorna isValid:false para string só com espaços', () => {
    const result = normalizePhone('   ');
    expect(result).toEqual({ e164: null, normalized: null, isValid: false });
  });

  it('retorna isValid:false para lixo textual', () => {
    const result = normalizePhone('abc');
    expect(result).toEqual({ e164: null, normalized: null, isValid: false });
  });

  it('retorna isValid:false para número com dígitos insuficientes', () => {
    const result = normalizePhone('1234');
    expect(result).toEqual({ e164: null, normalized: null, isValid: false });
  });

  // ── Celular BR — com máscara ─────────────────────────────────────────────
  it('normaliza celular BR mascarado (11) 91234-5678 → +5511912345678', () => {
    const result = normalizePhone('(11) 91234-5678');
    expect(result.isValid).toBe(true);
    expect(result.e164).toBe('+5511912345678');
  });

  // ── Celular BR — sem máscara ─────────────────────────────────────────────
  it('normaliza celular BR sem máscara 11912345678 → +5511912345678', () => {
    const result = normalizePhone('11912345678');
    expect(result.isValid).toBe(true);
    expect(result.e164).toBe('+5511912345678');
  });

  // ── E.164 já válido ──────────────────────────────────────────────────────
  it('retorna inalterado número já em E.164 +5511912345678', () => {
    const result = normalizePhone('+5511912345678');
    expect(result.isValid).toBe(true);
    expect(result.e164).toBe('+5511912345678');
  });

  // ── Fixo BR 8 dígitos com prefixo de cidade ─────────────────────────────
  it('normaliza fixo BR (11) 3456-7890 → +551134567890', () => {
    const result = normalizePhone('(11) 3456-7890');
    expect(result.isValid).toBe(true);
    expect(result.e164).toBe('+551134567890');
  });

  it('normaliza fixo BR 8 dígitos sem máscara (prefixo de cidade) 1134567890 → +551134567890', () => {
    const result = normalizePhone('1134567890');
    expect(result.isValid).toBe(true);
    expect(result.e164).toBe('+551134567890');
  });

  // ── Internacional com defaultCountry BR ─────────────────────────────────
  it('normaliza número US com código +1 mesmo com defaultCountry BR', () => {
    const result = normalizePhone('+1 415 555 1234');
    expect(result.isValid).toBe(true);
    expect(result.e164).toBe('+14155551234');
  });

  // ── Campo normalized é string legível ────────────────────────────────────
  it('normalized é string não-nula para entrada válida', () => {
    const result = normalizePhone('(11) 91234-5678');
    expect(typeof result.normalized).toBe('string');
    expect(result.normalized).not.toBe('');
  });

  // ── defaultCountry alternativo ───────────────────────────────────────────
  it('usa defaultCountry US quando especificado para número local US', () => {
    const result = normalizePhone('4155551234', 'US');
    expect(result.isValid).toBe(true);
    expect(result.e164).toBe('+14155551234');
  });
});
