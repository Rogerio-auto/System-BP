// =============================================================================
// features/quick-replies/admin/useDebouncedValue.ts — Debounce genérico de
// string (F28-S07) — busca/categoria com 300ms, doc 25 §11.2.
// =============================================================================
import * as React from 'react';

export function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
