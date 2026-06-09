// =============================================================================
// __tests__/contextual-help-store.test.ts
//
// Testes unitários do store Zustand de ajuda contextual.
// Testamos apenas lógica de estado pura (sem React).
// =============================================================================

import { describe, expect, it, beforeEach } from 'vitest';

import { useContextualHelpStore, type DrawerTutorial } from '../contextual-help-store';

// ─── Fixture ─────────────────────────────────────────────────────────────────

const TUTORIAL_A: DrawerTutorial = {
  id: 'tut-a',
  title: 'Como criar um lead',
  description: 'Aprenda a criar um lead no CRM.',
  provider: 'youtube',
  videoRef: 'dQw4w9WgXcQ',
  hash: undefined,
  articleSlug: 'guias/crm/criar-lead',
  featureKey: 'crm.lead.create',
};

const TUTORIAL_B: DrawerTutorial = {
  id: 'tut-b',
  title: 'Como fazer follow-up',
  description: 'Saiba quando e como fazer follow-up.',
  provider: 'youtube',
  videoRef: 'abc123xyz',
  hash: undefined,
  articleSlug: null,
  featureKey: 'followup.create',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getStore() {
  return useContextualHelpStore.getState();
}

function reset() {
  useContextualHelpStore.setState({ open: false, activeTutorial: null });
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('contextual-help-store — estado inicial', () => {
  beforeEach(reset);

  it('começa fechado', () => {
    expect(getStore().open).toBe(false);
  });

  it('começa sem tutorial ativo', () => {
    expect(getStore().activeTutorial).toBeNull();
  });
});

describe('contextual-help-store — openDrawer', () => {
  beforeEach(reset);

  it('abre o drawer com o tutorial fornecido', () => {
    getStore().openDrawer(TUTORIAL_A);
    expect(getStore().open).toBe(true);
    expect(getStore().activeTutorial).toEqual(TUTORIAL_A);
  });

  it('substitui o tutorial ativo ao abrir com tutorial diferente', () => {
    getStore().openDrawer(TUTORIAL_A);
    getStore().openDrawer(TUTORIAL_B);
    expect(getStore().open).toBe(true);
    expect(getStore().activeTutorial?.id).toBe('tut-b');
  });

  it('fecha (toggle) ao clicar no mesmo tutorial quando aberto', () => {
    getStore().openDrawer(TUTORIAL_A);
    getStore().openDrawer(TUTORIAL_A); // segundo clique no mesmo ⓘ
    expect(getStore().open).toBe(false);
    expect(getStore().activeTutorial).toBeNull();
  });

  it('abre mesmo após toggle-fechado', () => {
    getStore().openDrawer(TUTORIAL_A);
    getStore().openDrawer(TUTORIAL_A); // fecha
    getStore().openDrawer(TUTORIAL_A); // abre novamente
    expect(getStore().open).toBe(true);
    expect(getStore().activeTutorial?.id).toBe('tut-a');
  });
});

describe('contextual-help-store — closeDrawer', () => {
  beforeEach(reset);

  it('fecha o drawer e limpa o tutorial ativo', () => {
    getStore().openDrawer(TUTORIAL_A);
    getStore().closeDrawer();
    expect(getStore().open).toBe(false);
    expect(getStore().activeTutorial).toBeNull();
  });

  it('é idempotente — fechar quando já fechado não levanta erro', () => {
    expect(() => getStore().closeDrawer()).not.toThrow();
    expect(getStore().open).toBe(false);
  });
});

describe('contextual-help-store — integridade de referência', () => {
  beforeEach(reset);

  it('guarda referência ao tutorial completo (não apenas o id)', () => {
    getStore().openDrawer(TUTORIAL_A);
    const stored = getStore().activeTutorial;
    expect(stored?.featureKey).toBe('crm.lead.create');
    expect(stored?.articleSlug).toBe('guias/crm/criar-lead');
    expect(stored?.videoRef).toBe('dQw4w9WgXcQ');
  });

  it('tutorial sem articleSlug é armazenado corretamente', () => {
    getStore().openDrawer(TUTORIAL_B);
    expect(getStore().activeTutorial?.articleSlug).toBeNull();
  });
});
