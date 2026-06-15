// =============================================================================
// customers/schemas.ts — Schemas Zod locais do módulo customers (F17-S07).
//
// Importa CustomerOverviewResponseSchema de @elemento/shared-schemas (F17-S02).
// Define apenas schemas locais de params de rota.
//
// LGPD (doc 17 §8.1):
//   - O campo `name` vem do lead — é PII.
//     Nenhum CPF ou documento é retornado neste endpoint.
//     spc_status + spc_changed_at são dados operacionais de crédito, não PII estrito.
// =============================================================================
import type { BoletoHealthSchema, ContractSchema } from '@elemento/shared-schemas';
import { CustomerOverviewResponseSchema } from '@elemento/shared-schemas';
import { z } from 'zod';

// Re-exporta para uso em routes.ts e controller.ts sem import adicional
export { CustomerOverviewResponseSchema };

// Tipos derivados
export type CustomerOverviewResponse = z.infer<typeof CustomerOverviewResponseSchema>;
export type BoletoHealth = z.infer<typeof BoletoHealthSchema>;
export type ContractWithHealth = z.infer<typeof ContractSchema> & {
  boleto_health: z.infer<typeof BoletoHealthSchema> | null;
};

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

/**
 * Parâmetros de rota para GET /api/customers/:id/overview.
 */
export const CustomerOverviewParamsSchema = z.object({
  id: z.string().uuid().describe('UUID do customer'),
});

export type CustomerOverviewParams = z.infer<typeof CustomerOverviewParamsSchema>;
