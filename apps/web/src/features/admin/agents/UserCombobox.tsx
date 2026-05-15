// =============================================================================
// features/admin/agents/UserCombobox.tsx — Combobox de users ativos sem agente.
//
// DS:
//   - Input de busca com debounce 300ms.
//   - Dropdown com elev-3, users listados com avatar + nome + email.
//   - Chip de seleção com botão clear.
//   - Empty state claro.
// =============================================================================

import * as React from 'react';

import { useUsersWithoutAgent } from '../../../hooks/admin/useAgents';
import type { UserOption } from '../../../hooks/admin/useAgents';
import { cn } from '../../../lib/cn';

interface UserComboboxProps {
  value: string | null;
  onChange: (userId: string | null) => void;
  disabled?: boolean;
  error?: string;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Combobox de usuários ativos da organização sem agente vinculado.
 * Busca com debounce — exibe avatar + nome + email.
 */
export function UserCombobox({
  value,
  onChange,
  disabled = false,
  error,
}: UserComboboxProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [searchDebounced, setSearchDebounced] = React.useState('');
  const [selectedUser, setSelectedUser] = React.useState<UserOption | null>(null);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const { users, isLoading } = useUsersWithoutAgent(searchDebounced || undefined);

  // Sincroniza o usuário selecionado quando value muda externamente (modo edição)
  React.useEffect(() => {
    if (value && users.length > 0) {
      const found = users.find((u) => u.id === value);
      if (found) setSelectedUser(found);
    }
    if (!value) setSelectedUser(null);
  }, [value, users]);

  const handleSearchChange = (v: string): void => {
    setSearch(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearchDebounced(v), 300);
  };

  React.useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

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

  function selectUser(user: UserOption): void {
    setSelectedUser(user);
    onChange(user.id);
    setOpen(false);
    setSearch('');
    setSearchDebounced('');
  }

  function clearSelection(): void {
    setSelectedUser(null);
    onChange(null);
  }

  const filteredUsers = searchDebounced
    ? users.filter(
        (u) =>
          u.fullName.toLowerCase().includes(searchDebounced.toLowerCase()) ||
          u.email.toLowerCase().includes(searchDebounced.toLowerCase()),
      )
    : users;

  return (
    <div ref={containerRef} className="flex flex-col gap-1.5">
      {selectedUser ? (
        /* Chip do usuário selecionado */
        <div
          className="flex items-center gap-2.5 px-3 py-2 rounded-sm border border-border"
          style={{ background: 'var(--bg-elev-1)' }}
        >
          {/* Avatar */}
          <div
            className="w-7 h-7 rounded-pill flex items-center justify-center shrink-0"
            style={{ background: 'var(--grad-rondonia)' }}
            aria-hidden="true"
          >
            <span className="font-sans font-bold text-white" style={{ fontSize: '0.625rem' }}>
              {getInitials(selectedUser.fullName)}
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <p className="font-sans text-sm font-semibold text-ink truncate">
              {selectedUser.fullName}
            </p>
            <code
              className="font-mono text-xs truncate block"
              style={{ color: 'var(--text-3)', letterSpacing: '-0.01em' }}
            >
              {selectedUser.email}
            </code>
          </div>

          {!disabled && (
            <button
              type="button"
              onClick={clearSelection}
              aria-label="Remover usuário vinculado"
              className={cn(
                'w-6 h-6 flex items-center justify-center rounded-pill shrink-0',
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
        </div>
      ) : (
        /* Trigger abrir dropdown */
        <div className="relative">
          <button
            type="button"
            onClick={() => !disabled && setOpen((v) => !v)}
            disabled={disabled}
            aria-expanded={open}
            aria-haspopup="listbox"
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2 rounded-sm text-sm text-left',
              'border transition-[border-color,box-shadow] duration-fast ease',
              'font-sans font-medium',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
              'disabled:opacity-40 disabled:cursor-not-allowed',
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
              <path d="M13 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
              <path d="M7 10a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z" />
              <path d="M1 17c0-2.8 2.69-5 6-5h6c3.31 0 6 2.2 6 5" />
            </svg>
            <span>Selecionar usuário (opcional)</span>
          </button>

          {open && (
            <div
              role="listbox"
              aria-label="Usuários disponíveis"
              className="absolute top-full left-0 mt-1 w-full rounded-sm border border-border z-20"
              style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-3)' }}
            >
              {/* Busca inline */}
              <div className="px-3 py-2 border-b border-border-subtle">
                <input
                  type="text"
                  placeholder="Buscar por nome ou email..."
                  value={search}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className={cn(
                    'w-full font-sans text-sm text-ink bg-transparent',
                    'focus:outline-none placeholder:text-ink-4',
                  )}
                  autoFocus
                />
              </div>

              {/* Lista */}
              <div className="max-h-52 overflow-y-auto">
                {isLoading ? (
                  <div className="px-4 py-3 text-xs text-ink-3 font-sans">Carregando...</div>
                ) : filteredUsers.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-ink-4 font-sans italic">
                    {searchDebounced
                      ? 'Nenhum usuário encontrado'
                      : 'Nenhum usuário ativo disponível'}
                  </div>
                ) : (
                  filteredUsers.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => selectUser(user)}
                      className={cn(
                        'flex items-center gap-2.5 w-full px-4 py-2.5',
                        'font-sans text-sm text-ink-2 hover:text-ink',
                        'hover:bg-surface-hover',
                        'transition-colors duration-fast text-left',
                        'focus-visible:outline-none focus-visible:bg-surface-hover',
                      )}
                    >
                      {/* Avatar */}
                      <div
                        className="w-7 h-7 rounded-pill flex items-center justify-center shrink-0"
                        style={{ background: 'var(--grad-rondonia)' }}
                        aria-hidden="true"
                      >
                        <span
                          className="font-sans font-bold text-white"
                          style={{ fontSize: '0.625rem' }}
                        >
                          {getInitials(user.fullName)}
                        </span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="font-sans text-sm font-semibold text-ink truncate">
                          {user.fullName}
                        </p>
                        <code
                          className="font-mono text-xs truncate block"
                          style={{ color: 'var(--text-3)', letterSpacing: '-0.01em' }}
                        >
                          {user.email}
                        </code>
                      </div>
                    </button>
                  ))
                )}
              </div>

              {/* Opção "sem vínculo" */}
              <div className="border-t border-border-subtle">
                <button
                  type="button"
                  role="option"
                  aria-selected={value === null}
                  onClick={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex items-center gap-2 w-full px-4 py-2.5',
                    'font-sans text-xs text-ink-4 italic hover:text-ink-2',
                    'hover:bg-surface-hover',
                    'transition-colors duration-fast',
                    'focus-visible:outline-none focus-visible:bg-surface-hover',
                  )}
                >
                  Sem usuário vinculado
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && <span className="text-xs text-danger font-sans">{error}</span>}
    </div>
  );
}
