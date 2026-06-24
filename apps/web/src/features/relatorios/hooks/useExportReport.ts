// =============================================================================
// features/relatorios/hooks/useExportReport.ts -- Hook de exportacao (F23-S10).
//
// Mutation TanStack Query que envia POST /api/reports/export, recebe o Blob
// e dispara o download no browser via URL.createObjectURL.
//
// Gating (camada UI): so deve ser chamado quando
//   hasPermission("reports:export") && flagEnabled("reports.export.enabled").
//
// Estados expostos: idle | loading | success | error.
// Erro de limite (422): ExportLimitExceededError com rowCount/limit.
// =============================================================================

import type { ExportFormat, ExportRequest, ReportSection } from '@elemento/shared-schemas';
import { useMutation } from '@tanstack/react-query';

import { ExportLimitExceededError, postReportsExport, type ExportBlobResult } from '../api';

// Re-exporta para conveniencia dos callers
export type { ExportFormat, ExportRequest, ReportSection };
export { ExportLimitExceededError };

// ---------------------------------------------------------------------------
// Trigger download no browser
// ---------------------------------------------------------------------------

function triggerDownload(result: ExportBlobResult): void {
  const url = URL.createObjectURL(result.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = result.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// useExportReport
// ---------------------------------------------------------------------------

export interface UseExportReportResult {
  /** Inicia o download do relatorio. */
  exportReport: (args: ExportRequest) => void;
  /** true enquanto a requisicao esta em andamento. */
  isExporting: boolean;
  /** Erro da ultima tentativa (null em idle/success). */
  error: Error | null;
  /** true quando o ultimo export foi bem-sucedido. */
  isSuccess: boolean;
  /** Reseta o estado da mutation (limpa erro/success). */
  reset: () => void;
}

/**
 * Hook de exportacao de relatorios.
 *
 * @example
 * const { exportReport, isExporting, error } = useExportReport();
 *
 * // Para exportar a secao atual como CSV com os filtros ativos:
 * exportReport({ section: currentSection, format: 'csv', filters });
 */
export function useExportReport(): UseExportReportResult {
  const mutation = useMutation<ExportBlobResult, Error, ExportRequest>({
    mutationFn: postReportsExport,
    onSuccess: (result) => {
      triggerDownload(result);
    },
  });

  return {
    exportReport: mutation.mutate,
    isExporting: mutation.isPending,
    error: mutation.error,
    isSuccess: mutation.isSuccess,
    reset: mutation.reset,
  };
}
