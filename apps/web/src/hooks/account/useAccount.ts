// =============================================================================
// hooks/account/useAccount.ts — Queries TanStack Query para self-service (F8-S09).
//
// Fornece:
//   useProfile()        → GET /api/account/profile
//   useUpdateProfile()  → PATCH /api/account/profile
//   useChangePassword() → POST /api/account/password
//
// Nunca useEffect+fetch. TanStack Query é o único caminho pra rede.
// LGPD: currentPassword/newPassword nunca logados.
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { useToast } from '../../components/ui/Toast';
import { ApiError, api } from '../../lib/api';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface ProfileResponse {
  id: string;
  email: string;
  fullName: string;
  organizationId: string;
}

export interface UpdateProfileBody {
  fullName: string;
}

export interface ChangePasswordBody {
  currentPassword: string;
  newPassword: string;
}

// ---------------------------------------------------------------------------
// Zod schemas (validação runtime)
// ---------------------------------------------------------------------------

const ProfileResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string(),
  organizationId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

async function apiGetProfile(): Promise<ProfileResponse> {
  const raw = await api.get('/api/account/profile');
  return ProfileResponseSchema.parse(raw);
}

async function apiUpdateProfile(body: UpdateProfileBody): Promise<ProfileResponse> {
  const raw = await api.patch('/api/account/profile', body);
  return ProfileResponseSchema.parse(raw);
}

async function apiChangePassword(body: ChangePasswordBody): Promise<void> {
  await api.post('/api/account/password', body);
}

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const ACCOUNT_QUERY_KEY = {
  profile: ['account', 'profile'] as const,
};

// ---------------------------------------------------------------------------
// useProfile — GET /api/account/profile
// ---------------------------------------------------------------------------

export function useProfile(): {
  data: ProfileResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
} {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ACCOUNT_QUERY_KEY.profile,
    queryFn: apiGetProfile,
    staleTime: 60_000, // perfil muda raramente — 1 min
  });

  return { data, isLoading, isError, error: error as Error | null };
}

// ---------------------------------------------------------------------------
// useUpdateProfile — PATCH /api/account/profile
// ---------------------------------------------------------------------------

interface UseUpdateProfileOptions {
  onSuccess?: ((result: ProfileResponse) => void) | undefined;
}

export function useUpdateProfile(opts: UseUpdateProfileOptions = {}): {
  updateProfile: (body: UpdateProfileBody) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: (body: UpdateProfileBody) => apiUpdateProfile(body),
    onSuccess: (result) => {
      // Atualiza o cache do perfil
      queryClient.setQueryData(ACCOUNT_QUERY_KEY.profile, result);
      toast('Perfil atualizado com sucesso!', 'success');
      opts.onSuccess?.(result);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Erro ao atualizar perfil.';
      toast(msg, 'danger');
    },
  });

  return { updateProfile: (body) => mutation.mutate(body), isPending: mutation.isPending };
}

// ---------------------------------------------------------------------------
// useChangePassword — POST /api/account/password
// ---------------------------------------------------------------------------

interface UseChangePasswordOptions {
  /** Chamado quando a troca é concluída com sucesso */
  onSuccess?: (() => void) | undefined;
  /** Chamado especificamente com código 401 (senha atual errada) */
  onWrongPassword?: ((message: string) => void) | undefined;
}

export function useChangePassword(opts: UseChangePasswordOptions = {}): {
  changePassword: (body: ChangePasswordBody) => void;
  isPending: boolean;
} {
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: (body: ChangePasswordBody) => apiChangePassword(body),
    onSuccess: () => {
      toast('Senha alterada com sucesso!', 'success');
      opts.onSuccess?.();
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        opts.onWrongPassword?.(err.message);
        return;
      }
      const msg = err instanceof Error ? err.message : 'Erro ao alterar senha.';
      toast(msg, 'danger');
    },
  });

  return {
    changePassword: (body) => mutation.mutate(body),
    isPending: mutation.isPending,
  };
}
