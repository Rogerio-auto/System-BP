// =============================================================================
// pwa/OfflinePage.tsx — Página offline (F27-S01, doc 24 §3.5)
//
// Floor de degradação: quando não há rede, o Manager não tem dados pra
// mostrar (network-only por decisão de LGPD — doc 24 §2/§3.4, zero PII em
// repouso). Renderizada por `main.tsx` no lugar de <App /> enquanto
// `navigator.onLine === false`. Não é tela de dados.
// =============================================================================

import * as React from 'react';

import { Button } from '../components/ui/Button';

interface OfflinePageProps {
  /** Chamado ao clicar em "Tentar novamente". Default: recarrega a página. */
  onRetry?: () => void;
}

export function OfflinePage({ onRetry }: OfflinePageProps): React.JSX.Element {
  const handleRetry = React.useCallback(() => {
    if (onRetry) {
      onRetry();
      return;
    }
    window.location.reload();
  }, [onRetry]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-6">
      <div
        className="flex w-full max-w-md flex-col items-center gap-6 rounded-lg border border-border bg-surface-1 px-8 py-10 text-center shadow-e3"
        role="alert"
        aria-live="polite"
      >
        <span
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-pill"
          style={{
            background: 'var(--warning-bg)',
            boxShadow: 'var(--elev-2), inset 0 1px 0 rgba(255,255,255,0.5)',
          }}
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-8 w-8 text-warning"
          >
            <path d="M3 8.5c5-4 13-4 18 0" />
            <path d="M6.3 12.2c3.2-2.5 8.2-2.5 11.4 0" />
            <path d="M9.5 15.8c1.6-1.2 3.4-1.2 5 0" />
            <path d="M12 19h.01" />
            <path d="M2 2l20 20" />
          </svg>
        </span>

        <div className="flex flex-col gap-2">
          <h1
            className="font-display font-bold text-ink"
            style={{ fontSize: 'var(--text-2xl)', letterSpacing: '-0.03em' }}
          >
            Sem conexão
          </h1>
          <p className="font-sans text-sm text-ink-2">
            O Manager precisa de internet para carregar seus dados. Verifique sua conexão e tente
            novamente.
          </p>
        </div>

        <Button variant="primary" onClick={handleRetry}>
          Tentar novamente
        </Button>
      </div>
    </main>
  );
}
