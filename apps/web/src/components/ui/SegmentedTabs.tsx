// =============================================================================
// components/ui/SegmentedTabs.tsx — Controle de abas/segmento canônico (DS §9).
//
// Exibe uma fila de abas horizontais. Cada aba pode ter rótulo e contador.
// A aba ativa é destacada com a cor fornecida (default: var(--brand-azul)).
//
// Design:
//   - Container: bg-elev-1, border-subtle, border-radius-sm, elev-1 (profundidade física).
//   - Tab ativa: bg com opacidade da cor, borda inferior colorida, texto na cor.
//   - Tab inativa: text-3, hover com surface-hover sutil.
//   - Contador: pill pequeno alinhado ao rótulo.
//   - Horizontal scroll automático em espaços apertados (overflow-x: auto).
//   - Light-first + dark first-class via tokens CSS.
//   - 4 estados: default, hover, active, focus (ring-2).
//   - Respeita prefers-reduced-motion.
//
// Uso:
//   <SegmentedTabs
//     tabs={[{ value: 'all', label: 'Todas', count: 12 }, ...]}
//     value="all"
//     onChange={(v) => setFilter(v)}
//   />
//
// NÃO usar fora de componentes que gerenciam estado de filtro de lista.
// =============================================================================

import * as React from 'react';

import { cn } from '../../lib/cn';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface SegmentedTab<T extends string = string> {
  /** Valor único da aba — passado ao onChange */
  readonly value: T;
  /** Rótulo exibido */
  readonly label: string;
  /**
   * Número exibido ao lado do rótulo.
   * undefined = não exibir contador.
   * 0 = exibir "0" (válido — pode indicar fila vazia).
   *
   * Aceita `number | undefined` explicitamente para compatibilidade com
   * `exactOptionalPropertyTypes` ao passar dados que podem estar carregando.
   */
  readonly count?: number | undefined;
  /**
   * Cor da aba quando ativa (hex ou CSS var).
   * Default: var(--brand-azul).
   */
  readonly activeColor?: string;
}

export interface SegmentedTabsProps<T extends string = string> {
  readonly tabs: SegmentedTab<T>[];
  /** Valor da aba ativa */
  readonly value: T;
  /** Callback chamado quando o usuário seleciona uma aba */
  readonly onChange: (value: T) => void;
  readonly className?: string;
  /** aria-label do container para acessibilidade */
  readonly 'aria-label'?: string;
}

// ---------------------------------------------------------------------------
// Sub-componente: badge de contador
// ---------------------------------------------------------------------------

function CountPill({
  count,
  active,
  color,
}: {
  count: number;
  active: boolean;
  color: string;
}): React.JSX.Element {
  return (
    <span
      aria-label={`${count} itens`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 18,
        height: 16,
        padding: '0 5px',
        borderRadius: 'var(--radius-pill)',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        fontWeight: 600,
        lineHeight: 1,
        letterSpacing: '-0.01em',
        background: active
          ? `color-mix(in srgb, ${color} 18%, transparent)`
          : 'var(--surface-muted)',
        color: active ? color : 'var(--text-3)',
        transition: `background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease)`,
        flexShrink: 0,
      }}
    >
      {count}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

/**
 * SegmentedTabs — fila de abas com contador opcional.
 *
 * Genérico: <SegmentedTabs<StatusFilter> .../> preserva o tipo do value.
 * Sem genérico explícito, infere T = string.
 */
export function SegmentedTabs<T extends string = string>({
  tabs,
  value,
  onChange,
  className,
  'aria-label': ariaLabel = 'Filtro',
}: SegmentedTabsProps<T>): React.JSX.Element {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn('flex gap-0.5 overflow-x-auto', className)}
      style={{
        background: 'var(--bg-inset)',
        borderRadius: 'var(--radius-sm)',
        padding: 3,
        boxShadow: 'inset 0 1px 2px rgba(20, 33, 61, 0.06)',
        scrollbarWidth: 'none', // Firefox
        msOverflowStyle: 'none', // IE/Edge
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.value === value;
        const color = tab.activeColor ?? 'var(--brand-azul)';

        return (
          <button
            key={tab.value}
            role="tab"
            type="button"
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab.value}`}
            onClick={() => onChange(tab.value)}
            className={cn(
              'relative flex items-center gap-1.5',
              'px-2.5 py-1.5',
              'rounded-[4px]',
              'font-sans font-medium whitespace-nowrap',
              'cursor-pointer select-none',
              'transition-all',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
              'focus-visible:ring-azul',
              // Hover apenas para inativas — ativa já tem estilo próprio
              !isActive && 'hover:bg-surface-hover',
            )}
            style={{
              fontSize: 'var(--text-xs)',
              letterSpacing: '0.01em',
              flex: '1 1 0',
              justifyContent: 'center',
              minWidth: 0,
              // Estado ativo: fundo colorido levemente + elev-1 (carta elevada)
              background: isActive
                ? `color-mix(in srgb, ${color} 10%, var(--bg-elev-1))`
                : 'transparent',
              color: isActive ? color : 'var(--text-3)',
              boxShadow: isActive ? 'var(--elev-1)' : 'none',
              // Borda sutil na aba ativa para reforçar a seleção
              border: isActive
                ? `1px solid color-mix(in srgb, ${color} 25%, transparent)`
                : '1px solid transparent',
              transitionDuration: 'var(--dur-fast)',
              transitionTimingFunction: 'var(--ease)',
            }}
          >
            {/* Rótulo */}
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                minWidth: 0,
                fontWeight: isActive ? 600 : 500,
              }}
            >
              {tab.label}
            </span>

            {/* Contador — só renderiza se count é um número */}
            {tab.count !== undefined && (
              <CountPill count={tab.count} active={isActive} color={color} />
            )}
          </button>
        );
      })}
    </div>
  );
}
