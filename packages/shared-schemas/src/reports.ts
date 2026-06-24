// =============================================================================
// reports.ts — Contratos Zod compartilhados para o módulo de relatórios (F23-S03).
//
// Importado tanto pelo backend (apps/api) quanto pelo frontend (apps/web) para
// garantir contratos idênticos e evitar drift front×API (ver memória do projeto).
//
// LGPD (doc 17 §3.3 finalidade 8):
//   - Nenhum campo de PII nos responses (nome, CPF, telefone, email, endereço).
//   - Apenas contagens, somatórios, médias e IDs opacos (UUIDs de cidades/agentes/stages).
//
// Multi-tenant: organization_id é implícito no contexto do actor — nunca exposto
// como filtro de query (o backend injeta do JWT).
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const ReportRangeEnum = z.enum([
  'today',
  'last7d',
  'last30d',
  'last90d',
  'thisMonth',
  'lastMonth',
  'custom',
]);
export type ReportRange = z.infer<typeof ReportRangeEnum>;

export const ReportScopeEnum = z.enum(['global', 'city', 'self']);
export type ReportScope = z.infer<typeof ReportScopeEnum>;

// ---------------------------------------------------------------------------
// Filtros comuns
// ---------------------------------------------------------------------------

export const CommonReportQuerySchema = z.object({
  range: ReportRangeEnum.optional().default('last30d'),
  dateFrom: z.string().datetime({ offset: true }).optional(),
  dateTo: z.string().datetime({ offset: true }).optional(),
  cityIds: z.array(z.string().uuid()).optional(),
  agentIds: z.array(z.string().uuid()).optional(),
  channel: z.string().optional(),
  status: z.string().optional(),
  origin: z.string().optional(),
  compareWithPrevious: z.boolean().optional().default(false),
});

export type CommonReportQuery = z.infer<typeof CommonReportQuerySchema>;

// ---------------------------------------------------------------------------
// Shape auxiliar
// ---------------------------------------------------------------------------

const ReportRangeInfoSchema = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string(),
  scope: ReportScopeEnum,
});

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export const OverviewQuerySchema = CommonReportQuerySchema;
export type OverviewQuery = z.infer<typeof OverviewQuerySchema>;

const OverviewLeadsSchema = z.object({
  total: z.number().int().nonnegative(),
  newInPeriod: z.number().int().nonnegative(),
  closedWon: z.number().int().nonnegative(),
  closedLost: z.number().int().nonnegative(),
  conversionRate: z.number().nonnegative(),
});

const OverviewSimulationsSchema = z.object({
  total: z.number().int().nonnegative(),
  amountSum: z.number().nonnegative(),
  amountAvg: z.number().nonnegative(),
});

const OverviewContractsSchema = z.object({
  active: z.number().int().nonnegative(),
  settled: z.number().int().nonnegative(),
  defaulted: z.number().int().nonnegative(),
  activePrincipalSum: z.number().nonnegative(),
});

const OverviewConversationsSchema = z.object({
  open: z.number().int().nonnegative(),
  resolved: z.number().int().nonnegative(),
});

const OverviewPreviousPeriodSchema = z.object({
  leads: z.object({
    total: z.number().int().nonnegative(),
    closedWon: z.number().int().nonnegative(),
    conversionRate: z.number().nonnegative(),
  }),
  simulations: z.object({
    total: z.number().int().nonnegative(),
    amountSum: z.number().nonnegative(),
  }),
});

export const OverviewResponseSchema = z.object({
  range: ReportRangeInfoSchema,
  leads: OverviewLeadsSchema,
  simulations: OverviewSimulationsSchema,
  contracts: OverviewContractsSchema,
  conversations: OverviewConversationsSchema,
  previousPeriod: OverviewPreviousPeriodSchema.optional(),
});

export type OverviewResponse = z.infer<typeof OverviewResponseSchema>;

// ---------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------

export const FunnelQuerySchema = CommonReportQuerySchema;
export type FunnelQuery = z.infer<typeof FunnelQuerySchema>;

const FunnelStageSchema = z.object({
  stageId: z.string().uuid(),
  stageName: z.string(),
  stageOrder: z.number().int().nonnegative(),
  cardCount: z.number().int().nonnegative(),
  staleCardCount: z.number().int().nonnegative(),
  conversionToNextRate: z.number().nonnegative().nullable(),
  avgDwellHours: z.number().nonnegative().nullable(),
  medianDwellHours: z.number().nonnegative().nullable(),
});

