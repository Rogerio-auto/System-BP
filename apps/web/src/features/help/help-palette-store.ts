import { create } from 'zustand';

interface HelpPaletteStore {
  open: boolean;
  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
  setOpen: (open: boolean) => void;
}

/**
 * Store mínimo do palette de busca da Central de Ajuda.
 *
 * Por que store global e não estado local: a UI tem múltiplos triggers
 * (atalho Cmd+K + botão "?" da topbar + item "Ajuda" da sidebar quando
 * F11 adicionar tutoriais). Centralizar evita prop drilling e event
 * dispatching ad hoc.
 *
 * Sem persist — estado efêmero por natureza.
 */
export const useHelpPaletteStore = create<HelpPaletteStore>((set) => ({
  open: false,
  openPalette: () => set({ open: true }),
  closePalette: () => set({ open: false }),
  togglePalette: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
}));
