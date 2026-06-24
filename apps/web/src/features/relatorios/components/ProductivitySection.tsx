// features/relatorios/components/ProductivitySection.tsx  -- F23-S08 sec.4-G
// Produtividade por agente.
// D3: data.teamAverage presente = self-scoped (agente ve a si + media anonima);
//     ausente = gestor (ranking nominal completo).
// A UI APENAS APRESENTA o que o backend retornou. Sem reconstrucao de nomes.
import type { CommonReportQuery, ProductivityResponse } from '@elemento/shared-schemas';
import * as React from 'react';

import { Stat } from '../../../components/ui/Stat';
import { useReportsProductivity } from '../hooks/useReportsProductivity';
function fmtNumber(n: number): string {
  return n.toLocaleString('pt-BR');
}
function fmtDuration(sec: number | null): string {
  if (sec === null) return '--';
  if (sec < 60) return String(Math.round(sec)) + 's';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m < 60
    ? s > 0
      ? String(m) + 'm ' + String(s) + 's'
      : String(m) + 'm'
    : String(Math.floor(m / 60)) + 'h ' + String(m % 60) + 'm';
}
function ProductivitySkeleton(): React.JSX.Element {
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
        style={{ height: '120px', background: 'var(--surface-muted)' }}
      />
    </div>
  );
}
function ProductivityError({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  return (
    <div
      className="flex flex-col items-center gap-4 rounded-md border px-6 py-10 text-center"
      style={{ borderColor: 'var(--border)', background: 'var(--danger-bg)' }}
    >
      <p className="font-sans text-sm text-ink-2">
        Nao foi possivel carregar os dados de produtividade.
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
function ProductivityEmpty(): React.JSX.Element {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-md border border-dashed px-6 py-10 text-center"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <p className="font-sans text-sm text-ink-3">
        Sem dados de produtividade no periodo selecionado.
      </p>
      <p className="font-sans text-xs text-ink-3">Tente ampliar o periodo ou ajustar o escopo.</p>
    </div>
  );
}
// D3: self-scoped -- agente ve seu proprio registro + media anonima da equipe
function SelfView({ data }: { data: ProductivityResponse }): React.JSX.Element {
  const me = data.agents[0];
  if (!me) return <ProductivityEmpty />;
  const avg = data.teamAverage;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Leads fechados"
          value={fmtNumber(me.leadsClosedWon)}
          description={
            avg ? 'media equipe: ' + fmtNumber(Math.round(avg.leadsClosedWon)) : 'sem comparativo'
          }
        />
        <Stat
          label="Simulacoes"
          value={fmtNumber(me.simulationsCreated)}
          description={
            avg
              ? 'media equipe: ' + fmtNumber(Math.round(avg.simulationsCreated))
              : 'sem comparativo'
          }
        />
        <Stat
          label="Conversas resolvidas"
          value={fmtNumber(me.conversationsResolved)}
          description={
            avg
              ? 'media equipe: ' + fmtNumber(Math.round(avg.conversationsResolved))
              : 'sem comparativo'
          }
        />
        <Stat
          label="Contratos originados"
          value={fmtNumber(me.contractsOriginated)}
          description={
            avg
              ? 'media equipe: ' + fmtNumber(Math.round(avg.contractsOriginated))
              : 'sem comparativo'
          }
        />
      </div>
      {avg && (
        <div
          className="rounded-md border px-5 py-4"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
        >
          <p className="font-sans text-xs text-ink-3">
            A media da equipe e calculada de forma anonima e nao identifica colegas. Voce esta vendo
            apenas seus proprios dados (D3).
          </p>
        </div>
      )}
    </div>
  );
}
// Gestor: ranking nominal completo, ordenado por leadsClosedWon desc
function RankingView({ data }: { data: ProductivityResponse }): React.JSX.Element {
  if (data.agents.length === 0) return <ProductivityEmpty />;
  const sorted = data.agents.slice().sort((a, b) => b.leadsClosedWon - a.leadsClosedWon);
  return (
    <div className="space-y-3">
      <div className="rounded-md border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
        <table className="w-full font-sans text-sm">
          <thead>
            <tr style={{ background: 'var(--surface-1)', borderBottom: '1px solid var(--border)' }}>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-ink-3">
                #
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-ink-3">
                Agente
              </th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-ink-3">
                Leads
              </th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-ink-3">
                Simulacoes
              </th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-ink-3">
                Conversas
              </th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-ink-3">
                Contratos
              </th>
              <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-ink-3">
                1a resp.
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((agent, idx) => (
              <tr
                key={agent.agentId}
                style={{
                  borderBottom: '1px solid var(--border-subtle)',
                  background: idx % 2 === 0 ? 'var(--surface-1)' : 'transparent',
                }}
              >
                <td className="px-4 py-3 text-ink-3 text-xs">{idx + 1}</td>
                <td className="px-4 py-3 font-semibold text-ink">{agent.displayName ?? '--'}</td>
                <td className="px-4 py-3 text-right text-ink">{fmtNumber(agent.leadsClosedWon)}</td>
                <td className="px-4 py-3 text-right text-ink-2">
                  {fmtNumber(agent.simulationsCreated)}
                </td>
                <td className="px-4 py-3 text-right text-ink-2">
                  {fmtNumber(agent.conversationsResolved)}
                </td>
                <td className="px-4 py-3 text-right text-ink-2">
                  {fmtNumber(agent.contractsOriginated)}
                </td>
                <td className="px-4 py-3 text-right text-ink-2">
                  {fmtDuration(agent.avgFirstResponseSec)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
interface ProductivitySectionProps {
  query: Partial<CommonReportQuery>;
}
export function ProductivitySection({ query }: ProductivitySectionProps): React.JSX.Element {
  const { data, isLoading, isError, isForbidden, refetch } = useReportsProductivity(query);
  if (isForbidden) {
    return (
      <div
        className="rounded-md border px-6 py-8 text-center"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
      >
        <p className="font-sans text-sm text-ink-3">
          Voce nao tem permissao para visualizar dados de produtividade.
        </p>
      </div>
    );
  }
  if (isLoading) return <ProductivitySkeleton />;
  if (isError) return <ProductivityError onRetry={refetch} />;
  if (!data || data.agents.length === 0) return <ProductivityEmpty />;
  // D3: teamAverage presente = self-scoped; ausente = gestor com ranking nominal
  if (data.teamAverage !== undefined) return <SelfView data={data} />;
  return <RankingView data={data} />;
}
