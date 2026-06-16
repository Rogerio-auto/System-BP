// =============================================================================
// features/law-firms/LawFirmsPage.tsx — /configuracoes/advocacia (F19-S04).
//
// Página de administração de escritórios de advocacia parceiros.
//
// DS:
//   - Bricolage 700 no h1 (display), Geist no body.
//   - Tabela densa §9.7: th caption-style, hover de linha.
//   - Loading: skeleton 5 linhas (nunca spinner sozinho).
//   - Empty state com CTA.
//   - Error state com retry.
//   - Modal unificado de criação/edição (elev-5, fade-up).
//   - Confirm dialog inline para exclusão.
//   - JetBrains Mono para telefone.
//
// RBAC: redireciona /404 sem permissão law_firms:manage.
// =============================================================================

import type { LawFirmResponse } from '@elemento/shared-schemas';
import * as React from 'react';
import { Navigate } from 'react-router-dom';

import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { useCitiesList } from '../../hooks/useCitiesList';
import { useAuth } from '../../lib/auth-store';
import { cn } from '../../lib/cn';

import { useDeleteLawFirm, useLawFirms } from './hooks';
import { LawFirmModal } from './LawFirmModal';


// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function TableSkeleton(): React.JSX.Element {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i} aria-hidden="true">
          {Array.from({ length: 4 }).map((__, j) => (
            <td key={j} className="px-4 py-3.5">
              <div
                className="h-4 rounded-xs animate-pulse"
                style={{
                  width: 60 + ((i * 17 + j * 13) % 100),
                  background: 'var(--surface-muted)',
                }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ onNew }: { onNew: () => void }): React.JSX.Element {
  return (
    <tr>
      <td colSpan={4}>
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          {/* Scale icon */}
          <svg
            viewBox="0 0 48 48"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.2}
            className="w-12 h-12"
            style={{ color: 'var(--brand-azul)', opacity: 0.4 }}
            aria-hidden="true"
          >
            <path d="M24 8v32M8 20l16 4 16-4" strokeLinecap="round" />
            <path d="M8 20l-4 12a8 8 0 0016 0L16 20" strokeLinecap="round" strokeLinejoin="round" />
            <path
              d="M40 20l-4 12a8 8 0 0016 0L48 20"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M18 40h12" strokeLinecap="round" />
          </svg>
          <div className="flex flex-col gap-1">
            <p className="font-sans font-semibold text-ink" style={{ fontSize: 'var(--text-sm)' }}>
              Nenhum escritório cadastrado
            </p>
            <p className="font-sans text-ink-3 text-xs max-w-xs">
              Cadastre escritórios de advocacia parceiros para encaminhamento de processos de
              clientes inadimplentes.
            </p>
          </div>
          <Button variant="primary" size="sm" onClick={onNew}>
            Cadastrar primeiro escritório
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Confirm delete dialog
// ---------------------------------------------------------------------------

interface ConfirmDeleteDialogProps {
  firmName: string;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}

function ConfirmDeleteDialog({
  firmName,
  onConfirm,
  onCancel,
  isPending,
}: ConfirmDeleteDialogProps): React.JSX.Element {
  React.useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--text)]/60 backdrop-blur-[4px]"
      role="alertdialog"
      aria-modal="true"
      aria-label="Confirmar exclusão"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="w-full max-w-sm rounded-md flex flex-col"
        style={{
          background: 'var(--bg-elev-1)',
          boxShadow: 'var(--elev-5)',
          border: '1px solid var(--border)',
          animation: 'fade-up 200ms var(--ease-out) both',
        }}
      >
        <div className="flex flex-col gap-2 px-6 py-5">
          <h2
            className="font-display font-bold text-ink"
            style={{ fontSize: 'var(--text-lg)', letterSpacing: '-0.02em' }}
          >
            Excluir escritório?
          </h2>
          <p className="font-sans text-sm text-ink-3">
            O escritório <span className="font-semibold text-ink">&ldquo;{firmName}&rdquo;</span>{' '}
            será removido. Esta ação não pode ser desfeita.
          </p>
        </div>
        <div
          className="flex items-center justify-end gap-3 px-6 py-4"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          <Button type="button" variant="ghost" onClick={onCancel} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="button" variant="danger" onClick={onConfirm} disabled={isPending}>
            {isPending ? 'Excluindo…' : 'Excluir'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row actions
// ---------------------------------------------------------------------------

interface RowActionsProps {
  firm: LawFirmResponse;
  onEdit: (firm: LawFirmResponse) => void;
  onDelete: (firm: LawFirmResponse) => void;
}

function RowActions({ firm, onEdit, onDelete }: RowActionsProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-1 justify-end">
      <button
        type="button"
        onClick={() => onEdit(firm)}
        className={cn(
          'p-1.5 rounded-sm text-ink-3 transition-colors duration-[150ms]',
          'hover:text-azul hover:bg-azul/8',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/15',
        )}
        aria-label={`Editar ${firm.name}`}
        title="Editar"
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="w-4 h-4"
          aria-hidden="true"
        >
          <path
            d="M11.5 2.5a1.414 1.414 0 112 2l-8 8L3 14l1.5-2.5 8-8z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => onDelete(firm)}
        className={cn(
          'p-1.5 rounded-sm text-ink-3 transition-colors duration-[150ms]',
          'hover:text-danger hover:bg-danger/8',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/15',
        )}
        aria-label={`Excluir ${firm.name}`}
        title="Excluir"
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="w-4 h-4"
          aria-hidden="true"
        >
          <path
            d="M2 4h12M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6 7v5M10 7v5M3 4l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Página de administração de escritórios de advocacia.
 * Rota: /configuracoes/advocacia
 * RBAC: requer law_firms:manage
 */
export function LawFirmsPage(): React.JSX.Element {
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const { cities } = useCitiesList();

  // RBAC gate
  if (!hasPermission('law_firms:manage')) {
    return <Navigate to="/404" replace />;
  }

  return <LawFirmsPageContent cities={cities} toast={toast} />;
}

// ---------------------------------------------------------------------------
// Inner page (separated so hooks run after RBAC check — Rules of Hooks)
// ---------------------------------------------------------------------------

interface LawFirmsPageContentProps {
  cities: { id: string; name: string; state_uf: string }[];
  toast: (message: string, type: 'success' | 'danger' | 'info') => void;
}

function LawFirmsPageContent({ cities, toast }: LawFirmsPageContentProps): React.JSX.Element {
  const [page, setPage] = React.useState(1);
  const PAGE_SIZE = 20;

  const { data, isLoading, isError, refetch } = useLawFirms({ page, pageSize: PAGE_SIZE });
  const { mutate: deleteFirm, isPending: isDeleting } = useDeleteLawFirm();

  // Modal state
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editingFirm, setEditingFirm] = React.useState<LawFirmResponse | null>(null);

  // Delete confirm state
  const [deletingFirm, setDeletingFirm] = React.useState<LawFirmResponse | null>(null);

  const openCreate = (): void => {
    setEditingFirm(null);
    setModalOpen(true);
  };

  const openEdit = (firm: LawFirmResponse): void => {
    setEditingFirm(firm);
    setModalOpen(true);
  };

  const closeModal = (): void => {
    setModalOpen(false);
    setEditingFirm(null);
  };

  const handleDeleteRequest = (firm: LawFirmResponse): void => {
    setDeletingFirm(firm);
  };

  const handleDeleteConfirm = (): void => {
    if (!deletingFirm) return;
    deleteFirm(deletingFirm.id, {
      onSuccess: () => {
        toast('Escritório excluído com sucesso', 'success');
        setDeletingFirm(null);
      },
      onError: (err) => {
        toast(`Erro ao excluir: ${err.message}`, 'danger');
        setDeletingFirm(null);
      },
    });
  };

  const firms = data?.data ?? [];
  const meta = data?.meta;
  const totalPages = meta?.totalPages ?? 1;

  // Map city id -> name for coverage display
  const cityMap = React.useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of cities) m[c.id] = c.name;
    return m;
  }, [cities]);

  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1
            className="font-display font-bold text-ink"
            style={{
              fontSize: 'var(--text-3xl)',
              letterSpacing: '-0.04em',
              lineHeight: '1',
              fontVariationSettings: "'opsz' 32",
            }}
          >
            Escritórios de Advocacia
          </h1>
          <p className="mt-1.5 font-sans text-ink-3" style={{ fontSize: 'var(--text-sm)' }}>
            Gerencie os escritórios parceiros para encaminhamento de processos por cidade.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={openCreate}>
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            className="w-4 h-4 mr-1.5"
            aria-hidden="true"
          >
            <path d="M8 3v10M3 8h10" strokeLinecap="round" />
          </svg>
          Novo escritório
        </Button>
      </div>

      {/* Table card */}
      <div
        className="rounded-md overflow-hidden"
        style={{
          background: 'var(--bg-elev-1)',
          boxShadow: 'var(--elev-2)',
          border: '1px solid var(--border)',
        }}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Nome', 'Telefone', 'Cidades de cobertura', 'Ações'].map((th, i) => (
                  <th
                    key={th}
                    className={cn(
                      'px-4 py-3 font-sans font-semibold uppercase tracking-widest text-ink-3',
                      i === 3 ? 'text-right' : 'text-left',
                    )}
                    style={{ fontSize: '0.65rem', letterSpacing: '0.1em' }}
                  >
                    {th}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeleton />
              ) : isError ? (
                <tr>
                  <td colSpan={4}>
                    <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                      <p className="font-sans text-sm text-danger">Erro ao carregar escritórios.</p>
                      <Button variant="outline" size="sm" onClick={() => refetch()}>
                        Tentar novamente
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : firms.length === 0 ? (
                <EmptyState onNew={openCreate} />
              ) : (
                firms.map((firm) => (
                  <tr
                    key={firm.id}
                    className={cn(
                      'group border-b border-border last:border-b-0',
                      'transition-all duration-[150ms]',
                      'hover:bg-surface-hover',
                    )}
                  >
                    {/* Nome */}
                    <td className="px-4 py-3.5">
                      <div className="flex flex-col gap-0.5">
                        <span
                          className="font-sans font-semibold text-ink"
                          style={{ fontSize: 'var(--text-sm)' }}
                        >
                          {firm.name}
                        </span>
                        {firm.is_default_for_city && <Badge variant="info">Padrão</Badge>}
                      </div>
                    </td>

                    {/* Telefone */}
                    <td className="px-4 py-3.5">
                      {firm.contact_phone ? (
                        <span
                          className="font-mono text-ink-2"
                          style={{ fontSize: 'var(--text-sm)' }}
                        >
                          {firm.contact_phone}
                        </span>
                      ) : (
                        <span className="text-ink-4 text-sm">—</span>
                      )}
                    </td>

                    {/* Cidades */}
                    <td className="px-4 py-3.5">
                      {firm.coverage_city_ids.length === 0 ? (
                        <span className="text-ink-4 text-sm">Nenhuma</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {firm.coverage_city_ids.slice(0, 3).map((cid) => (
                            <span
                              key={cid}
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-sans font-medium"
                              style={{
                                background: 'var(--surface-muted)',
                                color: 'var(--ink-2)',
                              }}
                            >
                              {cityMap[cid] ?? cid.slice(0, 8)}
                            </span>
                          ))}
                          {firm.coverage_city_ids.length > 3 && (
                            <span
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-sans text-ink-3"
                              style={{ background: 'var(--surface-muted)' }}
                            >
                              +{firm.coverage_city_ids.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Ações */}
                    <td className="px-4 py-3.5">
                      <RowActions firm={firm} onEdit={openEdit} onDelete={handleDeleteRequest} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Paginação */}
        {!isLoading && !isError && totalPages > 1 && (
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ borderTop: '1px solid var(--border)' }}
          >
            <p className="font-sans text-xs text-ink-3">
              Página {page} de {totalPages} — {meta?.total ?? 0} escritórios
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Modal criação/edição */}
      {modalOpen && <LawFirmModal firm={editingFirm} onClose={closeModal} />}

      {/* Confirm delete */}
      {deletingFirm && (
        <ConfirmDeleteDialog
          firmName={deletingFirm.name}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeletingFirm(null)}
          isPending={isDeleting}
        />
      )}
    </div>
  );
}
