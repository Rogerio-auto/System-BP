// =============================================================================
// dashboard/schemas.ts — Schemas Zod para o endpoint de métricas (F8-S03).
//
// Importações reexportadas de shared-schemas quando aplicável.
// Não retorna PII de leads — somente contagens e IDs opacos de agentes.
//
// LGPD: nenhum dos shapes aqui expõe name/phone/email/cpf de leads.
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enums canônicos (replicam os da DB para validação nas bordas HTTP)
// ---------------------------------------------------------------------------

export const LeadStatusEnum = z.enum([
  'new',
  'qualifying',
  'simulation',
  'closed_won',
  'closed_lost',
  'archived',
]);
export type LeadStatus = z.infer<typeof LeadStatusEnum>;

export const LeadSourceEnum = z.enum(['whatsapp', 'manual', 'import', 'chatwoot', 'api']);
export type LeadSource = z.infer<typeof LeadSourceEnum>;

export const InteractionChannelEnum = z.enum([
  'whatsapp',
  'phone',
  'email',
  'in_person',
  'chatwoot',
]);
export type InteractionChannel = z.infer<typeof InteractionChannelEnum>;

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------

/** Intervalo de tempo disponível no endpoint de métricas. */
export const RangeEnum = z.enum(['today', '7d', '30d', 'mtd', 'ytd']);
export type Range = z.infer<typeof RangeEnum>;

export const DashboardMetricsQuerySchema = z.object({
  /**
   * Intervalo de tempo para agregação.
   * Default: '30d' — últimos 30 dias.
   */
  range: RangeEnum.optional().default('30d'),
  /**
   * UUID de uma cidade específica (opcional).
   * Se omitido, agrega todas as cidades no escopo do usuário.
   * Se fornecido, deve estar no escopo do usuário (senão 403).
   */
  cityId: z.string().uuid().optional(),
});

export type DashboardMetricsQuery = z.infer<typeof DashboardMetricsQuerySchema>;

// ---------------------------------------------------------------------------
// Shapes internos da resposta
// ---------------------------------------------------------------------------

const RangeInfoSchema = z.object({
  /** ISO 8601 — início do intervalo. */
  from: z.string(),
  /** ISO 8601 — fim do intervalo. */
  to: z.string(),
  /** Label human-readable (ex: "Últimos 30 dias"). */
  label: z.string(),
});

const LeadsByStatusItemSchema = z.object({
  status: LeadStatusEnum,
  count: z.number().int().nonnegative(),
});

const LeadsByCityItemSchema = z.object({
  cityId: z.string().uuid(),
  cityName: z.string(),
  count: z.number().int().nonnegative(),
});

const LeadsBySourceItemSchema = z.object({
  source: LeadSourceEnum,
  count: z.number().int().nonnegative(),
});

const LeadsMetricsSchema = z.object({
  /** Total de leads ativos (não deletados) no escopo. */
  total: z.number().int().nonnegative(),
  /** Leads criados no intervalo selecionado. */
  newInRange: z.number().int().nonnegative(),
  /** Distribuição por status. */
  byStatus: z.array(LeadsByStatusItemSchema),
  /** Distribuição por cidade. */
  byCity: z.array(LeadsByCityItemSchema),
  /** Distribuição por canal de origem. */
  bySource: z.array(LeadsBySourceItemSchema),
  /**
   * Leads sem interação há mais de 7 dias (stale).
   * Calculado como MAX(interactions.created_at) < now() - 7 days.
   * Leads sem nenhuma interação também são contados como stale se criados há > 7 dias.
   */
  staleCount: z.number().int().nonnegative(),
});

const InteractionsByChannelItemSchema = z.object({
  channel: InteractionChannelEnum,
  count: z.number().int().nonnegative(),
});

const InboundOutboundRatioSchema = z.object({
  inbound: z.number().int().nonnegative(),
  outbound: z.number().int().nonnegative(),
});

const InteractionsMetricsSchema = z.object({
  /** Total de interações registradas no intervalo. */
  totalInRange: z.number().int().nonnegative(),
  /** Distribuição por canal. */
  byChannel: z.array(InteractionsByChannelItemSchema),
  /** Proporção inbound/outbound no intervalo. */
  inboundOutboundRatio: InboundOutboundRatioSchema,
});

const KanbanCardsByStageItemSchema = z.object({
  stageId: z.string().uuid(),
  stageName: z.string(),
  count: z.number().int().nonnegative(),
});

const KanbanAvgDaysInStageItemSchema = z.object({
  stageId: z.string().uuid(),
  /** Média de dias que os cards passam neste stage. */
  days: z.number().nonnegative(),
});

const KanbanMetricsSchema = z.object({
  /** Contagem de cards por stage. */
  cardsByStage: z.array(KanbanCardsByStageItemSchema),
  /** Tempo médio de permanência por stage (baseado em kanban_stage_history). */
  avgDaysInStage: z.array(KanbanAvgDaysInStageItemSchema),
});

const TopAgentItemSchema = z.object({
  /**
   * ID do agente — NÃO é PII de cidadão.
   * display_name é nome de trabalho interno (LGPD: colaborador, base art. 7°, IX).
   */
  agentId: z.string().uuid(),
  displayName: z.string(),
  closedWon: z.number().int().nonnegative(),
});

const AgentsMetricsSchema = z.object({
  /** Top agentes por leads fechados como ganhos (status=closed_won) no intervalo. */
  topByLeadsClosed: z.array(TopAgentItemSchema),
});

// ---------------------------------------------------------------------------
// Response schema principal
// ---------------------------------------------------------------------------

export const DashboardMetricsResponseSchema = z.object({
  range: RangeInfoSchema,
  leads: LeadsMetricsSchema,
  interactions: InteractionsMetricsSchema,
  kanban: KanbanMetricsSchema,
  agents: AgentsMetricsSchema,
});

export type DashboardMetricsResponse = z.infer<typeof DashboardMetricsResponseSchema>;
