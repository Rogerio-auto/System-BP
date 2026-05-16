// =============================================================================
// features/dashboard/components/TopAgentsTable.tsx — Tabela compacta de
// top agentes por leads fechados (closed_won).
//
// DS §9.7 Tabela: bg-elev-1, elev-2, th uppercase tracking, hover de linha.
// DS §9.10 Avatar: grad-rondonia (ou variante), iniciais Geist 700.
// LGPD: displayName é nome de trabalho interno (art. 7°, IX), não PII de cidadão.
// =============================================================================

import * as React from 'react';

import { Avatar } from '../../../components/ui/Avatar';
import type { AvatarVariant } from '../../../components/ui/Avatar';
import type { TopAgentItem } from '../../../hooks/dashboard/types';

interface TopAgentsTableProps {
  agents: TopAgentItem[];
}

// Variantes de avatar cicladas pelos agentes (sem sólido — sempre gradient)
const AVATAR_VARIANTS: AvatarVariant[] = ['rondonia', 'azul', 'verde', 'amarelo'];

/**
 * Tabela compacta de top agentes por leads fechados.
 * Hover de linha via bg-surface-hover.
 * Avatar com gradiente (nunca sólido — DS §9.10).
 */
export function TopAgentsTable({ agents }: TopAgentsTableProps): React.JSX.Element {
  const isEmpty = agents.length === 0;

  return (
    <div
      className="overflow-hidden rounded-md border border-border"
      style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-2)' }}
    >
      {/* Header da tabela */}
      <div className="px-5 py-3 border-b border-border" style={{ background: 'var(--bg-elev-2)' }}>
        <p
          className="font-sans font-semibold uppercase"
          style={{ fontSize: '0.7rem', letterSpacing: '0.12em', color: 'var(--text-3)' }}
        >
          Top agentes — leads fechados
        </p>
      </div>

      {isEmpty ? (
        <div className="flex items-center justify-center py-10" style={{ color: 'var(--text-3)' }}>
          <p className="font-sans text-sm">Sem agentes com leads fechados no período.</p>
        </div>
      ) : (
        <table className="w-full" aria-label="Top agentes por leads fechados">
          <thead>
            <tr style={{ background: 'var(--bg-elev-2)' }}>
              <th
                scope="col"
                className="px-5 py-2.5 text-left font-sans font-bold uppercase"
                style={{
                  fontSize: '0.65rem',
                  letterSpacing: '0.1em',
                  color: 'var(--text-3)',
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                #
              </th>
              <th
                scope="col"
                className="px-5 py-2.5 text-left font-sans font-bold uppercase"
                style={{
                  fontSize: '0.65rem',
                  letterSpacing: '0.1em',
                  color: 'var(--text-3)',
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                Agente
              </th>
              <th
                scope="col"
                className="px-5 py-2.5 text-right font-sans font-bold uppercase"
                style={{
                  fontSize: '0.65rem',
                  letterSpacing: '0.1em',
                  color: 'var(--text-3)',
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                Fechados
              </th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent, idx) => {
              const variant = AVATAR_VARIANTS[idx % AVATAR_VARIANTS.length] ?? 'rondonia';
              return (
                <tr
                  key={agent.agentId}
                  className="transition-colors duration-fast"
                  style={{ borderBottom: '1px solid var(--border-subtle)' }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLTableRowElement).style.background =
                      'var(--surface-hover)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLTableRowElement).style.background = '';
                  }}
                >
                  {/* Posição */}
                  <td
                    className="px-5 py-3 font-mono tabular-nums"
                    style={{
                      fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: 'var(--text-3)',
                    }}
                  >
                    {idx + 1}
                  </td>

                  {/* Avatar + Nome */}
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={agent.displayName} variant={variant} size="sm" />
                      <span
                        className="font-sans font-medium text-sm"
                        style={{ color: 'var(--text)' }}
                      >
                        {agent.displayName}
                      </span>
                    </div>
                  </td>

                  {/* Closed won */}
                  <td
                    className="px-5 py-3 text-right font-mono tabular-nums"
                    style={{
                      fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      color: 'var(--success)',
                    }}
                  >
                    {agent.closedWon.toLocaleString('pt-BR')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export function TopAgentsTableSkeleton(): React.JSX.Element {
  return (
    <div
      className="overflow-hidden rounded-md border border-border"
      style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-2)' }}
    >
      <div className="px-5 py-3 border-b border-border" style={{ background: 'var(--bg-elev-2)' }}>
        <div
          className="h-2.5 w-40 rounded-pill animate-pulse"
          style={{ background: 'var(--surface-muted)' }}
        />
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-7 h-7 rounded-pill animate-pulse shrink-0"
              style={{ background: 'var(--surface-muted)' }}
            />
            <div
              className="h-3 w-32 rounded-pill animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
          </div>
          <div
            className="h-3 w-8 rounded-pill animate-pulse"
            style={{ background: 'var(--surface-muted)' }}
          />
        </div>
      ))}
    </div>
  );
}
