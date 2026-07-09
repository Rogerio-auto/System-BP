// =============================================================================
// pages/admin/Notificacoes.tsx — /admin/notificacoes (F24-S10 / F24-S11).
//
// Página de administração de regras de notificação.
//
// Layout:
//   - Header editorial (Bricolage) + descrição (Geist)
//   - Barra de filtros: busca por nome/gatilho, filtro por status
//   - RuleList: tabela densa DS §9.7
//   - RuleDrawer: drawer criar/editar regra (F24-S11)
//
// RBAC: notifications:manage (backend valida; API retorna 403 sem permissão).
// DS: profundidade elev-1 nos cards, hover de linha no table, tokens canônicos.
// =============================================================================
import * as React from 'react';

import type { ListRulesParams } from '../../features/admin/notification-rules/api';
import { useNotificationRules } from '../../features/admin/notification-rules/hooks';
import { RuleDrawer } from '../../features/admin/notification-rules/RuleDrawer';
import { RuleList } from '../../features/admin/notification-rules/RuleList';
import { cn } from '../../lib/cn';

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

/**
 * Página de gestão de regras de notificação (/admin/notificacoes).
 * RBAC: notifications:manage (verificado pelo backend em cada request).
 */
export function NotificacoesPage(): React.JSX.Element {
  const [search, setSearch] = React.useState('');
  const [searchDebounced, setSearchDebounced] = React.useState('');
  const [enabledFilter, setEnabledFilter] = React.useState<'all' | 'true' | 'false'>('all');
  const [page] = React.useState(1);

  // Estado do drawer
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [editRuleId, setEditRuleId] = React.useState<string | undefined>(undefined);

  // Debounce da busca — 300ms
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = React.useCallback((value: string): void => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchDebounced(value);
    }, 300);
  }, []);

  React.useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const enabledParam =
    enabledFilter === 'true' ? true : enabledFilter === 'false' ? false : undefined;

  // Build params without undefined properties (exactOptionalPropertyTypes: true)
  const queryParams: ListRulesParams = { page, per_page: 50 };
  if (searchDebounced.length > 0) queryParams.search = searchDebounced;
  if (enabledParam !== undefined) queryParams.enabled = enabledParam;

  const { data, isLoading, isError, refetch } = useNotificationRules(queryParams);

  const rules = data?.data ?? [];

  const handleNewRule = React.useCallback((): void => {
    setEditRuleId(undefined);
    setDrawerOpen(true);
  }, []);

  // Chamado a partir de qualquer call site que queira abrir o drawer de edição
  // (ex: RuleList quando ganhar suporte à prop onEditRule em slot futuro).
  const handleEditRule = React.useCallback((id: string): void => {
    setEditRuleId(id);
    setDrawerOpen(true);
  }, []);

  // Expor via window event para que RuleList possa acionar sem alterar a interface
  // — compatibilidade sem tocar em files_forbidden.
  React.useEffect(() => {
    const handler = (e: Event): void => {
      const ce = e as CustomEvent<{ ruleId: string }>;
      if (ce.detail?.ruleId) handleEditRule(ce.detail.ruleId);
    };
    window.addEventListener('rule:edit', handler);
    return () => window.removeEventListener('rule:edit', handler);
  }, [handleEditRule]);

  const handleDrawerClose = React.useCallback((): void => {
    setDrawerOpen(false);
    setEditRuleId(undefined);
  }, []);

  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div>
        <h1
          className="font-display font-bold text-ink"
          style={{
            fontSize: 'var(--text-3xl)',
            letterSpacing: '-0.04em',
            lineHeight: '1',
            fontVariationSettings: "'opsz' 32",
          }}
        >
          Regras de Notificação
        </h1>
        <p className="mt-1.5 font-sans text-ink-3" style={{ fontSize: 'var(--text-sm)' }}>
          Configure quando e como a plataforma notifica agentes e gestores sobre eventos relevantes.
        </p>
      </div>

      {/* ── Filtros ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="search"
          id="notificacoes-search"
          placeholder="Buscar por nome ou gatilho…"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          aria-label="Buscar regras de notificação"
          className={cn(
            'flex-1 max-w-sm h-10 rounded-sm border border-border-strong px-3',
            'font-sans text-sm text-ink bg-surface-1',
            'shadow-[inset_0_1px_3px_rgba(0,0,0,0.06)]',
            'placeholder:text-ink-4',
            'focus:outline-none focus:border-[var(--brand-azul)]',
            'focus:ring-3 focus:ring-[rgba(27,58,140,0.15)]',
            'transition-[border-color,box-shadow] duration-[150ms]',
          )}
        />
        <select
          id="notificacoes-status"
          value={enabledFilter}
          onChange={(e) => setEnabledFilter(e.target.value as typeof enabledFilter)}
          aria-label="Filtrar por status"
          className={cn(
            'w-44 h-10 rounded-sm border border-border-strong px-3',
            'font-sans text-sm text-ink bg-surface-1',
            'shadow-[inset_0_1px_3px_rgba(0,0,0,0.06)]',
            'focus:outline-none focus:border-[var(--brand-azul)]',
            'focus:ring-3 focus:ring-[rgba(27,58,140,0.15)]',
            'transition-[border-color,box-shadow] duration-[150ms]',
          )}
        >
          <option value="all">Todos os status</option>
          <option value="true">Apenas ativos</option>
          <option value="false">Apenas inativos</option>
        </select>
      </div>

      {/* ── Lista de regras ──────────────────────────────────────────────────── */}
      <RuleList
        rules={rules}
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        onNewRule={handleNewRule}
      />

      {/* ── Drawer criar/editar ───────────────────────────────────────────────── */}
      <RuleDrawer open={drawerOpen} onClose={handleDrawerClose} ruleId={editRuleId} />
    </div>
  );
}
