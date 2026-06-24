// features/relatorios/components/AuditSection.tsx  -- F23-S08 sec.4-H
// Auditoria e Operacao: volume de eventos, acoes criticas, saude do outbox, DLQ.
// Gating: audit:read (admin/gestor_geral). isForbidden esconde a secao.
import type { AuditResponse, CommonReportQuery } from '@elemento/shared-schemas';
import * as React from 'react';

import { Stat } from '../../../components/ui/Stat';
import { useReportsAudit } from '../hooks/useReportsAudit';
function fmtNumber(n: number): string {
  return n.toLocaleString('pt-BR');
}
function fmtPercent(n: number): string {
  return (
    (n * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'
  );
}
function AuditSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-md border border-border bg-surface-1 p-5 animate-pulse"
            style={{ boxShadow: 'var(--elev-2)', minHeight: '88px' }}
          >
            <div
              className="mb-3 h-2.5 w-24 rounded-full"
              style={{ background: 'var(--surface-muted)' }}
            />
            <div className="h-7 w-16 rounded-sm" style={{ background: 'var(--surface-muted)' }} />
          </div>
        ))}
      </div>
      <div
        className="rounded-md border animate-pulse"
        style={{ height: '140px', background: 'var(--surface-muted)' }}
      />
    </div>
  );
}
function AuditError({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  return (
    <div
      className="flex flex-col items-center gap-4 rounded-md border px-6 py-10 text-center"
      style={{ borderColor: 'var(--border)', background: 'var(--danger-bg)' }}
    >
      <p className="font-sans text-sm text-ink-2">
        Nao foi possivel carregar os dados de auditoria.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="font-sans text-sm font-semibold rounded-sm px-4 py-2"
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border-strong)',
          color: 'var(--text)',
          boxShadow: 'var(--elev-1)',
        }}
      >
        Tentar novamente
      </button>
    </div>
  );
}
function AuditEmpty(): React.JSX.Element {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-md border border-dashed px-6 py-10 text-center"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <p className="font-sans text-sm text-ink-3">Sem dados de auditoria no periodo selecionado.</p>
      <p className="font-sans text-xs text-ink-3">Tente ampliar o periodo ou ajustar o escopo.</p>
    </div>
  );
}
function AuditContent({ data }: { data: AuditResponse }): React.JSX.Element {
  const { auditVolume, topActions, criticalActions, outboxHealth, dlqSnapshot } = data;
  if (auditVolume.total === 0) return <AuditEmpty />;
  const topActionsSlice = topActions
    .slice()
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Total de eventos"
          value={fmtNumber(auditVolume.total)}
          description={data.range.label}
        />
        <Stat
          label="Outbox processados"
          value={fmtNumber(outboxHealth.totalProcessed)}
          description={fmtPercent(outboxHealth.successRate) + ' de sucesso'}
        />
        <Stat
          label="Outbox pendentes"
          value={fmtNumber(outboxHealth.totalPending)}
          description="aguardando processamento"
        />
        <Stat
          label="DLQ pendentes"
          value={fmtNumber(dlqSnapshot.pendingReprocess)}
          description={dlqSnapshot.pendingReprocess > 0 ? 'requer atencao' : 'fila limpa'}
        />
      </div>
      {dlqSnapshot.pendingReprocess > 0 && (
        <div
          className="rounded-md border px-5 py-4 space-y-2"
          style={{ borderColor: 'var(--warning)', background: 'var(--warning-bg)' }}
        >
          <p className="font-sans text-sm font-semibold" style={{ color: 'var(--warning)' }}>
            {fmtNumber(dlqSnapshot.pendingReprocess)} eventos na DLQ aguardando reprocessamento
          </p>
          {dlqSnapshot.topEventNames.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-1">
              {dlqSnapshot.topEventNames.map((e) => (
                <span
                  key={e.eventName}
                  className="font-mono text-xs px-2 py-0.5 rounded-sm"
                  style={{
                    background: 'var(--surface-1)',
                    color: 'var(--text-2)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {e.eventName}: {fmtNumber(e.count)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {topActionsSlice.length > 0 && (
          <div
            className="rounded-md border p-5"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--surface-1)',
              boxShadow: 'var(--elev-1)',
            }}
          >
            <p className="font-sans text-xs font-semibold uppercase tracking-wider text-ink-3 mb-4">
              Top acoes
            </p>
            <div className="space-y-2">
              {topActionsSlice.map((a) => {
                const pct = auditVolume.total > 0 ? (a.count / auditVolume.total) * 100 : 0;
                return (
                  <div key={a.action} className="flex items-center gap-3">
                    <span className="font-mono text-xs text-ink-3 truncate flex-1">{a.action}</span>
                    <div
                      className="w-20 rounded-full overflow-hidden"
                      style={{ height: '4px', background: 'var(--surface-muted)' }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{ width: String(pct) + '%', background: 'var(--brand)' }}
                      />
                    </div>
                    <span className="font-sans text-xs font-semibold text-ink-2 w-10 text-right">
                      {fmtNumber(a.count)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {criticalActions.length > 0 && (
          <div
            className="rounded-md border p-5"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--surface-1)',
              boxShadow: 'var(--elev-1)',
            }}
          >
            <p className="font-sans text-xs font-semibold uppercase tracking-wider text-ink-3 mb-4">
              Acoes criticas
            </p>
            <div className="space-y-2">
              {criticalActions.map((a) => (
                <div key={a.action} className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-ink-3 truncate flex-1">{a.action}</span>
                  <span className="font-sans text-xs text-ink-3">
                    {fmtNumber(a.actorCount)} atores
                  </span>
                  <span
                    className="font-sans text-xs font-semibold"
                    style={{ color: 'var(--danger)' }}
                  >
                    {fmtNumber(a.count)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
interface AuditSectionProps {
  query: Partial<CommonReportQuery>;
}
export function AuditSection({ query }: AuditSectionProps): React.JSX.Element {
  const { data, isLoading, isError, isForbidden, refetch } = useReportsAudit(query);
  if (isForbidden) {
    return (
      <div
        className="rounded-md border px-6 py-8 text-center"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
      >
        <p className="font-sans text-sm text-ink-3">
          Voce nao tem permissao para visualizar dados de auditoria.
        </p>
      </div>
    );
  }
  if (isLoading) return <AuditSkeleton />;
  if (isError) return <AuditError onRetry={refetch} />;
  if (!data) return <AuditEmpty />;
  return <AuditContent data={data} />;
}
