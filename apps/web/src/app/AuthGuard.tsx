// =============================================================================
// app/AuthGuard.tsx — Proteção de rotas autenticadas.
//
// Redireciona para /login se não autenticado.
// Preserva a rota pretendida em state para redirect pós-login (futuro).
// =============================================================================

import * as React from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { useAuthStore } from '../lib/auth-store';

interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * Wrapper de rotas protegidas.
 * Uso: <Route element={<AuthGuard><AppLayout /></AuthGuard>}>
 */
export function AuthGuard({ children }: AuthGuardProps): React.JSX.Element {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const location = useLocation();

  if (!isAuthenticated) {
    // Guarda a rota pretendida para redirect pós-login (F1-S09+)
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
