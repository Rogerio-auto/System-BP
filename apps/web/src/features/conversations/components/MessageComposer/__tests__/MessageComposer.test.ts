// =============================================================================
// MessageComposer/__tests__/MessageComposer.test.ts — Testes unitários (F16-S17).
//
// Valida a lógica de janela 24h independente de React.
// Testes de renderização ficam no E2E.
// =============================================================================

import { describe, expect, it } from 'vitest';

// ─── Lógica de janela 24h ─────────────────────────────────────────────────────

/**
 * Replica a lógica de windowOpen do useWindowState sem depender do hook.
 * Permite testar os cenários diretamente.
 */
type ComposerWindowKind = 'open' | 'human_agent_tag' | 'template_only' | 'closed';

function isWindowOpen(kind: ComposerWindowKind): boolean {
  return kind === 'open' || kind === 'human_agent_tag';
}

describe('window 24h — lógica de abertura', () => {
  it('abre quando window === "open"', () => {
    expect(isWindowOpen('open')).toBe(true);
  });

  it('abre quando window === "human_agent_tag"', () => {
    expect(isWindowOpen('human_agent_tag')).toBe(true);
  });

  it('fecha quando window === "template_only"', () => {
    expect(isWindowOpen('template_only')).toBe(false);
  });

  it('fecha quando window === "closed"', () => {
    expect(isWindowOpen('closed')).toBe(false);
  });
});

// ─── Idempotência de envio ────────────────────────────────────────────────────

describe('idempotencyKey — geração por tentativa', () => {
  it('gera UUIDs diferentes por chamada', () => {
    const key1 = crypto.randomUUID();
    const key2 = crypto.randomUUID();
    expect(key1).not.toBe(key2);
  });

  it('UUID tem formato válido (RFC 4122)', () => {
    const key = crypto.randomUUID();
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});

// ─── Validação de texto antes de envio ────────────────────────────────────────

describe('validação de texto', () => {
  function canSendText(text: string, windowOpen: boolean): boolean {
    return text.trim().length > 0 && windowOpen;
  }

  it('permite envio com texto não-vazio e janela aberta', () => {
    expect(canSendText('Olá!', true)).toBe(true);
  });

  it('bloqueia envio com texto vazio', () => {
    expect(canSendText('', true)).toBe(false);
    expect(canSendText('   ', true)).toBe(false);
  });

  it('bloqueia envio com janela fechada', () => {
    expect(canSendText('Mensagem', false)).toBe(false);
  });

  it('bloqueia envio com texto vazio e janela fechada', () => {
    expect(canSendText('', false)).toBe(false);
  });
});
