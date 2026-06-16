// =============================================================================
// features/crm/api.ts — HTTP client para o módulo CRM (F17-S08).
//
// Endpoint:
//   GET /api/customers/:id/overview — visão consolidada do cliente
//     Retorna: customer, contracts (com boleto_health), recent_dues
//
// Usa lib/api.ts (apiFetch com CSRF + auth + interceptor 401).
// LGPD: customer_name, spc_status — sem CPF, telefone ou email direto.
// =============================================================================

import type { CustomerOverviewResponse } from '@elemento/shared-schemas';

import { api } from '../../lib/api';

/**
 * GET /api/customers/:id/overview
 * Retorna dados consolidados do cliente: contratos, parcelas recentes e status SPC.
 * Permissão: customers:read (verificada no backend).
 */
export async function fetchCustomerOverview(customerId: string): Promise<CustomerOverviewResponse> {
  return api.get<CustomerOverviewResponse>(
    `/api/customers/${encodeURIComponent(customerId)}/overview`,
  );
}
