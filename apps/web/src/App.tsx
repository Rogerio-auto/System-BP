// =============================================================================
// App.tsx — Roteador raiz e providers de infraestrutura.
//
// Estrutura de rotas:
//   /login          → público
//   /               → protegido (AuthGuard > AppLayout > DashboardPage)
//   /tarefas        → protegido (F15-S10: painel minhas tarefas)
//   /conversas      → protegido (F16-S15: inbox live chat — UI em S16/S17)
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
import { PersonalEmailModal } from './features/account/PersonalEmailModal';
import { usePersonalEmailGuard } from './features/account/usePersonalEmailGuard';
import { RolesPage } from './features/admin/roles/RolesPage';
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
import { ContractsPage } from './features/contracts';
import { CreditAnalysesListPage, CreditAnalysisDetailPage } from './features/credit-analyses';
import { CrmDetailPage } from './features/crm/CrmDetailPage';
import { CrmListPage } from './features/crm/CrmListPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { FollowupJobsPage, FollowupRulesPage } from './features/followup';
import { DocPage } from './features/help/DocPage';
import { HelpHomePage } from './features/help/HelpHomePage';
import { ImportWizardPage } from './features/imports/ImportWizardPage';
import { LawFirmsPage } from './features/law-firms/LawFirmsPage';
import { RelatoriosPage } from './features/relatorios/RelatoriosPage';
import { TasksPage } from './features/tasks';
import { TemplateDetailPage, TemplateFormPage, TemplatesListPage } from './features/templates';
import { ApiError } from './lib/api';
import { AgentsPage } from './pages/admin/Agents';
import { CanaisAdminPage } from './pages/admin/Canais';
import { CitiesPage } from './pages/admin/Cities';
import { FeatureFlagsPage } from './pages/admin/FeatureFlags';
import { ProductDetailPage } from './pages/admin/ProductDetail';
import { ProductsPage } from './pages/admin/Products';
import { TutoriaisPage } from './pages/admin/Tutoriais';
import { UsersPage } from './pages/admin/Users';
import { ConversasPage } from './pages/ConversasPage';
import { SimulatorPage } from './pages/simulator/SimulatorPage';

// Code-split: ApiReferencePage não está no main bundle — só carregado quando
// o usuário acessa /ajuda/api. Economiza ~15-20 KB gzipped no main chunk.
const ApiReferencePage = React.lazy(() =>
  import('./features/help/api-reference/ApiReferencePage').then((m) => ({
    default: m.ApiReferencePage,
  })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Não retentar erros 4xx (rate-limit/permissão/validação) — retentar no
      // 429 amplificava o refetch storm. Só retenta falhas de rede/5xx (1x).
      retry: (failureCount, error) => {
        const status = error instanceof ApiError ? error.status : undefined;
        if (status !== undefined && status >= 400 && status < 500) return false;
        return failureCount < 1;
      },
    },
  },
});

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

/**
 * Guard de 1º login — exibe o modal bloqueante de email pessoal quando necessário.
 *
 * Renderizado DENTRO do AppRoutes para ter acesso ao QueryClient e ao
 * estado de autenticação. O modal sobrepõe toda a UI via position:fixed z-50,
 * então não importa qual rota está ativa — o agente não consegue interagir.
 *
 * F14-S04 D3: fluxo obrigatório antes de qualquer uso do sistema.
 */
function PersonalEmailGuard(): React.JSX.Element | null {
  const { requiresPersonalEmail, refetch } = usePersonalEmailGuard();

  if (!requiresPersonalEmail) return null;

  return (
    <PersonalEmailModal
      onSuccess={() => {
        // Revalida o perfil — após o cadastro, requiresPersonalEmail deve ser false
        refetch();
      }}
    />
  );
}

function AppRoutes(): React.JSX.Element {
  return (
    <>
      {/* Guard de 1º login — sobrepõe toda a UI quando necessário (F14-S04) */}
      <PersonalEmailGuard />
      <Routes>
        {/* ── Pública ────────────────────────────────────────────────────────── */}
        <Route path="/login" element={<LoginPage />} />

        {/* ── Protegidas (AuthGuard > AppLayout) ───────────────────────────── */}
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
          <Route path="/contratos" element={<ContractsPage />} />
          <Route path="/relatorios" element={<RelatoriosPage />} />
          <Route path="/configuracoes" element={<ConfiguracoesPage />} />
          <Route path="/configuracoes/advocacia" element={<LawFirmsPage />} />
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
          <Route path="/admin/papeis" element={<RolesPage />} />
          <Route path="/admin/agents" element={<AgentsPage />} />
          {/* Canais de mensagem (WhatsApp Business) */}
          <Route path="/admin/canais" element={<CanaisAdminPage />} />
          {/* F12-S10: Tutoriais em vídeo */}
          <Route path="/admin/tutoriais" element={<TutoriaisPage />} />
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
          {/* F16-S16: Inbox live chat — layout 3 colunas + ChatList */}
          <Route path="/conversas" element={<ConversasPage />} />
          {/* F15-S10: Painel de tarefas */}
          <Route path="/tarefas" element={<TasksPage />} />
          {/* F10-S02: Central de Ajuda */}
          <Route path="/ajuda" element={<HelpHomePage />} />
          {/* F10-S10: API Reference — ANTES do wildcard /ajuda/* */}
          <Route
            path="/ajuda/api/:resource?"
            element={
              <React.Suspense fallback={null}>
                <ApiReferencePage />
              </React.Suspense>
            }
          />
          <Route path="/ajuda/*" element={<DocPage />} />
        </Route>

        {/* ── Catch-all ────────────────────────────────────────────────────── */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </>
  );
}
