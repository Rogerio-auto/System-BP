// =============================================================================
// features/relatorios/components/AiSection.tsx
// F23-S07 sec.4-C: IA / Pre-atendimento (Ana Clara)
//
// GATING: se o endpoint /api/reports/ai retornar 403 (papel city-scoped),
// a secao inteira e escondida (retorna null). A pagina nao quebra.
// O bloco llmMetrics/modelBreakdown fica visivel somente quando !isForbidden.
// =============================================================================
import type { AiResponse, CommonReportQuery } from '@elemento/shared-schemas';
import * as React from 'react';

import type { ResponsiveTableColumn } from '../../../components/ui/ResponsiveTable';
import { ResponsiveTable } from '../../../components/ui/ResponsiveTable';
import { Stat } from '../../../components/ui/Stat';
import { useReportsAi } from '../hooks/useReportsAi';

type NodeRow = AiResponse['nodeDistribution'][number];
type ModelRow = AiResponse['modelBreakdown'][number];

function fmtNumber(n: number): string {
  return n.toLocaleString('pt-BR');
}
function fmtPct(n: number): string {
  return (
    (n * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'
  );
}
function fmtMs(ms: number | null): string {
  if (ms === null) return '--';
  if (ms < 1000) return String(Math.round(ms)) + 'ms';
  return (
    (ms / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) +
    's'
  );
}
function fmtCostUsd(v: number | null): string {
  if (v === null) return '--';
  return 'US$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}
function AiSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="rounded-md border border-border bg-surface-1 p-5"
            style={{ boxShadow: 'var(--elev-2)', minHeight: '88px' }}
          >
            <div
              className="mb-3 h-2.5 w-24 rounded-full animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
            <div
              className="h-7 w-16 rounded-sm animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
          </div>
        ))}
      </div>
      <div
        className="rounded-md border animate-pulse"
        style={{ height: '100px', background: 'var(--surface-muted)' }}
      />
    </div>
  );
}
function AiError({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  return (
    <div
      className="flex flex-col items-center gap-4 rounded-md border px-6 py-10 text-center"
      style={{ borderColor: 'var(--border)', background: 'var(--danger-bg)' }}
    >
      <p className="font-sans text-sm text-ink-2">Nao foi possivel carregar os dados de IA.</p>
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
function AiEmpty(): React.JSX.Element {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-md border border-dashed px-6 py-10 text-center"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <p className="font-sans text-sm text-ink-3">
        Nenhuma conversa com IA no periodo selecionado.
      </p>
      <p className="font-sans text-xs text-ink-3">
        Tente ampliar o periodo ou verifique se a IA esta habilitada.
      </p>
    </div>
  );
}
function HandoffReasonBars({ data }: { data: AiResponse }): React.JSX.Element | null {
  if (data.handoffReasons.length === 0) return null;
  const maxCount = Math.max(...data.handoffReasons.map((r) => r.count));
  return (
    <div
      className="rounded-md border p-5"
      style={{
        borderColor: 'var(--border)',
        background: 'var(--surface-1)',
        boxShadow: 'var(--elev-1)',
      }}
    >
      <p className="font-sans text-xs font-semibold uppercase tracking-wider text-ink-3 mb-4">
        Motivos de handoff
      </p>
      <div className="space-y-3">
        {data.handoffReasons.map((r) => {
          const pct = maxCount > 0 ? (r.count / maxCount) * 100 : 0;
          return (
            <div key={r.reason} className="flex items-center gap-3">
              <span
                className="font-sans text-xs text-ink-3 flex-shrink-0"
                style={{ width: '120px', textAlign: 'right' }}
              >
                {r.reason}
              </span>
              <div
                className="flex-1 rounded-full overflow-hidden"
                style={{ height: '8px', background: 'var(--surface-muted)' }}
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: String(pct) + '%', background: 'var(--brand)' }}
                />
              </div>
              <span
                className="font-sans text-xs font-semibold text-ink-2"
                style={{ width: '40px' }}
              >
                {fmtNumber(r.count)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
// Colunas (ResponsiveTable — DS §9.7 + doc 24 §6): tabela no desktop, cards
// empilhados no mobile, a partir da MESMA definição.
const NODE_DISTRIBUTION_COLUMNS: ResponsiveTableColumn<NodeRow>[] = [
  {
    key: 'node',
    header: 'No',
    primary: true,
    cell: (n) => <span className="font-sans text-xs text-ink font-medium">{n.nodeName}</span>,
  },
  {
    key: 'calls',
    header: 'Chamadas',
    align: 'right',
    cell: (n) => <span className="font-sans text-xs text-ink-2">{fmtNumber(n.callCount)}</span>,
  },
  {
    key: 'errors',
    header: 'Erros',
    align: 'right',
    cell: (n) => (
      <span
        className="font-sans text-xs"
        style={{ color: n.errorCount > 0 ? 'var(--danger)' : 'var(--text-3)' }}
      >
        {fmtNumber(n.errorCount)}
      </span>
    ),
  },
  {
    key: 'latency',
    header: 'Latencia media',
    align: 'right',
    cell: (n) => <span className="font-sans text-xs text-ink-2">{fmtMs(n.avgLatencyMs)}</span>,
  },
];

function NodeDistributionTable({ data }: { data: AiResponse }): React.JSX.Element | null {
  if (data.nodeDistribution.length === 0) return null;
  return (
    <div
      className="rounded-md border p-5"
      style={{
        borderColor: 'var(--border)',
        background: 'var(--surface-1)',
        boxShadow: 'var(--elev-1)',
      }}
    >
      <p className="font-sans text-xs font-semibold uppercase tracking-wider text-ink-3 mb-4">
        Distribuicao por no do grafo
      </p>
      <ResponsiveTable
        columns={NODE_DISTRIBUTION_COLUMNS}
        data={data.nodeDistribution}
        getRowKey={(n) => n.nodeName}
        aria-label="Distribuicao por no do grafo"
      />
    </div>
  );
}
const MODEL_BREAKDOWN_COLUMNS: ResponsiveTableColumn<ModelRow>[] = [
  {
    key: 'model',
    header: 'Modelo',
    primary: true,
    cell: (m) => <span className="font-sans text-xs text-ink font-medium">{m.model}</span>,
  },
  {
    key: 'calls',
    header: 'Chamadas',
    align: 'right',
    cell: (m) => <span className="font-sans text-xs text-ink-2">{fmtNumber(m.callCount)}</span>,
  },
  {
    key: 'tokensIn',
    header: 'Tokens in',
    align: 'right',
    cell: (m) => <span className="font-sans text-xs text-ink-2">{fmtNumber(m.tokensIn)}</span>,
  },
  {
    key: 'cost',
    header: 'Custo est.',
    align: 'right',
    cell: (m) => (
      <span className="font-sans text-xs text-ink-2">
        {m.costAvailable ? fmtCostUsd(m.estimatedCostUsd) : 'n/d'}
      </span>
    ),
  },
];

function LlmMetricsBlock({ data }: { data: AiResponse }): React.JSX.Element {
  return (
    <div
      className="rounded-md border p-5"
      style={{
        borderColor: 'var(--border)',
        background: 'var(--surface-1)',
        boxShadow: 'var(--elev-1)',
      }}
    >
      <p className="font-sans text-xs font-semibold uppercase tracking-wider text-ink-3 mb-4">
        Custo e saude do LLM
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Stat
          label="Total de chamadas LLM"
          value={fmtNumber(data.llmMetrics.totalCalls)}
          description="no periodo"
        />
        <Stat
          label="Tokens entrada"
          value={fmtNumber(data.llmMetrics.totalTokensIn)}
          description="total acumulado"
        />
        <Stat
          label="Tokens saida"
          value={fmtNumber(data.llmMetrics.totalTokensOut)}
          description="total acumulado"
        />
        <Stat
          label="Custo estimado"
          value={
            data.llmMetrics.costAvailable ? fmtCostUsd(data.llmMetrics.estimatedCostUsd) : 'n/d'
          }
          description={data.llmMetrics.costAvailable ? 'estimativa USD' : 'tarifa nao disponivel'}
        />
        <Stat
          label="Latencia media"
          value={fmtMs(data.llmMetrics.avgLatencyMs)}
          description={
            data.llmMetrics.p90LatencyMs !== null
              ? 'p90: ' + fmtMs(data.llmMetrics.p90LatencyMs)
              : 'sem p90'
          }
        />
        <Stat
          label="Taxa de erro LLM"
          value={fmtPct(data.llmMetrics.errorRate)}
          description="do total de chamadas"
        />
      </div>
      {data.modelBreakdown.length > 0 && (
        <div className="mt-4">
          <ResponsiveTable
            columns={MODEL_BREAKDOWN_COLUMNS}
            data={data.modelBreakdown}
            getRowKey={(m) => m.model}
            aria-label="Custo por modelo de LLM"
          />
        </div>
      )}
    </div>
  );
}
function AiContent({ data }: { data: AiResponse }): React.JSX.Element {
  const isEmpty = data.conversations.total === 0;
  if (isEmpty) return <AiEmpty />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Stat
          label="Conversas com IA"
          value={fmtNumber(data.conversations.total)}
          description={data.range.label}
        />
        <Stat
          label="Resolvidas sem handoff"
          value={fmtNumber(data.conversations.completedWithoutHandoff)}
          description={fmtPct(1 - data.conversations.handoffRate) + ' do total'}
        />
        <Stat
          label="Handoffs para humano"
          value={fmtNumber(data.conversations.handoffed)}
          description={fmtPct(data.conversations.handoffRate) + ' de taxa de handoff'}
        />
        <Stat
          label="Conversas ativas"
          value={fmtNumber(data.conversations.active)}
          description="em andamento agora"
        />
        <Stat
          label="Tempo ate aceitar handoff"
          value={
            data.handoffSla.avgTimeToAcceptSec !== null
              ? String(Math.round(data.handoffSla.avgTimeToAcceptSec)) + 's'
              : '--'
          }
          description={
            data.handoffSla.pendingHandoffs > 0
              ? fmtNumber(data.handoffSla.pendingHandoffs) + ' pendentes'
              : 'sem pendentes'
          }
        />
      </div>
      <HandoffReasonBars data={data} />
      <NodeDistributionTable data={data} />
      <LlmMetricsBlock data={data} />
    </div>
  );
}
interface AiSectionProps {
  query: Partial<CommonReportQuery>;
}
/**
 * Secao IA / Pre-atendimento (paragr 4-C).
 * GATING: retorna null quando isForbidden (403). A pagina nao quebra.
 * O bloco de custo/latencia LLM so aparece para globais (admin/gestor_geral)
 * pois o endpoint ja retorna 403 para papeis city-scoped.
 */
export function AiSection({ query }: AiSectionProps): React.JSX.Element | null {
  const { data, isLoading, isError, isForbidden, refetch } = useReportsAi(query);
  // 403 = papel sem acesso global. Esconder silenciosamente.
  if (isForbidden) return null;
  if (isLoading) return <AiSkeleton />;
  if (isError) return <AiError onRetry={refetch} />;
  if (!data) return <AiEmpty />;
  return <AiContent data={data} />;
}
