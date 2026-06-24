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
