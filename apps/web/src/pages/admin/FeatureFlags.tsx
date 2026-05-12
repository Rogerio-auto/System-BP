// =============================================================================
// pages/admin/FeatureFlags.tsx — Tela de administração de feature flags.
//
// Design System: light-first, tokens canônicos (docs/18-design-system.md).
//   - Tipografia: Bricolage Grotesque (headers), Geist (body), JetBrains Mono (keys).
//   - Cores: --brand-azul, --brand-verde, bandeira de Rondônia.
//   - Profundidade: elev-1 (cards), elev-2 (panel).
//
// Funcionalidades:
//   - Tabela com filtro por status (enabled/disabled/internal_only).
//   - Toggle inline via PATCH /api/admin/feature-flags/:key.
//   - Invalidação do cache TanStack Query após toggle (reflète em ≤ 30s).
//   - Badge visual por status.
//   - Apenas usuários com permissão 'flags:manage' chegam aqui (RBAC via route).
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import type { FeatureFlagStatus } from '../../hooks/useFeatureFlag';
import { FEATURE_FLAGS_QUERY_KEY } from '../../hooks/useFeatureFlag';
import { api } from '../../lib/api';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface FeatureFlagDto {
  key: string;
  status: FeatureFlagStatus;
  visible: boolean;
  ui_label: string | null;
  description: string | null;
  audience: { roles?: string[]; city_ids?: string[] };
  updated_by: string | null;
  updated_at: string;
  created_at: string;
}

type StatusFilter = 'all' | FeatureFlagStatus;

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const ADMIN_FLAGS_QUERY_KEY = ['feature-flags', 'admin', 'list'] as const;

async function fetchAdminFlags(): Promise<FeatureFlagDto[]> {
  return api.get<FeatureFlagDto[]>('/api/admin/feature-flags');
}

async function patchFlag(key: string, status: FeatureFlagStatus): Promise<FeatureFlagDto> {
  return api.patch<FeatureFlagDto>(`/api/admin/feature-flags/${encodeURIComponent(key)}`, {
    status,
  });
}

// ---------------------------------------------------------------------------
// Status Badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: FeatureFlagStatus }): React.JSX.Element {
  const config: Record<FeatureFlagStatus, { label: string; bg: string; text: string }> = {
    enabled: {
      label: 'Habilitado',
      bg: 'var(--success-bg)',
      text: 'var(--success)',
    },
    disabled: {
      label: 'Desabilitado',
      bg: 'var(--danger-bg)',
      text: 'var(--danger)',
    },
    internal_only: {
      label: 'Interno',
      bg: 'var(--info-bg)',
      text: 'var(--info)',
    },
  };

  const { label, bg, text } = config[status];

  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 font-sans text-xs font-medium"
      style={{ backgroundColor: bg, color: text }}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Toggle Button
// ---------------------------------------------------------------------------

interface ToggleButtonProps {
  flagKey: string;
  currentStatus: FeatureFlagStatus;

  onToggle: (flagKey: string, status: FeatureFlagStatus) => void;
  isPending: boolean;
}

function ToggleButton({
  flagKey,
  currentStatus,
  onToggle,
  isPending,
}: ToggleButtonProps): React.JSX.Element {
  const isEnabled = currentStatus === 'enabled';

  function handleClick(): void {
    const nextStatus: FeatureFlagStatus = isEnabled ? 'disabled' : 'enabled';
    onToggle(flagKey, nextStatus);
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isEnabled}
      aria-label={`Toggle flag ${flagKey}`}
      disabled={isPending}
      onClick={handleClick}
      className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        backgroundColor: isEnabled ? 'var(--brand-azul)' : 'var(--surface-muted)',
        transitionDuration: 'var(--dur-fast)',
        transitionTimingFunction: 'var(--ease)',
      }}
    >
      <span
        className="pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
        style={{
          transform: isEnabled ? 'translateX(16px)' : 'translateX(0)',
          transitionDuration: 'var(--dur-fast)',
          transitionTimingFunction: 'var(--ease)',
          boxShadow: 'var(--elev-1)',
        }}
        aria-hidden="true"
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Filter Tabs
// ---------------------------------------------------------------------------

