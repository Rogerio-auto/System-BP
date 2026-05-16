// =============================================================================
// features/dashboard/components/ChannelBars.tsx — Bar chart horizontal de
// volume de interações por canal.
//
// SVG manual (sem dep externa). Barras horizontais com label + valor.
// Cores dos tokens DS. Funciona em light + dark.
// =============================================================================

import * as React from 'react';

import type { InteractionsByChannelItem } from '../../../hooks/dashboard/types';

interface ChannelBarsProps {
  data: InteractionsByChannelItem[];
  totalInRange: number;
}

// Mapeamento canal → label legível
const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  phone: 'Telefone',
  email: 'E-mail',
  in_person: 'Presencial',
  chatwoot: 'Chatwoot',
};

// Cores por canal usando tokens DS
const CHANNEL_COLORS: Record<string, string> = {
  whatsapp: 'var(--success)',
  phone: 'var(--brand-azul)',
  email: 'var(--info)',
  in_person: 'var(--brand-verde)',
  chatwoot: 'var(--brand-amarelo)',
};

/**
 * Bar chart horizontal SVG de interações por canal.
 * Sem dep externa — SVG puro com barras responsivas via CSS.
 */
export function ChannelBars({ data, totalInRange }: ChannelBarsProps): React.JSX.Element {
  const sorted = [...data].sort((a, b) => b.count - a.count);
  const maxCount = sorted[0]?.count ?? 0;
  const isEmpty = totalInRange === 0 || sorted.length === 0;

  return (
    <div
      className="rounded-md border border-border bg-surface-1 p-5"
      style={{ boxShadow: 'var(--elev-2)' }}
    >
      <p
        className="font-sans font-semibold uppercase mb-1"
        style={{ fontSize: '0.7rem', letterSpacing: '0.12em', color: 'var(--text-3)' }}
      >
        Interações por canal
      </p>
      <p
        className="font-mono mb-4"
        style={{
          fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
          fontSize: '0.7rem',
          color: 'var(--text-4)',
        }}
      >
        {totalInRange.toLocaleString('pt-BR')} total no período
      </p>

      {isEmpty ? (
        <div className="flex items-center justify-center py-8" style={{ color: 'var(--text-3)' }}>
          <p className="font-sans text-sm">Sem interações no período selecionado.</p>
        </div>
      ) : (
        <ul
          className="flex flex-col gap-3"
          aria-label="Gráfico de barras horizontais — interações por canal"
        >
          {sorted.map((item) => {
            const label = CHANNEL_LABELS[item.channel] ?? item.channel;
            const color = CHANNEL_COLORS[item.channel] ?? 'var(--brand-azul)';
            const pct = maxCount > 0 ? (item.count / maxCount) * 100 : 0;
            const totalPct = totalInRange > 0 ? Math.round((item.count / totalInRange) * 100) : 0;

            return (
              <li key={item.channel} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-sans font-medium" style={{ color: 'var(--text-2)' }}>
                    {label}
                  </span>
                  <span
                    className="font-mono tabular-nums"
                    style={{
                      fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
                      color: 'var(--text-3)',
                    }}
                  >
                    {item.count.toLocaleString('pt-BR')}
                    <span className="ml-1 opacity-60">({totalPct}%)</span>
                  </span>
                </div>
                {/* Barra horizontal */}
                <div
                  className="h-2 rounded-pill overflow-hidden"
                  style={{ background: 'var(--surface-muted)' }}
                  role="presentation"
                  aria-hidden="true"
                >
                  <div
                    className="h-full rounded-pill transition-all duration-slow"
                    style={{
                      width: `${pct}%`,
                      background: color,
                      minWidth: pct > 0 ? '4px' : '0',
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export function ChannelBarsSkeleton(): React.JSX.Element {
  return (
    <div
      className="rounded-md border border-border bg-surface-1 p-5"
      style={{ boxShadow: 'var(--elev-2)', minHeight: '200px' }}
    >
      <div
        className="mb-4 h-2.5 w-36 rounded-pill animate-pulse"
        style={{ background: 'var(--surface-muted)' }}
      />
      <div className="flex flex-col gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="flex justify-between">
              <div
                className="h-2.5 w-20 rounded-pill animate-pulse"
                style={{ background: 'var(--surface-muted)' }}
              />
              <div
                className="h-2.5 w-10 rounded-pill animate-pulse"
                style={{ background: 'var(--surface-muted)' }}
              />
            </div>
            <div
              className="h-2 rounded-pill animate-pulse"
              style={{ background: 'var(--surface-muted)', width: `${60 - i * 10}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
