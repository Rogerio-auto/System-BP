import * as React from 'react';

import { useHelpPaletteStore } from './help-palette-store';

// Lazy shell: o impl carrega `cmdk` + `flexsearch` + todo o markdown bruto
// das páginas de ajuda. Sem o shell, esse custo cairia no first paint de toda
// rota autenticada. Com o shell, só carrega após o primeiro acionamento
// (Cmd+K, botão "?" da topbar ou item da sidebar).
const SearchPaletteImpl = React.lazy(() =>
  import('./SearchPaletteImpl').then((m) => ({ default: m.SearchPaletteImpl })),
);

/**
 * Shell do palette global de busca da Central de Ajuda.
 * Registra o atalho Cmd+K / Ctrl+K e lazy-loads a UI pesada após o primeiro
 * trigger. Esc, ↑/↓, Enter ficam no impl.
 *
 * Estado de abertura vive em `useHelpPaletteStore` para que múltiplos
 * triggers (atalho + botão "?" + futuro link de sidebar) compartilhem.
 */
export function SearchPalette(): React.JSX.Element {
  const open = useHelpPaletteStore((s) => s.open);
  const togglePalette = useHelpPaletteStore((s) => s.togglePalette);
  const setOpen = useHelpPaletteStore((s) => s.setOpen);

  // Marca que o usuário já tocou em algum trigger; a partir daí mantemos o
  // impl montado para toggles subsequentes instantâneos.
  const [hasInteracted, setHasInteracted] = React.useState(false);

  // Marca interacted sempre que open vira true por qualquer caminho
  React.useEffect(() => {
    if (open) setHasInteracted(true);
  }, [open]);

  // Atalho global Cmd+K / Ctrl+K
  React.useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        togglePalette();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePalette]);

  if (!hasInteracted) return <></>;
  return (
    <React.Suspense fallback={null}>
      <SearchPaletteImpl open={open} onOpenChange={setOpen} />
    </React.Suspense>
  );
}
