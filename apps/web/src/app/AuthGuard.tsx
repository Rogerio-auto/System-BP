// =============================================================================
// app/AuthGuard.tsx — Proteção de rotas autenticadas.
//
// Redireciona para /login se não autenticado.
// Preserva a rota pretendida em state para redirect pós-login (futuro).
// =============================================================================

import * as React from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { useAuthStore } from '../lib/auth-store';

import { useSessionBootstrap } from './SessionBootstrap';

interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * Wrapper de rotas protegidas.
 * Uso: <Route element={<AuthGuard><AppLayout /></AuthGuard>}>
 *
 * Bootstrap-aware: enquanto o SessionBootstrap está restaurando a sessão
 * via refresh-cookie, mostra um splash discreto em vez de redirecionar
 * para /login (evita o flash de login no reload de usuários autenticados).
 */
export function AuthGuard({ children }: AuthGuardProps): React.JSX.Element {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { status } = useSessionBootstrap();
  const location = useLocation();

  if (status === 'bootstrapping') {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className="flex items-center justify-center min-h-screen bg-[var(--bg-elev-1)]"
      >
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-8 h-8 rounded-full border-2 border-border-strong border-t-azul animate-spin"
            aria-hidden="true"
          />
          <span className="sr-only">Restaurando sessão…</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Guarda a rota pretendida para redirect pós-login (F1-S09+)
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
