// =============================================================================
// features/quick-replies/admin/__tests__/shortcut.test.ts
// =============================================================================
import { describe, expect, it } from 'vitest';

import { QUICK_REPLY_SHORTCUT_REGEX } from '../../types';
import { sanitizeShortcutInput } from '../shortcut';

describe('sanitizeShortcutInput', () => {
  it('minusculiza e remove acentos', () => {
    expect(sanitizeShortcutInput('Orientação Documentos')).toBe('orientacaodocumentos');
  });

  it('preserva hífen e underscore no meio', () => {
    expect(sanitizeShortcutInput('orientacao-documentos_v2')).toBe('orientacao-documentos_v2');
  });

  it('remove caracteres não permitidos (espaço, pontuação)', () => {
    expect(sanitizeShortcutInput('Prazo: 30 dias!')).toBe('prazo30dias');
  });

  it('não permite começar por hífen ou underscore', () => {
    expect(sanitizeShortcutInput('-inicio')).toBe('inicio');
    expect(sanitizeShortcutInput('_inicio')).toBe('inicio');
  });

  it('trunca em 32 caracteres', () => {
    const long = 'a'.repeat(50);
    expect(sanitizeShortcutInput(long)).toHaveLength(32);
  });

  it('resultado sempre casa com QUICK_REPLY_SHORTCUT_REGEX quando não-vazio', () => {
    const inputs = ['Orientação Documentos', 'Prazo: 30 dias!', 'já-válido_1', 'ç ã õ !!!'];
    for (const input of inputs) {
      const sanitized = sanitizeShortcutInput(input);
      if (sanitized.length > 0) {
        expect(sanitized).toMatch(QUICK_REPLY_SHORTCUT_REGEX);
      }
    }
  });
});
