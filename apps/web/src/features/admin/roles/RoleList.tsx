// =============================================================================
// features/admin/roles/RoleList.tsx — Coluna esquerda: lista de papéis.
//
// - Cada papel é um botão selecionável (listbox acessível)
// - Papel selecionado: borda esquerda azul + bg sutil
// - Scope badge: Global (azul) | Cidade (verde)
// - Estado: loading skeleton (5 itens), vazio, lista
// =============================================================================

import * as React from 'react';

import { cn } from '../../../lib/cn';

import type { RoleDto } from './api';

// ─── Scope badge ─────────────────────────────────────────────────────────────

function ScopeBadge({ scope }: { scope: 'global' | 'city' }): React.JSX.Element {
  const isGlobal = scope === 'global';
  return (
    <span
      className="inline-flex items-center rounded-pill px-2 py-0.5 font-sans text-xs font-medium shrink-0"
      style={{
        backgroundColor: isGlobal ? 'var(--info-bg)' : 'var(--success-bg)',
        color: isGlobal ? 'var(--info)' : 'var(--success)',
      }}
    >
      {isGlobal ? 'Global' : 'Cidade'}
    </span>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function RoleListSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 p-3" aria-label="Carregando papéis" aria-busy="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="h-14 rounded-md animate-pulse"
          style={{ background: 'var(--surface-muted)' }}
        />
      ))}
    </div>
  );
}

// ─── Componente ──────────────────────────────────────────────────────────────

interface RoleListProps {
  roles: RoleDto[];
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function RoleList({
  roles,
  isLoading,
  selectedId,
  onSelect,
}: RoleListProps): React.JSX.Element {
  return (
    <div
      className="rounded-lg border border-border overflow-hidden flex flex-col"
      style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-2)' }}
    >
      {/* Panel header */}
      <div
        className="px-4 py-3 border-b border-border-subtle"
        style={{ background: 'var(--bg-elev-2)' }}
      >
        <p
          className="font-sans font-semibold text-ink"
          style={{ fontSize: 'var(--text-sm)', letterSpacing: '-0.01em' }}
        >
          Papéis
        </p>
      </div>

      {isLoading ? (
        <RoleListSkeleton />
      ) : roles.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <p className="font-sans text-sm" style={{ color: 'var(--text-3)' }}>
            Nenhum papel encontrado.
          </p>
        </div>
      ) : (
        <ul role="listbox" aria-label="Papéis disponíveis" className="flex flex-col">
          {roles.map((role, idx) => {
            const isSelected = role.id === selectedId;
            return (
              <li
                key={role.id}
                role="option"
                aria-selected={isSelected}
                style={{
                  borderBottom: idx < roles.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                }}
              >
                <button
                  type="button"
                  onClick={() => onSelect(role.id)}
                  className={cn(
                    'w-full text-left px-4 py-3 transition-colors duration-fast',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset',
                    'focus-visible:ring-azul/20',
                    isSelected ? 'bg-[rgba(27,58,140,0.05)]' : 'hover:bg-surface-hover',
                  )}
                  style={{
                    borderLeft: isSelected
                      ? '3px solid var(--brand-azul)'
                      : '3px solid transparent',
                  }}
                >
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span
                      className={cn(
                        'font-sans font-semibold truncate',
                        isSelected ? 'text-azul' : 'text-ink',
                      )}
                      style={{ fontSize: 'var(--text-sm)' }}
                    >
                      {role.name}
                    </span>
                    <ScopeBadge scope={role.scope} />
                  </div>
                  {role.description && (
                    <p
                      className="font-sans text-xs line-clamp-2 text-left"
                      style={{ color: 'var(--text-3)' }}
                    >
                      {role.description}
                    </p>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
