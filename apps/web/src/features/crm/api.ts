// =============================================================================
// features/crm/api.ts — HTTP client para o módulo CRM (F17-S08 + F18-S10).
//
// Endpoints:
//   GET /api/customers/:id/overview — visão consolidada do cliente
//     Retorna: customer, contracts (com boleto_health), recent_dues
//   PATCH /api/users/me/personal-email — atualiza email pessoal do agente (F18-S10)
//
// Usa lib/api.ts (apiFetch com CSRF + auth + interceptor 401).
// LGPD: customer_name, spc_status — sem CPF, telefone ou email direto.
//       personal_email é PII — nunca logar (doc 17 §8.1).
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

/**
 * PATCH /api/users/me/personal-email
 * Atualiza (ou remove) o email pessoal do agente autenticado.
 *
 * @param personalEmail - email para cadastrar, ou null para remover.
 *
 * LGPD: personalEmail é PII — nunca logar o valor em console.
 */
export async function updatePersonalEmail(personalEmail: string | null): Promise<{ ok: true }> {
  return api.patch<{ ok: true }>('/api/users/me/personal-email', {
    personal_email: personalEmail,
  });
}
