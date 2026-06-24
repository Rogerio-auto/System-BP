// =============================================================================
// features/relatorios/RelatoriosPage.tsx -- Modulo de Relatorios (F23-S06/S07).
//
// Secoes (F23-S06 entrega Visao Geral; S07 entrega Atendimentos/IA/Funil; S08 o restante):
//   - Visao Geral:            sempre (autenticado)
//   - Atendimentos & IA:      dashboard:read OU dashboard:read_by_agent
//   - Funil & CRM:            dashboard:read OU dashboard:read_by_agent
//   - Credito & Cobranca:     dashboard:read OU billing:read               (S08)
//   - Auditoria & Operacao:   audit:read                                   (S08)
// =============================================================================

import type { CommonReportQuery, ReportScope } from '@elemento/shared-schemas';
import * as React from 'react';

import { useCitiesList } from '../../hooks/useCitiesList';
import { useAuth } from '../auth/useAuth';
import { ContextualHelp } from '../help/contextual';

import { AiSection } from './components/AiSection';
import { AttendanceSection } from './components/AttendanceSection';
import { FunnelSection } from './components/FunnelSection';
import { OverviewSection } from './components/OverviewSection';
import { ReportFiltersBar } from './components/ReportFiltersBar';
import { useReportFilters } from './hooks/useReportFilters';

// ---------------------------------------------------------------------------
// Helpers de papel -> scope disponivel
// ---------------------------------------------------------------------------

function inferAvailableScopes(hasPermission: (p: string) => boolean): ReportScope[] {
  if (hasPermission('audit:read')) return ['global', 'city'];
  if (hasPermission('dashboard:read')) return ['city', 'self'];
  return ['self'];
}

function inferDefaultScope(hasPermission: (p: string) => boolean): ReportScope {
  if (hasPermission('audit:read')) return 'global';
  if (hasPermission('dashboard:read')) return 'city';
  return 'self';
}

// ---------------------------------------------------------------------------
// Placeholder para secoes futuras (S08)
// ---------------------------------------------------------------------------

function SectionPlaceholder({ title }: { title: string }): React.JSX.Element {
  return (
    <section>
      <h2
        className="font-display font-bold text-ink mb-3"
        style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.02em' }}
      >
        {title}
      </h2>
      <div
        className="flex items-center justify-center rounded-md border border-dashed px-6 py-10"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <p className="font-sans text-sm text-ink-3">Disponivel em breve.</p>
      </div>
    </section>
  );
}
// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

/**
 * Shell do modulo de Relatorios.
 * Monta secoes por hasPermission; filtros na URL (deep-link + reload-safe).
 */
export function RelatoriosPage(): React.JSX.Element {
  const { hasPermission } = useAuth();
  const { cities } = useCitiesList();

  const availableScopes = inferAvailableScopes(hasPermission);
  const defaultScope = inferDefaultScope(hasPermission);
  const filters = useReportFilters(defaultScope);

  const canSeeAtendimentos =
    hasPermission('dashboard:read') || hasPermission('dashboard:read_by_agent');
  const canSeeCredito = hasPermission('dashboard:read') || hasPermission('billing:read');
  const canSeeAuditoria = hasPermission('audit:read');
  const showAgentFilter = hasPermission('dashboard:read_by_agent');

  const query: Partial<CommonReportQuery> = {
    range: filters.range,
    cityIds: filters.cityIds.length > 0 ? filters.cityIds : undefined,
    agentIds: filters.agentIds.length > 0 ? filters.agentIds : undefined,
    compareWithPrevious: filters.compareWithPrevious,
  };

  return (
    <div
      className="flex flex-col gap-6"
      style={{
        animation:
          'fade-up var(--dur-slow, 400ms) var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both',
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1
            className="font-display font-bold text-ink"
            style={{
              fontSize: 'var(--text-3xl)',
              letterSpacing: '-0.04em',
              fontVariationSettings: "'opsz' 48",
            }}
          >
            Relatorios
          </h1>
          <p className="font-sans text-sm text-ink-3 mt-1">
            Indicadores operacionais e de desempenho
          </p>
        </div>
        <ContextualHelp featureKey="relatorios.overview" />
      </div>

      {/* Filtros adaptativos */}
      <ReportFiltersBar
        filters={filters}
        availableScopes={availableScopes}
        availableCities={cities}
        showAgentFilter={showAgentFilter}
        availableAgents={[]}
      />

      {/* Visao Geral */}
      <section>
        <h2
          className="font-display font-bold text-ink mb-4"
          style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.02em' }}
        >
          Visao Geral
        </h2>
        <OverviewSection query={query} />
      </section>

      {/* Atendimentos & Conversas (S07) */}
      {canSeeAtendimentos && (
        <section>
          <h2
            className="font-display font-bold text-ink mb-4"
            style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.02em' }}
          >
            Atendimentos & Conversas
          </h2>
          <AttendanceSection query={query} />
        </section>
      )}

      {/* IA / Pre-atendimento (S07) -- AiSection retorna null quando forbidden (403), sem quebrar a pagina */}
      {canSeeAtendimentos && (
        <section>
          <h2
            className="font-display font-bold text-ink mb-4"
            style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.02em' }}
          >
            IA / Pre-atendimento
          </h2>
          <AiSection query={query} />
        </section>
      )}

      {/* Funil & CRM (S07) */}
      {canSeeAtendimentos && (
        <section>
          <h2
            className="font-display font-bold text-ink mb-4"
            style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.02em' }}
          >
            Funil & CRM
          </h2>
          <FunnelSection query={query} />
        </section>
      )}

      {/* Credito & Cobranca (S08) */}
      {canSeeCredito && <SectionPlaceholder title="Credito & Cobranca" />}

      {/* Auditoria & Operacao (S08) */}
      {canSeeAuditoria && <SectionPlaceholder title="Auditoria & Operacao" />}
    </div>
  );
}
