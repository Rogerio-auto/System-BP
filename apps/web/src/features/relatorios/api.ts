// =============================================================================
// features/relatorios/api.ts — Funções de API para o módulo de Relatórios (F23-S06/S07).
//
// Consome os endpoints GET /api/reports/* entregues em F23-S03/S04/S05.
// Tipos vêm de @elemento/shared-schemas — sem drift front×API.
// LGPD (doc 17 §3.3 finalidade 8): responses são apenas agregados (sem PII).
// =============================================================================

import {
  AiResponseSchema,
  AttendanceResponseSchema,
  FunnelResponseSchema,
  OverviewResponseSchema,
  type AiResponse,
  type AttendanceResponse,
  type CommonReportQuery,
  type FunnelResponse,
  type OverviewResponse,
} from '@elemento/shared-schemas';

import { api } from '../../lib/api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Converte CommonReportQuery (com arrays e booleanos) em URLSearchParams.
 * Arrays são serializados como param repetido: cityIds=a&cityIds=b.
 */
function buildParams(query: Partial<CommonReportQuery>): URLSearchParams {
  const params = new URLSearchParams();

  if (query.range) params.set('range', query.range);
  if (query.dateFrom) params.set('dateFrom', query.dateFrom);
  if (query.dateTo) params.set('dateTo', query.dateTo);
  if (query.cityIds?.length) {
    for (const id of query.cityIds) params.append('cityIds', id);
  }
  if (query.agentIds?.length) {
    for (const id of query.agentIds) params.append('agentIds', id);
  }
  if (query.channel) params.set('channel', query.channel);
  if (query.compareWithPrevious) params.set('compareWithPrevious', 'true');

  return params;
}

// ---------------------------------------------------------------------------
// GET /api/reports/overview
// ---------------------------------------------------------------------------

export async function fetchReportsOverview(
  query: Partial<CommonReportQuery>,
): Promise<OverviewResponse> {
  const params = buildParams(query);
  const raw = await api.get<unknown>(`/api/reports/overview?${params.toString()}`);
  return OverviewResponseSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// GET /api/reports/attendance
// ---------------------------------------------------------------------------

export async function fetchReportsAttendance(
  query: Partial<CommonReportQuery>,
): Promise<AttendanceResponse> {
  const params = buildParams(query);
  const raw = await api.get<unknown>(`/api/reports/attendance?${params.toString()}`);
  return AttendanceResponseSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// GET /api/reports/ai
// ---------------------------------------------------------------------------

export async function fetchReportsAi(query: Partial<CommonReportQuery>): Promise<AiResponse> {
  const params = buildParams(query);
  const raw = await api.get<unknown>(`/api/reports/ai?${params.toString()}`);
  return AiResponseSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// GET /api/reports/funnel
// ---------------------------------------------------------------------------

export async function fetchReportsFunnel(
  query: Partial<CommonReportQuery>,
): Promise<FunnelResponse> {
  const params = buildParams(query);
  const raw = await api.get<unknown>(`/api/reports/funnel?${params.toString()}`);
  return FunnelResponseSchema.parse(raw);
}
