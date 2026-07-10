// =============================================================================
// hooks/ai-actions/useAiActions.ts — TanStack Query hooks do painel
// "IA no funil" (F25-S07).
//
// Consome a API do F25-S06 (apps/api/src/modules/ai-actions/):
//   GET  /api/ai-actions?window=&page=&limit=
//   POST /api/ai-actions/:id/revert
//
// Contrato lido diretamente de apps/api/src/modules/ai-actions/schemas.ts —
// os schemas Zod abaixo espelham exatamente as respostas do backend
// (evita drift front×API).
//
// LGPD (doc 17 §8.5): a listagem NUNCA traz o nome completo do lead — apenas
// `lead_name_masked` (ex.: "J. Silva"). A UI não tenta de-mask.
//
// Permissões (backend routes.ts):
//   - GET  /api/ai-actions          → ai_actions:read
//   - POST /api/ai-actions/:id/revert → ai_actions:revert
// As rotas NÃO são gateadas por feature flag no backend (ferramentas de
// supervisão humana) — o gating de flag é só de UI (ver AiActionsPage.tsx).
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '../../lib/api';

// ─── Schemas Zod (espelham apps/api/src/modules/ai-actions/schemas.ts) ───────

export const AI_ACTION_NAMES = ['leads.qualified', 'leads.stagnant', 'leads.abandoned'] as const;

export type AiActionName = (typeof AI_ACTION_NAMES)[number];

export const REVERTIBLE_AI_ACTION_NAMES = ['leads.qualified', 'leads.abandoned'] as const;

export type RevertibleAiActionName = (typeof REVERTIBLE_AI_ACTION_NAMES)[number];

export const AiActionsWindowSchema = z.enum(['24h', '7d', '30d']);

export type AiActionsWindow = z.infer<typeof AiActionsWindowSchema>;

const AiActionItemSchema = z.object({
  action_id: z.string().uuid(),
  action: z.enum(AI_ACTION_NAMES),
  lead_id: z.string().uuid(),
  /** Nome do lead mascarado (LGPD §8.5) — ex.: "J. Silva". null se o lead não existe mais. */
  lead_name_masked: z.string().nullable(),
  city_id: z.string().uuid().nullable(),
  occurred_at: z.string(),
  revertible: z.boolean(),
  reverted: z.boolean(),
});

export type AiActionItem = z.infer<typeof AiActionItemSchema>;

const AiActionsListResponseSchema = z.object({
  data: z.array(AiActionItemSchema),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
});

export type AiActionsListResponse = z.infer<typeof AiActionsListResponseSchema>;

const AiActionRevertResponseSchema = z.object({
  action_id: z.string().uuid(),
  lead_id: z.string().uuid(),
  action: z.enum(REVERTIBLE_AI_ACTION_NAMES),
  reverted: z.boolean(),
  previous_status: z.string(),
  current_status: z.string(),
  reverted_at: z.string(),
});

export type AiActionRevertResponse = z.infer<typeof AiActionRevertResponseSchema>;

// ─── Filtros + query keys ─────────────────────────────────────────────────────

export interface AiActionsListFilters {
  window: AiActionsWindow;
  page: number;
  limit: number;
}

export const aiActionsQueryKeys = {
  all: ['ai-actions'] as const,
  list: (filters: AiActionsListFilters) => [...aiActionsQueryKeys.all, 'list', filters] as const,
} as const;

// ─── Fetch helpers ────────────────────────────────────────────────────────────

function buildListQs(filters: AiActionsListFilters): string {
  const params = new URLSearchParams();
  params.set('window', filters.window);
  params.set('page', String(filters.page));
  params.set('limit', String(filters.limit));
  return `?${params.toString()}`;
}

async function fetchAiActionsList(filters: AiActionsListFilters): Promise<AiActionsListResponse> {
  const raw = await api.get<unknown>(`/api/ai-actions${buildListQs(filters)}`);
  return AiActionsListResponseSchema.parse(raw);
}

async function postRevertAiAction(actionId: string): Promise<AiActionRevertResponse> {
  const raw = await api.post<unknown>(`/api/ai-actions/${encodeURIComponent(actionId)}/revert`, {});
  return AiActionRevertResponseSchema.parse(raw);
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

/**
 * Lista paginada de ações da IA no funil (painel "IA no funil").
 *
 * @param options.enabled - false enquanto a permissão/flag não estiverem
 *   confirmadas (evita fetch antes do gate — mesmo padrão de useDecisionsList).
 */
export function useAiActionsList(
  filters: AiActionsListFilters,
  options?: { enabled?: boolean },
): {
  data: AiActionsListResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
} {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: aiActionsQueryKeys.list(filters),
    queryFn: () => fetchAiActionsList(filters),
    staleTime: 15_000,
    enabled: options?.enabled !== false,
  });

  return { data, isLoading, isError, error, refetch: () => void refetch() };
}

interface RevertContext {
  previous: AiActionsListResponse | undefined;
}

/**
 * Reverte uma ação autônoma da IA (qualificação ou abandono).
 *
 * Otimismo UI: marca `reverted: true` no item imediatamente; reverte o
 * snapshot completo em caso de erro. Em sucesso, invalida toda a família de
 * queries `ai-actions` (outras janelas/páginas podem conter o mesmo item).
 *
 * @param filters - filtros da lista atualmente renderizada (usados para
 *   localizar o cache a atualizar de forma otimista).
 */
export function useRevertAiAction(filters: AiActionsListFilters) {
  const queryClient = useQueryClient();
  const queryKey = aiActionsQueryKeys.list(filters);

  return useMutation<AiActionRevertResponse, Error, string, RevertContext>({
    mutationFn: (actionId: string) => postRevertAiAction(actionId),

    onMutate: async (actionId: string) => {
      await queryClient.cancelQueries({ queryKey });

      const previous = queryClient.getQueryData<AiActionsListResponse>(queryKey);

      queryClient.setQueryData<AiActionsListResponse>(queryKey, (old) => {
        if (!old) return old;
        return {
          ...old,
          data: old.data.map((item) =>
            item.action_id === actionId ? { ...item, reverted: true } : item,
          ),
        };
      });

      return { previous };
    },

    onError: (_error, _actionId, context) => {
      // Rollback: restaura o snapshot anterior (item volta a "não revertido")
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },

    onSuccess: () => {
      // Sincroniza com o servidor — outras janelas/páginas podem ter o mesmo lead
      void queryClient.invalidateQueries({ queryKey: aiActionsQueryKeys.all });
    },
  });
}
