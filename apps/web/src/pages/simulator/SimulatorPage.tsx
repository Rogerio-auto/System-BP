// =============================================================================
// pages/simulator/SimulatorPage.tsx — Página /simulator (F2-S06).
//
// Layout 2 colunas (desktop), empilhado (mobile).
// AuthGuard via rota. Feature flag: credit_simulation.enabled.
// Se flag off: retorna 404 client-side (Navigate /404 não existe → catch-all /login,
// mas aqui usamos banner explícito + mensagem acessível).
//
// Fluxo:
//   1. useFeatureFlag('credit_simulation.enabled') → se off, mostra banner desativado.
//   2. SimulatorForm coleta lead + produto + valor + prazo.
//   3. useSimulate().mutate → POST /api/simulations.
//   4. SimulatorResult exibe estatísticas + tabela de amortização.
//   5. "Nova simulação" reseta result mas mantém o lead selecionado.
// =============================================================================

import * as React from 'react';
import { Navigate } from 'react-router-dom';

import { SimulatorForm } from '../../features/simulator/SimulatorForm';
import { SimulatorResult } from '../../features/simulator/SimulatorResult';
import type { LeadResponse } from '../../hooks/crm/types';
import type { SimulationBody } from '../../hooks/simulator/types';
import { useSimulate } from '../../hooks/simulator/useSimulate';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';

// ─── Componente ──────────────────────────────────────────────────────────────

/**
 * Página /simulator.
 * Protegida por AuthGuard na rota. Feature flag guard interno.
 */
export function SimulatorPage(): React.JSX.Element {
  const { enabled: flagEnabled, isLoading: flagLoading } = useFeatureFlag(
    'credit_simulation.enabled',
  );

  const { mutate, isPending, data, simulationError, reset } = useSimulate();

  // Lead selecionado — mantido entre "Nova simulação" para UX
  const [selectedLead, setSelectedLead] = React.useState<LeadResponse | null>(null);

  function handleSubmit(body: SimulationBody) {
    mutate(body);
  }

  function handleReset() {
    reset(); // limpa mutation state (data + error), mantém selectedLead
  }

  // Aguarda feature flag resolver (evita flash de "desativado" em usuários com acesso)
  if (flagLoading) {
    return (
      <div
        className="flex items-center justify-center min-h-[320px]"
        role="status"
        aria-label="Carregando…"
      >
        <div className="w-6 h-6 rounded-full border-2 border-border-strong border-t-azul animate-spin" />
      </div>
    );
  }

  // Feature flag desativada → 404 client-side via Navigate catch-all
  if (!flagEnabled) {
    return <Navigate to="/404" replace />;
  }

  return (
    <div
      className="flex flex-col gap-6"
      style={{ animation: 'fade-up var(--dur-slow) var(--ease-out)' }}
    >
      {/* Page header */}
      <div>
        <h1
          className="font-display font-bold text-ink leading-tight"
          style={{
            fontSize: 'var(--text-3xl)',
            letterSpacing: '-0.04em',
            fontVariationSettings: "'opsz' 36",
          }}
        >
          Simulador de crédito
        </h1>
        <p className="font-sans text-sm text-ink-3 mt-1">
          Calcule parcela, total e tabela de amortização antes de formalizar.
        </p>
      </div>

      {/* Layout 2 colunas */}
      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-5 items-start">
        {/* Coluna esquerda — Form (sticky no desktop) */}
        <SimulatorForm
          isPending={isPending}
          simulationError={simulationError}
          onSubmit={handleSubmit}
          onLeadChange={setSelectedLead}
        />

        {/* Coluna direita — Resultado */}
        <div className="min-h-[320px]">
          <SimulatorResult
            isPending={isPending}
            result={data}
            simulationError={simulationError}
            leadId={selectedLead?.id ?? null}
            onReset={handleReset}
          />
        </div>
      </div>
    </div>
  );
}
