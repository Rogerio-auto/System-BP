// =============================================================================
// features/imports/components/StepPreview.tsx
//
// Passo 3: Revisão dos dados validados.
//
// Layout:
//   - Stats row (linhas válidas / inválidas / pendentes) — Stat mini cards
//   - Tabs: Todas / Válidas / Inválidas / Pendentes
//   - Tabela paginada com badge de status por linha
//   - Botão "Baixar CSV de erros" quando houver inválidas
//
// Estado de fetch: loading (skeleton), empty, error, success.
// =============================================================================

import * as React from 'react';

import type { BadgeVariant } from '../../../components/ui/Badge';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { useImportPreview } from '../../../hooks/imports/useImportPreview';
import type {
  ImportBatch,
  ImportPreviewRow,
  ImportRowStatus,
  PreviewParams,
} from '../../../lib/api/imports';
import { cn } from '../../../lib/cn';

type PreviewTab = 'all' | ImportRowStatus;

const TAB_LABELS: Record<PreviewTab, string> = {
  all: 'Todas',
  valid: 'Válidas',
  invalid: 'Inválidas',
  pending: 'Pendentes',
  persisted: 'Persistidas',
  failed: 'Com falha',
};

const ROW_STATUS_BADGE: Record<string, BadgeVariant> = {
  valid: 'success',
  invalid: 'danger',
  pending: 'warning',
  persisted: 'success',
  failed: 'danger',
};

const ROW_STATUS_LABEL: Record<string, string> = {
  valid: 'Válida',
  invalid: 'Inválida',
  pending: 'Pendente',
  persisted: 'Importada',
  failed: 'Falha',
};

interface StepPreviewProps {
  batch: ImportBatch;
}

