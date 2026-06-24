// features/relatorios/components/CollectionSection.tsx  -- F23-S08 sec.4-F
// Cobranca e Carteira: 5 cards de carteira, adimplencia/inadimplencia, eficiencia de jobs.
// Gating: billing:read (inclui gestor_regional city-scoped). isForbidden esconde a secao.
import type { CollectionResponse, CommonReportQuery } from '@elemento/shared-schemas';
import * as React from 'react';

import { Stat } from '../../../components/ui/Stat';
import { useReportsCollection } from '../hooks/useReportsCollection';
function fmtNumber(n: number): string {
  return n.toLocaleString('pt-BR');
}
function fmtCurrency(n: number): string {
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  });
}
function fmtPercent(n: number): string {
  return (
    (n * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'
  );
}
function CollectionSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 8 }).map((_, i) => (
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
    </div>
  );
}
function CollectionError({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  return (
    <div
      className="flex flex-col items-center gap-4 rounded-md border px-6 py-10 text-center"
      style={{ borderColor: 'var(--border)', background: 'var(--danger-bg)' }}
    >
      <p className="font-sans text-sm text-ink-2">
        Nao foi possivel carregar os dados de cobranca.
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
function CollectionEmpty(): React.JSX.Element {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-md border border-dashed px-6 py-10 text-center"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <p className="font-sans text-sm text-ink-3">Sem dados de cobranca no periodo selecionado.</p>
      <p className="font-sans text-xs text-ink-3">Tente ampliar o periodo ou ajustar o escopo.</p>
    </div>
  );
}
function CollectionContent({ data }: { data: CollectionResponse }): React.JSX.Element {
  const { wallet, rates, jobsEfficiency } = data;
  const totalWallet = wallet.pending + wallet.overdue + wallet.paid;
  if (totalWallet === 0 && wallet.renegotiated === 0) return <CollectionEmpty />;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Stat
          label="A vencer"
          value={fmtNumber(wallet.pending)}
          description={
            wallet.pendingAmountSum > 0 ? fmtCurrency(wallet.pendingAmountSum) : 'sem parcelas'
          }
        />
        <Stat
          label="Em atraso"
          value={fmtNumber(wallet.overdue)}
          description={
            wallet.overdueAmountSum > 0 ? fmtCurrency(wallet.overdueAmountSum) : 'sem atrasos'
          }
        />
        <Stat
          label="Pagos"
          value={fmtNumber(wallet.paid)}
          description={
            wallet.paidAmountSum > 0 ? fmtCurrency(wallet.paidAmountSum) : data.range.label
          }
        />
        <Stat
          label="Renegociados"
          value={fmtNumber(wallet.renegotiated)}
          description={data.range.label}
        />
        <Stat
          label="Cancelados"
          value={fmtNumber(wallet.cancelled)}
          description={data.range.label}
        />
        <Stat
          label="Adimplencia"
          value={fmtPercent(rates.adimplenciaRate)}
          description={'inadimplencia: ' + fmtPercent(rates.inadimplenciaRate)}
        />
        <Stat
          label="Inadimplencia"
          value={fmtPercent(rates.inadimplenciaRate)}
          description={
            rates.avgDaysOverdue > 0
              ? fmtNumber(Math.round(rates.avgDaysOverdue)) + ' dias medio de atraso'
              : 'sem atrasos'
          }
        />
        <Stat
          label="Atraso medio"
          value={
            rates.avgDaysOverdue > 0 ? fmtNumber(Math.round(rates.avgDaysOverdue)) + 'd' : '--'
          }
          description="dias corridos de atraso"
        />
      </div>
      <div
        className="rounded-md border p-5"
        style={{
          borderColor: 'var(--border)',
          background: 'var(--surface-1)',
          boxShadow: 'var(--elev-1)',
        }}
      >
        <p className="font-sans text-xs font-semibold uppercase tracking-wider text-ink-3 mb-4">
          Eficiencia de cobranca
        </p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="font-sans text-xs text-ink-3">Cobranças agendadas</p>
            <p
              className="font-display font-bold text-ink mt-1"
              style={{ fontSize: 'var(--text-xl)' }}
            >
              {fmtNumber(jobsEfficiency.scheduled)}
            </p>
          </div>
          <div>
            <p className="font-sans text-xs text-ink-3">Enviadas</p>
            <p
              className="font-display font-bold text-ink mt-1"
              style={{ fontSize: 'var(--text-xl)' }}
            >
              {fmtNumber(jobsEfficiency.sent)}
              <span className="font-sans text-xs text-ink-3 ml-1">
                {fmtPercent(jobsEfficiency.sendRate)}
              </span>
            </p>
          </div>
          <div>
            <p className="font-sans text-xs text-ink-3">Falhas</p>
            <p
              className="font-display font-bold text-ink mt-1"
              style={{
                fontSize: 'var(--text-xl)',
                color: jobsEfficiency.failed > 0 ? 'var(--danger)' : 'inherit',
              }}
            >
              {fmtNumber(jobsEfficiency.failed)}
            </p>
          </div>
          <div>
            <p className="font-sans text-xs text-ink-3">Pagas antes do envio</p>
            <p
              className="font-display font-bold text-ink mt-1"
              style={{ fontSize: 'var(--text-xl)', color: 'var(--success)' }}
            >
              {fmtNumber(jobsEfficiency.paidBeforeSend)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
interface CollectionSectionProps {
  query: Partial<CommonReportQuery>;
}
export function CollectionSection({ query }: CollectionSectionProps): React.JSX.Element {
  const { data, isLoading, isError, isForbidden, refetch } = useReportsCollection(query);
  if (isForbidden) {
    return (
      <div
        className="rounded-md border px-6 py-8 text-center"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
      >
        <p className="font-sans text-sm text-ink-3">
          Voce nao tem permissao para visualizar dados de cobranca.
        </p>
      </div>
    );
  }
  if (isLoading) return <CollectionSkeleton />;
  if (isError) return <CollectionError onRetry={refetch} />;
  if (!data) return <CollectionEmpty />;
  return <CollectionContent data={data} />;
}
