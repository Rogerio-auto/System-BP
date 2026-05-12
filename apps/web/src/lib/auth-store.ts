// =============================================================================
// lib/auth-store.ts — Estado global de autenticação (Zustand).
//
// Segurança (LGPD + auth):
//   - access_token APENAS em memória (campo do store Zustand). NUNCA localStorage.
//   - Refresh via cookie httpOnly — frontend só faz POST /api/auth/refresh.
//   - user.email é PII — nunca logar no console.
//   - clear() é chamado em logout e em refresh falho (lib/api.ts).
//
// O store NÃO persiste via zustand/middleware/persist — intencional.
// Preferências de UI (tema, sidebar) persistem em ThemeProvider / sidebarStore.
// =============================================================================

import { create } from 'zustand';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  organizationId: string;
  /** Permissões/roles — populado em futuras iterações (F1-S04+) */
  permissions: string[];
}

export interface AuthState {
  /** Access token em memória (nunca persiste em storage) */
  accessToken: string | null;
  /** Usuário autenticado */
  user: AuthUser | null;
  /** true quando accessToken != null e user != null */
  isAuthenticated: boolean;
  /** Define user + token após login */
  setAuth: (
    user: AuthUser,
    token: string,
  ) => void /** Atualiza apenas o access token (refresh interceptor) */;
  setAccessToken: (token: string) => void /** Limpa toda sessão */;
  clear: () => void;
  /** Verifica se o usuário possui uma permissão específica (RBAC). */
  hasPermission: (permission: string) => boolean;
}

// ─── Estado inicial ───────────────────────────────────────────────────────────

const INITIAL_DATA = {
  accessToken: null as string | null,
  user: null as AuthUser | null,
  isAuthenticated: false,
};

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAuthStore = create<AuthState>()((set, get) => ({
  ...INITIAL_DATA,

  setAuth(user: AuthUser, token: string) {
    set({ user, accessToken: token, isAuthenticated: true });
  },

  setAccessToken(token: string) {
    set({ accessToken: token });
  },

  clear() {
    set({ ...INITIAL_DATA });
  },

  hasPermission(permission: string) {
    const { user } = get();
    if (!user) return false;
    return user.permissions.includes(permission);
  },
}));

// ─── Hook conveniente ─────────────────────────────────────────────────────────

/**
 * Hook para consumo nos componentes.
 * Expõe o slice de auth + helpers semânticos.
 */
export function useAuth() {
  return useAuthStore((state) => ({
    user: state.user,
    accessToken: state.accessToken,
    isAuthenticated: state.isAuthenticated,
    hasPermission: state.hasPermission,
    setAuth: state.setAuth,
    clear: state.clear,
  }));
}