export const FunnelResponseSchema = z.object({
  range: ReportRangeInfoSchema,
  stages: z.array(FunnelStageSchema),
});

export type FunnelResponse = z.infer<typeof FunnelResponseSchema>;

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export const AttendanceQuerySchema = CommonReportQuerySchema;
export type AttendanceQuery = z.infer<typeof AttendanceQuerySchema>;

const AttendanceByChannelSchema = z.object({
  channel: z.string(),
  conversationCount: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
});

const AttendanceTimingsSchema = z.object({
  firstResponseAvgSec: z.number().nonnegative().nullable(),
  firstResponseP90Sec: z.number().nonnegative().nullable(),
  resolutionAvgSec: z.number().nonnegative().nullable(),
  resolutionP90Sec: z.number().nonnegative().nullable(),
});

export const AttendanceResponseSchema = z.object({
  range: ReportRangeInfoSchema,
  totals: z.object({
    conversationsOpened: z.number().int().nonnegative(),
    conversationsResolved: z.number().int().nonnegative(),
    messagesTotal: z.number().int().nonnegative(),
  }),
  byChannel: z.array(AttendanceByChannelSchema),
  timings: AttendanceTimingsSchema,
});

export type AttendanceResponse = z.infer<typeof AttendanceResponseSchema>;

// ---------------------------------------------------------------------------
// Credit -- 4-E (F23-S04)
//
// Fonte principal: mv_reports_credit (colunas por produto/cidade).
// Zero PII: product_id e UUID opaco; city_id e UUID opaco.
// ---------------------------------------------------------------------------

export const CreditQuerySchema = CommonReportQuerySchema.extend({
  productIds: z.array(z.string().uuid()).optional(),
});
export type CreditQuery = z.infer<typeof CreditQuerySchema>;

// Funil de credito: simulacao -> analise -> aprovacao -> contrato
const CreditFunnelSchema = z.object({
  simulations: z.number().int().nonnegative(),
  analyses: z.number().int().nonnegative(),
  analysesApproved: z.number().int().nonnegative(),
  analysesRefused: z.number().int().nonnegative(),
  analysesInProgress: z.number().int().nonnegative(),
  contracts: z.number().int().nonnegative(),
  simToAnalysisRate: z.number().nonnegative(),
  approvalRate: z.number().nonnegative(),
  simToContractRate: z.number().nonnegative(),
});

const CreditAmountsSchema = z.object({
  simulationsAmountSum: z.number().nonnegative(),
  simulationsAmountAvg: z.number().nonnegative(),
  simulationsTermAvg: z.number().nonnegative(),
  analysesApprovedAmountAvg: z.number().nonnegative(),
  contractsPrincipalSum: z.number().nonnegative(),
});

const CreditContractsByStatusSchema = z.object({
  active: z.number().int().nonnegative(),
  settled: z.number().int().nonnegative(),
  defaulted: z.number().int().nonnegative(),
  defaultRate: z.number().nonnegative(),
});

// Breakdown por produto (sem PII -- so UUID do produto)
const CreditByProductSchema = z.object({
  productId: z.string().uuid().nullable(),
  simulations: z.number().int().nonnegative(),
  analyses: z.number().int().nonnegative(),
  analysesApproved: z.number().int().nonnegative(),
  contracts: z.number().int().nonnegative(),
  principalSum: z.number().nonnegative(),
});

export const CreditResponseSchema = z.object({
  range: ReportRangeInfoSchema,
  funnel: CreditFunnelSchema,
  amounts: CreditAmountsSchema,
  contractsByStatus: CreditContractsByStatusSchema,
  byProduct: z.array(CreditByProductSchema),
});

export type CreditResponse = z.infer<typeof CreditResponseSchema>;

// ---------------------------------------------------------------------------
// Collection -- 4-F (F23-S04)
//
// Fonte principal: mv_reports_collection (parcelas por status/cidade).
// Gating: billing:read (inclui gestor_regional city-scoped via F23-S02).
// Zero PII: todos os campos sao agregados.
// ---------------------------------------------------------------------------

export const CollectionQuerySchema = CommonReportQuerySchema;
export type CollectionQuery = z.infer<typeof CollectionQuerySchema>;

// Carteira de cobranca (5 cards de status)
const CollectionWalletSchema = z.object({
  pending: z.number().int().nonnegative(),
  pendingAmountSum: z.number().nonnegative(),
  overdue: z.number().int().nonnegative(),
  overdueAmountSum: z.number().nonnegative(),
  paid: z.number().int().nonnegative(),
  paidAmountSum: z.number().nonnegative(),
  renegotiated: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
});

