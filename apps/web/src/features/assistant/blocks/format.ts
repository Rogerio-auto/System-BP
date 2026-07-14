// =============================================================================
// features/assistant/blocks/format.ts — Formatação local de data/hora para os
// cards de bloco do copiloto interno (F6-S22). Segue o mesmo padrão de
// Intl.DateTimeFormat local usado no resto do app (ex.: KanbanCard.tsx,
// PromptDetailPage.tsx) — não há util compartilhado em lib/format para datas.
// =============================================================================

const DATE_FMT = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const TIME_FMT = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** "2026-07-10T12:00:00Z" → "10/07/2026". Retorna "—" se a data for inválida. */
export function formatDateBR(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return DATE_FMT.format(date);
}

/** "2026-07-10T12:00:00Z" → "09:00". Retorna "—" se a data for inválida. */
export function formatTimeBR(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return TIME_FMT.format(date);
}

/** Horas médias de permanência: null → "—", número → "12,5h". */
export function formatDwellHours(hours: number | null): string {
  if (hours === null) return '—';
  return `${hours.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}h`;
}

/** Taxa (0–100 ou fração 0–1, já vem pronta do backend) → "42,0%". */
export function formatPercent(rate: number): string {
  return `${rate.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}
