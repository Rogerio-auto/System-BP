// =============================================================================
// features/account/usePersonalEmailGuard.ts — Hook para o guard de 1º login.
//
// Responsabilidade:
//   Consulta GET /api/account/profile e retorna se o modal bloqueante deve
//   ser exibido (requiresPersonalEmail=true).
//
// Uso: consumido por AppRoutes em App.tsx para interceptar ANTES de renderizar
//   qualquer rota protegida.
//
// Caching:
//   TanStack Query com staleTime=0 — queremos sempre o estado mais fresco
//   após a autenticação. O backend responde em < 50ms (query simples).
//
// LGPD: personal_email é PII — a resposta não é logada.
// =============================================================================

import { useQuery } from '@tanstack/react-query';

import { useAuthStore } from '../../lib/auth-store';

import { getAccountProfile } from './api';
import type { AccountProfile } from './api';

// ─── Query key ───────────────────────────────────────────────────────────────

/** Query key canônica — invalida ao fazer logout (clear do store). */
export const ACCOUNT_PROFILE_QUERY_KEY = ['account', 'profile'] as const;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UsePersonalEmailGuardResult {
  /** true enquanto a query de perfil está sendo carregada */
  isLoading: boolean;
  /** true quando o agente deve cadastrar o email pessoal antes de continuar */
  requiresPersonalEmail: boolean;
  /** Perfil completo (null enquanto carregando ou erro) */
  profile: AccountProfile | null;
  /** Função para invalidar o cache após cadastro bem-sucedido */
  refetch: () => void;
}

/**
 * Hook que verifica se o agente precisa cadastrar o email pessoal.
 * Só executa quando o usuário está autenticado (isAuthenticated=true).
 */
export function usePersonalEmailGuard(): UsePersonalEmailGuardResult {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ACCOUNT_PROFILE_QUERY_KEY,
    queryFn: getAccountProfile,
    // Só busca quando autenticado — evita 401 em rotas públicas
    enabled: isAuthenticated,
    // staleTime=0: queremos o estado real do banco no 1º acesso
    staleTime: 0,
    // Não refetch em background — o guard é pontual (1º login)
    refetchOnWindowFocus: false,
    retry: 1,
  });

  return {
    isLoading: isAuthenticated && isLoading,
    requiresPersonalEmail: data?.requiresPersonalEmail ?? false,
    profile: data ?? null,
    refetch: () => {
      void refetch();
    },
  };
}