export function StepPreview({ batch }: StepPreviewProps): React.JSX.Element {
  const [activeTab, setActiveTab] = React.useState<PreviewTab>('all');
  const [page, setPage] = React.useState(1);
  const PER_PAGE = 20;

  const queryParams = React.useMemo<PreviewParams>(() => {
    const base: PreviewParams = { page, perPage: PER_PAGE };
    if (activeTab !== 'all') {
      base.status = activeTab as ImportRowStatus;
    }
    return base;
  }, [page, activeTab]);

  const { data, isLoading, isError } = useImportPreview({
    batchId: batch.id,
    params: queryParams,
  });

  const handleTabChange = (tab: PreviewTab): void => {
    setActiveTab(tab);
    setPage(1);
  };

  const totalPages = data ? Math.ceil(data.total / PER_PAGE) : 1;

  // Derivar quais tabs mostrar baseado nos dados do batch
  const tabs: PreviewTab[] = ['all', 'valid', 'invalid', 'pending'];

  return (
    <div className="flex flex-col gap-6">
      {/* Cabeçalho */}
      <div>
        <h2
          className="font-display font-bold text-ink leading-tight"
          style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.025em' }}
        >
          Revisão dos dados
        </h2>
        <p className="font-sans text-sm text-ink-3 mt-1">
          Verifique os dados antes de confirmar a importação.
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <StatMini label="Válidas" value={batch.validRows} variant="success" />
        <StatMini label="Inválidas" value={batch.invalidRows} variant="danger" />
        <StatMini label="Total de linhas" value={batch.totalRows} variant="neutral" />
      </div>

      {/* Tabs */}
      <div
        className="flex gap-1 border-b border-border-subtle"
        role="tablist"
        aria-label="Filtro de linhas"
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              role="tab"
              aria-selected={isActive}
              onClick={() => handleTabChange(tab)}
              className={cn(
                'relative px-4 py-2.5 font-sans text-sm font-medium',
                'transition-colors duration-fast',
                'outline-none focus-visible:ring-2 focus-visible:ring-azul/40',
                'rounded-t-sm',
                isActive ? 'text-azul' : 'text-ink-3 hover:text-ink',
              )}
            >
              {TAB_LABELS[tab]}
              {/* Indicador ativo */}
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 left-0 right-0 h-[2px] rounded-t-pill"
                  style={{ background: 'var(--brand-azul)' }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Tabela */}
      <div
        className="rounded-md border border-border overflow-hidden"
        style={{ boxShadow: 'var(--elev-2)' }}
        role="tabpanel"
        aria-label={`Linhas: ${TAB_LABELS[activeTab]}`}
      >
        {isLoading ? (
          <TableSkeleton />
        ) : isError ? (
          <TableError />
        ) : !data || data.rows.length === 0 ? (
          <TableEmpty tab={activeTab} />
        ) : (
          <PreviewTable rows={data.rows} />
        )}
      </div>

      {/* Paginação */}
      {data && data.total > PER_PAGE && (
        <div className="flex items-center justify-between">
          <p className="font-sans text-xs text-ink-3">
            Exibindo {Math.min((page - 1) * PER_PAGE + 1, data.total)}–
            {Math.min(page * PER_PAGE, data.total)} de {data.total} linhas
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
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

      {/* Botão de download de erros (visível quando há linhas inválidas) */}
      {batch.invalidRows > 0 && (
        <div className="flex justify-end">
          <a
            href={`${(import.meta.env['VITE_API_URL'] as string | undefined) ?? 'http://localhost:3000'}/api/imports/${batch.id}/errors.csv`}
            download
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2',
              'rounded-sm border border-border-strong',
              'font-sans font-semibold text-sm text-ink-2',
              'bg-surface-1 hover:bg-surface-hover',
              'transition-colors duration-fast',
              'focus-visible:ring-2 focus-visible:ring-azul/40',
            )}
            style={{ boxShadow: 'var(--elev-1)' }}
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              className="w-4 h-4"
              aria-hidden="true"
            >
              <path d="M8 1v9m0 0l-3-3m3 3l3-3" />
              <path d="M1 12v1a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1" />
            </svg>
            Baixar CSV de erros ({batch.invalidRows} linhas)
          </a>
        </div>
      )}
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

interface StatMiniProps {
  label: string;
  value: number;
  variant: 'success' | 'danger' | 'neutral';
}

function StatMini({ label, value, variant }: StatMiniProps): React.JSX.Element {
  const colorMap = {
    success: { color: 'var(--success)', bg: 'var(--success-bg)' },
    danger: { color: 'var(--danger)', bg: 'var(--danger-bg)' },
    neutral: { color: 'var(--text-2)', bg: 'var(--surface-muted)' },
  };
  const colors = colorMap[variant];

  return (
    <div
      className="rounded-md border border-border p-4 flex flex-col gap-1"
      style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-2)' }}
    >
      <p
        className="font-sans font-semibold uppercase text-ink-3"
        style={{ fontSize: '0.65rem', letterSpacing: '0.10em' }}
      >
        {label}
      </p>
      <span
        className="font-display font-extrabold leading-none"
        style={{
          fontSize: 'var(--text-3xl)',
          letterSpacing: '-0.04em',
          color: colors.color,
          fontVariationSettings: "'opsz' 48",
        }}
      >
        {value.toLocaleString('pt-BR')}
      </span>
    </div>
  );
}

function PreviewTable({ rows }: { rows: ImportPreviewRow[] }): React.JSX.Element {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="border-b border-border" style={{ background: 'var(--bg-elev-2)' }}>
          <th
            scope="col"
            className="px-4 py-3 text-left font-sans font-semibold text-xs text-ink-3 uppercase tracking-[0.08em] w-16"
          >
            #
          </th>
          <th
            scope="col"
            className="px-4 py-3 text-left font-sans font-semibold text-xs text-ink-3 uppercase tracking-[0.08em] w-28"
          >
            Status
          </th>
          <th
            scope="col"
            className="px-4 py-3 text-left font-sans font-semibold text-xs text-ink-3 uppercase tracking-[0.08em]"
          >
            Dados brutos (prévia)
          </th>
          <th
            scope="col"
            className="px-4 py-3 text-left font-sans font-semibold text-xs text-ink-3 uppercase tracking-[0.08em]"
          >
            Erros
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => {
          const badgeVariant: BadgeVariant = ROW_STATUS_BADGE[row.status] ?? 'neutral';
          const statusLabel = ROW_STATUS_LABEL[row.status] ?? row.status;
          const rawPreview = Object.entries(row.rawData)
            .slice(0, 3)
            .map(([k, v]) => `${k}: ${String(v ?? '')}`)
            .join(' · ');

          return (
            <tr
              key={row.id}
              className={cn(
                'border-b border-border-subtle last:border-0',
                'hover:bg-surface-hover transition-colors duration-fast',
              )}
              style={
                idx % 2 === 0
                  ? { background: 'var(--bg-elev-1)' }
                  : { background: 'var(--bg-elev-2)' }
              }
            >
              <td className="px-4 py-3">
                <span
                  className="font-mono text-xs text-ink-4"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  {row.rowIndex}
                </span>
              </td>
              <td className="px-4 py-3">
                <Badge variant={badgeVariant}>{statusLabel}</Badge>
              </td>
              <td className="px-4 py-3">
                <span
                  className="font-sans text-xs text-ink-2 truncate max-w-xs block"
                  title={rawPreview}
                >
                  {rawPreview || '—'}
                </span>
              </td>
              <td className="px-4 py-3">
                {row.validationErrors && row.validationErrors.length > 0 ? (
                  <ul className="flex flex-col gap-0.5">
                    {row.validationErrors.slice(0, 3).map((err, i) => (
                      <li key={i} className="font-sans text-xs text-danger">
                        {err}
                      </li>
                    ))}
                    {row.validationErrors.length > 3 && (
                      <li className="font-sans text-xs text-ink-3">
                        +{row.validationErrors.length - 3} mais
                      </li>
                    )}
                  </ul>
                ) : (
                  <span className="font-sans text-xs text-ink-4">—</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TableSkeleton(): React.JSX.Element {
  return (
    <div className="p-4 flex flex-col gap-3" aria-label="Carregando linhas…" aria-busy="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex gap-4 items-center">
          <div className="w-10 h-4 bg-surface-muted animate-pulse rounded-xs" />
          <div className="w-20 h-5 bg-surface-muted animate-pulse rounded-pill" />
          <div className="flex-1 h-4 bg-surface-muted animate-pulse rounded-xs" />
        </div>
      ))}
    </div>
  );
}

function TableError(): React.JSX.Element {
  return (
    <div className="p-8 flex flex-col items-center gap-3">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--danger)"
        strokeWidth={1.5}
        className="w-10 h-10"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <circle cx="12" cy="16" r="0.5" fill="var(--danger)" />
      </svg>
      <p className="font-sans text-sm text-danger text-center">
        Erro ao carregar dados. Verifique sua conexão e tente novamente.
      </p>
    </div>
  );
}

function TableEmpty({ tab }: { tab: PreviewTab }): React.JSX.Element {
  const messages: Partial<Record<PreviewTab, string>> = {
    all: 'Nenhuma linha encontrada no arquivo.',
    valid: 'Nenhuma linha válida neste batch.',
    invalid: 'Nenhuma linha com erro — ótimo!',
    pending: 'Nenhuma linha pendente.',
  };

  return (
    <div className="p-8 flex flex-col items-center gap-3">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--text-4)"
        strokeWidth={1.5}
        className="w-10 h-10"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="3" y1="9" x2="21" y2="9" />
        <line x1="3" y1="15" x2="21" y2="15" />
      </svg>
      <p className="font-sans text-sm text-ink-3 text-center">
        {messages[tab] ?? 'Nenhuma linha encontrada.'}
      </p>
    </div>
  );
}