const CollectionRatesSchema = z.object({
  // Adimplencia = paid / (paid + overdue + pending)
  adimplenciaRate: z.number().nonnegative(),
  // Inadimplencia = overdue / (paid + overdue + pending)
  inadimplenciaRate: z.number().nonnegative(),
  avgDaysOverdue: z.number().nonnegative(),
});

// Eficiencia dos jobs de cobranca
const CollectionJobsEfficiencySchema = z.object({
  scheduled: z.number().int().nonnegative(),
  sent: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  paidBeforeSend: z.number().int().nonnegative(),
  sendRate: z.number().nonnegative(),
  failRate: z.number().nonnegative(),
});

export const CollectionResponseSchema = z.object({
  range: ReportRangeInfoSchema,
  wallet: CollectionWalletSchema,
  rates: CollectionRatesSchema,
  jobsEfficiency: CollectionJobsEfficiencySchema,
});

export type CollectionResponse = z.infer<typeof CollectionResponseSchema>;

// ---------------------------------------------------------------------------
// Productivity -- 4-G (F23-S04) -- D3
//
// Gating: dashboard:read_by_agent.
// D3: self-scoped (agente) ve so o proprio registro + media anonima da equipe.
//     Gestor recebe ranking nominal completo (agentId UUID + displayName).
//
// LGPD: displayName e dado de colaborador (nao PII de cidadao), OK para gestores.
//       Para self-scoped, displayName e null nos registros de colegas (nao expostos).
// ---------------------------------------------------------------------------

export const ProductivityQuerySchema = CommonReportQuerySchema;
export type ProductivityQuery = z.infer<typeof ProductivityQuerySchema>;

// Uma linha do ranking de produtividade por agente
const ProductivityAgentRowSchema = z.object({
  agentId: z.string().uuid(),
  // displayName presente para gestores (ranking nominal); null para self-scoped colegas (D3)
  displayName: z.string().nullable(),
  leadsClosedWon: z.number().int().nonnegative(),
  simulationsCreated: z.number().int().nonnegative(),
  conversationsResolved: z.number().int().nonnegative(),
  contractsOriginated: z.number().int().nonnegative(),
  avgFirstResponseSec: z.number().nonnegative().nullable(),
});

// Media anonima da equipe (retornada apenas em self-scoped -- D3)
const ProductivityTeamAverageSchema = z.object({
  leadsClosedWon: z.number().nonnegative(),
  simulationsCreated: z.number().nonnegative(),
  conversationsResolved: z.number().nonnegative(),
  contractsOriginated: z.number().nonnegative(),
});

export const ProductivityResponseSchema = z.object({
  range: ReportRangeInfoSchema,
  // Para gestor: todos os agentes com nome. Para self-scoped: so o proprio (com nome).
  agents: z.array(ProductivityAgentRowSchema),
  // Presente apenas em self-scoped (D3): media agregada anonima da equipe.
  teamAverage: ProductivityTeamAverageSchema.optional(),
});

export type ProductivityResponse = z.infer<typeof ProductivityResponseSchema>;

// ---------------------------------------------------------------------------
// AI / Pre-attendance -- §4-C (F23-S05)
//
// Fonte: ai_conversation_states, ai_decision_logs, chatwoot_handoffs.
// Gating: dashboard:read + flag ai.livechat_agent.enabled.
// Zero PII: sem phone, sem summary de handoff, sem lead_id em texto livre.
// Custo de LLM: tokens × tarifa por modelo. Se tarifa indisponivel no catalogo,
//   costAvailable=false e estimatedCostUsd=null (nao inventar tarifa).
// ---------------------------------------------------------------------------

export const AiQuerySchema = CommonReportQuerySchema;
export type AiQuery = z.infer<typeof AiQuerySchema>;

// Saude de conversas IA (contagens e taxas)
const AiConversationHealthSchema = z.object({
  total: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  handoffed: z.number().int().nonnegative(),
  handoffRate: z.number().nonnegative(),
  completedWithoutHandoff: z.number().int().nonnegative(),
});

// Motivos de handoff (breakdown por reason)
const AiHandoffReasonRowSchema = z.object({
  reason: z.string(),
  count: z.number().int().nonnegative(),
  rate: z.number().nonnegative(),
});

// Distribuicao por no do grafo (intenção/decisão)
const AiNodeDistributionRowSchema = z.object({
  nodeName: z.string(),
  callCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  errorRate: z.number().nonnegative(),
  avgLatencyMs: z.number().nonnegative().nullable(),
});

