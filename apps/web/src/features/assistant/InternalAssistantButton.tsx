// =============================================================================
// features/assistant/InternalAssistantButton.tsx — Botão do Assistente IA interno.
//
// Doc 05 §7 / doc 22: quando a flag `ai.internal_assistant.enabled` estiver
// ligada E o usuário tiver a permissão `ai_assistant:use`, o botão abre o
// workspace fullscreen do copiloto (AssistantWorkspaceModal, F6-S12 —
// substitui o drawer lateral de F6-S09) consumindo
// POST /api/internal-assistant/query. Caso contrário, mantém o teaser
// honesto ("em breve") — comportamento original desta superfície (F1).
//
// Gating é defesa em profundidade: o backend também aplica authorize() +
// featureGate() na rota (fonte de verdade).
// =============================================================================

import * as React from 'react';

import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { useAuth } from '../auth/useAuth';

import { AssistantTeaserPopover } from './components/AssistantTeaserPopover';
import { AssistantWorkspaceModal } from './components/AssistantWorkspaceModal';
import { SparkleIcon } from './components/SparkleIcon';

/**
 * Botão do Assistente interno na Topbar.
 *
 * Gated por flag `ai.internal_assistant.enabled` + permissão `ai_assistant:use`:
 *   - Liberado → abre o AssistantWorkspaceModal (workspace fullscreen, F6-S12).
 *   - Bloqueado → mantém o popover de teaser honesto ("em breve").
 * Fecha ao clicar fora (teaser) ou Escape (ambos).
 */
export function InternalAssistantButton(): React.JSX.Element {
  const [open, setOpen] = React.useState(false); // popover de teaser
  const [chatOpen, setChatOpen] = React.useState(false); // workspace fullscreen
  const containerRef = React.useRef<HTMLDivElement>(null);

  const { hasPermission } = useAuth();
  const { enabled: flagEnabled } = useFeatureFlag('ai.internal_assistant.enabled');
  const canUseAssistant = flagEnabled && hasPermission('ai_assistant:use');

  // O teaser é a única superfície com clique-fora — o workspace usa overlay próprio.
  React.useEffect(() => {
    if (!open || canUseAssistant) return;
    function onPointerDown(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, canUseAssistant]);

  function handleClick(): void {
    if (canUseAssistant) {
      setChatOpen((v) => !v);
    } else {
      setOpen((v) => !v);
    }
  }

  const isActive = canUseAssistant ? chatOpen : open;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={handleClick}
        aria-label={canUseAssistant ? 'Assistente interno' : 'Assistente interno (em breve)'}
        aria-expanded={isActive}
        className="inline-flex items-center gap-1.5 rounded-sm transition-all duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20"
        style={{
          height: 32,
          paddingLeft: 'var(--space-2)',
          paddingRight: 'var(--space-2)',
          color: isActive ? 'var(--brand-azul)' : 'var(--text-3)',
          background: isActive
            ? 'color-mix(in srgb, var(--brand-azul) 10%, transparent)'
            : 'transparent',
        }}
        onMouseEnter={(e) => {
          if (!isActive) {
            (e.currentTarget as HTMLElement).style.color = 'var(--text)';
            (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)';
          }
        }}
        onMouseLeave={(e) => {
          if (!isActive) {
            (e.currentTarget as HTMLElement).style.color = 'var(--text-3)';
            (e.currentTarget as HTMLElement).style.background = 'transparent';
          }
        }}
      >
        <SparkleIcon className="w-[18px] h-[18px] shrink-0" />
        <span className="hidden md:inline font-sans" style={{ fontSize: 'var(--text-sm)' }}>
          Assistente
        </span>
        {!canUseAssistant && (
          <span
            className="hidden sm:inline font-sans font-semibold uppercase"
            style={{
              fontSize: '9px',
              letterSpacing: '0.06em',
              lineHeight: 1,
              padding: '2px 5px',
              borderRadius: 'var(--radius-pill)',
              color: 'var(--verde)',
              background: 'color-mix(in srgb, var(--verde) 14%, transparent)',
            }}
          >
            em breve
          </span>
        )}
      </button>

      {canUseAssistant && chatOpen && (
        <AssistantWorkspaceModal onClose={() => setChatOpen(false)} hasPermission={hasPermission} />
      )}

      {!canUseAssistant && open && <AssistantTeaserPopover />}
    </div>
  );
}
