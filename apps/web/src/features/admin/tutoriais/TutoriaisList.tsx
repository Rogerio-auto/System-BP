// =============================================================================
// features/admin/tutoriais/TutoriaisList.tsx — Tabela de tutoriais (F12-S05).
//
// DS §9.7 — tabela canônica:
//   - elev-2, th caption-style, hover de linha (Lift).
//   - JetBrains Mono para featureKey, datas.
//   - Badge para ativo/inativo.
//   - Kebab menu: editar, ativar/desativar, remover.
//   - Loading: skeleton 4 linhas. Empty: CTA. Error: retry.
//
// F12-S12: alinhado ao contrato camelCase da API. Sem paginação server-side
//          (API não pagina — filtro client-side apenas).
// =============================================================================

import * as React from 'react';
import { createPortal } from 'react-dom';

import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { useDeleteTutorial, useToggleTutorialActive } from '../../../hooks/admin/useTutorials';
import type { TutorialResponse } from '../../../lib/api/tutorials';
import { cn } from '../../../lib/cn';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PROVIDER_LABEL: Record<string, string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  mp4: 'MP4',
};

// ─── Skeleton ────────────────────────────────────────────────────────────────

function TableSkeleton(): React.JSX.Element {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <tr key={i} aria-hidden="true">
          <td className="pl-5 pr-4 py-4">
            <div className="flex flex-col gap-1.5">
              <div
                className="h-4 rounded-xs animate-pulse"
                style={{ width: 120 + ((i * 37) % 100), background: 'var(--surface-muted)' }}
              />
              <div
                className="h-3 w-40 rounded-xs animate-pulse"
                style={{ background: 'var(--surface-muted)' }}
              />
            </div>
          </td>
          <td className="px-4 py-4 hidden md:table-cell">
            <div
              className="h-5 w-16 rounded-pill animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
          </td>
          <td className="px-4 py-4 hidden sm:table-cell">
            <div
              className="h-4 w-20 rounded-xs animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
          </td>
          <td className="px-4 py-4">
            <div
              className="h-5 w-14 rounded-pill animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
          </td>
          <td className="px-4 pr-5 py-4">
            <div
              className="h-7 w-7 rounded-sm animate-pulse ml-auto"
              style={{ background: 'var(--surface-muted)' }}
            />
          </td>
        </tr>
      ))}
    </>
  );
}

// ─── EmptyState ───────────────────────────────────────────────────────────────

