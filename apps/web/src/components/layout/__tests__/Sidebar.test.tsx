// =============================================================================
// Sidebar.test.tsx — Testes unitários das regras de gate de navegação (F4-S07).
//
// Estratégia: testa lógica pura isolada via isNavItemVisible + APP_NAV
// sem renderizar React (JSDOM não configurado neste projeto).
//
// Cobertura (slot F4-S07 DoD):
//   1. Item "Análise" aparece quando hasPermission('credit_analyses:read') === true
//   2. Item "Análise" não aparece quando hasPermission('credit_analyses:read') === false
//   3. Item "Simulador" é ocultado quando featureFlag 'credit_simulation.enabled' está off
//   4. Link "Análise" aponta para /credit-analyses (não /analise)
// =============================================================================

import { describe, expect, it } from 'vitest';

import { APP_NAV } from '../../../app/navigation';
import type { NavItem } from '../../../app/navigation';
import { isNavItemVisible } from '../Sidebar';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ITEM_ANALISE = APP_NAV.flatMap((s) => s.items).find((i) => i.iconKey === 'analise');
const ITEM_SIMULATOR = APP_NAV.flatMap((s) => s.items).find((i) => i.iconKey === 'simulator');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeGates(opts: {
  permissions?: string[];
  flags?: Record<string, 'enabled' | 'disabled' | 'internal_only'>;
}) {
  const permissions = opts.permissions ?? [];
  const flags = opts.flags ?? {};
  return {
    hasPermission: (perm: string) => permissions.includes(perm),
    flagEnabled: (key: string) => {
      const status = flags[key];
      return status === 'enabled' || status === 'internal_only';
    },
  };
}

// ─── Sanidade do fixture ──────────────────────────────────────────────────────

describe('APP_NAV — integridade da fonte de verdade', () => {
  it('item Análise existe no APP_NAV', () => {
    expect(ITEM_ANALISE).toBeDefined();
  });

  it('item Simulador existe no APP_NAV', () => {
    expect(ITEM_SIMULATOR).toBeDefined();
  });

  it('link Análise aponta para /credit-analyses (não /analise)', () => {
    expect(ITEM_ANALISE?.href).toBe('/credit-analyses');
    expect(ITEM_ANALISE?.href).not.toBe('/analise');
  });

  it('item Análise declara permission credit_analyses:read', () => {
    expect(ITEM_ANALISE?.permission).toBe('credit_analyses:read');
  });

  it('item Simulador declara featureFlag credit_simulation.enabled', () => {
    expect(ITEM_SIMULATOR?.featureFlag).toBe('credit_simulation.enabled');
  });
});

// ─── Gate de permissão (Análise) ─────────────────────────────────────────────

describe('isNavItemVisible — gate de permissão para Análise', () => {
  it('exibe item Análise quando hasPermission retorna true', () => {
    const gates = makeGates({ permissions: ['credit_analyses:read'] });
    expect(isNavItemVisible(ITEM_ANALISE!, gates)).toBe(true);
  });

  it('oculta item Análise quando hasPermission retorna false', () => {
    const gates = makeGates({ permissions: [] });
    expect(isNavItemVisible(ITEM_ANALISE!, gates)).toBe(false);
  });

  it('oculta item Análise quando usuário tem outras permissões mas não credit_analyses:read', () => {
    const gates = makeGates({ permissions: ['crm:read', 'simulator:use'] });
    expect(isNavItemVisible(ITEM_ANALISE!, gates)).toBe(false);
  });
});

// ─── Gate de feature flag (Simulador) ────────────────────────────────────────

describe('isNavItemVisible — gate de feature flag para Simulador', () => {
  it('exibe item Simulador quando flag credit_simulation.enabled está enabled', () => {
    const gates = makeGates({ flags: { 'credit_simulation.enabled': 'enabled' } });
    expect(isNavItemVisible(ITEM_SIMULATOR!, gates)).toBe(true);
  });

  it('exibe item Simulador quando flag está internal_only', () => {
    const gates = makeGates({ flags: { 'credit_simulation.enabled': 'internal_only' } });
    expect(isNavItemVisible(ITEM_SIMULATOR!, gates)).toBe(true);
  });

  it('oculta item Simulador quando flag credit_simulation.enabled está disabled', () => {
    const gates = makeGates({ flags: { 'credit_simulation.enabled': 'disabled' } });
    expect(isNavItemVisible(ITEM_SIMULATOR!, gates)).toBe(false);
  });

  it('oculta item Simulador quando flag não está no mapa (fail-closed)', () => {
    const gates = makeGates({ flags: {} });
    expect(isNavItemVisible(ITEM_SIMULATOR!, gates)).toBe(false);
  });
});

// ─── Itens sem gate passam livremente ────────────────────────────────────────

describe('isNavItemVisible — items sem permission nem featureFlag', () => {
  const ITEM_DASHBOARD = APP_NAV.flatMap((s) => s.items).find((i) => i.iconKey === 'dashboard');
  const ITEM_CRM = APP_NAV.flatMap((s) => s.items).find((i) => i.iconKey === 'crm');

  it('Dashboard sempre visível (sem gate)', () => {
    const gates = makeGates({});
    expect(isNavItemVisible(ITEM_DASHBOARD!, gates)).toBe(true);
  });

  it('CRM sempre visível (sem gate de permissão nem de flag)', () => {
    const gates = makeGates({});
    expect(isNavItemVisible(ITEM_CRM!, gates)).toBe(true);
  });

  it('item ad-hoc sem gates é visível mesmo sem permissões', () => {
    const item: NavItem = { href: '/qualquer', label: 'Teste', iconKey: 'x' };
    const gates = makeGates({});
    expect(isNavItemVisible(item, gates)).toBe(true);
  });
});

// ─── Combinação de gates ──────────────────────────────────────────────────────

describe('isNavItemVisible — combinação de permission + featureFlag', () => {
  it('item com ambos os gates exige que os dois passem', () => {
    const item: NavItem = {
      href: '/restrito',
      label: 'Restrito',
      iconKey: 'restrito',
      permission: 'some:perm',
      featureFlag: 'some.flag',
    };

    // Ambos ativos → visível
    expect(
      isNavItemVisible(
        item,
        makeGates({ permissions: ['some:perm'], flags: { 'some.flag': 'enabled' } }),
      ),
    ).toBe(true);

    // Só permissão → oculto (flag ausente = fail-closed)
    expect(isNavItemVisible(item, makeGates({ permissions: ['some:perm'], flags: {} }))).toBe(
      false,
    );

    // Só flag → oculto (sem permissão)
    expect(isNavItemVisible(item, makeGates({ flags: { 'some.flag': 'enabled' } }))).toBe(false);

    // Nenhum → oculto
    expect(isNavItemVisible(item, makeGates({}))).toBe(false);
  });
});
