// =============================================================================
// pwa/UpdatePrompt.tsx — Toast "Nova versão disponível" (F27-S01, doc 24 §3.4)
//
// `registerType: 'prompt'`: a atualização do service worker nunca é
// silenciosa. Quando `register.ts` detecta um novo build (`onNeedRefresh`),
// este toast aparece e só troca de SW mediante ação explícita do operador —
// nunca deixa o operador preso num shell velho, nem troca sem avisar.
// =============================================================================

import * as React from 'react';

import { Button } from '../components/ui/Button';
import { cn } from '../lib/cn';

import { applyServiceWorkerUpdate, subscribeToServiceWorkerUpdate } from './register';

export function UpdatePrompt(): React.JSX.Element | null {
  const [needsUpdate, setNeedsUpdate] = React.useState(false);

  React.useEffect(() => subscribeToServiceWorkerUpdate(setNeedsUpdate), []);

  if (!needsUpdate) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'fixed inset-x-4 bottom-4 z-[200] mx-auto flex w-[min(100%,24rem)]',
        'items-center gap-3 rounded-md border border-border bg-surface-1 px-4 py-3',
        'font-sans shadow-e4',
        'animate-[fade-up_250ms_cubic-bezier(0.16,1,0.3,1)_both]',
      )}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill text-azul"
        style={{ background: 'var(--info-bg)' }}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          <path d="M8 2v7.5" />
          <path d="M4.5 6.5 8 10l3.5-3.5" />
          <path d="M3 13.5h10" />
        </svg>
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">Nova versão disponível</p>
        <p className="text-xs text-ink-3">Atualize para ver as últimas melhorias.</p>
      </div>

      <Button variant="primary" size="sm" onClick={applyServiceWorkerUpdate} className="shrink-0">
        Atualizar
      </Button>
    </div>
  );
}
