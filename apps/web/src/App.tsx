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
import { SessionBootstrap } from './app/SessionBootstrap';
import { ToastProvider } from './components/ui/Toast';
import { LoginPage } from './features/auth/LoginPage';
import { CollectionJobsPage, CollectionRulesPage, PaymentDuesPage } from './features/billing';
import {
  ConversationTimelinePage,
  DecisionsListPage,
  PlaygroundPage,
  PromptDetailPage,
  PromptsListPage,
} from './features/configuracoes/ai-console';
import { ConfiguracoesPage } from './features/configuracoes/ConfiguracoesPage';
import { CreditAnalysesListPage, CreditAnalysisDetailPage } from './features/credit-analyses';
import { CrmDetailPage } from './features/crm/CrmDetailPage';
import { CrmListPage } from './features/crm/CrmListPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { FollowupJobsPage, FollowupRulesPage } from './features/followup';
import { HelpMdxPreview } from './features/help/__demo__/HelpMdxPreview';
import { ImportWizardPage } from './features/imports/ImportWizardPage';
import { TemplateDetailPage, TemplateFormPage, TemplatesListPage } from './features/templates';
import { AgentsPage } from './pages/admin/Agents';
import { CitiesPage } from './pages/admin/Cities';
import { FeatureFlagsPage } from './pages/admin/FeatureFlags';
import { ProductDetailPage } from './pages/admin/ProductDetail';
import { ProductsPage } from './pages/admin/Products';
import { UsersPage } from './pages/admin/Users';
import { SimulatorPage } from './pages/simulator/SimulatorPage';

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
      <ToastProvider>
        <BrowserRouter>
          <SessionBootstrap>
            <AppRoutes />
          </SessionBootstrap>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function AppRoutes(): React.JSX.Element {
  return (
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
        {/* Legacy redirects — bookmarks antigos preservados */}
        <Route path="/kanban" element={<Navigate to="/crm?view=kanban" replace />} />
        <Route path="/leads" element={<Navigate to="/crm" replace />} />
        <Route path="/crm" element={<CrmListPage />} />
        <Route path="/crm/:id" element={<CrmDetailPage />} />
        <Route path="/imports/leads/new" element={<ImportWizardPage />} />
        <Route path="/simulator" element={<SimulatorPage />} />
        {/* Legacy redirect — /analise era placeholder; a rota real é /credit-analyses (F4-S03) */}
        <Route path="/analise" element={<Navigate to="/credit-analyses" replace />} />
        {/* F4-S03: Análise de crédito */}
        <Route path="/credit-analyses" element={<CreditAnalysesListPage />} />
        <Route path="/credit-analyses/:id" element={<CreditAnalysisDetailPage />} />
        <Route path="/contratos" element={<PlaceholderPage title="Contratos" />} />
        <Route path="/relatorios" element={<PlaceholderPage title="Relatórios" />} />
        <Route path="/configuracoes" element={<ConfiguracoesPage />} />
        <Route path="/configuracoes/ia/prompts" element={<PromptsListPage />} />
        <Route path="/configuracoes/ia/prompts/:key" element={<PromptDetailPage />} />
        <Route path="/configuracoes/ia/decisoes" element={<DecisionsListPage />} />
        <Route
          path="/configuracoes/ia/decisoes/conversa/:conversationId"
          element={<ConversationTimelinePage />}
        />
        <Route path="/configuracoes/ia/playground" element={<PlaygroundPage />} />
        <Route path="/admin/cities" element={<CitiesPage />} />
        <Route path="/admin/feature-flags" element={<FeatureFlagsPage />} />
        <Route path="/admin/products" element={<ProductsPage />} />
        <Route path="/admin/products/:id" element={<ProductDetailPage />} />
        <Route path="/admin/users" element={<UsersPage />} />
        <Route path="/admin/agents" element={<AgentsPage />} />
        {/* F5-S05: Follow-up — réguas e jobs */}
        <Route path="/admin/followup/rules" element={<FollowupRulesPage />} />
        <Route path="/admin/followup/jobs" element={<FollowupJobsPage />} />
        {/* F5-S08: Cobrança — parcelas, réguas, jobs */}
        <Route path="/admin/billing/dues" element={<PaymentDuesPage />} />
        <Route path="/admin/billing/rules" element={<CollectionRulesPage />} />
        <Route path="/admin/billing/jobs" element={<CollectionJobsPage />} />
        {/* F5-S09: Templates WhatsApp */}
        <Route path="/admin/templates" element={<TemplatesListPage />} />
        <Route path="/admin/templates/new" element={<TemplateFormPage />} />
        <Route path="/admin/templates/:id" element={<TemplateDetailPage />} />
        {/* F10-S01: smoke test do pipeline MDX — dev-only, removida em F10-S02 */}
        {import.meta.env.DEV && (
          <Route path="/_dev/help-mdx-preview" element={<HelpMdxPreview />} />
        )}
      </Route>

      {/* ── Catch-all ────────────────────────────────────────────────── */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
