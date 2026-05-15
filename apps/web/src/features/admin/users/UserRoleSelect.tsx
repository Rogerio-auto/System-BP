// =============================================================================
// features/admin/users/UserRoleSelect.tsx — Multi-select de roles com Badge chips.
//
// DS:
//   - Badge chips para roles selecionadas (variant info)
//   - Dropdown com opções disponíveis (elev-3)
//   - Bloqueia remoção da última role admin (Toast warning via onLastAdminWarning)
//   - Hover/focus states canônicos
//
// Props:
//   - value: string[] — IDs das roles selecionadas
//   - onChange: (ids: string[]) => void
//   - roles: RoleOption[] — opções disponíveis (do useRoles())
//   - disabled?: boolean
//   - error?: string
//   - isAdminUser?: boolean — se true, bloqueia remover role admin quando é o único
// =============================================================================

import * as React from 'react';

import { Badge } from '../../../components/ui/Badge';
import type { RoleOption } from '../../../hooks/admin/useUsers.types';
import { GLOBAL_ROLE_KEYS, ROLE_LABELS } from '../../../hooks/admin/useUsers.types';
import { cn } from '../../../lib/cn';

interface UserRoleSelectProps {
  value: string[];
  onChange: (ids: string[]) => void;
  roles: RoleOption[];
  disabled?: boolean;
  error?: string | undefined;
  onLastAdminWarning?: (() => void) | undefined;
}

/**
 * Multi-select de roles com chips Badge.
 * Dropdown controlado com teclado (Escape fecha).
 */
export function UserRoleSelect({
  value,
  onChange,
  roles,
  disabled = false,
  error,
  onLastAdminWarning,
}: UserRoleSelectProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Fechar ao clicar fora
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Fechar com Escape
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const selectedRoles = roles.filter((r) => value.includes(r.id));
  const availableRoles = roles.filter((r) => !value.includes(r.id));

  function handleAdd(roleId: string): void {
    onChange([...value, roleId]);
    setOpen(false);
  }

  function handleRemove(roleId: string): void {
    const role = roles.find((r) => r.id === roleId);
    if (role?.key === 'admin') {
      const adminRoles = value.filter((id) => {
        const r = roles.find((ro) => ro.id === id);
        return r?.key === 'admin';
      });
      if (adminRoles.length <= 1) {
        onLastAdminWarning?.();
        return;
      }
    }
    onChange(value.filter((id) => id !== roleId));
  }

  /** Determina variante do Badge pela role key */
  function getRoleBadgeVariant(key: string): 'info' | 'warning' | 'neutral' {
    if (key === 'admin') return 'warning';
    if (GLOBAL_ROLE_KEYS.has(key)) return 'info';
    return 'neutral';
  }

  /** Label da role (fallback para key se não mapeado) */
  function getRoleLabel(role: RoleOption): string {
    return ROLE_LABELS[role.key] ?? role.label;
  }

  return (
    <div ref={containerRef} className="flex flex-col gap-2">
      {/* Chips das roles selecionadas */}
      {selectedRoles.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedRoles.map((role) => (
            <span key={role.id} className="inline-flex items-center gap-1">
              <Badge variant={getRoleBadgeVariant(role.key)}>{getRoleLabel(role)}</Badge>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => handleRemove(role.id)}
                  aria-label={`Remover role ${getRoleLabel(role)}`}
                  className={cn(
                    'w-4 h-4 flex items-center justify-center rounded-pill',
                    'text-ink-3 hover:text-danger hover:bg-danger/10',
                    'transition-colors duration-fast',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-azul/30',
                  )}
                >
                  <svg
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    className="w-2.5 h-2.5"
                    aria-hidden="true"
                  >
                    <path d="M3 3l6 6M9 3l-6 6" />
                  </svg>
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Trigger de abertura */}
      {!disabled && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            disabled={disabled || availableRoles.length === 0}
            aria-expanded={open}
            aria-haspopup="listbox"
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2 rounded-sm text-sm text-left',
              'border transition-[border-color,box-shadow] duration-fast ease',
              'font-sans font-medium',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
              error
                ? 'border-danger text-danger'
                : 'border-border-strong text-ink-3 hover:border-ink-3 hover:text-ink',
            )}
            style={{
              background: 'var(--surface-1)',
              boxShadow: 'inset 0 1px 2px var(--border-inner-dark)',
            }}
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              className="w-4 h-4 shrink-0"
              aria-hidden="true"
            >
              <path d="M8 3v10M3 8h10" />
            </svg>
            <span>
              {availableRoles.length === 0 ? 'Todas as roles atribuídas' : 'Adicionar role'}
            </span>
          </button>

          {open && availableRoles.length > 0 && (
            <div
              role="listbox"
              aria-label="Roles disponíveis"
              className="absolute top-full left-0 mt-1 w-full rounded-sm border border-border z-20"
              style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-3)' }}
            >
              {availableRoles.map((role) => (
                <button
                  key={role.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => handleAdd(role.id)}
                  className={cn(
                    'flex items-center gap-2.5 w-full px-4 py-2.5',
                    'font-sans text-sm text-ink-2 hover:text-ink',
                    'hover:bg-surface-hover',
                    'transition-colors duration-fast text-left',
                    'focus-visible:outline-none focus-visible:bg-surface-hover',
                  )}
                >
                  <Badge variant={getRoleBadgeVariant(role.key)}>{getRoleLabel(role)}</Badge>
                  {GLOBAL_ROLE_KEYS.has(role.key) && (
                    <span className="text-xs text-ink-4 ml-auto">Acesso global</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
