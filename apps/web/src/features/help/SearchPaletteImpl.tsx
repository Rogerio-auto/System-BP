import { Command } from 'cmdk';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';

import { searchHelp, type SearchResult } from './search';

interface SearchPaletteImplProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Implementação pesada do palette de busca. Carregada via React.lazy pelo
 * shell em SearchPalette.tsx — assim cmdk + flexsearch + raw MDX só chegam
 * ao client após o primeiro Cmd+K, mantendo o first paint enxuto.
 *
 * Esc, ↑/↓ e Enter são tratados pelo cmdk automaticamente.
 */
export function SearchPaletteImpl({
  open,
  onOpenChange: setOpen,
}: SearchPaletteImplProps): React.JSX.Element {
  const navigate = useNavigate();
  const [query, setQuery] = React.useState('');
  const results: SearchResult[] = React.useMemo(() => searchHelp(query), [query]);

  // Reset query ao fechar (próxima abertura começa limpa)
  React.useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const handleSelect = (slug: string): void => {
    setOpen(false);
    void navigate(`/ajuda/${slug}`);
  };

  return (
    <>
      {/* Highlight do item selecionado — cmdk usa data-selected="true" */}
      <style>{`
        .cmdk-help-item[data-selected="true"] {
          background: rgba(27,58,140,0.08);
        }
      `}</style>
      <Command.Dialog
        open={open}
        onOpenChange={setOpen}
        label="Buscar na Central de Ajuda"
        shouldFilter={false}
        // Estilo do overlay aplicado via dialog wrapper
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 60,
          display: open ? 'flex' : 'none',
          alignItems: 'flex-start',
          justifyContent: 'center',
          paddingTop: '12vh',
          background: 'rgba(15,16,18,0.45)',
          backdropFilter: 'blur(6px)',
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 'min(640px, 92vw)',
            background: 'var(--bg-elev-1)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            boxShadow: 'var(--elev-5)',
            overflow: 'hidden',
            animation: 'fade-up 180ms var(--ease-out) both',
          }}
        >
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder="Buscar na Central de Ajuda…"
            className="font-sans"
            style={{
              width: '100%',
              border: 'none',
              outline: 'none',
              padding: '1rem 1.25rem',
              background: 'transparent',
              color: 'var(--text)',
              fontSize: 'var(--text-base)',
              borderBottom: '1px solid var(--border)',
            }}
          />
          <Command.List
            style={{
              maxHeight: '60vh',
              overflowY: 'auto',
              padding: '0.5rem',
            }}
          >
            {query.trim() === '' && (
              <div
                className="font-sans"
                style={{
                  padding: '1.25rem 0.75rem',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-3)',
                  textAlign: 'center',
                }}
              >
                Digite para buscar nas páginas de ajuda.
              </div>
            )}

            {query.trim() !== '' && (
              <Command.Empty
                style={{
                  padding: '1.25rem 0.75rem',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-3)',
                  textAlign: 'center',
                }}
              >
                Nada encontrado para “{query}”.
              </Command.Empty>
            )}

            {results.map((r) => (
              <Command.Item
                key={r.slug}
                value={r.slug}
                onSelect={() => handleSelect(r.slug)}
                style={{
                  padding: '0.625rem 0.75rem',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.125rem',
                }}
                className="cmdk-help-item"
              >
                <span
                  className="font-sans font-medium"
                  style={{ fontSize: 'var(--text-sm)', color: 'var(--text)' }}
                >
                  {r.title}
                </span>
                <span
                  className="font-sans"
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--text-3)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {r.description ?? r.snippet}
                </span>
              </Command.Item>
            ))}
          </Command.List>
          <div
            className="font-sans"
            style={{
              display: 'flex',
              gap: '1rem',
              padding: '0.5rem 1rem',
              borderTop: '1px solid var(--border)',
              fontSize: '0.6875rem',
              color: 'var(--text-3)',
              background: 'var(--surface-muted)',
            }}
          >
            <span>
              <kbd style={kbdStyle}>↑</kbd> <kbd style={kbdStyle}>↓</kbd> navegar
            </span>
            <span>
              <kbd style={kbdStyle}>Enter</kbd> abrir
            </span>
            <span>
              <kbd style={kbdStyle}>Esc</kbd> fechar
            </span>
          </div>
        </div>
      </Command.Dialog>
    </>
  );
}

const kbdStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '0.05rem 0.35rem',
  border: '1px solid var(--border)',
  borderRadius: '4px',
  fontSize: '0.6875rem',
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-2)',
  background: 'var(--bg-elev-1)',
};
