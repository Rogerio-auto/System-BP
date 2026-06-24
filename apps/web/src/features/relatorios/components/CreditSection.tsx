// features/relatorios/components/CreditSection.tsx  -- F23-S08 sec.4-E
import type { CommonReportQuery, CreditResponse } from '@elemento/shared-schemas';
import * as React from 'react';

import { Stat } from '../../../components/ui/Stat';
import { useReportsCredit } from '../hooks/useReportsCredit';
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
function CreditSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
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
        style={{ height: '80px', background: 'var(--surface-muted)' }}
      />
    </div>
  );
}
function CreditError({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  return (
    <div
      className="flex flex-col items-center gap-4 rounded-md border px-6 py-10 text-center"
      style={{ borderColor: 'var(--border)', background: 'var(--danger-bg)' }}
    >
      <p className="font-sans text-sm text-ink-2">Nao foi possivel carregar os dados de credito.</p>
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
function CreditEmpty(): React.JSX.Element {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-md border border-dashed px-6 py-10 text-center"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <p className="font-sans text-sm text-ink-3">Sem dados de credito no periodo selecionado.</p>
      <p className="font-sans text-xs text-ink-3">Tente ampliar o periodo ou ajustar o escopo.</p>
    </div>
  );
}
interface CreditFunnelBarProps {
  label: string;
  count: number;
  maxCount: number;
  rate?: string;
  accent?: string;
}
// Helper: retorna {} ou { rate } sem passar undefined explicito (exactOptionalPropertyTypes)
function rateProps(rate: string | undefined): { rate: string } | Record<string, never> {
  if (rate === undefined) return {};
  return { rate };
}
function CreditFunnelBar({
  label,
  count,
  maxCount,
  rate,
  accent,
}: CreditFunnelBarProps): React.JSX.Element {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  const barColor = accent ?? 'var(--brand)';
  return (
    <div className="flex items-center gap-3">
      <span
        className="font-sans text-xs text-ink-3 flex-shrink-0 text-right"
        style={{ width: '88px' }}
      >
        {label}
      </span>
      <div
        className="flex-1 rounded-full overflow-hidden"
        style={{ height: '8px', background: 'var(--surface-muted)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: String(pct) + '%', background: barColor }}
        />
      </div>
      <span className="font-sans text-xs font-semibold text-ink-2" style={{ width: '56px' }}>
        {fmtNumber(count)}
      </span>
      {rate !== undefined && (
        <span className="font-mono text-xs text-ink-3" style={{ width: '56px' }}>
          {rate}
        </span>
      )}
    </div>
  );
}
function CreditContent({ data }: { data: CreditResponse }): React.JSX.Element {
  const { funnel, amounts, contractsByStatus } = data;
  const isEmpty = funnel.simulations === 0 && funnel.contracts === 0;
  if (isEmpty) return <CreditEmpty />;
  const maxFunnel = Math.max(
    funnel.simulations,
    funnel.analyses,
    funnel.analysesApproved,
    funnel.contracts,
    1,
  );
  const refusedRate = funnel.analyses > 0 ? funnel.analysesRefused / funnel.analyses : 0;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Stat
          label="Simulacoes"
          value={fmtNumber(funnel.simulations)}
          description={
            amounts.simulationsAmountSum > 0
              ? 'total ' + fmtCurrency(amounts.simulationsAmountSum)
              : data.range.label
          }
        />
        <Stat
          label="Analises"
          value={fmtNumber(funnel.analyses)}
          description={
            funnel.simulations > 0
              ? fmtPercent(funnel.simToAnalysisRate) + ' das simulacoes'
              : data.range.label
          }
        />
        <Stat
          label="Aprovadas"
          value={fmtNumber(funnel.analysesApproved)}
          description={
            funnel.analyses > 0 ? fmtPercent(funnel.approvalRate) + ' das analises' : 'sem analises'
          }
        />
        <Stat
          label="Recusadas"
          value={fmtNumber(funnel.analysesRefused)}
          description={
            funnel.analyses > 0 ? fmtPercent(refusedRate) + ' das analises' : 'sem analises'
          }
        />
        <Stat
          label="Contratos"
          value={fmtNumber(funnel.contracts)}
          description={
            funnel.simulations > 0
              ? fmtPercent(funnel.simToContractRate) + ' das simulacoes'
              : data.range.label
          }
        />
        <Stat
          label="Inadimplencia"
          value={fmtPercent(contractsByStatus.defaultRate)}
          description={
            contractsByStatus.defaulted > 0
              ? fmtNumber(contractsByStatus.defaulted) + ' contratos em atraso'
              : 'sem inadimplencia'
          }
        />
      </div>
      <div
        className="rounded-md border p-5 space-y-3"
        style={{
          borderColor: 'var(--border)',
          background: 'var(--surface-1)',
          boxShadow: 'var(--elev-1)',
        }}
      >
        <p className="font-sans text-xs font-semibold uppercase tracking-wider text-ink-3 mb-4">
          Funil de credito
        </p>
        <CreditFunnelBar label="Simulacoes" count={funnel.simulations} maxCount={maxFunnel} />
        <CreditFunnelBar
          label="Analises"
          count={funnel.analyses}
          maxCount={maxFunnel}
          {...rateProps(funnel.simulations > 0 ? fmtPercent(funnel.simToAnalysisRate) : undefined)}
        />
        <CreditFunnelBar
          label="Aprovadas"
          count={funnel.analysesApproved}
          maxCount={maxFunnel}
          {...rateProps(funnel.analyses > 0 ? fmtPercent(funnel.approvalRate) : undefined)}
          accent="var(--success)"
        />
        <CreditFunnelBar
          label="Contratos"
          count={funnel.contracts}
          maxCount={maxFunnel}
          {...rateProps(funnel.simulations > 0 ? fmtPercent(funnel.simToContractRate) : undefined)}
          accent="var(--brand-verde)"
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
          Valores medios
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <p className="font-sans text-xs text-ink-3">Valor medio de simulacao</p>
            <p
              className="font-display font-bold text-ink mt-1"
              style={{ fontSize: 'var(--text-xl)' }}
            >
              {amounts.simulationsAmountAvg > 0 ? fmtCurrency(amounts.simulationsAmountAvg) : '--'}
            </p>
          </div>
          <div>
            <p className="font-sans text-xs text-ink-3">Valor medio aprovado</p>
            <p
              className="font-display font-bold text-ink mt-1"
              style={{ fontSize: 'var(--text-xl)' }}
            >
              {amounts.analysesApprovedAmountAvg > 0
                ? fmtCurrency(amounts.analysesApprovedAmountAvg)
                : '--'}
            </p>
          </div>
          <div>
            <p className="font-sans text-xs text-ink-3">Principal em carteira</p>
            <p
              className="font-display font-bold text-ink mt-1"
              style={{ fontSize: 'var(--text-xl)' }}
            >
              {amounts.contractsPrincipalSum > 0
                ? fmtCurrency(amounts.contractsPrincipalSum)
                : '--'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
interface CreditSectionProps {
  query: Partial<CommonReportQuery>;
}
export function CreditSection({ query }: CreditSectionProps): React.JSX.Element {
  const { data, isLoading, isError, isForbidden, refetch } = useReportsCredit(query);
  if (isForbidden) {
    return (
      <div
        className="rounded-md border px-6 py-8 text-center"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
      >
        <p className="font-sans text-sm text-ink-3">
          Voce nao tem permissao para visualizar dados de credito.
        </p>
      </div>
    );
  }
  if (isLoading) return <CreditSkeleton />;
  if (isError) return <CreditError onRetry={refetch} />;
  if (!data) return <CreditEmpty />;
  return <CreditContent data={data} />;
}