function EmptyState({ onAdd }: { onAdd: () => void }): React.JSX.Element {
  return (
    <tr>
      <td colSpan={5}>
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <div
            className="w-16 h-16 rounded-md flex items-center justify-center"
            style={{ background: 'var(--info-bg)' }}
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="w-8 h-8"
              style={{ color: 'var(--info)' }}
            >
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" />
            </svg>
          </div>
          <div>
            <p
              className="font-display font-bold text-ink"
              style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.025em' }}
            >
              Nenhum tutorial cadastrado
            </p>
            <p className="font-sans text-sm text-ink-3 mt-1 max-w-xs mx-auto">
              Crie o primeiro tutorial para ligar uma funcionalidade ao seu vídeo explicativo.
            </p>
          </div>
          <Button
            variant="primary"
            onClick={onAdd}
            leftIcon={
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className="w-4 h-4"
                aria-hidden="true"
              >
                <path d="M8 3v10M3 8h10" />
              </svg>
            }
          >
            Criar primeiro tutorial
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ─── KebabMenu ────────────────────────────────────────────────────────────────

interface KebabMenuProps {
  tutorial: TutorialResponse;
  onEdit: () => void;
}

function KebabMenu({ tutorial, onEdit }: KebabMenuProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [dropdownPos, setDropdownPos] = React.useState({ top: 0, right: 0 });
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  const { toggle: doToggle, isPending: isToggling } = useToggleTutorialActive();
  const { deleteTutorial: doDelete, isPending: isDeleting } = useDeleteTutorial();

  const isBusy = isToggling || isDeleting;

  function openMenu(): void {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuHeight = 120;
    const rightFromViewport = window.innerWidth - rect.right;
    const top = rect.bottom + window.scrollY + 4;
    const finalTop =
      rect.bottom + menuHeight > window.innerHeight
        ? rect.top + window.scrollY - menuHeight - 4
        : top;
    const right = Math.max(4, rightFromViewport - (192 - rect.width));
    setDropdownPos({ top: finalTop, right });
    setOpen(true);
  }

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (triggerRef.current && triggerRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  function handleToggle(): void {
    setOpen(false);
    doToggle(tutorial.id, tutorial.isActive);
  }

  function handleDelete(): void {
    setOpen(false);
    if (
      window.confirm(
        `Remover o tutorial "${tutorial.title}"?\nEsta ação não pode ser desfeita (soft-delete).`,
      )
    ) {
      doDelete(tutorial.id);
    }
  }

  const dropdown = open
    ? createPortal(
        <div
          role="menu"
          aria-label={`Ações para ${tutorial.title}`}
          className="fixed w-48 rounded-sm border border-border z-[120]"
          style={{
            background: 'var(--bg-elev-1)',
            boxShadow: 'var(--elev-3)',
            top: dropdownPos.top,
            right: dropdownPos.right,
          }}
        >
          {/* Editar */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
            className={cn(
              'flex items-center gap-2.5 w-full px-4 py-2.5',
              'font-sans text-sm text-ink-2 hover:text-ink',
              'hover:bg-surface-hover transition-colors duration-fast',
            )}
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              className="w-4 h-4 shrink-0"
              aria-hidden="true"
            >
              <path d="M11 2l3 3-8 8H3v-3L11 2Z" />
            </svg>
            Editar
          </button>

          <div className="border-t border-border-subtle" />

          {/* Ativar / Desativar */}
          <button
            type="button"
            role="menuitem"
            disabled={isBusy}
            onClick={handleToggle}
            className={cn(
              'flex items-center gap-2.5 w-full px-4 py-2.5',
              'font-sans text-sm',
              'hover:bg-surface-hover transition-colors duration-fast',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              tutorial.isActive ? 'text-warning' : 'text-ink-2 hover:text-ink',
            )}
          >
            {tutorial.isActive ? (
              <>
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                  className="w-4 h-4 shrink-0"
                  aria-hidden="true"
                >
                  <path d="M8 1v7M5.5 3A7 7 0 1 0 10.5 3" />
                </svg>
                {isToggling ? 'Desativando...' : 'Desativar'}
              </>
            ) : (
              <>
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                  className="w-4 h-4 shrink-0"
                  aria-hidden="true"
                  style={{ color: 'var(--success)' }}
                >
                  <circle cx="8" cy="8" r="6" />
                  <path d="M5.5 8l2 2 3-3" />
                </svg>
                <span style={{ color: 'var(--success)' }}>
                  {isToggling ? 'Ativando...' : 'Ativar'}
                </span>
              </>
            )}
          </button>

          <div className="border-t border-border-subtle" />

          {/* Remover */}
          <button
            type="button"
            role="menuitem"
            disabled={isBusy}
            onClick={handleDelete}
            className={cn(
              'flex items-center gap-2.5 w-full px-4 py-2.5',
              'font-sans text-sm text-danger hover:bg-danger/10',
              'transition-colors duration-fast',
              'disabled:opacity-40 disabled:cursor-not-allowed',
            )}
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              className="w-4 h-4 shrink-0"
              aria-hidden="true"
            >
              <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8l1-10H3z" />
            </svg>
            {isDeleting ? 'Removendo...' : 'Remover'}
          </button>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openMenu}
        aria-label={`Ações para ${tutorial.title}`}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={isBusy}
        className={cn(
          'w-8 h-8 flex items-center justify-center rounded-sm',
          'text-ink-3 hover:text-ink hover:bg-surface-hover',
          'transition-all duration-fast ease',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
          'disabled:opacity-40',
        )}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden="true">
          <circle cx="10" cy="4" r="1.5" />
          <circle cx="10" cy="10" r="1.5" />
          <circle cx="10" cy="16" r="1.5" />
        </svg>
      </button>
      {dropdown}
    </>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface TutoriaisListProps {
  tutorials: TutorialResponse[];
  isLoading: boolean;
  isError: boolean;
  onRefetch: () => void;
  onAdd: () => void;
  onEdit: (tutorial: TutorialResponse) => void;
  search: string;
  onSearchChange: (v: string) => void;
  /** onPageChange mantido na interface por compatibilidade com o container mas é no-op. */
  onPageChange: (page: number) => void;
}

/**
 * Tabela de tutoriais com filtro de busca client-side.
 * A API não pagina — sem controles de paginação server-side.
 */
export function TutoriaisList({
  tutorials,
  isLoading,
  isError,
  onRefetch,
  onAdd,
  onEdit,
  search,
  onSearchChange,
}: TutoriaisListProps): React.JSX.Element {
  // Filtro client-side por título/featureKey
  const filtered = React.useMemo(() => {
    if (!search) return tutorials;
    const q = search.toLowerCase();
    return tutorials.filter(
      (t) => t.title.toLowerCase().includes(q) || t.featureKey.toLowerCase().includes(q),
    );
  }, [tutorials, search]);

  return (
    <div className="flex flex-col gap-4">
      {/* Filtro */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[240px]">
          <Input
            id="tutoriais-search"
            placeholder="Buscar por título ou feature_key..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>

      {/* Tabela */}
      <div
        className="rounded-md border border-border overflow-hidden"
        style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-2)' }}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ background: 'var(--bg-elev-2)' }}>
                {[
                  { label: 'Tutorial', className: 'pl-5 pr-4' },
                  { label: 'Provider', className: 'px-4 hidden md:table-cell' },
                  { label: 'Feature key', className: 'px-4 hidden sm:table-cell' },
                  { label: 'Status', className: 'px-4' },
                  { label: 'Ações', className: 'px-4 pr-5 text-right' },
                ].map((col) => (
                  <th
                    key={col.label}
                    scope="col"
                    className={cn('py-3 font-sans font-bold text-ink-3 text-left', col.className)}
                    style={{
                      fontSize: '0.7rem',
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {isLoading ? (
                <TableSkeleton />
              ) : isError ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center">
                    <div
                      className="inline-flex flex-col items-center gap-2 px-6 py-4 rounded-md"
                      style={{ background: 'var(--danger-bg)' }}
                    >
                      <p className="font-sans text-sm font-medium text-danger">
                        Erro ao carregar tutoriais.
                      </p>
                      <button
                        type="button"
                        onClick={onRefetch}
                        className="font-sans text-xs text-azul hover:underline focus-visible:outline-none focus-visible:underline"
                      >
                        Tentar novamente
                      </button>
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <EmptyState onAdd={onAdd} />
              ) : (
                filtered.map((tutorial) => (
                  <tr
                    key={tutorial.id}
                    className="group border-t border-border-subtle"
                    style={{
                      transition:
                        'background-color var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease)',
                    }}
                    onMouseEnter={(e) => {
                      const el = e.currentTarget;
                      el.style.transform = 'translateY(-1px)';
                      el.style.boxShadow = 'var(--elev-2)';
                      el.style.position = 'relative';
                      el.style.zIndex = '1';
                      el.style.background = 'var(--surface-hover)';
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget;
                      el.style.transform = '';
                      el.style.boxShadow = '';
                      el.style.position = '';
                      el.style.zIndex = '';
                      el.style.background = '';
                    }}
                  >
                    {/* Título + description */}
                    <td className="pl-5 pr-4 py-4">
                      <button
                        type="button"
                        onClick={() => onEdit(tutorial)}
                        className="block text-left group/btn focus-visible:outline-none focus-visible:underline"
                      >
                        <span className="block font-sans text-sm font-semibold text-ink group-hover/btn:text-azul transition-colors duration-fast">
                          {tutorial.title}
                        </span>
                        <span className="block font-sans text-xs text-ink-4 mt-0.5 max-w-[280px] truncate">
                          {tutorial.description}
                        </span>
                      </button>
                    </td>

                    {/* Provider */}
                    <td className="px-4 py-4 hidden md:table-cell">
                      <span className="font-sans text-xs font-medium text-ink-3">
                        {PROVIDER_LABEL[tutorial.provider] ?? tutorial.provider}
                      </span>
                    </td>

                    {/* featureKey — JetBrains Mono */}
                    <td className="px-4 py-4 hidden sm:table-cell">
                      <code
                        className="font-mono text-xs"
                        style={{ color: 'var(--text-3)', letterSpacing: '-0.01em' }}
                      >
                        {tutorial.featureKey}
                      </code>
                    </td>

                    {/* Status badge */}
                    <td className="px-4 py-4">
                      <Badge variant={tutorial.isActive ? 'success' : 'neutral'}>
                        {tutorial.isActive ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </td>

                    {/* Ações kebab */}
                    <td className="px-4 pr-5 py-4 text-right">
                      <KebabMenu tutorial={tutorial} onEdit={() => onEdit(tutorial)} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
