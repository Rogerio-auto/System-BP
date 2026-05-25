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
