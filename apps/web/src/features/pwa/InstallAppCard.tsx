// =============================================================================
// features/pwa/InstallAppCard.tsx — Banner "instale o app no celular" (doc 24).
//
// Ajuda o operador a levar o Manager para o celular: copia o link do app para
// enviar ao próprio telefone e instalar (Adicionar à Tela de Início). Depois de
// confirmar a instalação ("Já instalei"), o banner some para sempre neste
// dispositivo (localStorage). O "×" apenas dispensa na sessão atual.
//
// Não aparece quando:
//   - a flag `pwa.enabled` está off (ou ainda resolvendo);
//   - o app já roda instalado (standalone) — não faz sentido oferecer instalar;
//   - o usuário já confirmou a instalação neste dispositivo (localStorage);
//   - foi dispensado nesta sessão.
// =============================================================================

import * as React from 'react';

import { Button } from '../../components/ui/Button';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';

import { isStandaloneDisplayMode } from './platform';

/** Marca, por dispositivo, que o usuário confirmou a instalação (não some sozinho). */
const CONFIRMED_STORAGE_KEY = 'elemento-pwa-install-confirmed';

function readConfirmed(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(CONFIRMED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function PhoneGlyph(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-5 h-5"
      aria-hidden="true"
    >
      <rect x="7" y="2" width="10" height="20" rx="2.5" />
      <path d="M11 18h2" />
    </svg>
  );
}

export function InstallAppCard(): React.JSX.Element | null {
  const { enabled, isLoading } = useFeatureFlag('pwa.enabled');
  const [confirmed, setConfirmed] = React.useState<boolean>(readConfirmed);
  const [sessionDismissed, setSessionDismissed] = React.useState(false);
  const [standalone] = React.useState<boolean>(() => isStandaloneDisplayMode());
  const [copied, setCopied] = React.useState(false);

  // Reset do "copiado" após 2s — limpo no unmount.
  React.useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);

  if (isLoading || !enabled) return null;
  if (standalone) return null;
  if (confirmed || sessionDismissed) return null;

  const appUrl = window.location.origin;

  const handleCopy = (): void => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(appUrl);
        setCopied(true);
      } catch {
        // clipboard indisponível (contexto não-seguro / permissão) — o link fica
        // visível no card para seleção manual.
        setCopied(false);
      }
    })();
  };

  const handleConfirm = (): void => {
    try {
      window.localStorage.setItem(CONFIRMED_STORAGE_KEY, '1');
    } catch {
      // localStorage indisponível — ao menos esconde na sessão atual.
    }
    setConfirmed(true);
  };

  return (
    <div
      role="region"
      aria-label="Instalar o app no celular"
      className="mb-5 flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
      style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-1)' }}
    >
      <div className="flex items-start gap-3 min-w-0">
        <span
          className="shrink-0 flex items-center justify-center w-9 h-9 rounded-md"
          style={{ background: 'var(--info-bg)', color: 'var(--brand-azul)' }}
          aria-hidden="true"
        >
          <PhoneGlyph />
        </span>
        <div className="min-w-0">
          <p className="font-sans font-semibold text-ink" style={{ fontSize: 'var(--text-sm)' }}>
            Instale o Manager no seu celular
          </p>
          <p className="font-sans text-ink-3 mt-0.5" style={{ fontSize: 'var(--text-xs)' }}>
            Copie o link e abra no navegador do celular para adicionar o app à tela de início.
          </p>
          <p
            className="font-mono truncate mt-1"
            style={{ fontSize: 'var(--text-xs)', color: 'var(--text-2)' }}
            title={appUrl}
          >
            {appUrl}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Button type="button" variant="primary" size="sm" onClick={handleCopy}>
          {copied ? 'Copiado!' : 'Copiar link'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={handleConfirm}>
          Já instalei
        </Button>
        <button
          type="button"
          onClick={() => setSessionDismissed(true)}
          aria-label="Dispensar por agora"
          title="Dispensar por agora"
          className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-sm text-ink-3 transition-colors duration-fast ease hover:bg-surface-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/30"
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="w-4 h-4"
            aria-hidden="true"
          >
            <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
