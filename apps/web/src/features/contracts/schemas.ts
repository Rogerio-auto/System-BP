// =============================================================================
// features/contracts/schemas.ts — Tipos locais da feature Contratos (F17-S05, F17-S06).
//
// Reutiliza os tipos inferidos de @elemento/shared-schemas.
// Define filtros de listagem e tipo de resposta paginada (espelha a API).
// F17-S06: adiciona BoletoHealth + meta de health + ContractDuesFilters.
// =============================================================================

import type { BoletoHealth, Contract, ContractSign, ContractStatus } from '@elemento/shared-schemas';

import type { BadgeVariant } from '../../components/ui/Badge';

export type { BoletoHealth, Contract, ContractSign, ContractStatus };

// ---------------------------------------------------------------------------
// Filtros de listagem
// ---------------------------------------------------------------------------

export interface ContractsFilters {
  status?: string;
  customer_id?: string;
  page?: number;
  per_page?: number;
}

// ---------------------------------------------------------------------------
// Resposta paginada (espelha GET /api/contracts)
// ---------------------------------------------------------------------------

export interface ContractsPagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

export interface ContractsListResponse {
  data: Contract[];
  pagination: ContractsPagination;
}

// ---------------------------------------------------------------------------
// Meta de status (para UI: badge + label + cor)
// ---------------------------------------------------------------------------

export interface StatusMeta {
  label: string;
  variant: BadgeVariant;
}

export const CONTRACT_STATUS_META: Record<ContractStatus, StatusMeta> = {
  draft: { label: 'Rascunho', variant: 'neutral' },
  signed: { label: 'Assinado', variant: 'info' },
  active: { label: 'Ativo', variant: 'success' },
  settled: { label: 'Liquidado', variant: 'success' },
  defaulted: { label: 'Inadimplente', variant: 'danger' },
  cancelled: { label: 'Cancelado', variant: 'neutral' },
};

// ---------------------------------------------------------------------------
// Saúde de boletos (F17-S06) — meta de UI para o badge de saúde
// ---------------------------------------------------------------------------

export type HealthVariant = 'success' | 'warning' | 'danger' | 'neutral';

export interface HealthMeta {
  label: string;
  variant: HealthVariant;
  description: string;
}

export const HEALTH_META: Record<BoletoHealth['health'], HealthMeta> = {
  healthy: {
    label: 'Saudável',
    variant: 'success',
    description: 'Sem parcelas em atraso',
  },
  at_risk: {
    label: 'Em risco',
    variant: 'warning',
    description: 'Parcela(s) vencida(s) recentemente',
  },
  defaulted: {
    label: 'Inadimplente',
    variant: 'danger',
    description: 'Parcela(s) vencida(s) há 15+ dias',
  },
  settled: {
    label: 'Quitado',
    variant: 'neutral',
    description: 'Todas as parcelas foram pagas',
  },
};

// ---------------------------------------------------------------------------
// Filtros de parcelas por contrato (F17-S06)
// ---------------------------------------------------------------------------

/** Filtro de listagem de parcelas via GET /api/billing/payment-dues?customer_id=... */
export interface ContractDuesFilters {
  customerId: string;
  /** contract_reference do contrato para filtro client-side */
  contractReference: string;
}

export const CONTRACT_STATUS_OPTIONS = [
  { value: '', label: 'Todos os status' },
  { value: 'draft', label: 'Rascunho' },
  { value: 'signed', label: 'Assinado' },
  { value: 'active', label: 'Ativo' },
  { value: 'settled', label: 'Liquidado' },
  { value: 'defaulted', label: 'Inadimplente' },
  { value: 'cancelled', label: 'Cancelado' },
];
