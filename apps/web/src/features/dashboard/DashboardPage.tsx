// =============================================================================
// features/dashboard/DashboardPage.tsx — Placeholder do dashboard.
//
// Conteúdo real será implementado em F1-S10+.
// Este arquivo existe para que o roteador protegido tenha algo para renderizar
// após o login e a validação possa ser feita no navegador.
// =============================================================================

import * as React from 'react';

import { useAuth } from '../auth/useAuth';

/**
 * Dashboard placeholder.
 * Mostra um card de boas-vindas com o nome do usuário logado.
 * Conteúdo real em slot futuro.
 */
export function DashboardPage(): React.JSX.Element {
  const { user } = useAuth();

  return (
    <div className="flex flex-col gap-6">
      {/* Header da página */}
      <div>
        <h1
          className="font-display font-bold text-ink"
          style={{
            fontSize: 'var(--text-3xl)',
            letterSpacing: '-0.03em',
            fontVariationSettings: "'opsz' 48",
          }}
        >
          Dashboard
        </h1>
        <p className="font-sans text-sm text-ink-3 mt-1">
          Bem-vindo, {user?.fullName ?? 'Agente'}.
        </p>
      </div>

      {/* Card placeholder */}
      <div
        className="rounded-md border border-border bg-surface-1 p-6"
        style={{ boxShadow: 'var(--elev-2)' }}
      >
        <p className="font-sans text-sm text-ink-2">
          O dashboard completo será implementado em releases futuros. O sistema de autenticação,
          refresh transparente e layout autenticado estão ativos.
        </p>
      </div>
    </div>
  );
}
