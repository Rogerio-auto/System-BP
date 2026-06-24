// =============================================================================
// features/relatorios/hooks/useReportFilters.ts — Estado dos filtros de
// relatórios serializado na URL (F23-S06).
//
// Estado serializado em searchParams para deep-link e reload-safe:
//   ?range=last30d&scope=global&cityIds=uuid1,uuid2&compareWithPrevious=true
//
// Defaults:
//   range: 'last30d'
//   scope: inferido do papel (self → agente; city → 1 cidade; global → admin/gestor_geral)
//   cityIds: []
//   compareWithPrevious: false
// =============================================================================

import type { ReportRange, ReportScope } from '@elemento/shared-schemas';
import * as React from 'react';
import { useSearchParams } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface ReportFilters {
  range: ReportRange;
  scope: ReportScope;
  cityIds: string[];
  agentIds: string[];
  compareWithPrevious: boolean;
}

export interface ReportFiltersActions {
  setRange: (range: ReportRange) => void;
  setScope: (scope: ReportScope) => void;
  setCityIds: (ids: string[]) => void;
  setAgentIds: (ids: string[]) => void;
  setCompareWithPrevious: (v: boolean) => void;
}

// ---------------------------------------------------------------------------
// Valores válidos para validação de input vindo da URL
// ---------------------------------------------------------------------------

const VALID_RANGES = new Set<ReportRange>([
  'today',
  'last7d',
  'last30d',
  'last90d',
  'thisMonth',
  'lastMonth',
  'custom',
]);

const VALID_SCOPES = new Set<ReportScope>(['global', 'city', 'self']);

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Gerencia os filtros do módulo de relatórios na URL.
 * O defaultScope deve ser calculado pelo caller com base no papel do usuário.
 */
export function useReportFilters(
  defaultScope: ReportScope = 'self',
): ReportFilters & ReportFiltersActions {
  const [params, setParams] = useSearchParams();

  // ── Leitura (com validação defensiva dos valores da URL) ─────────────────

  const range = ((): ReportRange => {
    const v = params.get('range');
    if (v && VALID_RANGES.has(v as ReportRange)) return v as ReportRange;
    return 'last30d';
  })();

  const scope = ((): ReportScope => {
    const v = params.get('scope');
    if (v && VALID_SCOPES.has(v as ReportScope)) return v as ReportScope;
    return defaultScope;
  })();

  const cityIds = ((): string[] => {
    // Aceita formato: cityIds=uuid1&cityIds=uuid2 (repeat) ou cityIds=uuid1,uuid2 (comma)
    const repeated = params.getAll('cityIds');
    if (repeated.length > 0) return repeated.flatMap((v) => v.split(',').filter(Boolean));
    const single = params.get('cityIds');
    if (single) return single.split(',').filter(Boolean);
    return [];
  })();

  const agentIds = ((): string[] => {
    const repeated = params.getAll('agentIds');
    if (repeated.length > 0) return repeated.flatMap((v) => v.split(',').filter(Boolean));
    const single = params.get('agentIds');
    if (single) return single.split(',').filter(Boolean);
    return [];
  })();

  const compareWithPrevious = params.get('compareWithPrevious') === 'true';

  // ── Setters (atualizam a URL, preservam outros params) ───────────────────

  const setRange = React.useCallback(
    (next: ReportRange) => {
      setParams((prev) => {
        const next_params = new URLSearchParams(prev);
        next_params.set('range', next);
        return next_params;
      });
    },
    [setParams],
  );

  const setScope = React.useCallback(
    (next: ReportScope) => {
      setParams((prev) => {
        const next_params = new URLSearchParams(prev);
        next_params.set('scope', next);
        // Ao trocar scope, limpar cityIds/agentIds (podem não fazer sentido no novo scope)
        next_params.delete('cityIds');
        next_params.delete('agentIds');
        return next_params;
      });
    },
    [setParams],
  );

  const setCityIds = React.useCallback(
    (ids: string[]) => {
      setParams((prev) => {
        const next_params = new URLSearchParams(prev);
        next_params.delete('cityIds');
        for (const id of ids) next_params.append('cityIds', id);
        return next_params;
      });
    },
    [setParams],
  );

  const setAgentIds = React.useCallback(
    (ids: string[]) => {
      setParams((prev) => {
        const next_params = new URLSearchParams(prev);
        next_params.delete('agentIds');
        for (const id of ids) next_params.append('agentIds', id);
        return next_params;
      });
    },
    [setParams],
  );

  const setCompareWithPrevious = React.useCallback(
    (v: boolean) => {
      setParams((prev) => {
        const next_params = new URLSearchParams(prev);
        if (v) {
          next_params.set('compareWithPrevious', 'true');
        } else {
          next_params.delete('compareWithPrevious');
        }
        return next_params;
      });
    },
    [setParams],
  );

  return {
    range,
    scope,
    cityIds,
    agentIds,
    compareWithPrevious,
    setRange,
    setScope,
    setCityIds,
    setAgentIds,
    setCompareWithPrevious,
  };
}
