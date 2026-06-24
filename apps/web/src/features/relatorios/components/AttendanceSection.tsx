// =============================================================================
// features/relatorios/components/AttendanceSection.tsx
// F23-S07 sec.4-B: Atendimentos & Conversas
// =============================================================================
import type { AttendanceResponse, CommonReportQuery } from '@elemento/shared-schemas';
import * as React from 'react';

import { Stat } from '../../../components/ui/Stat';
import { useReportsAttendance } from '../hooks/useReportsAttendance';
function fmtNumber(n: number): string {
  return n.toLocaleString('pt-BR');
}
function fmtDuration(seconds: number | null): string {
  if (seconds === null) return '--';
  if (seconds < 60) return String(Math.round(seconds)) + 's';
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins < 60) return secs > 0 ? String(mins) + 'm ' + String(secs) + 's' : String(mins) + 'm';
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? String(hours) + 'h ' + String(remMins) + 'm' : String(hours) + 'h';
}
function AttendanceSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
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
        style={{ height: '120px', background: 'var(--surface-muted)' }}
      />
    </div>
  );
}
function AttendanceError({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  return (
    <div
      className="flex flex-col items-center gap-4 rounded-md border px-6 py-10 text-center"
      style={{ borderColor: 'var(--border)', background: 'var(--danger-bg)' }}
    >
      <p className="font-sans text-sm text-ink-2">
        Nao foi possivel carregar os dados de atendimento.
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
function AttendanceEmpty(): React.JSX.Element {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-md border border-dashed px-6 py-10 text-center"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <p className="font-sans text-sm text-ink-3">Nenhuma conversa no periodo selecionado.</p>
      <p className="font-sans text-xs text-ink-3">Tente ampliar o periodo ou ajustar o escopo.</p>
    </div>
  );
}
interface ChannelBarProps {
  channel: string;
  count: number;
  maxCount: number;
}
const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  web: 'Web',
  telefone: 'Telefone',
  instagram: 'Instagram',
  email: 'E-mail',
};
function ChannelBar({ channel, count, maxCount }: ChannelBarProps): React.JSX.Element {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span
        className="font-sans text-xs text-ink-3 flex-shrink-0"
        style={{ width: '72px', textAlign: 'right' }}
      >
        {CHANNEL_LABELS[channel] ?? channel}
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
      <span className="font-sans text-xs font-semibold text-ink-2" style={{ width: '40px' }}>
        {fmtNumber(count)}
      </span>
    </div>
  );
}
function AttendanceContent({ data }: { data: AttendanceResponse }): React.JSX.Element {
  const isEmpty =
    data.totals.conversationsOpened === 0 &&
    data.totals.conversationsResolved === 0 &&
    data.totals.messagesTotal === 0;
  if (isEmpty) return <AttendanceEmpty />;
  const maxCC =
    data.byChannel.length > 0 ? Math.max(...data.byChannel.map((c) => c.conversationCount)) : 0;
  const resolRate =
    data.totals.conversationsOpened > 0
      ? (data.totals.conversationsResolved / data.totals.conversationsOpened) * 100
      : 0;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Stat
          label="Conversas abertas"
          value={fmtNumber(data.totals.conversationsOpened)}
          description={data.range.label}
        />
        <Stat
          label="Conversas resolvidas"
          value={fmtNumber(data.totals.conversationsResolved)}
          description={
            resolRate > 0
              ? resolRate.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '% de resolucao'
              : data.range.label
          }
        />
        <Stat
          label="Mensagens trocadas"
          value={fmtNumber(data.totals.messagesTotal)}
          description={data.range.label}
        />
        <Stat
          label="1a resposta (medio)"
          value={fmtDuration(data.timings.firstResponseAvgSec)}
          description={
            data.timings.firstResponseP90Sec !== null
              ? 'p90: ' + fmtDuration(data.timings.firstResponseP90Sec)
              : 'sem dados de percentil'
          }
        />
        <Stat
          label="Resolucao (medio)"
          value={fmtDuration(data.timings.resolutionAvgSec)}
          description={
            data.timings.resolutionP90Sec !== null
              ? 'p90: ' + fmtDuration(data.timings.resolutionP90Sec)
              : 'sem dados de percentil'
          }
        />
        <Stat
          label="Taxa de resolucao"
          value={
            data.totals.conversationsOpened > 0
              ? resolRate.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'
              : '--'
          }
          description={
            fmtNumber(data.totals.conversationsResolved) +
            ' de ' +
            fmtNumber(data.totals.conversationsOpened)
          }
        />
      </div>
      {data.byChannel.length > 0 && (
        <div
          className="rounded-md border p-5"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--surface-1)',
            boxShadow: 'var(--elev-1)',
          }}
        >
          <p className="font-sans text-xs font-semibold uppercase tracking-wider text-ink-3 mb-4">
            Volume por canal
          </p>
          <div className="space-y-3">
            {data.byChannel
              .slice()
              .sort((a, b) => b.conversationCount - a.conversationCount)
              .map((ch) => (
                <ChannelBar
                  key={ch.channel}
                  channel={ch.channel}
                  count={ch.conversationCount}
                  maxCount={maxCC}
                />
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
interface AttendanceSectionProps {
  query: Partial<CommonReportQuery>;
}
export function AttendanceSection({ query }: AttendanceSectionProps): React.JSX.Element {
  const { data, isLoading, isError, isForbidden, refetch } = useReportsAttendance(query);
  if (isForbidden) {
    return (
      <div
        className="rounded-md border px-6 py-8 text-center"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
      >
        <p className="font-sans text-sm text-ink-3">
          Voce nao tem permissao para visualizar dados de atendimento.
        </p>
      </div>
    );
  }
  if (isLoading) return <AttendanceSkeleton />;
  if (isError) return <AttendanceError onRetry={refetch} />;
  if (!data) return <AttendanceEmpty />;
  return <AttendanceContent data={data} />;
}
