// =============================================================================
// billing.ts — Schemas Zod públicos do domínio de cobrança e SPC.
//
// Compartilhados entre frontend (dashboard, ações) e backend (routes + service).
// Cobre: status SPC, atualização de SPC e dashboard de cobrança.
//
// LGPD (doc 17 §8.1):
//   customer_id é UUID — sem PII bruta exposta.
//   Dados financeiros (total_amount) são agregados, não individuais neste schema.
//
// Origem: tabelas criadas em F15-S02/S03; dashboard via GET /api/billing/dashboard.
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// SPC
// ---------------------------------------------------------------------------

/**
 * Status do cliente no SPC (Serviço de Proteção ao Crédito).
 *
 * Transições válidas (validadas pelo service, não pelo schema):
 *   none → pending_inclusion → included → removed
 *   removed → pending_inclusion (reinclusão)
 */
export const SpcStatusSchema = z.enum(['none', 'pending_inclusion', 'included', 'removed'], {
  errorMap: () => ({ message: 'status SPC inválido' }),
});
export type SpcStatus = z.infer<typeof SpcStatusSchema>;

/**
 * Payload para atualização de status SPC de um cliente.
 * A transição de estado é validada pelo service — o schema aceita qualquer
 * status destino e deixa a regra de negócio (sequência válida) para a camada
 * de serviço.
 */
export const SpcUpdateSchema = z.object({
  /** UUID do cliente cujo status SPC está sendo atualizado. */
  customer_id: z.string().uuid().describe('UUID do cliente no sistema'),

  /**
   * Novo status SPC.
   * O service valida a transição válida antes de persistir.
   */
  status: SpcStatusSchema,
});
export type SpcUpdate = z.infer<typeof SpcUpdateSchema>;

// ---------------------------------------------------------------------------
// Dashboard de cobrança
// ---------------------------------------------------------------------------

/**
 * Card individual do dashboard de cobrança.
 * Cada card representa um segmento da carteira em determinada situação.
 */
export const CollectionDashboardCardSchema = z.object({
  /** Rótulo legível do segmento (ex: "Vencendo em 7 dias"). */
  label: z.string().describe('Rótulo do segmento exibido no card'),

  /** Quantidade de contratos/clientes no segmento. */
  count: z.number().int().describe('Quantidade de contratos no segmento'),

  /**
   * Valor total do segmento.
   * Retornado como string para preservar precisão decimal (numeric 14,2 no PG).
   * Ex: "125000.50"
   */
  total_amount: z
    .string()
    .describe('Valor total do segmento em reais — numeric 14,2 serializado como string'),
});
export type CollectionDashboardCard = z.infer<typeof CollectionDashboardCardSchema>;

/**
 * Resposta completa do dashboard de cobrança (GET /api/billing/dashboard).
 * Cada campo é um segmento da carteira com contagem e valor total.
 * O frontend exibe os cards na ordem definida aqui.
 */
export const CollectionDashboardResponseSchema = z.object({
  /**
   * Contratos vencendo nos próximos 7 dias.
   * Permite ação preventiva de cobrança antes do vencimento.
   */
  due_soon: CollectionDashboardCardSchema.describe('Vencendo nos próximos 7 dias'),

  /**
   * Contratos vencidos sem collection_job ativo.
   * Candidatos imediatos para abertura de ação de cobrança.
   */
  overdue_uncollected: CollectionDashboardCardSchema.describe(
    'Vencidos sem cobrança ativa (sem collection_job)',
  ),

  /**
   * Contratos com collection_job em andamento.
   * Permite acompanhar o volume em processo de cobrança.
   */
  in_collection: CollectionDashboardCardSchema.describe(
    'Em cobrança ativa (collection_job em andamento)',
  ),

  /**
   * Contratos inadimplentes há 15 dias ou mais.
   * Candidatos a inclusão no SPC ou escalonamento.
   */
  overdue_15d: CollectionDashboardCardSchema.describe('Inadimplentes há 15+ dias'),

  /**
   * Clientes atualmente incluídos no SPC (status = included).
   */
  in_spc: CollectionDashboardCardSchema.describe("Clientes no SPC (status = 'included')"),
});
export type CollectionDashboardResponse = z.infer<typeof CollectionDashboardResponseSchema>;
