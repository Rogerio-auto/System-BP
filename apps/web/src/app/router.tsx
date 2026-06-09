// =============================================================================
// app/router.tsx — Rotas adicionadas em F4-S03 (credit-analyses).
//
// Importadas em App.tsx e inseridas dentro do elemento AuthGuard > AppLayout.
// Rotas:
//   /credit-analyses              → CreditAnalysesListPage
//   /credit-analyses/:id          → CreditAnalysisDetailPage
//   /admin/billing/dues           → PaymentDuesPage
//   /admin/billing/rules          → CollectionRulesPage
//   /admin/billing/jobs           → CollectionJobsPage
// =============================================================================

import * as React from 'react';
import { Route } from 'react-router-dom';

import { CollectionJobsPage, CollectionRulesPage, PaymentDuesPage } from '../features/billing';
import { CreditAnalysesListPage, CreditAnalysisDetailPage } from '../features/credit-analyses';
import { TemplateDetailPage, TemplateFormPage, TemplatesListPage } from '../features/templates';
import { TutoriaisPage } from '../pages/admin/Tutoriais';

/**
 * Rotas do módulo de análise de crédito.
 * Inserir dentro de <Routes> protegidas (AuthGuard > AppLayout).
 */
export function CreditAnalysisRoutes(): React.JSX.Element {
  return (
    <>
      <Route path="/credit-analyses" element={<CreditAnalysesListPage />} />
      <Route path="/credit-analyses/:id" element={<CreditAnalysisDetailPage />} />
    </>
  );
}

/**
 * Rotas do módulo de templates WhatsApp (F5-S09).
 * Inserir dentro de <Routes> protegidas (AuthGuard > AppLayout).
 *
 * NOTA: F5-S05 também adiciona rotas a router.tsx.
 * Adicionar apenas estas rotas, sem reorganizar as existentes.
 */
export function TemplateRoutes(): React.JSX.Element {
  return (
    <>
      <Route path="/admin/templates" element={<TemplatesListPage />} />
      <Route path="/admin/templates/new" element={<TemplateFormPage />} />
      <Route path="/admin/templates/:id" element={<TemplateDetailPage />} />
    </>
  );
}

/**
 * Rotas do módulo de cobrança (F5-S08).
 * Inserir dentro de <Routes> protegidas (AuthGuard > AppLayout).
 *
 * Permissão mínima: billing:read (checada internamente pelos stores).
 */
export function BillingRoutes(): React.JSX.Element {
  return (
    <>
      <Route path="/admin/billing/dues" element={<PaymentDuesPage />} />
      <Route path="/admin/billing/rules" element={<CollectionRulesPage />} />
      <Route path="/admin/billing/jobs" element={<CollectionJobsPage />} />
    </>
  );
}

/**
 * Rotas do módulo de tutoriais em vídeo (F12-S05).
 * Inserir dentro de <Routes> protegidas (AuthGuard > AppLayout).
 *
 * Permissão mínima: tutorials:manage (checada internamente pelo componente).
 */
export function TutoriaisRoutes(): React.JSX.Element {
  return (
    <>
      <Route path="/admin/tutoriais" element={<TutoriaisPage />} />
    </>
  );
}
