// =============================================================================
// features/credit-analyses/components/CreditAnalysisVersionTimeline.tsx
//
// Timeline imutável de versões de parecer — ordem DESC (mais recente primeiro).
//
// DS:
//   - Cards com elev-2 + hover Spotlight (halo verde §8)
//   - JetBrains Mono no parecer
//   - Bricolage no cabeçalho de versão
//   - Badge de status por versão via CreditAnalysisStatusBadge
//   - Diff visual (CreditAnalysisDiff) entre versão N e N-1
//   - Pendências como checklist
//   - Anexos como cards de metadados (sem URL direta — signed URL é slot futuro)
// =============================================================================

import * as React from 'react';

import { cn } from '../../../lib/cn';
import type { CreditAnalysisVersionResponse } from '../schemas';

import { CreditAnalysisDiff } from './CreditAnalysisDiff';
import { CreditAnalysisStatusBadge } from './CreditAnalysisStatusBadge';

// ─── Spotlight Card ───────────────────────────────────────────────────────────

function SpotlightCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  const cardRef = React.useRef<HTMLDivElement>(null);

  const handleMouseMove = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - rect.left}px`);
    el.style.setProperty('--my', `${e.clientY - rect.top}px`);
  }, []);

  const handleMouseLeave = React.useCallback(() => {
    const el = cardRef.current;
    if (!el) return;
    el.style.setProperty('--mx', '-9999px');
    el.style.setProperty('--my', '-9999px');
  }, []);

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={cn(
        'relative overflow-hidden rounded-md border border-border bg-surface-1',
        'transition-[transform,box-shadow] duration-[250ms] ease-out',
        '[--mx:-9999px] [--my:-9999px]',
        className,
      )}
      style={{ boxShadow: 'var(--elev-2)' }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-md"
        style={{
          background:
            'radial-gradient(300px circle at var(--mx) var(--my), rgba(46,155,62,0.06), transparent 60%)',
        }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

// ─── Helpers de formatação ────────────────────────────────────────────────────

function formatDatetime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function VersionSkeleton(): React.JSX.Element {
  return (
    <div
      className="rounded-md border border-border bg-surface-1 p-5 animate-pulse"
      style={{ boxShadow: 'var(--elev-2)' }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="h-4 w-24 rounded-xs" style={{ background: 'var(--surface-muted)' }} />
        <div className="h-5 w-20 rounded-pill" style={{ background: 'var(--surface-muted)' }} />
      </div>
      <div className="space-y-2">
        <div className="h-3 w-full rounded-xs" style={{ background: 'var(--surface-muted)' }} />
        <div className="h-3 w-5/6 rounded-xs" style={{ background: 'var(--surface-muted)' }} />
        <div className="h-3 w-4/6 rounded-xs" style={{ background: 'var(--surface-muted)' }} />
      </div>
    </div>
  );
}

// ─── Item de versão ───────────────────────────────────────────────────────────

interface VersionItemProps {
  version: CreditAnalysisVersionResponse;
  previousVersion: CreditAnalysisVersionResponse | undefined;
  isLatest: boolean;
}

function VersionItem({ version, previousVersion, isLatest }: VersionItemProps): React.JSX.Element {
  const [showDiff, setShowDiff] = React.useState(false);

  return (
    <SpotlightCard>
      <div className="p-5">
        {/* Header: número de versão + status + data */}
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            {/* Número da versão */}
            <span
              className="font-display font-bold text-ink"
              style={{
                fontSize: 'var(--text-lg)',
                letterSpacing: '-0.03em',
                fontVariationSettings: "'opsz' 24",
              }}
            >
              v{version.version}
            </span>
            {isLatest && (
              <span
                className="font-sans text-xs font-semibold px-2 py-0.5 rounded-pill uppercase"
                style={{
                  background: 'var(--info-bg)',
                  color: 'var(--info)',
                  letterSpacing: '0.06em',
                  fontSize: '0.65rem',
                }}
              >
                Atual
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <CreditAnalysisStatusBadge status={version.status} />
            <span className="font-sans text-xs text-ink-4">
              {formatDatetime(version.created_at)}
            </span>
          </div>
        </div>

        {/* Parecer */}
        <div className="mb-4">
          <p
            className="font-sans font-semibold text-ink-3 uppercase mb-2"
            style={{ fontSize: '0.65rem', letterSpacing: '0.1em' }}
          >
            Parecer
          </p>

          {/* Toggle diff */}
          {previousVersion && (
            <button
              type="button"
              onClick={() => setShowDiff((v) => !v)}
              className="mb-2 font-sans text-xs text-azul hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20 rounded-xs"
              aria-pressed={showDiff}
            >
              {showDiff ? 'Ocultar diff' : 'Ver diferenças vs v' + String(previousVersion.version)}
            </button>
          )}

          <div
            className="rounded-sm border border-border-subtle p-3"
            style={{ background: 'var(--bg-elev-2)' }}
          >
            <CreditAnalysisDiff
              previous={showDiff && previousVersion ? previousVersion.parecer_text : undefined}
              current={version.parecer_text}
            />
          </div>
        </div>

        {/* Pendências */}
        {version.pendencias.length > 0 && (
          <div className="mb-4">
            <p
              className="font-sans font-semibold text-ink-3 uppercase mb-2"
              style={{ fontSize: '0.65rem', letterSpacing: '0.1em' }}
            >
              Pendências
            </p>
            <ul className="flex flex-col gap-2">
              {version.pendencias.map((p, idx) => (
                <li key={idx} className="flex items-start gap-2 font-sans text-sm text-ink-2">
                  {/* Checkbox visual inert */}
                  <span
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 w-4 h-4 rounded-xs border border-border-strong flex items-center justify-center"
                    style={{ background: 'var(--surface-muted)' }}
                  />
                  <div>
                    <span className="font-semibold text-ink">{p.tipo}:</span> {p.descricao}
                    {p.prazo && (
                      <span className="ml-1.5 font-sans text-xs text-ink-4">
                        (Prazo: {p.prazo})
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Anexos — apenas metadados (signed URL é slot futuro) */}
        {version.attachments.length > 0 && (
          <div>
            <p
              className="font-sans font-semibold text-ink-3 uppercase mb-2"
              style={{ fontSize: '0.65rem', letterSpacing: '0.1em' }}
            >
              Anexos
            </p>
            <div className="flex flex-wrap gap-2">
              {version.attachments.map((att) => (
                <div
                  key={att.sha256}
                  className="flex items-center gap-2 rounded-sm border border-border-subtle px-3 py-2"
                  style={{ background: 'var(--bg-elev-2)' }}
                  title={`SHA-256: ${att.sha256}`}
                >
                  {/* Ícone de arquivo */}
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    className="w-4 h-4 text-ink-3 shrink-0"
                    aria-hidden="true"
                  >
                    <path d="M4 2h6l4 4v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" />
                    <path d="M10 2v4h4" />
                  </svg>
                  <div className="min-w-0">
                    <p
                      className="font-sans text-xs font-medium text-ink truncate"
                      style={{ maxWidth: 160 }}
                    >
                      {att.filename}
                    </p>
                    <p className="font-sans text-xs text-ink-4">
                      {formatFileSize(att.size_bytes)} · {att.sha256.slice(0, 8)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </SpotlightCard>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

interface CreditAnalysisVersionTimelineProps {
  /** Versões ordenadas já vindas da API — o componente reordena em DESC. */
  versions: CreditAnalysisVersionResponse[];
  isLoading?: boolean;
}

/**
 * Timeline imutável de versões de parecer.
 * Ordem sempre DESC (mais recente no topo).
 * Diff visual disponível para cada versão com predecessor.
 */
export function CreditAnalysisVersionTimeline({
  versions,
  isLoading = false,
}: CreditAnalysisVersionTimelineProps): React.JSX.Element {
  // Garantir ordenação DESC por número de versão
  const sorted = React.useMemo(
    () => [...versions].sort((a, b) => b.version - a.version),
    [versions],
  );

  // Mapa versão → anterior para diff. Declarado antes dos early returns
  // para preservar a ordem dos hooks entre renders (Rules of Hooks).
  const byVersion = React.useMemo(() => {
    const map = new Map<number, CreditAnalysisVersionResponse>();
    for (const v of versions) map.set(v.version, v);
    return map;
  }, [versions]);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <VersionSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div
        className="rounded-md border border-border bg-surface-1 p-6 text-center"
        style={{ boxShadow: 'var(--elev-2)' }}
      >
        <p className="font-sans text-sm text-ink-3">Nenhuma versão de parecer registrada.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {sorted.map((version, idx) => (
        <div
          key={version.id}
          style={{ animation: `fade-up var(--dur-slow) var(--ease-out) ${idx * 50}ms both` }}
        >
          <VersionItem
            version={version}
            previousVersion={byVersion.get(version.version - 1)}
            isLatest={idx === 0}
          />
        </div>
      ))}
    </div>
  );
}
