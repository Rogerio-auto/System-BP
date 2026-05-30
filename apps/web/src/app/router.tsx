// =============================================================================
// app/router.tsx — Rotas adicionadas em F4-S03 (credit-analyses).
//
// Importadas em App.tsx e inseridas dentro do elemento AuthGuard > AppLayout.
// Rotas:
//   /credit-analyses       → CreditAnalysesListPage
//   /credit-analyses/:id   → CreditAnalysisDetailPage
// =============================================================================

import * as React from 'react';
import { Route } from 'react-router-dom';

import { CreditAnalysesListPage, CreditAnalysisDetailPage } from '../features/credit-analyses';
import { TemplateDetailPage, TemplateFormPage, TemplatesListPage } from '../features/templates';

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
