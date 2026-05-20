// =============================================================================
// features/auth/useAuth.ts — Hook público de autenticação (F1-S02 / F8-S11).
//
// Wraps lib/auth-store.ts + lib/api.ts expondo uma API semântica para features.
// O store é a fonte de verdade; este arquivo é apenas a fachada de domínio.
//
// Fluxo de login com 2FA:
//   1. login({ email, password }) → { status: '2fa_required', challenge_token }
//   2. onTwoFactorRequired é chamado com o challengeToken
//   3. O componente exibe a etapa TOTP
//   4. verify2fa({ challengeToken, code }) → sessão completa
//
// LGPD: credenciais nunca são logadas. Erros de auth são genéricos ao usuário.
// =============================================================================

import type { LoginBody } from '@elemento/shared-schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { api, apiLogin, apiLogout } from '../../lib/api';
import { useAuth as useAuthBase, useAuthStore, type AuthUser } from '../../lib/auth-store';

// ─── Tipos de resposta do login (pós-F8-S11) ─────────────────────────────────

interface LoginResponseOk {
  status: 'ok';
  access_token: string;
  expires_in: number;
  user: {
    id: string;
    email: string;
    full_name: string;
    organization_id: string;
    /** Permissões RBAC consolidadas — espelha `loginResponseSchema` em shared-schemas. */
    permissions: string[];
  };
}

interface LoginResponse2faRequired {
  status: '2fa_required';
  challenge_token: string;
}

type LoginApiResponse = LoginResponseOk | LoginResponse2faRequired;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapResponseToUser(res: LoginResponseOk): AuthUser {
  return {
    id: res.user.id,
    email: res.user.email,
    fullName: res.user.full_name,
    organizationId: res.user.organization_id,
    // Backend (F1-S03 + fix de auth-permissions) retorna permissions consolidadas.
    // Fallback `?? []` protege contra response antigo durante deploy progressivo.
    permissions: res.user.permissions ?? [],
  };
}

// ─── Verify 2FA API ───────────────────────────────────────────────────────────

export interface Verify2faBody {
  challengeToken: string;
  code: string;
}

async function apiVerify2fa(body: Verify2faBody): Promise<LoginResponseOk> {
  return api.post<LoginResponseOk>('/api/auth/verify-2fa', body);
}

// ─── Hook ────────────────────────────────────────────────────────────────────

interface UseAuthOptions {
  /** Chamado quando o login retorna 2fa_required — recebe o challengeToken */
  onTwoFactorRequired?: ((challengeToken: string) => void) | undefined;
}

/**
 * Hook principal de autenticação.
 *
 * Expõe:
 * - user, accessToken, isAuthenticated (do store)
 * - hasPermission(perm): boolean — verifica RBAC
 * - login({ email, password }): TanStack Mutation
 * - verify2fa({ challengeToken, code }): TanStack Mutation
 * - logout(): void — limpa store + cookie + redireciona /login
 *
 * Segurança:
 * - Access token apenas em memória (store Zustand)
 * - Logout chama API (idempotente) + limpa store
 * - Refresh é transparente via interceptor em lib/api.ts
 * - challengeToken: dado temporário — nunca persiste em store
 */
export function useAuth(opts: UseAuthOptions = {}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const auth = useAuthBase();

  // ── Login mutation ─────────────────────────────────────────────────────────
  const loginMutation = useMutation({
    mutationFn: (credentials: LoginBody) => apiLogin(credentials) as Promise<LoginApiResponse>,
    onSuccess: (data) => {
      if (data.status === '2fa_required') {
        // Não emitir sessão ainda — aguardar verificação do segundo fator
        opts.onTwoFactorRequired?.(data.challenge_token);
        return;
      }
      const user = mapResponseToUser(data);
      useAuthStore.getState().setAuth(user, data.access_token);
      void queryClient.invalidateQueries();
      navigate('/', { replace: true });
    },
    // onError é tratado pelo componente para mensagens amigáveis
  });

  // ── Verify 2FA mutation ────────────────────────────────────────────────────
  const verify2faMutation = useMutation({
    mutationFn: (body: Verify2faBody) => apiVerify2fa(body),
    onSuccess: (data) => {
      const user = mapResponseToUser(data);
      useAuthStore.getState().setAuth(user, data.access_token);
      void queryClient.invalidateQueries();
      navigate('/', { replace: true });
    },
    // onError tratado pelo componente
  });

  // ── Logout ──────────────────────────────────────────────────────────────────
  async function logout(): Promise<void> {
    try {
      await apiLogout();
    } catch {
      // Logout é idempotente — mesmo que a API falhe, limpamos o estado local
    } finally {
      auth.clear();
      queryClient.clear();
      navigate('/login', { replace: true });
    }
  }

  return {
    user: auth.user,
    accessToken: auth.accessToken,
    isAuthenticated: auth.isAuthenticated,
    hasPermission: auth.hasPermission,
    login: loginMutation,
    verify2fa: verify2faMutation,
    logout,
  };
}
