// =============================================================================
// components/layout/mobile-nav-store.ts — Estado do drawer de navegação mobile.
//
// Estado de UI transiente (não persiste — reseta ao fechar/recarregar a aba,
// diferente do `sidebarCollapsed` que é preferência do usuário).
//
// Compartilhado entre Topbar (botão hambúrguer = trigger) e Sidebar/
// MobileNavDrawer (consumidor), evitando prop-drilling através do AppLayout.
//
// `triggerRef` guarda o botão que abriu o drawer para devolver o foco a ele
// ao fechar (WCAG 2.4.3 — ordem de foco previsível).
// =============================================================================

import type { RefObject } from 'react';
import { create } from 'zustand';

interface MobileNavState {
  open: boolean;
  triggerRef: RefObject<HTMLButtonElement> | null;
  setTriggerRef: (ref: RefObject<HTMLButtonElement>) => void;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
}

export const useMobileNavStore = create<MobileNavState>((set, get) => ({
  open: false,
  triggerRef: null,

  setTriggerRef: (ref) => set({ triggerRef: ref }),

  openDrawer: () => set({ open: true }),

  closeDrawer: () => {
    if (!get().open) return;
    set({ open: false });
    // Devolve o foco ao botão que abriu o drawer (hambúrguer da Topbar).
    get().triggerRef?.current?.focus();
  },

  toggleDrawer: () => {
    if (get().open) {
      get().closeDrawer();
    } else {
      get().openDrawer();
    }
  },
}));
