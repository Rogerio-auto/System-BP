// =============================================================================
// features/contracts/schemas.ts — Tipos locais da feature Contratos (F17-S05).
//
// Reutiliza os tipos inferidos de @elemento/shared-schemas.
// Define filtros de listagem e tipo de resposta paginada (espelha a API).
// =============================================================================

import type { Contract, ContractSign, ContractStatus } from '@elemento/shared-schemas';

import type { BadgeVariant } from '../../components/ui/Badge';

export type { Contract, ContractSign, ContractStatus };

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

export const CONTRACT_STATUS_OPTIONS = [
  { value: '', label: 'Todos os status' },
  { value: 'draft', label: 'Rascunho' },
  { value: 'signed', label: 'Assinado' },
  { value: 'active', label: 'Ativo' },
  { value: 'settled', label: 'Liquidado' },
  { value: 'defaulted', label: 'Inadimplente' },
  { value: 'cancelled', label: 'Cancelado' },
];
