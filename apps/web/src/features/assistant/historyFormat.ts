// =============================================================================
// features/assistant/historyFormat.ts — Formatação de data das conversas na
// barra lateral de histórico do copiloto interno (F6-S29). Função pura,
// testável sem montar React (mesmo padrão de chips.ts/conversationTurns.ts).
// =============================================================================

const TIME_FORMATTER = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const DAY_MONTH_FORMATTER = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
const FULL_DATE_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Formata a data de uma conversa para a barra lateral: "HH:MM" se hoje,
 * "DD/MM" se este ano, "DD/MM/AAAA" caso contrário. Espelha o padrão de
 * ChatListItem.tsx (inbox) para consistência entre listas do produto.
 */
export function formatConversationDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  if (isSameDay(date, now)) {
    return TIME_FORMATTER.format(date);
  }
  if (date.getFullYear() === now.getFullYear()) {
    return DAY_MONTH_FORMATTER.format(date);
  }
  return FULL_DATE_FORMATTER.format(date);
}
