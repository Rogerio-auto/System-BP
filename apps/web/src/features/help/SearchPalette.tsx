import * as React from 'react';

// Lazy shell: o impl carrega `cmdk` + `flexsearch` + todo o markdown bruto
// das páginas de ajuda. Sem o shell, esse custo cairia no first paint de toda
// rota autenticada. Com o shell, só carrega quando o usuário aciona Cmd+K
// pela primeira vez na sessão.
const SearchPaletteImpl = React.lazy(() =>
  import('./SearchPaletteImpl').then((m) => ({ default: m.SearchPaletteImpl })),
);

/**
 * Shell do palette global de busca da Central de Ajuda.
 * Registra o atalho Cmd+K / Ctrl+K e lazy-loads a UI pesada apenas após o
 * primeiro acionamento. Esc, ↑/↓, Enter ficam todos no impl.
 */
export function SearchPalette(): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  // Marca que o usuário já tocou o atalho — depois disso, mantemos o impl
  // montado para que toggles subsequentes sejam instantâneos.
  const [hasInteracted, setHasInteracted] = React.useState(false);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setHasInteracted(true);
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!hasInteracted) return <></>;
  return (
    <React.Suspense fallback={null}>
      <SearchPaletteImpl open={open} onOpenChange={setOpen} />
    </React.Suspense>
  );
}
