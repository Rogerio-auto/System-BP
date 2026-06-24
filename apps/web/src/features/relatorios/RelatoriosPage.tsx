// features/relatorios/RelatoriosPage.tsx -- Modulo de Relatorios (F23-S06/S07/S08/S10).
import type { CommonReportQuery, ReportScope } from '@elemento/shared-schemas';
import * as React from 'react';

import { useCitiesList } from '../../hooks/useCitiesList';
import { useAuth } from '../auth/useAuth';
import { ContextualHelp } from '../help/contextual';

import { AiSection } from './components/AiSection';
import { AttendanceSection } from './components/AttendanceSection';
import { AuditSection } from './components/AuditSection';
import { CollectionSection } from './components/CollectionSection';
import { CreditSection } from './components/CreditSection';
import { ExportButton } from './components/ExportButton';
import { FunnelSection } from './components/FunnelSection';
import { OverviewSection } from './components/OverviewSection';
import { ProductivitySection } from './components/ProductivitySection';
import { ReportFiltersBar } from './components/ReportFiltersBar';
import { useReportFilters } from './hooks/useReportFilters';
/**
 * Determina os escopos disponíveis para o scope toggle de /relatorios.
 *
 * Usa cityScopeIds (payload de auth) em vez de heurística por permissão:
 *   - dashboard:read + null (global): admin/gestor_geral → ['global', 'city']
 *   - dashboard:read + [] ou [...] (city-scoped): gestor_regional → ['city']
 *   - dashboard:read_by_agent (sem dashboard:read): agente → ['self']
 *
 * Regra: toggle só aparece com >1 escopo (ReportFiltersBar.showScopeToggle).
 */
function inferAvailableScopes(
  hasPermission: (p: string) => boolean,
  cityScopeIds: string[] | null,
): ReportScope[] {
  if (hasPermission('dashboard:read')) {
    // null = acesso global (admin/gestor_geral)
    if (cityScopeIds === null) return ['global', 'city'];
    // array (vazio ou com cidades) = city-scoped (gestor_regional/agente com dashboard:read)
    return ['city'];
  }
  return ['self'];
}

function inferDefaultScope(
  hasPermission: (p: string) => boolean,
  cityScopeIds: string[] | null,
): ReportScope {
  if (hasPermission('dashboard:read')) {
    if (cityScopeIds === null) return 'global';
    return 'city';
  }
  return 'self';
}
export function RelatoriosPage(): React.JSX.Element {
  const { hasPermission, user } = useAuth();
  const { cities } = useCitiesList();
  const cityScopeIds = user?.cityScopeIds ?? null;
  const availableScopes = inferAvailableScopes(hasPermission, cityScopeIds);
  const defaultScope = inferDefaultScope(hasPermission, cityScopeIds);
  const filters = useReportFilters(defaultScope);
  const canSeeAtendimentos =
    hasPermission('dashboard:read') || hasPermission('dashboard:read_by_agent');
  const canSeeCredito = hasPermission('dashboard:read') || hasPermission('billing:read');
  const canSeeProductividade =
    hasPermission('dashboard:read') || hasPermission('dashboard:read_by_agent');
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
        <ExportButton currentSection="overview" filters={filters} />
      </div>
      <ReportFiltersBar
        filters={filters}
        availableScopes={availableScopes}
        availableCities={cities}
        showAgentFilter={showAgentFilter}
        availableAgents={[]}
      />
      <section>
        <h2
          className="font-display font-bold text-ink mb-4"
          style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.02em' }}
        >
          Visao Geral
        </h2>
        <OverviewSection query={query} />
      </section>
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
      {canSeeCredito && (
        <section>
          <h2
            className="font-display font-bold text-ink mb-4"
            style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.02em' }}
          >
            Credito
          </h2>
          <CreditSection query={query} />
        </section>
      )}
      {canSeeCredito && (
        <section>
          <h2
            className="font-display font-bold text-ink mb-4"
            style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.02em' }}
          >
            Cobranca & Carteira
          </h2>
          <CollectionSection query={query} />
        </section>
      )}
      {canSeeProductividade && (
        <section>
          <h2
            className="font-display font-bold text-ink mb-4"
            style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.02em' }}
          >
            Produtividade
          </h2>
          <ProductivitySection query={query} />
        </section>
      )}
      {canSeeAuditoria && (
        <section>
          <h2
            className="font-display font-bold text-ink mb-4"
            style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.02em' }}
          >
            Auditoria & Operacao
          </h2>
          <AuditSection query={query} />
        </section>
      )}
    </div>
  );
}
