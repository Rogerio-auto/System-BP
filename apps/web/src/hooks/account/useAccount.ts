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
//   useUploadAvatar()   → POST signed-url + PUT R2 + PUT /api/account/avatar
//   useRemoveAvatar()   → DELETE /api/account/avatar
//
// Nunca useEffect+fetch. TanStack Query é o único caminho pra rede.
// LGPD: credenciais e recovery codes nunca logados.
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
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
  /**
   * URL pública da foto de perfil no R2.
   * Null quando não definida; string quando definida.
   * Sempre presente na resposta após Zod parse (nunca undefined).
   */
  avatarUrl: string | null;
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
  // .optional() tolera respostas antigas sem o campo; .transform normaliza para null
  // (evita undefined no tipo de saída — exigido por exactOptionalPropertyTypes).
  avatarUrl: z
    .string()
    .url()
    .nullable()
    .optional()
    .transform((v): string | null => v ?? null),
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

// ---------------------------------------------------------------------------
// Avatar upload — signed-url + PUT R2 + PUT /api/account/avatar
// ---------------------------------------------------------------------------

/** Schema de validação da resposta de signed-url (espelha AvatarSignedUrlResponseSchema). */
const AvatarSignedUrlResultSchema = z.object({
  uploadUrl: z.string().url(),
  publicUrl: z.string().url(),
  key: z.string(),
});

async function apiGetAvatarSignedUrl(body: {
  fileName: string;
  mime: string;
  sizeBytes: number;
}): Promise<{ uploadUrl: string; publicUrl: string; key: string }> {
  const raw = await api.post('/api/account/avatar/signed-url', body);
  return AvatarSignedUrlResultSchema.parse(raw);
}

async function apiSaveAvatar(avatarUrl: string): Promise<ProfileResponse> {
  const raw = await api.put('/api/account/avatar', { avatarUrl });
  return ProfileResponseSchema.parse(raw);
}

async function apiRemoveAvatar(): Promise<ProfileResponse> {
  const raw = await api.delete('/api/account/avatar');
  return ProfileResponseSchema.parse(raw);
}

// ─── Tipos públicos de progresso ──────────────────────────────────────────────

export interface AvatarUploadProgress {
  phase: 'idle' | 'signing' | 'uploading' | 'saving' | 'done' | 'error';
  /** 0–100 durante 'uploading'; 100 em 'done'/'saving'. */
  percent: number;
  /** Mensagem de erro (somente em phase === 'error'). */
  error?: string | undefined;
}

// ---------------------------------------------------------------------------
// useUploadAvatar
// ---------------------------------------------------------------------------

/**
 * Orquestra o upload de foto de perfil em 3 fases:
 *   1. POST /api/account/avatar/signed-url → obtém uploadUrl pré-assinado.
 *   2. PUT direto no R2 via XHR (sem Authorization) — com progresso real.
 *   3. PUT /api/account/avatar { avatarUrl } → persiste e invalida cache.
 *
 * Espelha o padrão de useUploadMedia (conversas). Sem useEffect+fetch.
 */
export function useUploadAvatar(): {
  upload: (file: File) => Promise<void>;
  progress: AvatarUploadProgress;
  abort: () => void;
} {
  const [progress, setProgress] = React.useState<AvatarUploadProgress>({
    phase: 'idle',
    percent: 0,
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const xhrRef = React.useRef<XMLHttpRequest | null>(null);

  const abort = React.useCallback((): void => {
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }
    setProgress({ phase: 'idle', percent: 0 });
  }, []);

  const upload = React.useCallback(
    async (file: File): Promise<void> => {
      const mime = file.type || 'image/jpeg';

      // ── Fase 1: Obter signed-url ────────────────────────────────────────────
      setProgress({ phase: 'signing', percent: 0 });

      let uploadUrl: string;
      let publicUrl: string;

      try {
        const res = await apiGetAvatarSignedUrl({
          fileName: file.name,
          mime,
          sizeBytes: file.size,
        });
        uploadUrl = res.uploadUrl;
        publicUrl = res.publicUrl;
      } catch {
        const msg = 'Não foi possível iniciar o upload. Tente novamente.';
        setProgress({ phase: 'error', percent: 0, error: msg });
        toast(msg, 'danger');
        return;
      }

      // ── Fase 2: PUT para R2 via XHR (progresso real) ────────────────────────
      setProgress({ phase: 'uploading', percent: 0 });

      try {
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhrRef.current = xhr;

          xhr.open('PUT', uploadUrl, true);
          // Content-Type deve casar com o que foi assinado no R2.
          xhr.setRequestHeader('Content-Type', mime);
          // Sem Authorization — URL pré-assinada, credencial está na query string.

          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              const percent = Math.round((event.loaded / event.total) * 100);
              setProgress({ phase: 'uploading', percent });
            }
          };

          xhr.onload = () => {
            xhrRef.current = null;
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              reject(new Error(`Upload falhou (HTTP ${xhr.status}).`));
            }
          };

          xhr.onerror = () => {
            xhrRef.current = null;
            reject(new Error('Erro de rede durante o upload. Verifique sua conexão.'));
          };

          xhr.onabort = () => {
            xhrRef.current = null;
            reject(new Error('Upload cancelado.'));
          };

          xhr.send(file);
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erro ao enviar a imagem.';
        setProgress({ phase: 'error', percent: 0, error: msg });
        toast(msg, 'danger');
        return;
      }

      // ── Fase 3: Persistir URL + invalidar cache ─────────────────────────────
      setProgress({ phase: 'saving', percent: 100 });

      try {
        const result = await apiSaveAvatar(publicUrl);
        // Atualiza o cache do perfil diretamente (sem re-fetch)
        queryClient.setQueryData(ACCOUNT_QUERY_KEY.profile, result);
        setProgress({ phase: 'done', percent: 100 });
        toast('Foto de perfil atualizada!', 'success');
      } catch {
        const msg = 'Não foi possível salvar a foto. Tente novamente.';
        setProgress({ phase: 'error', percent: 0, error: msg });
        toast(msg, 'danger');
      }
    },
    [queryClient, toast],
  );

  return { upload, progress, abort };
}

// ---------------------------------------------------------------------------
// useRemoveAvatar
// ---------------------------------------------------------------------------

/**
 * Remove a foto de perfil (avatar_url = null no banco).
 * Atualiza o cache do perfil via setQueryData após sucesso.
 */
export function useRemoveAvatar(): {
  remove: () => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: () => apiRemoveAvatar(),
    onSuccess: (result) => {
      queryClient.setQueryData(ACCOUNT_QUERY_KEY.profile, result);
      toast('Foto de perfil removida.', 'success');
    },
    onError: () => {
      toast('Não foi possível remover a foto. Tente novamente.', 'danger');
    },
  });

  return { remove: () => mutation.mutate(), isPending: mutation.isPending };
}
