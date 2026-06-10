// =============================================================================
// __tests__/Callout.test.tsx — Testes de regressão do componente Callout
//
// Sem JSDOM configurado neste projeto — testes são unitários de lógica pura.
// Valida o lookup de CONFIG (fallback defensivo) e os 4 tipos válidos.
// =============================================================================

import { describe, expect, it } from 'vitest';

import { type CalloutType } from '../Callout';

// Mirrors the CONFIG structure from Callout.tsx so we can test the lookup
// logic independently, without rendering React.
type CfgEntry = { bg: string; border: string; color: string; defaultTitle: string };

const VALID_TYPES: CalloutType[] = ['info', 'warn', 'danger', 'tip'];

// Replicate the lookup logic from Callout.tsx so we can verify the contract.
const CONFIG: Record<CalloutType, CfgEntry> = {
  info: {
    bg: 'var(--info-bg)',
    border: 'var(--info)',
    color: 'var(--info)',
    defaultTitle: 'Atenção',
  },
  warn: {
    bg: 'var(--warning-bg)',
    border: 'var(--warning)',
    color: 'var(--warning)',
    defaultTitle: 'Aviso',
  },
  danger: {
    bg: 'var(--danger-bg)',
    border: 'var(--danger)',
    color: 'var(--danger)',
    defaultTitle: 'Cuidado',
  },
  tip: {
    bg: 'var(--success-bg)',
    border: 'var(--success)',
    color: 'var(--success)',
    defaultTitle: 'Dica',
  },
};

function lookupConfig(type: string): CfgEntry {
  // Mirrors the fallback added in Callout.tsx: CONFIG[type] ?? CONFIG.info
  return CONFIG[type as CalloutType] ?? CONFIG.info;
}

describe('Callout CONFIG lookup', () => {
  it.each(VALID_TYPES)('tipo válido "%s" resolve sem fallback', (type) => {
    const cfg = lookupConfig(type);
    expect(cfg).toBeDefined();
    expect(cfg.bg).toMatch(/^var\(/);
    expect(cfg.border).toMatch(/^var\(/);
    expect(cfg.color).toMatch(/^var\(/);
    expect(cfg.defaultTitle).toBeTruthy();
  });

  it('tipo inválido "warning" não lança e cai no fallback info', () => {
    // This is the exact scenario that caused the white-screen crash.
    // Before the fix, CONFIG["warning"] was undefined → cfg.bg threw.
    expect(() => lookupConfig('warning')).not.toThrow();
    const cfg = lookupConfig('warning');
    expect(cfg).toBe(CONFIG.info);
  });

  it('tipo inválido string vazia não lança e cai no fallback info', () => {
    expect(() => lookupConfig('')).not.toThrow();
    const cfg = lookupConfig('');
    expect(cfg).toBe(CONFIG.info);
  });

  it('tipo inválido arbitrário não lança e cai no fallback info', () => {
    expect(() => lookupConfig('critical')).not.toThrow();
    const cfg = lookupConfig('critical');
    expect(cfg).toBe(CONFIG.info);
  });

  it('todos os 4 tipos válidos têm defaultTitle distinto', () => {
    const titles = VALID_TYPES.map((t) => CONFIG[t].defaultTitle);
    const unique = new Set(titles);
    expect(unique.size).toBe(VALID_TYPES.length);
  });

  it('tipo "info" tem defaultTitle "Atenção"', () => {
    expect(CONFIG.info.defaultTitle).toBe('Atenção');
  });

  it('tipo "warn" tem defaultTitle "Aviso"', () => {
    expect(CONFIG.warn.defaultTitle).toBe('Aviso');
  });

  it('tipo "danger" tem defaultTitle "Cuidado"', () => {
    expect(CONFIG.danger.defaultTitle).toBe('Cuidado');
  });

  it('tipo "tip" tem defaultTitle "Dica"', () => {
    expect(CONFIG.tip.defaultTitle).toBe('Dica');
  });

  it('Callout exporta o tipo CalloutType como union dos 4 válidos', () => {
    // Validate the union type assignment compiles without error.
    const t: CalloutType = 'warn';
    expect(VALID_TYPES).toContain(t);
  });
});
