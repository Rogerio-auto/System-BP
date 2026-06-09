// =============================================================================
// features/help/contextual/contextual-help-store.ts
//
// Store Zustand do drawer de ajuda contextual.
//
// Por que store global e não estado local:
//   - O drawer é um singleton global (montado em AppLayout).
//   - Qualquer <ContextualHelp featureKey> em qualquer profundidade da árvore
//     pode abri-lo sem prop drilling ou event dispatching ad hoc.
//   - Padrão idêntico ao help-palette-store.ts.
//
// Estado:
//   - open: se o drawer está aberto.
//   - activeTutorialId: qual tutorial está ativo (null = nenhum).
//
// Sem persist — efêmero por natureza.
// =============================================================================

import { create } from 'zustand';

// ─── Tipos ────────────────────────────────────────────────────────────────────

/** Tutorial a ser exibido no drawer. Dados mínimos para renderizar o drawer. */
export interface DrawerTutorial {
  id: string;
  title: string;
  description: string;
  provider: string;
  videoRef: string;
  hash?: string | undefined;
  articleSlug: string | null;
  featureKey: string;
}

interface ContextualHelpStore {
  /** Se o drawer está aberto. */
  open: boolean;
  /** Tutorial atualmente exibido no drawer. */
  activeTutorial: DrawerTutorial | null;
  /**
   * Abre o drawer exibindo o tutorial especificado.
   * Se o drawer já estiver aberto com o mesmo tutorial, fecha (toggle).
   */
  openDrawer: (tutorial: DrawerTutorial) => void;
  /** Fecha o drawer e limpa o tutorial ativo. */
  closeDrawer: () => void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useContextualHelpStore = create<ContextualHelpStore>((set, get) => ({
  open: false,
  activeTutorial: null,

  openDrawer(tutorial: DrawerTutorial) {
    const { activeTutorial, open } = get();
    // Toggle: clicar no mesmo ⓘ fecha o drawer.
    if (open && activeTutorial?.id === tutorial.id) {
      set({ open: false, activeTutorial: null });
      return;
    }
    set({ open: true, activeTutorial: tutorial });
  },

  closeDrawer() {
    set({ open: false, activeTutorial: null });
  },
}));
