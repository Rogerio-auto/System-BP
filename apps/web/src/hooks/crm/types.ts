// =============================================================================
// hooks/crm/types.ts — Tipos do módulo CRM (leads).
//
// LGPD (doc 17):
//   - phone_e164: PII — NUNCA exibido raw na UI, sempre via maskPhone()
//   - email: PII — truncado em listas via truncateEmail()
//   - CPF: PII — NUNCA exibido na UI (só armazenado como hash no backend)
// =============================================================================

import type { LeadResponse, LeadStatus } from '@elemento/shared-schemas';

export type { LeadResponse, LeadStatus };

// Re-exporta enum de status para uso nos componentes
export { LeadStatusSchema, LeadSourceSchema } from '@elemento/shared-schemas';

// ─── Tipos de filtros ─────────────────────────────────────────────────────────

export interface LeadFilters {
  page?: number;
  limit?: number;
  search?: string;
  status?: LeadStatus;
  city_id?: string;
  agent_id?: string;
}

// ─── Tipos de resposta da API ─────────────────────────────────────────────────

export interface LeadListResponse {
  data: LeadResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ─── Tipos de stats para o header KPI ────────────────────────────────────────

export interface LeadStats {
  total: number;
  newThisMonth: number;
  qualifying: number;
  conversionRate: number; // % closed_won
}

// ─── Interação de timeline ────────────────────────────────────────────────────

export interface LeadInteraction {
  id: string;
  leadId: string;
  type: 'note' | 'status_change' | 'call' | 'whatsapp' | 'system';
  content: string;
  actorName: string;
  createdAt: string;
}

// ─── Helpers LGPD — mascaramento de PII ──────────────────────────────────────

/**
 * Mascara telefone E.164 para exibição: "+55 11 ****-1234"
 * LGPD: PII — nunca exibir número completo em UI.
 */
export function maskPhone(phoneE164: string): string {
  // Ex: +5511999991234 → +55 11 ****-1234
  const digits = phoneE164.replace(/^\+/, '');
  if (digits.length < 10) return '****';

  const countryCode = digits.slice(0, 2); // 55
  const areaCode = digits.slice(2, 4); // 11
  const last4 = digits.slice(-4); // 1234

  return `+${countryCode} ${areaCode} ****-${last4}`;
}

/**
 * Trunca email para exibição em listas: "joao***@gmail.com"
 * LGPD: PII — nunca exibir email completo em listagens.
 */
export function truncateEmail(email: string): string {
  const atIdx = email.indexOf('@');
  if (atIdx <= 0) return '***@***';

  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx); // inclui o @

  const visible = local.slice(0, Math.min(4, local.length));
  return `${visible}***${domain}`;
}

/**
 * Formata valor em centavos para BRL: R$ 1.500,00
 */
export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

/**
 * Formata data ISO para exibição: "12 mai. 2026"
 */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Formata data ISO para exibição relativa: "há 2 horas"
 */
export function formatRelativeDate(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `há ${diffHrs}h`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `há ${diffDays}d`;
  return formatDate(iso);
}

// ─── Mapeamento de status para label + variante de Badge ─────────────────────

export type BadgeVariant = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

export const STATUS_META: Record<LeadStatus, { label: string; variant: BadgeVariant }> = {
  new: { label: 'Novo', variant: 'neutral' },
  qualifying: { label: 'Qualificando', variant: 'info' },
  simulation: { label: 'Simulação', variant: 'warning' },
  closed_won: { label: 'Convertido', variant: 'success' },
  closed_lost: { label: 'Perdido', variant: 'danger' },
  archived: { label: 'Arquivado', variant: 'neutral' },
};

export const SOURCE_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  manual: 'Manual',
  import: 'Importação',
  chatwoot: 'Chatwoot',
  api: 'API',
};
