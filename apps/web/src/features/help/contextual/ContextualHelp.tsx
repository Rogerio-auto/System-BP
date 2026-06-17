// =============================================================================
// features/help/contextual/ContextualHelp.tsx
//
// Ícone ⓘ que abre o Drawer de ajuda contextual.
//
// Norma 21 §7:
//   - Não renderiza nada se não há tutorial ativo para featureKey.
//   - Não renderiza nada se o usuário não tem permissão na funcionalidade
//     (RBAC de exibição — não anunciar o que o usuário não pode usar).
//   - Atributo data-help-contextual preserva âncora para tours (F11).
//
// Design System:
//   - Ícone 16×16 inline, cor --text-3, hover --text.
//   - Área clicável mínima 40×40 (norma DS §inegociável).
//   - Hover: color transition 150ms.
//   - Focus: ring-2 ring-azul/20.
//
// Uso:
//   <ContextualHelp featureKey="crm.lead.create" />
//   <ContextualHelp featureKey="crm.lead.create" permission="leads:read" />
//   <ContextualHelp featureKey="crm.lead.create" className="ml-1.5" />
// =============================================================================

import * as React from 'react';

import { useAuth } from '../../../lib/auth-store';
import { cn } from '../../../lib/cn';

import { useContextualHelpStore, type DrawerTutorial } from './contextual-help-store';
import { useContextualTutorials } from './useContextualTutorials';
import { useTrackTutorialEvent } from './useTrackTutorialEvent';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ContextualHelpProps {
  /**
   * Chave da funcionalidade (ex.: "crm.lead.create").
   * Deve corresponder a uma entrada no catálogo de feature_keys (norma 21 §4.1).
   */
  featureKey: string;
  /**
   * Permissão RBAC que o usuário precisa ter para ver o ⓘ.
   * Se omitida, apenas verifica se há tutorial ativo.
   *
   * Deve ser a mesma permissão que protege a funcionalidade — evita
   * revelar ao usuário funcionalidades que ele não pode usar.
   */
  permission?: string;
  /** Classe CSS adicional no botão. Útil para margin/spacing no contexto. */
  className?: string;
}

// ─── Ícone ⓘ (information circle) ───────────────────────────────────────────

function InfoIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
      style={{ width: 16, height: 16, display: 'block', flexShrink: 0 }}
    >
      <circle cx="8" cy="8" r="6.5" />
      {/* Ponto */}
      <circle cx="8" cy="5.5" r="0.6" fill="currentColor" stroke="none" />
      {/* Linha vertical */}
      <path d="M8 7.5v3" strokeLinecap="round" />
    </svg>
  );
}

// ─── Componente ──────────────────────────────────────────────────────────────

/**
 * Ícone ⓘ de ajuda contextual.
 *
 * Só renderiza quando:
 *   1. Há tutorial ativo para featureKey (do cache TanStack Query).
 *   2. O usuário tem a permissão especificada (se `permission` for passado).
 *
 * Abre o ContextualHelpDrawer global (singleton em AppLayout) via Zustand.
 */
export function ContextualHelp({
  featureKey,
  permission,
  className,
}: ContextualHelpProps): React.JSX.Element | null {
  const { tutorialsByKey, isLoading } = useContextualTutorials();
  const { hasPermission } = useAuth();
  const openDrawer = useContextualHelpStore((s) => s.openDrawer);
  const trackEvent = useTrackTutorialEvent();

  // Ainda carregando — não renderiza nada (evita flash do ícone).
  if (isLoading) return null;

  // Sem tutorial ativo para esta key → silencioso.
  const tutorial = tutorialsByKey[featureKey];
  if (!tutorial) return null;

  // Verificação RBAC — se permission foi fornecida, o usuário precisa tê-la.
  if (permission && !hasPermission(permission)) return null;

  // Construído no escopo já narrowed (tutorial != undefined). A narrowing de
  // `tutorial` não atravessa a fronteira do closure handleClick, então o objeto
  // é montado aqui e apenas referenciado dentro do handler.
  const drawerTutorial: DrawerTutorial = {
    id: tutorial.id,
    title: tutorial.title,
    description: tutorial.description,
    provider: tutorial.provider,
    videoRef: tutorial.videoRef,
    hash: tutorial.hash ?? undefined,
    articleSlug: tutorial.articleSlug,
    featureKey: tutorial.featureKey,
  };

  function handleClick(e: React.MouseEvent<HTMLButtonElement>): void {
    // Evitar propagação para o elemento pai (ex.: botão de ação primária).
    e.stopPropagation();
    openDrawer(drawerTutorial);
    // Telemetria: registra tutorial_opened fire-and-forget (F12-S07).
    // Rate-limit no servidor de 30s — cliques rápidos são silenciados.
    trackEvent({
      tutorialId: drawerTutorial.id,
      featureKey: drawerTutorial.featureKey,
      eventType: 'tutorial_opened',
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      data-help-contextual={featureKey}
      aria-label={`Ajuda sobre ${tutorial.title}`}
      title={`Ver tutorial: ${tutorial.title}`}
      className={cn(
        // Área mínima 40×40 (DS §inegociável) — padding compensa ícone 16px.
        'inline-flex items-center justify-center',
        'w-10 h-10 rounded-sm',
        'transition-colors duration-[150ms]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
        className,
      )}
      style={{
        color: 'var(--text-3)',
        background: 'transparent',
        padding: '0.75rem',
        // Área visual menor que a área clicável — ícone 16px dentro de 40px.
        boxSizing: 'border-box',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--brand-azul)';
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-3)';
        (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
      }}
      onMouseDown={(e) => {
        // Active/pressed state.
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--brand-azul-deep)';
      }}
      onMouseUp={(e) => {
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--brand-azul)';
      }}
    >
      <InfoIcon />
    </button>
  );
}
