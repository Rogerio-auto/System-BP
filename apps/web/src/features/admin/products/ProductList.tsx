// =============================================================================
// features/admin/products/ProductList.tsx — Tabela de produtos de crédito.
//
// DS:
//   - Tabela canônica (§9.7): elev-2, th caption-style, hover de linha.
//   - Bricolage no header.
//   - JetBrains Mono para key, monthly_rate, faixa de valor.
//   - Badge para status ativo/inativo.
//   - Kebab menu de ações (editar, excluir).
//   - Stat cards no topo.
//   - Loading: skeleton 5 linhas. Empty: CTA. Error: card retry.
// =============================================================================

import * as React from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import type { CreditProductResponse } from '../../../hooks/admin/types';
import { useDeleteProduct } from '../../../hooks/admin/useProducts';
import { cn } from '../../../lib/cn';

// ---------------------------------------------------------------------------
// Formatadores
// ---------------------------------------------------------------------------

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

function formatRate(decimalStr: string): string {
  const n = parseFloat(decimalStr);
  if (isNaN(n)) return decimalStr;
  return `${(n * 100).toFixed(2).replace('.', ',')}%`;
}

// ---------------------------------------------------------------------------
// Status filter options
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = [
  { value: '', label: 'Todos os status' },
  { value: 'true', label: 'Ativos' },
  { value: 'false', label: 'Inativos' },
];

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function TableSkeleton(): React.JSX.Element {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i} aria-hidden="true">
          <td className="pl-5 pr-4 py-4">
            <div className="flex flex-col gap-1.5">
              <div
                className="h-4 rounded-xs animate-pulse"
                style={{ width: 100 + ((i * 37) % 100), background: 'var(--surface-muted)' }}
              />
              <div
                className="h-3 w-28 rounded-xs animate-pulse"
                style={{ background: 'var(--surface-muted)' }}
              />
            </div>
          </td>
          <td className="px-4 py-4 hidden md:table-cell">
            <div
              className="h-4 w-16 rounded-xs animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
          </td>
          <td className="px-4 py-4 hidden lg:table-cell">
            <div
              className="h-4 w-32 rounded-xs animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
          </td>
          <td className="px-4 py-4 hidden lg:table-cell">
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

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ onAdd }: { onAdd: () => void }): React.JSX.Element {
  return (
    <tr>
      <td colSpan={6}>
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
              aria-hidden="true"
            >
              <rect x="2" y="7" width="20" height="14" rx="2" />
              <path d="M16 7V5a2 2 0 0 0-4 0v2M12 12v4M10 14h4" />
            </svg>
          </div>
          <div>
            <p
              className="font-display font-bold text-ink"
              style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.025em' }}
            >
              Nenhum produto de crédito
            </p>
            <p className="font-sans text-sm text-ink-3 mt-1 max-w-xs mx-auto">
              Crie o primeiro produto e publique as regras de concessão.
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
            Criar primeiro produto
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Kebab menu de ações
// ---------------------------------------------------------------------------

interface KebabMenuProps {
  product: CreditProductResponse;
  onEdit: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}

function KebabMenu({ product, onEdit, onDelete, isDeleting }: KebabMenuProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  // Fechar ao clicar fora
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={menuRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Ações para ${product.name}`}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'w-8 h-8 flex items-center justify-center rounded-sm',
          'text-ink-3 hover:text-ink hover:bg-surface-hover',
          'transition-all duration-fast ease',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
        )}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden="true">
          <circle cx="10" cy="4" r="1.5" />
          <circle cx="10" cy="10" r="1.5" />
          <circle cx="10" cy="16" r="1.5" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-44 rounded-sm border border-border z-10"
          style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-3)' }}
        >
          <Link
            to={`/admin/products/${product.id}`}
            role="menuitem"
            onClick={() => setOpen(false)}
            className={cn(
              'flex items-center gap-2.5 w-full px-4 py-2.5',
              'font-sans text-sm text-ink-2 hover:text-ink',
              'hover:bg-surface-hover',
              'transition-colors duration-fast',
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
              <circle cx="8" cy="8" r="2.5" />
              <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5Z" />
            </svg>
            Ver detalhe
          </Link>

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
              'hover:bg-surface-hover',
              'transition-colors duration-fast',
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

          <button
            type="button"
            role="menuitem"
            disabled={isDeleting}
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className={cn(
              'flex items-center gap-2.5 w-full px-4 py-2.5',
              'font-sans text-sm text-danger',
              'hover:bg-danger/10',
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
              <path d="M3 4h10M6 4V2h4v2M5 4l.7 9.1a1 1 0 0 0 1 .9h2.6a1 1 0 0 0 1-.9L11 4M7 7v4M9 7v4" />
            </svg>
            {isDeleting ? 'Removendo...' : 'Remover'}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props da ProductList
// ---------------------------------------------------------------------------

interface ProductListProps {
  products: CreditProductResponse[];
  isLoading: boolean;
  isError: boolean;
  onRefetch: () => void;
  onAdd: () => void;
  onEdit: (id: string) => void;
  // Filtros controlados pelo pai
  search: string;
  onSearchChange: (v: string) => void;
  statusFilter: string;
  onStatusFilterChange: (v: string) => void;
  // Paginação
  pagination?:
    | {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
      }
    | undefined;
  onPageChange: (page: number) => void;
}

/**
 * Tabela de produtos de crédito com filtros e paginação.
 * Os filtros são controlados pelo pai (Products.tsx).
 */
export function ProductList({
  products,
  isLoading,
  isError,
  onRefetch,
  onAdd,
  onEdit,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  pagination,
  onPageChange,
}: ProductListProps): React.JSX.Element {
  const {
    deleteProduct: doDelete,
    isPending: isDeleting,
    pendingId: deletingId,
  } = useDeleteProduct();

  const handleDelete = (product: CreditProductResponse): void => {
    if (
      window.confirm(
        `Remover "${product.name}"?\n\nSe houver simulações recentes, a operação será bloqueada.`,
      )
    ) {
      doDelete(product.id);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[220px]">
          <Input
            id="products-search"
            placeholder="Buscar por nome ou key..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <div className="w-[160px]">
          <Select
            id="products-status"
            options={STATUS_OPTIONS}
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
          />
        </div>
      </div>

      {/* Tabela */}
      <div
        className="rounded-md border border-border overflow-hidden"
        style={{
          background: 'var(--bg-elev-1)',
          boxShadow: 'var(--elev-2)',
        }}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ background: 'var(--bg-elev-2)' }}>
                {[
                  { label: 'Produto', className: 'pl-5 pr-4' },
                  { label: 'Regra ativa', className: 'px-4 hidden md:table-cell' },
                  { label: 'Faixa', className: 'px-4 hidden lg:table-cell' },
                  { label: 'Prazo', className: 'px-4 hidden lg:table-cell' },
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
                  <td colSpan={6} className="px-5 py-12 text-center">
                    <div
                      className="inline-flex flex-col items-center gap-2 px-6 py-4 rounded-md"
                      style={{ background: 'var(--danger-bg)' }}
                    >
                      <p className="font-sans text-sm font-medium text-danger">
                        Erro ao carregar produtos.
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
              ) : products.length === 0 ? (
                <EmptyState onAdd={onAdd} />
              ) : (
                products.map((product) => (
                  <tr
                    key={product.id}
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
                    {/* Nome + key */}
                    <td className="pl-5 pr-4 py-4">
                      <Link
                        to={`/admin/products/${product.id}`}
                        className="block font-sans text-sm font-semibold text-ink hover:text-azul transition-colors duration-fast focus-visible:outline-none focus-visible:underline"
                      >
                        {product.name}
                      </Link>
                      <code
                        className="font-mono text-xs mt-0.5 block"
                        style={{
                          color: 'var(--text-3)',
                          letterSpacing: '-0.01em',
                        }}
                      >
                        {product.key}
                      </code>
                    </td>

                    {/* Regra ativa — taxa mensal */}
                    <td className="px-4 py-4 hidden md:table-cell">
                      {product.active_rule ? (
                        <span
                          className="font-mono text-sm font-semibold"
                          style={{ color: 'var(--brand-azul)', letterSpacing: '-0.01em' }}
                        >
                          {formatRate(product.active_rule.monthly_rate)} a.m.
                        </span>
                      ) : (
                        <span className="font-sans text-xs text-ink-4 italic">Sem regra</span>
                      )}
                    </td>

                    {/* Faixa de valores */}
                    <td className="px-4 py-4 hidden lg:table-cell">
                      {product.active_rule ? (
                        <span
                          className="font-mono text-xs text-ink-2"
                          style={{ letterSpacing: '-0.01em' }}
                        >
                          {BRL.format(parseFloat(product.active_rule.min_amount))}–
                          {BRL.format(parseFloat(product.active_rule.max_amount))}
                        </span>
                      ) : (
                        <span className="font-sans text-xs text-ink-4">—</span>
                      )}
                    </td>

                    {/* Prazo */}
                    <td className="px-4 py-4 hidden lg:table-cell">
                      {product.active_rule ? (
                        <span
                          className="font-mono text-xs text-ink-2"
                          style={{ letterSpacing: '-0.01em' }}
                        >
                          {product.active_rule.min_term_months}–
                          {product.active_rule.max_term_months}m
                        </span>
                      ) : (
                        <span className="font-sans text-xs text-ink-4">—</span>
                      )}
                    </td>

                    {/* Status badge */}
                    <td className="px-4 py-4">
                      <Badge variant={product.is_active ? 'success' : 'neutral'}>
                        {product.is_active ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </td>

                    {/* Ações kebab */}
                    <td className="px-4 pr-5 py-4 text-right">
                      <KebabMenu
                        product={product}
                        onEdit={() => onEdit(product.id)}
                        onDelete={() => handleDelete(product)}
                        isDeleting={isDeleting && deletingId === product.id}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Paginação */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-border-subtle">
            <p className="font-sans text-xs text-ink-3">
              {(pagination.page - 1) * pagination.limit + 1}–
              {Math.min(pagination.page * pagination.limit, pagination.total)} de {pagination.total}{' '}
              produto{pagination.total !== 1 ? 's' : ''}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pagination.page <= 1}
                onClick={() => onPageChange(pagination.page - 1)}
                className={cn(
                  'px-3 py-1.5 rounded-sm font-sans text-xs font-medium',
                  'border border-border transition-all duration-fast',
                  'hover:bg-surface-hover hover:border-border-strong',
                  'disabled:opacity-40 disabled:cursor-not-allowed',
                  'focus-visible:ring-2 focus-visible:ring-azul/20',
                )}
              >
                ← Anterior
              </button>
              <button
                type="button"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => onPageChange(pagination.page + 1)}
                className={cn(
                  'px-3 py-1.5 rounded-sm font-sans text-xs font-medium',
                  'border border-border transition-all duration-fast',
                  'hover:bg-surface-hover hover:border-border-strong',
                  'disabled:opacity-40 disabled:cursor-not-allowed',
                  'focus-visible:ring-2 focus-visible:ring-azul/20',
                )}
              >
                Próxima →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
