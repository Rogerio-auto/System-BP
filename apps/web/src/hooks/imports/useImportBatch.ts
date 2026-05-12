// =============================================================================
// hooks/imports/useImportBatch.ts — Query de status do batch de importação.
//
// Polling automático enquanto status for transient (parsing, processing).
// =============================================================================

import { useQuery } from '@tanstack/react-query';

import { getImportBatch } from '../../lib/api/imports';
import type { ImportBatchStatus } from '../../lib/api/imports';

// Status que indicam processamento em background — polling ativo
const TRANSIENT_STATUSES: ImportBatchStatus[] = ['uploaded', 'parsing', 'processing'];

interface UseImportBatchOptions {
  batchId: string | null;
  enabled?: boolean;
}

export function useImportBatch({ batchId, enabled = true }: UseImportBatchOptions) {
  return useQuery({
    queryKey: ['import-batch', batchId],
    queryFn: () => {
      if (!batchId) throw new Error('batchId requerido');
      return getImportBatch(batchId);
    },
    enabled: enabled && Boolean(batchId),
    staleTime: 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status && (TRANSIENT_STATUSES as string[]).includes(status)) {
        return 2000; // polling 2s enquanto transient
      }
      return false;
    },
  });
}
