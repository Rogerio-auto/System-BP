import * as React from 'react';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  // eslint-disable-next-line no-unused-vars
  setTheme: (next: Theme) => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

// ─── Utilitários ──────────────────────────────────────────────────────────────

/**
 * Aplica o tema ao elemento <html>:
 * - data-theme="light|dark"  → CSS vars resolvem pelo seletor [data-theme]
 * - classList "light|dark"   → classes Tailwind dark: funcionam
 * Ambas estratégias simultâneas — sem dependência de uma só.
 */
function applyTheme(next: Theme): void {
  const html = document.documentElement;
  html.setAttribute('data-theme', next);
  html.classList.remove('light', 'dark');
  html.classList.add(next);
}

function persistTheme(next: Theme): void {
  try {
    localStorage.setItem('theme', next);
  } catch {
    // localStorage indisponível (ex: modo privado restrito) — silencioso
  }
}

/**
 * Lê o tema inicial do localStorage.
 * Se não houver, usa prefers-color-scheme (§12 do DS).
 * O inline script em index.html já aplicou antes do React montar
 * (zero flash), então aqui apenas sincronizamos o estado React.
 */
function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage indisponível
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

// ─── Provider ─────────────────────────────────────────────────────────────────

interface ThemeProviderProps {
  children: React.ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps): React.JSX.Element {
  // Estado inicial já aplicado pelo inline script em index.html — zero flash
  const [theme, setThemeState] = React.useState<Theme>(getInitialTheme);

  const setTheme = React.useCallback((next: Theme): void => {
    applyTheme(next);
    persistTheme(next);
    setThemeState(next);
  }, []);

  // Sincroniza se o tema mudou externamente (outra aba via storage event)
  React.useEffect(() => {
    const handler = (e: StorageEvent): void => {
      if (e.key === 'theme' && (e.newValue === 'light' || e.newValue === 'dark')) {
        applyTheme(e.newValue);
        setThemeState(e.newValue);
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const value = React.useMemo<ThemeContextValue>(
    () => ({ theme, setTheme }),
    [theme, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

// ─── Hook público ─────────────────────────────────────────────────────────────

/**
 * Consumir dentro de filhos do ThemeProvider.
 * Lança erro claro se usado fora do contexto.
 */
export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme deve ser usado dentro de <ThemeProvider>');
  }
  return ctx;
}
