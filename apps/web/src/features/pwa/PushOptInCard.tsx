// =============================================================================
// features/pwa/PushOptInCard.tsx — Opt-in de notificações push (doc 24 §5.4,
// F27-S07).
//
// Superfície: dropdown de notificações (sino, features/notifications) via a
// variante `compact` — `NotificationDropdown.tsx` renderiza
// `<PushOptInCard compact />` no rodapé do painel. Atrás da flag `pwa.enabled`
// (UI) — com a flag off ou ainda carregando, NADA é renderizado (doc 24 §7).
//
// A permissão do navegador só é pedida dentro do `onClick` do botão "Ativar"
// (gesto do usuário) — nunca no mount/load. Estados: suporte do browser,
// permissão negada, carregando, ativo/inativo, erro — cada um com feedback
// visual próprio (tokens do DS, sem cor hardcoded).
// =============================================================================

import * as React from 'react';

import { Button } from '../../components/ui/Button';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';

import { detectPushUnsupportedReason, isStandaloneDisplayMode } from './platform';
import { usePushSubscription } from './usePushSubscription';

function BellGlyph({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className={className ?? 'w-5 h-5 shrink-0'}
      aria-hidden="true"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

/** Bloco informativo com ícone + texto — usado nos estados "não suportado" e "bloqueado". */
function InfoBlock({
  background,
  textColor,
  children,
}: {
  background: string;
  textColor?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className="flex items-start gap-2.5 p-3 rounded-md border border-border"
      style={{ background }}
    >
      <BellGlyph className="w-4 h-4 shrink-0 mt-0.5" />
      <p
        className="font-sans"
        style={{ fontSize: 'var(--text-xs)', color: textColor ?? 'var(--text-3)' }}
      >
        {children}
      </p>
    </div>
  );
}

export interface PushOptInCardProps {
  /**
   * Variante compacta — sem chrome de card próprio (borda/sombra/padding
   * grande), pensada para viver dentro de outro container (ex: rodapé do
   * dropdown de notificações). Default: card completo, standalone.
   */
  compact?: boolean;
}

export function PushOptInCard({ compact = false }: PushOptInCardProps): React.JSX.Element | null {
  const { enabled: flagEnabled, isLoading: flagLoading } = useFeatureFlag('pwa.enabled');
  const push = usePushSubscription();

  // Flag off (ou ainda resolvendo) — a UI de push nem existe (doc 24 §7 camada UI).
  if (flagLoading || !flagEnabled) return null;

  const unsupportedReason = push.supported
    ? null
    : detectPushUnsupportedReason({
        supported: push.supported,
        userAgent: navigator.userAgent,
        standalone: isStandaloneDisplayMode(),
      });

  const content = (
    <>
      {!compact && (
        <div className="flex flex-col gap-1">
          <h2
            className="font-sans font-semibold text-ink"
            style={{ fontSize: 'var(--text-sm)', letterSpacing: '-0.01em' }}
          >
            Notificações no navegador
          </h2>
          <p className="font-sans text-ink-3" style={{ fontSize: 'var(--text-xs)' }}>
            Receba um aviso no dispositivo mesmo com o Manager fechado. O conteúdo real só aparece
            depois que você abre o app e entra na sua conta.
          </p>
        </div>
      )}

      {compact && (
        <p className="font-sans font-medium text-ink" style={{ fontSize: 'var(--text-xs)' }}>
          Notificações no navegador
        </p>
      )}

      {!push.supported && (
        <InfoBlock background="var(--surface-muted)">
          {unsupportedReason === 'ios-not-installed'
            ? 'No iPhone/iPad, adicione o Manager à Tela de Início (Compartilhar → Adicionar à Tela de Início) para poder ativar notificações.'
            : 'Seu navegador não suporta notificações push. Tente Chrome, Edge ou Safari 16.4+.'}
        </InfoBlock>
      )}

      {push.supported && push.isLoading && (
        <div
          className="animate-pulse h-12 rounded-md"
          style={{ background: 'var(--surface-muted)' }}
        />
      )}

      {push.supported && !push.isLoading && push.permission === 'denied' && (
        <InfoBlock background="var(--warning-bg)" textColor="var(--warning)">
          Você bloqueou notificações para este site. Habilite manualmente nas configurações do
          navegador para ativar.
        </InfoBlock>
      )}

      {push.supported && !push.isLoading && push.permission !== 'denied' && (
        <div
          className={
            compact
              ? 'flex items-center justify-between gap-3'
              : 'flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 rounded-md border border-border'
          }
          style={compact ? undefined : { background: 'var(--surface-muted)' }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {!compact && (
              <span
                className="flex items-center justify-center w-9 h-9 rounded-md shrink-0"
                style={{
                  background: push.subscribed ? 'var(--success-bg)' : 'var(--bg-elev-0)',
                  color: push.subscribed ? 'var(--success)' : 'var(--text-3)',
                }}
                aria-hidden="true"
              >
                <BellGlyph />
              </span>
            )}
            <div className="min-w-0">
              {!compact && (
                <p
                  className="font-sans font-medium text-ink"
                  style={{ fontSize: 'var(--text-sm)' }}
                >
                  {push.subscribed ? 'Notificações ativadas' : 'Notificações desativadas'}
                </p>
              )}
              <p className="font-sans text-ink-3 truncate" style={{ fontSize: 'var(--text-xs)' }}>
                {push.subscribed
                  ? 'Ativadas neste dispositivo.'
                  : 'Receba avisos mesmo com o app fechado.'}
              </p>
            </div>
          </div>

          <Button
            type="button"
            variant={push.subscribed ? 'ghost' : 'primary'}
            size="sm"
            disabled={push.isSubscribing || push.isUnsubscribing}
            className="shrink-0"
            onClick={() => {
              if (push.subscribed) push.unsubscribe();
              else push.subscribe();
            }}
          >
            {push.isSubscribing
              ? 'Ativando…'
              : push.isUnsubscribing
                ? 'Desativando…'
                : push.subscribed
                  ? 'Desativar'
                  : 'Ativar'}
          </Button>
        </div>
      )}

      {push.error && (
        <p role="alert" className="font-sans text-danger" style={{ fontSize: 'var(--text-xs)' }}>
          {push.error}
        </p>
      )}
    </>
  );

  if (compact) {
    return (
      <div
        className="flex flex-col gap-2 px-4 py-3 shrink-0"
        style={{ borderTop: '1px solid var(--border-subtle)' }}
      >
        {content}
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border border-border p-6 flex flex-col gap-5"
      style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-2)' }}
    >
      {content}
    </div>
  );
}
