// =============================================================================
// features/relatorios/api.ts — Funções de API para o módulo de Relatórios (F23-S06/S07/S08/S10).
//
// Consome os endpoints GET /api/reports/* entregues em F23-S03/S04/S05
// e POST /api/reports/export entregue em F23-S09.
// Tipos vêm de @elemento/shared-schemas — sem drift front×API.
// LGPD (doc 17 §3.3 finalidade 8): responses são apenas agregados (sem PII).
// =============================================================================

import {
  AiResponseSchema,
  AttendanceResponseSchema,
  AuditResponseSchema,
  CollectionResponseSchema,
  CreditResponseSchema,
  ExportLimitErrorSchema,
  ExportRequestSchema,
  FunnelResponseSchema,
  OverviewResponseSchema,
  ProductivityResponseSchema,
  type AiResponse,
  type AttendanceResponse,
  type AuditResponse,
  type CollectionResponse,
  type CommonReportQuery,
  type CreditResponse,
  type ExportLimitError,
  type ExportRequest,
  type FunnelResponse,
  type OverviewResponse,
  type ProductivityResponse,
} from '@elemento/shared-schemas';

import { api } from '../../lib/api';
import { useAuthStore } from '../../lib/auth-store';

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

// ---------------------------------------------------------------------------
// GET /api/reports/credit (F23-S08)
// ---------------------------------------------------------------------------

export async function fetchReportsCredit(
  query: Partial<CommonReportQuery>,
): Promise<CreditResponse> {
  const params = buildParams(query);
  const raw = await api.get<unknown>(`/api/reports/credit?${params.toString()}`);
  return CreditResponseSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// GET /api/reports/collection (F23-S08)
// ---------------------------------------------------------------------------

export async function fetchReportsCollection(
  query: Partial<CommonReportQuery>,
): Promise<CollectionResponse> {
  const params = buildParams(query);
  const raw = await api.get<unknown>(`/api/reports/collection?${params.toString()}`);
  return CollectionResponseSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// GET /api/reports/productivity (F23-S08)
// ---------------------------------------------------------------------------

export async function fetchReportsProductivity(
  query: Partial<CommonReportQuery>,
): Promise<ProductivityResponse> {
  const params = buildParams(query);
  const raw = await api.get<unknown>(`/api/reports/productivity?${params.toString()}`);
  return ProductivityResponseSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// GET /api/reports/audit (F23-S08)
// ---------------------------------------------------------------------------

export async function fetchReportsAudit(query: Partial<CommonReportQuery>): Promise<AuditResponse> {
  const params = buildParams(query);
  const raw = await api.get<unknown>(`/api/reports/audit?${params.toString()}`);
  return AuditResponseSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// POST /api/reports/export (F23-S09/S10)
//
// Retorna Blob para download. O cliente generico (api.*) faz .json() automaticamente,
// por isso este helper faz fetch direto, reutilizando accessToken e CSRF cookie.
// LGPD: apenas agregados -- sem PII bruta no payload exportado.
// ---------------------------------------------------------------------------

const API_BASE = (import.meta.env['VITE_API_URL'] as string | undefined) ?? 'http://localhost:3333';

function getCsrfToken(): string {
  const match = document.cookie.split('; ').find((row) => row.startsWith('csrf_token='));
  return match ? (match.split('=')[1] ?? '') : '';
}

export interface ExportBlobResult {
  blob: Blob;
  /** Nome de arquivo sugerido extraido do header Content-Disposition (ou fallback). */
  filename: string;
  contentType: string;
}

export class ExportLimitExceededError extends Error {
  public readonly rowCount: number;
  public readonly limit: number;
  public readonly detail: ExportLimitError;

  constructor(detail: ExportLimitError) {
    super(detail.message);
    this.name = 'ExportLimitExceededError';
    this.rowCount = detail.rowCount;
    this.limit = detail.limit;
    this.detail = detail;
  }
}

/**
 * POST /api/reports/export
 *
 * Valida o request localmente com ExportRequestSchema antes de enviar.
 * Em caso de sucesso retorna { blob, filename, contentType }.
 * Em caso de 422 EXPORT_LIMIT_EXCEEDED lanca ExportLimitExceededError.
 * Demais erros HTTP lancam Error padrao com mensagem legivel.
 */
export async function postReportsExport(request: ExportRequest): Promise<ExportBlobResult> {
  const validated = ExportRequestSchema.parse(request);

  const accessToken = useAuthStore.getState().accessToken;
  const csrf = getCsrfToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  if (csrf) headers['X-CSRF-Token'] = csrf;

  const res = await fetch(`${API_BASE}/api/reports/export`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(validated),
  });

  if (res.status === 422) {
    let detail: ExportLimitError;
    try {
      const body = await res.json();
      detail = ExportLimitErrorSchema.parse(body);
    } catch {
      throw new Error('Limite de exportacao excedido. Refine os filtros e tente novamente.');
    }
    throw new ExportLimitExceededError(detail);
  }

  if (!res.ok) {
    let message = `Erro ao exportar (${res.status})`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      if (body.message) message = body.message;
      else if (body.error) message = body.error;
    } catch {
      // body nao era JSON
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const contentType = res.headers.get('Content-Type') ?? 'application/octet-stream';

  // Extrai filename do Content-Disposition: attachment; filename="relatorio.csv"
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const filenameRfc5987 = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const filenameQuoted = disposition.match(/filename="?([^";]+)"?/i);
  const rawFilename = filenameRfc5987?.[1] ?? filenameQuoted?.[1];
  const filename = rawFilename
    ? decodeURIComponent(rawFilename)
    : `relatorio-${validated.section}.${validated.format}`;

  return { blob, filename, contentType };
}
