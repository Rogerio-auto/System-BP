// =============================================================================
// mobile-nav-store.test.ts — Testes unitários do estado do drawer mobile (F27-S03).
//
// Estratégia: testa a store Zustand diretamente via getState()/setState(),
// sem renderizar React (JSDOM não configurado neste projeto — ver
// Sidebar.test.tsx).
// =============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMobileNavStore } from '../mobile-nav-store';

// ─── Reset entre testes ────────────────────────────────────────────────────────

beforeEach(() => {
  useMobileNavStore.setState({ open: false, triggerRef: null });
});

// ─── open/close/toggle ─────────────────────────────────────────────────────────

describe('useMobileNavStore — abrir/fechar/alternar', () => {
  it('inicia fechado', () => {
    expect(useMobileNavStore.getState().open).toBe(false);
  });

  it('openDrawer() abre o drawer', () => {
    useMobileNavStore.getState().openDrawer();
    expect(useMobileNavStore.getState().open).toBe(true);
  });

  it('closeDrawer() fecha o drawer', () => {
    useMobileNavStore.getState().openDrawer();
    useMobileNavStore.getState().closeDrawer();
    expect(useMobileNavStore.getState().open).toBe(false);
  });

  it('toggleDrawer() alterna entre aberto e fechado', () => {
    expect(useMobileNavStore.getState().open).toBe(false);
    useMobileNavStore.getState().toggleDrawer();
    expect(useMobileNavStore.getState().open).toBe(true);
    useMobileNavStore.getState().toggleDrawer();
    expect(useMobileNavStore.getState().open).toBe(false);
  });

  it('closeDrawer() é no-op quando já está fechado (sem focar o trigger)', () => {
    const focus = vi.fn();
    useMobileNavStore.setState({
      open: false,
      triggerRef: { current: { focus } as unknown as HTMLButtonElement },
    });

    useMobileNavStore.getState().closeDrawer();

    expect(useMobileNavStore.getState().open).toBe(false);
    expect(focus).not.toHaveBeenCalled();
  });
});

// ─── Devolução de foco ao trigger ───────────────────────────────────────────────

describe('useMobileNavStore — devolução de foco ao fechar', () => {
  it('closeDrawer() foca o triggerRef registrado', () => {
    const focus = vi.fn();
    useMobileNavStore.setState({
      open: true,
      triggerRef: { current: { focus } as unknown as HTMLButtonElement },
    });

    useMobileNavStore.getState().closeDrawer();

    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('closeDrawer() não lança quando não há triggerRef registrado', () => {
    useMobileNavStore.setState({ open: true, triggerRef: null });
    expect(() => useMobileNavStore.getState().closeDrawer()).not.toThrow();
  });

  it('setTriggerRef() atualiza o ref usado para devolver o foco', () => {
    const focusA = vi.fn();
    const focusB = vi.fn();
    const refA = { current: { focus: focusA } as unknown as HTMLButtonElement };
    const refB = { current: { focus: focusB } as unknown as HTMLButtonElement };

    useMobileNavStore.getState().setTriggerRef(refA);
    useMobileNavStore.getState().setTriggerRef(refB);
    useMobileNavStore.setState({ open: true });
    useMobileNavStore.getState().closeDrawer();

    expect(focusA).not.toHaveBeenCalled();
    expect(focusB).toHaveBeenCalledTimes(1);
  });
});
