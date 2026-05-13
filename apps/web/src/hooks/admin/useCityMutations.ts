// =============================================================================
// hooks/admin/useCityMutations.ts — Mutations de create / update / delete.
//
// Cada mutation:
//   onSuccess → invalida ['admin', 'cities'] no query cache + toast verde.
//   onError   → toast danger com mensagem do ApiError.
// =============================================================================

import type { CityCreate, CityResponse, CityUpdate } from '@elemento/shared-schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useToast } from '../../components/ui/Toast';
import { ApiError } from '../../lib/api';
import { createCity, deleteCity, updateCity } from '../../lib/api/cities';

// ─── Chave base para invalidação ──────────────────────────────────────────────

const CITIES_BASE_KEY = ['admin', 'cities'] as const;

// ─── Hook: create ─────────────────────────────────────────────────────────────

interface UseCreateCityOptions {
  onSuccess?: (city: CityResponse) => void;
  /** Conflito 409 (slug ou ibge_code duplicado) — passa a mensagem para exibição inline. */
  onConflict?: (message: string) => void;
}

export function useCreateCity(opts: UseCreateCityOptions = {}): {
  createCity: (body: CityCreate) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: (body: CityCreate) => createCity(body),

    onSuccess: (city) => {
      void queryClient.invalidateQueries({ queryKey: CITIES_BASE_KEY });
      toast('Cidade criada com sucesso!', 'success');
      opts.onSuccess?.(city);
    },

    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 409) {
        opts.onConflict?.(err.message);
        return;
      }
      const msg = err instanceof Error ? err.message : 'Erro ao criar cidade.';
      toast(msg, 'danger');
    },
  });

  return {
    createCity: (body) => mutation.mutate(body),
    isPending: mutation.isPending,
  };
}

// ─── Hook: update ─────────────────────────────────────────────────────────────

interface UseUpdateCityOptions {
  onSuccess?: (city: CityResponse) => void;
  onConflict?: (message: string) => void;
}

export function useUpdateCity(opts: UseUpdateCityOptions = {}): {
  updateCity: (id: string, body: CityUpdate) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: CityUpdate }) => updateCity(id, body),

    onSuccess: (city) => {
      void queryClient.invalidateQueries({ queryKey: CITIES_BASE_KEY });
      toast('Cidade atualizada com sucesso!', 'success');
      opts.onSuccess?.(city);
    },

    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 409) {
        opts.onConflict?.(err.message);
        return;
      }
      const msg = err instanceof Error ? err.message : 'Erro ao atualizar cidade.';
      toast(msg, 'danger');
    },
  });

  return {
    updateCity: (id, body) => mutation.mutate({ id, body }),
    isPending: mutation.isPending,
  };
}

// ─── Hook: delete ─────────────────────────────────────────────────────────────

export function useDeleteCity(): {
  deleteCity: (id: string) => void;
  isPending: boolean;
  pendingId: string | null;
} {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: (id: string) => deleteCity(id),

    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CITIES_BASE_KEY });
      toast('Cidade removida.', 'success');
    },

    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Erro ao remover cidade.';
      toast(msg, 'danger');
    },
  });

  return {
    deleteCity: (id) => mutation.mutate(id),
    isPending: mutation.isPending,
    pendingId: mutation.isPending ? (mutation.variables ?? null) : null,
  };
}
