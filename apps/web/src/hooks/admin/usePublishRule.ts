// =============================================================================
// hooks/admin/usePublishRule.ts — Mutation para publicar nova versão de regra.
//
// POST /api/credit-products/:id/rules
//   - Incrementa versão (v1 → v2 → v3…).
//   - Marca versão anterior como expirada (effective_to = now).
//   - Requer feature flag credit_simulation.enabled (backend valida via gate).
//
// Após sucesso: invalida o detalhe do produto (timeline + active_rule)
// e também a lista (active_rule summary na tabela).
// =============================================================================

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useToast } from '../../components/ui/Toast';
import { ApiError } from '../../lib/api';
import { publishRule } from '../../lib/api/credit-products';

import type { CreditProductRuleResponse, RuleCreate } from './types';
import { PRODUCTS_QUERY_KEY } from './useProducts';

// ---------------------------------------------------------------------------
// Opções do hook
// ---------------------------------------------------------------------------

interface UsePublishRuleOptions {
  productId: string;
  onSuccess?: (rule: CreditProductRuleResponse) => void;
  /** 422 — validação de negócio (ex: max < min) */
  onValidationError?: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Publica nova versão de regra para um produto de crédito.
 *
 * Comportamento:
 *   onSuccess → invalida detalhe + lista → toast verde
 *   422       → chama onValidationError (para exibição inline no form)
 *   outros    → toast danger
 */
export function usePublishRule(opts: UsePublishRuleOptions): {
  publishRule: (body: RuleCreate) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: (body: RuleCreate) => publishRule(opts.productId, body),

    onSuccess: (rule) => {
      // Invalida detalhe do produto (timeline atualiza com v+1 no topo)
      void queryClient.invalidateQueries({
        queryKey: PRODUCTS_QUERY_KEY.detail(opts.productId),
      });
      // Invalida a lista (resumo da regra ativa na tabela)
      void queryClient.invalidateQueries({
        queryKey: PRODUCTS_QUERY_KEY.all,
      });

      toast(`Versão v${rule.version} publicada com sucesso!`, 'success');
      opts.onSuccess?.(rule);
    },

    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 422) {
        opts.onValidationError?.(err.message);
        return;
      }
      const msg = err instanceof Error ? err.message : 'Erro ao publicar regra.';
      toast(msg, 'danger');
    },
  });

  return {
    publishRule: (body) => mutation.mutate(body),
    isPending: mutation.isPending,
  };
}
