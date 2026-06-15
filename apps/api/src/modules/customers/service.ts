// =============================================================================
// customers/service.ts — Regras de negócio do módulo customers (F17-S07).
//
// Responsabilidades:
//   - getCustomerOverviewService: delega ao repository + valida contexto.
//
// RBAC verificado nas rotas — não aqui.
// City-scope propagado do repository.
// LGPD: nenhum CPF/PII bruto é tratado neste módulo.
// =============================================================================
import type { Database } from '../../db/client.js';

import { getCustomerOverview } from './repository.js';
import type { CustomerOverviewResponse } from './schemas.js';

// ---------------------------------------------------------------------------
// getCustomerOverviewService
// ---------------------------------------------------------------------------

export async function getCustomerOverviewService(
  db: Database,
  organizationId: string,
  customerId: string,
  cityScopeIds: string[] | null,
): Promise<CustomerOverviewResponse> {
  return getCustomerOverview(db, organizationId, customerId, cityScopeIds);
}
