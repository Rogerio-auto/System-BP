// features/relatorios/components/OverviewSection.tsx -- Secao Visao Geral (F23-S06).
// Consome GET /api/reports/overview via useReportsOverview (TanStack Query).
// KPIs: leads, simulacoes, contratos, conversas. Reutiliza Stat (DS s9.8).

import type { CommonReportQuery, OverviewResponse } from '@elemento/shared-schemas';
import * as React from 'react';

import { Stat } from '../../../components/ui/Stat';
import { useReportsOverview } from '../hooks/useReportsOverview';

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
/**
 * Calcula o trend de delta entre dois periodos.
 * Retorna undefined quando nao ha dado anterior (esconde o pill).
 * Para uso com exactOptionalPropertyTypes: usar o helper trendProps().
 */
function deltaTrend(
  current: number,
  previous: number,
): { value: string; direction: 'up' | 'down' | 'neutral' } | undefined {
  if (previous === 0) return undefined;
  const delta = (current - previous) / previous;
  const direction = delta > 0.005 ? 'up' : delta < -0.005 ? 'down' : 'neutral';
  const value = (Math.abs(delta) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
  return { value, direction };
}

/**
 * Retorna um objeto com { trend } somente se o trend for definido.
 * Compativel com exactOptionalPropertyTypes: true.
 */
function trendProps(
  trend: { value: string; direction: 'up' | 'down' | 'neutral' } | undefined,
): { trend: { value: string; direction: 'up' | 'down' | 'neutral' } } | Record<string, never> {
  if (trend === undefined) return {};
  return { trend };
}

function OverviewSkeleton(): React.JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="rounded-md border border-border bg-surface-1 p-5"
          style={{ boxShadow: 'var(--elev-2)', minHeight: '100px' }}
        >
          <div
            className="mb-3 h-2.5 w-24 rounded-pill animate-pulse"
            style={{ background: 'var(--surface-muted)' }}
          />
          <div
            className="h-8 w-16 rounded-xs animate-pulse"
            style={{ background: 'var(--surface-muted)' }}
          />
          <div
            className="mt-2 h-2 w-32 rounded-pill animate-pulse"
            style={{ background: 'var(--border-subtle)' }}
          />
        </div>
      ))}
    </div>
  );
}

function OverviewError({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  return (
    <div
      className="flex flex-col items-center gap-4 rounded-md border px-6 py-10 text-center"
      style={{ borderColor: 'var(--border)', background: 'var(--danger-bg)' }}
    >
      <p className="font-sans text-sm text-ink-2">Nao foi possivel carregar os dados.</p>
      <button
        type="button"
        onClick={onRetry}
        className="font-sans text-sm font-semibold rounded-sm px-4 py-2 transition-all duration-fast"
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

function OverviewEmpty(): React.JSX.Element {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-md border border-dashed px-6 py-10 text-center"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <p className="font-sans text-sm text-ink-3">Sem dados no periodo e escopo selecionados.</p>
      <p className="font-sans text-xs text-ink-3">Tente ampliar o periodo ou ajustar o escopo.</p>
    </div>
  );
}

function OverviewCards({
  data,
  compareWithPrevious,
}: {
  data: OverviewResponse;
  compareWithPrevious: boolean;
}): React.JSX.Element {
  const prev = compareWithPrevious ? data.previousPeriod : undefined;
  const totalClosed = data.leads.closedWon + data.leads.closedLost;
  const isEmpty =
    data.leads.total === 0 &&
    data.simulations.total === 0 &&
    data.contracts.active === 0 &&
    data.conversations.open === 0 &&
    data.conversations.resolved === 0;

  if (isEmpty) return <OverviewEmpty />;

  const totalContracts = data.contracts.active + data.contracts.defaulted;
  const adimplenciaRate = totalContracts > 0 ? data.contracts.active / totalContracts : 0;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat
        label="Total de leads"
        value={fmtNumber(data.leads.total)}
        description={data.range.label}
        {...trendProps(prev ? deltaTrend(data.leads.total, prev.leads.total) : undefined)}
      />
      <Stat
        label="Novos no periodo"
        value={fmtNumber(data.leads.newInPeriod)}
        description={data.range.label}
      />
      <Stat
        label="Conversao"
        value={totalClosed > 0 ? fmtPercent(data.leads.conversionRate) : '--'}
        description={
          totalClosed > 0
            ? fmtNumber(data.leads.closedWon) + ' de ' + fmtNumber(totalClosed) + ' fechados'
            : 'sem fechamentos'
        }
        {...trendProps(
          prev ? deltaTrend(data.leads.conversionRate, prev.leads.conversionRate) : undefined,
        )}
      />
      <Stat
        label="Simulacoes"
        value={fmtNumber(data.simulations.total)}
        description={
          data.simulations.total > 0
            ? 'media ' + fmtCurrency(data.simulations.amountAvg)
            : data.range.label
        }
        {...trendProps(
          prev ? deltaTrend(data.simulations.total, prev.simulations.total) : undefined,
        )}
      />
      <Stat
        label="Contratos ativos"
        value={fmtNumber(data.contracts.active)}
        description={
          data.contracts.activePrincipalSum > 0
            ? fmtCurrency(data.contracts.activePrincipalSum) + ' em carteira'
            : 'sem carteira'
        }
      />
      <Stat
        label="Adimplencia"
        value={totalContracts > 0 ? fmtPercent(adimplenciaRate) : '--'}
        description={
          data.contracts.defaulted > 0
            ? fmtNumber(data.contracts.defaulted) + ' inadimplentes'
            : 'sem inadimplencia'
        }
      />
      <Stat
        label="Conversas abertas"
        value={fmtNumber(data.conversations.open)}
        description="aguardando atendimento"
      />
      <Stat
        label="Conversas resolvidas"
        value={fmtNumber(data.conversations.resolved)}
        description={data.range.label}
      />
    </div>
  );
}

interface OverviewSectionProps {
  query: Partial<CommonReportQuery>;
}

/**
 * Secao Visao Geral. Consome /api/reports/overview com os filtros ativos.
 * Estados: loading (skeleton) / error / empty / success (8 KPI cards).
 */
export function OverviewSection({ query }: OverviewSectionProps): React.JSX.Element {
  const compareWithPrevious = query.compareWithPrevious ?? false;
  const { data, isLoading, isError, isForbidden, refetch } = useReportsOverview(query);

  if (isForbidden) {
    return (
      <div
        className="rounded-md border px-6 py-8 text-center"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
      >
        <p className="font-sans text-sm text-ink-3">
          Voce nao tem permissao para visualizar a Visao Geral.
        </p>
      </div>
    );
  }
  if (isLoading) return <OverviewSkeleton />;
  if (isError) return <OverviewError onRetry={refetch} />;
  if (!data) return <OverviewEmpty />;

  return <OverviewCards data={data} compareWithPrevious={compareWithPrevious} />;
}
