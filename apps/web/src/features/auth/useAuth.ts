// =============================================================================
// features/auth/useAuth.ts — Hook público de autenticação.
//
// Wraps lib/auth-store.ts + lib/api.ts expondo uma API semântica para features.
// O store é a fonte de verdade; este arquivo é apenas a fachada de domínio.
//
// LGPD: credenciais nunca são logadas. Erros de auth são genéricos ao usuário.
// =============================================================================

import type { LoginBody, LoginResponse } from '@elemento/shared-schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { apiLogin, apiLogout } from '../../lib/api';
import { useAuth as useAuthBase, useAuthStore, type AuthUser } from '../../lib/auth-store';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapResponseToUser(res: LoginResponse): AuthUser {
  return {
    id: res.user.id,
    email: res.user.email,
    fullName: res.user.full_name,
    organizationId: res.user.organization_id,
    permissions: [], // expandido em F1-S04 quando RBAC estiver completo
  };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Hook principal de autenticação.
 *
 * Expõe:
 * - user, accessToken, isAuthenticated (do store)
 * - hasPermission(perm): boolean — verifica RBAC
 * - login({ email, password }): TanStack Mutation
 * - logout(): void — limpa store + cookie + redireciona /login
 *
 * Segurança:
 * - Access token apenas em memória (store Zustand)
 * - Logout chama API (idempotente) + limpa store
 * - Refresh é transparente via interceptor em lib/api.ts
 */
export function useAuth() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const auth = useAuthBase();

  // ── Login mutation ─────────────────────────────────────────────────────────
  const loginMutation = useMutation({
    mutationFn: (credentials: LoginBody) => apiLogin(credentials),
    onSuccess: (data) => {
      const user = mapResponseToUser(data);
      useAuthStore.getState().setAuth(user, data.access_token);
      // Invalida qualquer query cacheada de estado anterior
      void queryClient.invalidateQueries();
      navigate('/', { replace: true });
    },
    // onError é tratado pelo componente para mensagens amigáveis
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
    logout,
  };
}
