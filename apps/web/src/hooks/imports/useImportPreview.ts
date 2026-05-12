// =============================================================================
// hooks/imports/useImportPreview.ts — Query paginada das linhas do batch.
// =============================================================================

import { useQuery } from '@tanstack/react-query';

import { getImportPreview } from '../../lib/api/imports';
import type { ImportRowStatus, PreviewParams } from '../../lib/api/imports';

interface UseImportPreviewOptions {
  batchId: string | null;
  params?: PreviewParams;
  enabled?: boolean;
}

export function useImportPreview({
  batchId,
  params = {},
  enabled = true,
}: UseImportPreviewOptions) {
  return useQuery({
    queryKey: ['import-preview', batchId, params],
    queryFn: () => {
      if (!batchId) throw new Error('batchId requerido');
      return getImportPreview(batchId, params);
    },
    enabled: enabled && Boolean(batchId),
    staleTime: 10_000,
  });
}

export type { ImportRowStatus };
