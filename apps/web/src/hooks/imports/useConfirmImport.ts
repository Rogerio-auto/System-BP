// =============================================================================
// hooks/imports/useConfirmImport.ts — Mutation de confirmação do batch.
// =============================================================================

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { confirmImportBatch } from '../../lib/api/imports';

export function useConfirmImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (batchId: string) => confirmImportBatch(batchId),
    onSuccess: (_data, batchId) => {
      // Invalida o cache do batch para forçar refetch com status atualizado
      void queryClient.invalidateQueries({ queryKey: ['import-batch', batchId] });
    },
  });
}
