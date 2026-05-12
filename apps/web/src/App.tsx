// =============================================================================
// App.tsx — Roteador raiz e providers de infraestrutura.
//
// Estrutura de rotas:
//   /login          → público
//   /               → protegido (AuthGuard > AppLayout > DashboardPage)
//   /leads etc.     → protegido (placeholder)
//   *               → redireciona /login
//
// QueryClient: staleTime 30s, sem refetchOnWindowFocus, retry 1x.
// =============================================================================

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AppLayout } from './app/AppLayout';
import { AuthGuard } from './app/AuthGuard';
import { LoginPage } from './features/auth/LoginPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { FeatureFlagsPage } from './pages/admin/FeatureFlags';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Placeholder genérico para rotas ainda não implementadas
function PlaceholderPage({ title }: { title: string }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <h1
        className="font-display font-bold text-ink"
        style={{ fontSize: 'var(--text-3xl)', letterSpacing: '-0.03em' }}
      >
        {title}
      </h1>
      <p className="font-sans text-sm text-ink-3">Em breve.</p>
    </div>
  );
}

export function App(): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/* ── Pública ─────────────────────────────────────────────────── */}
          <Route path="/login" element={<LoginPage />} />

          {/* ── Protegidas (AuthGuard > AppLayout) ──────────────────────── */}
          <Route
            element={
              <AuthGuard>
                <AppLayout />
              </AuthGuard>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="/leads" element={<PlaceholderPage title="Leads" />} />
            <Route path="/analise" element={<PlaceholderPage title="Análise" />} />
            <Route path="/contratos" element={<PlaceholderPage title="Contratos" />} />
            <Route path="/relatorios" element={<PlaceholderPage title="Relatórios" />} />
            <Route path="/configuracoes" element={<PlaceholderPage title="Configurações" />} />
            <Route path="/admin/feature-flags" element={<FeatureFlagsPage />} />
          </Route>

          {/* ── Catch-all ────────────────────────────────────────────────── */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
