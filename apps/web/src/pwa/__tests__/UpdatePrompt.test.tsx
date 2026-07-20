// =============================================================================
// pwa/__tests__/UpdatePrompt.test.tsx — Teste estrutural sem JSDOM.
//
// Mocka `virtual:pwa-register` (só existe via bundler) para permitir a
// importação de `./register` transitivamente. Valida apenas o contrato de
// exportação do módulo — renderização é coberta por verificação manual em
// navegador (screenshot obrigatório no PR).
// =============================================================================

import { describe, expect, it, vi } from 'vitest';

vi.mock('virtual:pwa-register', () => ({
  registerSW: () => vi.fn(),
}));

describe('UpdatePrompt', () => {
  it('é uma função React exportada', async () => {
    const { UpdatePrompt } = await import('../UpdatePrompt');
    expect(typeof UpdatePrompt).toBe('function');
  });
});
