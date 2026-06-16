// =============================================================================
// features/contracts/api.ts — HTTP client para contratos (F17-S05, F17-S06, F17-S11).
//
// Endpoints:
//   GET  /api/contracts                — lista paginada com filtros
//   GET  /api/contracts/:id            — detalhe
//   POST /api/contracts                — criar contrato (F17-S11)
//   POST /api/contracts/:id/sign       — assinar contrato (draft → signed)
//   GET  /api/contracts/:id/health     — saúde de boletos (F17-S06)
//
// Usa lib/api.ts (apiFetch com CSRF + auth + interceptor 401).
// LGPD: customer_name apenas — sem CPF, telefone ou email na listagem.
// =============================================================================
import type { ContractCreate } from '@elemento/shared-schemas';

import { api } from '../../lib/api';

import type {
  BoletoHealth,
  Contract,
  ContractSign,
  ContractsFilters,
  ContractsListResponse,
} from './schemas';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildQueryString(filters: ContractsFilters): string {
  const params = new URLSearchParams();
  if (filters.page !== undefined) params.set('page', String(filters.page));
  if (filters.per_page !== undefined) params.set('per_page', String(filters.per_page));
  if (filters.status) params.set('status', filters.status);
  if (filters.customer_id) params.set('customer_id', filters.customer_id);
  if (filters.analysis_id) params.set('analysis_id', filters.analysis_id);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

// ---------------------------------------------------------------------------
// Contratos
// ---------------------------------------------------------------------------

/**
 * GET /api/contracts — lista contratos com filtros de status e paginação.
 * Permissão: contracts:read
 */
export async function fetchContracts(filters: ContractsFilters): Promise<ContractsListResponse> {
  return api.get<ContractsListResponse>(`/api/contracts${buildQueryString(filters)}`);
}

/**
 * GET /api/contracts/:id — detalhe de um contrato.
 * Permissão: contracts:read
 */
export async function fetchContract(id: string): Promise<Contract> {
  return api.get<Contract>(`/api/contracts/${id}`);
}

/**
 * POST /api/contracts/:id/sign — assinar contrato (draft → signed).
 * Permissão: contracts:sign
 * Body: { signed_at? } — se omitido, backend usa now().
 */
export async function signContract(id: string, body: ContractSign): Promise<Contract> {
  return api.post<Contract>(`/api/contracts/${id}/sign`, body);
}

/**
 * GET /api/contracts/:id/health — saúde de boletos do contrato (F17-S06).
 * Permissão: contracts:read
 * LGPD: retorna apenas agregados financeiros operacionais — sem PII.
 */
export async function fetchContractHealth(id: string): Promise<BoletoHealth> {
  return api.get<BoletoHealth>(`/api/contracts/${id}/health`);
}

/**
 * POST /api/contracts — cria um novo contrato (F17-S11).
 * Permissão: contracts:write (verificada no backend).
 * Body: ContractCreate — validado via ContractCreateSchema em shared-schemas.
 */
export async function createContract(body: ContractCreate): Promise<Contract> {
  return api.post<Contract>('/api/contracts', body);
}