// Metricas de LLM (tokens, custo, latencia)
const AiLlmMetricsSchema = z.object({
  totalTokensIn: z.number().int().nonnegative(),
  totalTokensOut: z.number().int().nonnegative(),
  totalCalls: z.number().int().nonnegative(),
  // custo estimado em USD. null se tarifa nao disponivel no catalogo.
  estimatedCostUsd: z.number().nonnegative().nullable(),
  // false = tarifa nao disponivel para um ou mais modelos usados
  costAvailable: z.boolean(),
  avgLatencyMs: z.number().nonnegative().nullable(),
  p90LatencyMs: z.number().nonnegative().nullable(),
  errorRate: z.number().nonnegative(),
});

// Breakdown por modelo (tokens + custo por model key)
const AiModelBreakdownRowSchema = z.object({
  model: z.string(),
  callCount: z.number().int().nonnegative(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative().nullable(),
  costAvailable: z.boolean(),
});

// SLA de handoff (tempo entre criacao e accepted/resolved)
const AiHandoffSlaSchema = z.object({
  avgTimeToAcceptSec: z.number().nonnegative().nullable(),
  p90TimeToAcceptSec: z.number().nonnegative().nullable(),
  pendingHandoffs: z.number().int().nonnegative(),
});

export const AiResponseSchema = z.object({
  range: z.object({
    from: z.string(),
    to: z.string(),
    label: z.string(),
    scope: ReportScopeEnum,
  }),
  conversations: AiConversationHealthSchema,
  handoffReasons: z.array(AiHandoffReasonRowSchema),
  nodeDistribution: z.array(AiNodeDistributionRowSchema),
  llmMetrics: AiLlmMetricsSchema,
  modelBreakdown: z.array(AiModelBreakdownRowSchema),
  handoffSla: AiHandoffSlaSchema,
});

export type AiResponse = z.infer<typeof AiResponseSchema>;

// ---------------------------------------------------------------------------
// Audit & Operations -- §4-H (F23-S05)
//
// Fonte: audit_logs, event_outbox, event_dlq.
// Gating: audit:read (admin/gestor_geral).
// Zero PII: sem before/after dos audit_logs, sem payload de evento.
//   Apenas contagens, taxas e IDs opacos de resource_type/action.
// ---------------------------------------------------------------------------

export const AuditQuerySchema = CommonReportQuerySchema;
export type AuditQuery = z.infer<typeof AuditQuerySchema>;

// Resumo de acoes por tipo (ex: "leads.created" -> 42)
const AuditActionRowSchema = z.object({
  action: z.string(),
  count: z.number().int().nonnegative(),
});

// Resumo de acoes criticas (alteracoes de usuario, flags, permissoes)
const AuditCriticalActionRowSchema = z.object({
  action: z.string(),
  count: z.number().int().nonnegative(),
  actorCount: z.number().int().nonnegative(),
});

// Volume total de audit logs no periodo
const AuditVolumeSchema = z.object({
  total: z.number().int().nonnegative(),
  byResourceType: z.array(
    z.object({
      resourceType: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
});

// Saude do outbox (eventos processados, pendentes, falhos)
const EventOutboxHealthSchema = z.object({
  totalCreated: z.number().int().nonnegative(),
  totalProcessed: z.number().int().nonnegative(),
  totalPending: z.number().int().nonnegative(),
  totalFailed: z.number().int().nonnegative(),
  successRate: z.number().nonnegative(),
  avgProcessingLatencySec: z.number().nonnegative().nullable(),
});

// DLQ snapshot (itens pendentes de reprocessamento)
const EventDlqSnapshotSchema = z.object({
  pendingReprocess: z.number().int().nonnegative(),
  totalMoved: z.number().int().nonnegative(),
  // breakdown por event_name (top N)
  topEventNames: z.array(
    z.object({
      eventName: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
});

export const AuditResponseSchema = z.object({
  range: z.object({
    from: z.string(),
    to: z.string(),
    label: z.string(),
    scope: ReportScopeEnum,
  }),
  auditVolume: AuditVolumeSchema,
  topActions: z.array(AuditActionRowSchema),
  criticalActions: z.array(AuditCriticalActionRowSchema),
  outboxHealth: EventOutboxHealthSchema,
  dlqSnapshot: EventDlqSnapshotSchema,
});

export type AuditResponse = z.infer<typeof AuditResponseSchema>;