interface FilterTabsProps {
  current: StatusFilter;
  counts: Record<StatusFilter, number>;

  onChange: (filter: StatusFilter) => void;
}

function FilterTabs({ current, counts, onChange }: FilterTabsProps): React.JSX.Element {
  const tabs: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'Todas' },
    { value: 'enabled', label: 'Habilitadas' },
    { value: 'disabled', label: 'Desabilitadas' },
    { value: 'internal_only', label: 'Interno' },
  ];

  return (
    <div className="flex gap-1 p-1 rounded-md" style={{ backgroundColor: 'var(--bg-inset)' }}>
      {tabs.map((tab) => {
        const isActive = current === tab.value;
        return (
          <button
            key={tab.value}
            type="button"
            onClick={() => onChange(tab.value)}
            className="flex items-center gap-1.5 rounded px-3 py-1.5 font-sans text-sm font-medium transition-all"
            style={{
              backgroundColor: isActive ? 'var(--bg-elev-1)' : 'transparent',
              color: isActive ? 'var(--text)' : 'var(--text-3)',
              boxShadow: isActive ? 'var(--elev-1)' : 'none',
              transitionDuration: 'var(--dur-fast)',
              transitionTimingFunction: 'var(--ease)',
            }}
          >
            {tab.label}
            <span
              className="rounded-full px-1.5 py-0.5 font-mono text-xs"
              style={{
                backgroundColor: isActive ? 'var(--surface-muted)' : 'transparent',
                color: isActive ? 'var(--text-2)' : 'var(--text-4)',
              }}
            >
              {counts[tab.value]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FeatureFlags Page
// ---------------------------------------------------------------------------

/**
 * Tela de administração de feature flags.
 * Requer permissão 'flags:manage' (verificada no backend + rota protegida).
 */
export function FeatureFlagsPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [filter, setFilter] = React.useState<StatusFilter>('all');

  // Query: lista admin
  const {
    data: flags = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ADMIN_FLAGS_QUERY_KEY,
    queryFn: fetchAdminFlags,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  // Mutation: toggle
  const mutation = useMutation({
    mutationFn: ({ key, status }: { key: string; status: FeatureFlagStatus }) =>
      patchFlag(key, status),
    onSuccess: () => {
      // Invalida tanto a lista admin quanto o mapa /me do usuário
      void queryClient.invalidateQueries({ queryKey: ADMIN_FLAGS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
    },
  });

  function handleToggle(key: string, nextStatus: FeatureFlagStatus): void {
    mutation.mutate({ key, status: nextStatus });
  }

  // Contagens para as tabs
  const counts: Record<StatusFilter, number> = {
    all: flags.length,
    enabled: flags.filter((f) => f.status === 'enabled').length,
    disabled: flags.filter((f) => f.status === 'disabled').length,
    internal_only: flags.filter((f) => f.status === 'internal_only').length,
  };

  // Filtrar flags
  const visibleFlags = filter === 'all' ? flags : flags.filter((f) => f.status === filter);

  return (
    <div className="flex flex-col gap-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h1
            className="font-display font-bold text-ink"
            style={{
              fontSize: 'var(--text-3xl)',
              letterSpacing: '-0.03em',
              fontVariationSettings: "'opsz' 48",
            }}
          >
            Feature Flags
          </h1>
          <p className="font-sans text-sm mt-1" style={{ color: 'var(--text-3)' }}>
            Controle real em 4 camadas: UI, API, workers e tools de IA.
          </p>
        </div>

        {mutation.isError && (
          <div
            role="alert"
            className="rounded-md px-4 py-2 font-sans text-sm"
            style={{
              backgroundColor: 'var(--danger-bg)',
              color: 'var(--danger)',
            }}
          >
            Erro ao salvar. Tente novamente.
          </div>
        )}
      </div>

      {/* ── Filter Tabs ─────────────────────────────────────────────────── */}
      <FilterTabs current={filter} counts={counts} onChange={setFilter} />

      {/* ── Tabela ──────────────────────────────────────────────────────── */}
      <div
        className="rounded-lg border overflow-hidden"
        style={{
          borderColor: 'var(--border)',
          boxShadow: 'var(--elev-2)',
          backgroundColor: 'var(--bg-elev-1)',
        }}
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <p className="font-sans text-sm" style={{ color: 'var(--text-3)' }}>
              Carregando flags…
            </p>
          </div>
        ) : isError ? (
          <div className="flex items-center justify-center py-16">
            <p className="font-sans text-sm" style={{ color: 'var(--danger)' }}>
              Erro ao carregar feature flags.
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: `1px solid var(--border-subtle)` }}>
                <th
                  className="px-5 py-3 text-left font-sans text-xs font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--text-3)' }}
                >
                  Chave
                </th>
                <th
                  className="px-5 py-3 text-left font-sans text-xs font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--text-3)' }}
                >
                  Descrição
                </th>
                <th
                  className="px-5 py-3 text-left font-sans text-xs font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--text-3)' }}
                >
                  Status
                </th>
                <th
                  className="px-5 py-3 text-left font-sans text-xs font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--text-3)' }}
                >
                  Visível na UI
                </th>
                <th
                  className="px-5 py-3 text-left font-sans text-xs font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--text-3)' }}
                >
                  Toggle
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleFlags.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center">
                    <p className="font-sans text-sm" style={{ color: 'var(--text-3)' }}>
                      Nenhuma flag encontrada para este filtro.
                    </p>
                  </td>
                </tr>
              ) : (
                visibleFlags.map((flag, index) => (
                  <tr
                    key={flag.key}
                    style={{
                      borderBottom:
                        index < visibleFlags.length - 1 ? `1px solid var(--border-subtle)` : 'none',
                      backgroundColor:
                        mutation.isPending && mutation.variables?.key === flag.key
                          ? 'var(--surface-hover)'
                          : 'transparent',
                      transition: `background-color var(--dur-fast) var(--ease)`,
                    }}
                  >
                    {/* Key */}
                    <td className="px-5 py-4">
                      <code
                        className="font-mono text-sm"
                        style={{
                          color: 'var(--brand-azul)',
                          fontSize: 'var(--text-xs)',
                        }}
                      >
                        {flag.key}
                      </code>
                    </td>

                    {/* Description */}
                    <td className="px-5 py-4">
                      <div>
                        <p className="font-sans text-sm" style={{ color: 'var(--text)' }}>
                          {flag.description ?? '—'}
                        </p>
                        {flag.ui_label !== null && (
                          <p
                            className="font-sans text-xs mt-0.5"
                            style={{ color: 'var(--text-3)' }}
                          >
                            Badge: &quot;{flag.ui_label}&quot;
                          </p>
                        )}
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-5 py-4">
                      <StatusBadge status={flag.status} />
                    </td>

                    {/* Visible */}
                    <td className="px-5 py-4">
                      <span
                        className="font-sans text-sm"
                        style={{ color: flag.visible ? 'var(--success)' : 'var(--text-4)' }}
                      >
                        {flag.visible ? 'Sim' : 'Não'}
                      </span>
                    </td>

                    {/* Toggle */}
                    <td className="px-5 py-4">
                      <ToggleButton
                        flagKey={flag.key}
                        currentStatus={flag.status}
                        onToggle={handleToggle}
                        isPending={mutation.isPending && mutation.variables?.key === flag.key}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Footer info ─────────────────────────────────────────────────── */}
      <p className="font-sans text-xs" style={{ color: 'var(--text-4)' }}>
        Cache client: 30s — alterações refletem em até 30s para todos os usuários.
      </p>
    </div>
  );
}
