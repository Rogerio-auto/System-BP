// =============================================================================
// hooks/account/useAccount.ts — Queries TanStack Query para self-service (F8-S09/S11).
//
// Fornece:
//   useProfile()        → GET /api/account/profile
//   useUpdateProfile()  → PATCH /api/account/profile
//   useChangePassword() → POST /api/account/password
//   use2faStatus()      → GET /api/account/2fa/status
//   useEnroll2fa()      → POST /api/account/2fa/enroll
//   useActivate2fa()    → POST /api/account/2fa/activate
//   useDisable2fa()     → POST /api/account/2fa/disable
//
// Nunca useEffect+fetch. TanStack Query é o único caminho pra rede.
// LGPD: credenciais e recovery codes nunca logados.
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
// 2FA types
// ---------------------------------------------------------------------------

export interface TwoFactorStatus {
  enabled: boolean;
}

export interface TwoFactorEnrollResponse {
  otpauthUri: string;
  secret: string;
}

export interface TwoFactorActivateBody {
  code: string;
}

export interface TwoFactorActivateResponse {
  recoveryCodes: string[];
}

export interface TwoFactorDisableBody {
  code: string;
}

// ---------------------------------------------------------------------------
// 2FA schemas (Zod runtime validation)
// ---------------------------------------------------------------------------

const TwoFactorStatusSchema = z.object({
  enabled: z.boolean(),
});

const TwoFactorEnrollResponseSchema = z.object({
  otpauthUri: z.string(),
  secret: z.string(),
});

const TwoFactorActivateResponseSchema = z.object({
  recoveryCodes: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// 2FA API functions
// ---------------------------------------------------------------------------

async function apiGet2faStatus(): Promise<TwoFactorStatus> {
  const raw = await api.get('/api/account/2fa/status');
  return TwoFactorStatusSchema.parse(raw);
}

async function apiEnroll2fa(): Promise<TwoFactorEnrollResponse> {
  const raw = await api.post('/api/account/2fa/enroll', {});
  return TwoFactorEnrollResponseSchema.parse(raw);
}

async function apiActivate2fa(body: TwoFactorActivateBody): Promise<TwoFactorActivateResponse> {
  const raw = await api.post('/api/account/2fa/activate', body);
  return TwoFactorActivateResponseSchema.parse(raw);
}

async function apiDisable2fa(body: TwoFactorDisableBody): Promise<void> {
  await api.post('/api/account/2fa/disable', body);
}

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const ACCOUNT_QUERY_KEY = {
  profile: ['account', 'profile'] as const,
  twoFactorStatus: ['account', '2fa', 'status'] as const,
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

// ---------------------------------------------------------------------------
// use2faStatus — GET /api/account/2fa/status
// ---------------------------------------------------------------------------

export function use2faStatus(): {
  data: TwoFactorStatus | undefined;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: ACCOUNT_QUERY_KEY.twoFactorStatus,
    queryFn: apiGet2faStatus,
    staleTime: 30_000,
  });

  return { data, isLoading };
}

// ---------------------------------------------------------------------------
// useEnroll2fa — POST /api/account/2fa/enroll
// ---------------------------------------------------------------------------

interface UseEnroll2faOptions {
  onSuccess?: ((result: TwoFactorEnrollResponse) => void) | undefined;
}

export function useEnroll2fa(opts: UseEnroll2faOptions = {}): {
  enroll: () => void;
  isPending: boolean;
} {
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: () => apiEnroll2fa(),
    onSuccess: (result) => {
      opts.onSuccess?.(result);
    },
    onError: () => {
      toast('Erro ao iniciar ativação do 2FA. Tente novamente.', 'danger');
    },
  });

  return { enroll: () => mutation.mutate(), isPending: mutation.isPending };
}

// ---------------------------------------------------------------------------
// useActivate2fa — POST /api/account/2fa/activate
// ---------------------------------------------------------------------------

interface UseActivate2faOptions {
  onSuccess?: ((result: TwoFactorActivateResponse) => void) | undefined;
  onInvalidCode?: ((msg: string) => void) | undefined;
}

export function useActivate2fa(opts: UseActivate2faOptions = {}): {
  activate: (body: TwoFactorActivateBody) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: (body: TwoFactorActivateBody) => apiActivate2fa(body),
    onSuccess: (result) => {
      // Invalidar status do 2FA — agora está ativo
      void queryClient.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY.twoFactorStatus });
      opts.onSuccess?.(result);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        opts.onInvalidCode?.(err.message);
        return;
      }
      const msg = err instanceof Error ? err.message : 'Erro ao ativar 2FA.';
      toast(msg, 'danger');
    },
  });

  return { activate: (body) => mutation.mutate(body), isPending: mutation.isPending };
}

// ---------------------------------------------------------------------------
// useDisable2fa — POST /api/account/2fa/disable
// ---------------------------------------------------------------------------

interface UseDisable2faOptions {
  onSuccess?: (() => void) | undefined;
  onInvalidCode?: ((msg: string) => void) | undefined;
}

export function useDisable2fa(opts: UseDisable2faOptions = {}): {
  disable: (body: TwoFactorDisableBody) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: (body: TwoFactorDisableBody) => apiDisable2fa(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY.twoFactorStatus });
      toast('2FA desativado com sucesso.', 'success');
      opts.onSuccess?.();
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        opts.onInvalidCode?.(err.message);
        return;
      }
      const msg = err instanceof Error ? err.message : 'Erro ao desativar 2FA.';
      toast(msg, 'danger');
    },
  });

  return { disable: (body) => mutation.mutate(body), isPending: mutation.isPending };
}
