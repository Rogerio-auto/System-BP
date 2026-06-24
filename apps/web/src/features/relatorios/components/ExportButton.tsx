// features/relatorios/components/ExportButton.tsx -- F23-S10
// Gated por reports:export + flag reports.export.enabled. DS: tokens canonicos doc 18.

import type { ExportFormat, ExportRequest, ReportSection } from '@elemento/shared-schemas';
import * as React from 'react';

import { useFeatureFlag } from '../../../hooks/useFeatureFlag';
import { useAuth } from '../../auth/useAuth';
import { ExportLimitExceededError, useExportReport } from '../hooks/useExportReport';
import type { ReportFilters } from '../hooks/useReportFilters';

export interface ExportButtonProps {
  currentSection: ReportSection;
  filters: Pick<ReportFilters, 'range' | 'scope' | 'cityIds' | 'agentIds' | 'compareWithPrevious'>;
}

const FORMAT_OPTIONS: { value: ExportFormat; label: string }[] = [
  { value: 'csv', label: 'CSV' },
  { value: 'xlsx', label: 'Excel (XLSX)' },
  { value: 'pdf', label: 'PDF' },
];
type ExportScopeType = 'current' | 'full';
const SCOPE_OPTIONS: { value: ExportScopeType; label: string }[] = [
  { value: 'current', label: 'Secao atual' },
  { value: 'full', label: 'Relatorio completo' },
];
const ALL_SECTIONS: ReportSection[] = [
  'overview',
  'attendance',
  'ai',
  'funnel',
  'credit',
  'collection',
  'productivity',
  'audit',
];

function DownloadIcon(): React.JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
function SpinnerIcon(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="animate-spin"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
function CheckIcon(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function ExportButton({
  currentSection,
  filters,
}: ExportButtonProps): React.JSX.Element | null {
  const { hasPermission } = useAuth();
  const { enabled: flagEnabled } = useFeatureFlag('reports.export.enabled');
  if (!hasPermission('reports:export') || !flagEnabled) return null;
  return <ExportButtonInner currentSection={currentSection} filters={filters} />;
}

function ExportButtonInner({ currentSection, filters }: ExportButtonProps): React.JSX.Element {
  const [isOpen, setIsOpen] = React.useState(false);
  const [format, setFormat] = React.useState<ExportFormat>('xlsx');
  const [exportScope, setExportScope] = React.useState<ExportScopeType>('current');
  const [showSuccess, setShowSuccess] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const { exportReport, isExporting, error, isSuccess, reset } = useExportReport();

  React.useEffect(() => {
    if (!isOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setIsOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [isOpen]);

  React.useEffect(() => {
    if (!isSuccess) return;
    setShowSuccess(true);
    const t = window.setTimeout(() => {
      setShowSuccess(false);
      reset();
    }, 2500);
    return () => window.clearTimeout(t);
  }, [isSuccess, reset]);

  function handleExport() {
    const section: ReportSection =
      exportScope === 'current' ? currentSection : (ALL_SECTIONS[0] ?? 'overview');
    const request: ExportRequest = {
      section,
      format,
      filters: {
        range: filters.range,
        cityIds: filters.cityIds.length > 0 ? filters.cityIds : undefined,
        agentIds: filters.agentIds.length > 0 ? filters.agentIds : undefined,
        compareWithPrevious: filters.compareWithPrevious,
      },
    };
    exportReport(request);
    setIsOpen(false);
  }

  function getErrorMessage(err: Error): string {
    if (err instanceof ExportLimitExceededError) {
      return `Muitos dados: ${err.rowCount.toLocaleString('pt-BR')} linhas (limite: ${err.limit.toLocaleString('pt-BR')}). Refine os filtros de periodo ou cidades e tente novamente.`;
    }
    return err.message || 'Erro ao exportar. Tente novamente.';
  }

  const btnStyle: React.CSSProperties = {
    background: showSuccess ? 'var(--brand-verde)' : 'var(--bg-elev-2)',
    borderColor: 'var(--border-strong)',
    color: showSuccess ? '#fff' : 'var(--text)',
    boxShadow: 'var(--elev-1)',
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => {
          if (!isExporting) setIsOpen((v) => !v);
        }}
        disabled={isExporting}
        className="flex items-center gap-2 rounded-sm border px-3 py-2 font-sans text-sm font-medium transition-all duration-fast focus:outline-none focus-visible:ring-2 disabled:opacity-60 disabled:cursor-not-allowed"
        style={btnStyle}
        aria-label="Exportar relatorio"
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        {isExporting ? <SpinnerIcon /> : showSuccess ? <CheckIcon /> : <DownloadIcon />}
        <span>{isExporting ? 'Gerando...' : showSuccess ? 'Baixado!' : 'Exportar'}</span>
      </button>
      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 z-20 rounded-md border p-4 min-w-[220px]"
          style={{
            background: 'var(--bg-elev-2)',
            borderColor: 'var(--border-strong)',
            boxShadow: 'var(--elev-3)',
          }}
        >
          <fieldset className="mb-4 border-0 p-0 m-0">
            <legend
              className="font-sans font-semibold uppercase text-ink-3 mb-2"
              style={{ fontSize: '0.68rem', letterSpacing: '0.1em' }}
            >
              Formato
            </legend>
            <div className="flex gap-1">
              {FORMAT_OPTIONS.map((opt) => {
                const active = opt.value === format;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => setFormat(opt.value)}
                    className="flex-1 rounded-xs border px-2 py-1.5 font-sans text-xs font-medium transition-colors duration-fast focus:outline-none"
                    style={{
                      background: active ? 'var(--brand-verde)' : 'var(--bg-elev-1)',
                      borderColor: active ? 'var(--brand-verde)' : 'var(--border)',
                      color: active ? '#fff' : 'var(--text-2)',
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <fieldset className="mb-4 border-0 p-0 m-0">
            <legend
              className="font-sans font-semibold uppercase text-ink-3 mb-2"
              style={{ fontSize: '0.68rem', letterSpacing: '0.1em' }}
            >
              Abrangencia
            </legend>
            <div className="flex flex-col gap-1">
              {SCOPE_OPTIONS.map((opt) => {
                const active = opt.value === exportScope;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => setExportScope(opt.value)}
                    className="w-full text-left rounded-xs border px-3 py-1.5 font-sans text-sm transition-colors duration-fast focus:outline-none"
                    style={{
                      background: active
                        ? 'color-mix(in srgb, var(--brand-verde) 12%, transparent)'
                        : 'transparent',
                      borderColor: active ? 'var(--brand-verde)' : 'var(--border)',
                      color: active ? 'var(--brand-verde)' : 'var(--text-2)',
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <button
            type="button"
            onClick={handleExport}
            className="w-full rounded-sm px-3 py-2 font-sans text-sm font-semibold text-white transition-all duration-fast focus:outline-none focus-visible:ring-2"
            style={{ background: 'var(--brand-verde)' }}
          >
            Baixar
          </button>
          {error && (
            <p
              role="alert"
              className="mt-3 font-sans text-xs leading-relaxed"
              style={{ color: 'var(--semantic-error)' }}
            >
              {getErrorMessage(error)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
