// =============================================================================
// pages/admin/Products.tsx — /admin/products
//
// Lista de produtos de crédito com:
//   - Header Bricolage + botão "Novo produto"
//   - Stats row: total ativos, regras ativas, produtos sem regra
//   - Tabela de produtos (ProductList)
//   - Drawer create/edit (ProductDrawer)
//   - Drawer publicar primeira regra após criação (PublishRuleDrawer)
//   - Aviso feature flag desabilitada
//
// Acesso: credit_products:read (ver); credit_products:write (mutar).
// RBAC verificado no backend; UI usa permissão do token para desabilitar ações.
// =============================================================================

import * as React from 'react';

import { ProductDrawer } from '../../features/admin/products/ProductDrawer';
import { ProductList } from '../../features/admin/products/ProductList';
import { PublishRuleDrawer } from '../../features/admin/products/PublishRuleDrawer';
import { useProducts } from '../../hooks/admin/useProducts';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';

// ---------------------------------------------------------------------------
// Stats row
// ---------------------------------------------------------------------------

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  isLoading?: boolean;
}

function StatCard({ label, value, sub, isLoading }: StatCardProps): React.JSX.Element {
  return (
    <div
      className="flex flex-col gap-1 px-5 py-4 rounded-md border border-border"
      style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-1)' }}
    >
      <p
        className="font-sans font-bold uppercase text-ink-3"
        style={{ fontSize: '0.7rem', letterSpacing: '0.1em' }}
      >
        {label}
      </p>
      {isLoading ? (
        <div
          className="h-7 w-12 rounded-xs animate-pulse"
          style={{ background: 'var(--surface-muted)' }}
          aria-hidden="true"
        />
      ) : (
        <p
          className="font-display font-bold text-ink"
          style={{ fontSize: 'var(--text-2xl)', letterSpacing: '-0.035em' }}
        >
          {value}
        </p>
      )}
      {sub && <p className="font-sans text-xs text-ink-4">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

/**
 * Página de administração de produtos de crédito (/admin/products).
 */
export function ProductsPage(): React.JSX.Element {
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [searchDebounced, setSearchDebounced] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('');

  // Drawer states
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [editProductId, setEditProductId] = React.useState<string | undefined>(undefined);
  const [publishDrawerOpen, setPublishDrawerOpen] = React.useState(false);
  const [newlyCreatedProductId, setNewlyCreatedProductId] = React.useState<string | undefined>(
    undefined,
  );

  // Debounce da busca
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = (value: string): void => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchDebounced(value);
      setPage(1);
    }, 300);
  };

  React.useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Query params
  const queryParams = React.useMemo(() => {
    const p: Parameters<typeof useProducts>[0] = { page, limit: 20 };
    if (searchDebounced) p.search = searchDebounced;
    if (statusFilter === 'true') p.is_active = true;
    else if (statusFilter === 'false') p.is_active = false;
    return p;
  }, [page, searchDebounced, statusFilter]);

  const { data, isLoading, isError, refetch } = useProducts(queryParams);

  const { enabled: simulationEnabled } = useFeatureFlag('credit_simulation.enabled');

  const products = data?.data ?? [];
  const pagination = data?.pagination;

  // Estatísticas derivadas dos dados carregados
  const totalAtivos = products.filter((p) => p.is_active).length;
  const totalComRegra = products.filter((p) => p.active_rule !== null).length;
  const totalSemRegra = products.filter((p) => p.active_rule === null).length;

  // Nome do produto recém-criado (para o drawer de publicar)
  const newProduct = products.find((p) => p.id === newlyCreatedProductId);

  function openCreate(): void {
    setEditProductId(undefined);
    setDrawerOpen(true);
  }

  function openEdit(id: string): void {
    setEditProductId(id);
    setDrawerOpen(true);
  }

  function handleProductCreated(id: string): void {
    setNewlyCreatedProductId(id);
    // Abre drawer de publicar primeira regra (só se flag habilitada)
    if (simulationEnabled) {
      setPublishDrawerOpen(true);
    }
  }

  return (
    <>
      <div
        className="flex flex-col gap-6"
        style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) both' }}
      >
        {/* ── Feature flag aviso ──────────────────────────────────────────────── */}
        {!simulationEnabled && (
          <div
            className="flex items-start gap-3 px-4 py-3 rounded-sm border"
            style={{
              background: 'var(--warning-bg)',
              borderColor: 'var(--warning)',
              borderLeftWidth: 3,
              animation: 'fade-up var(--dur-slow) var(--ease-out) both',
            }}
            role="alert"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              className="w-4 h-4 shrink-0 mt-0.5"
              style={{ color: 'var(--warning)' }}
              aria-hidden="true"
            >
              <path d="M8 2l6 10H2L8 2Z" />
              <path d="M8 7v3M8 11.5v.5" />
            </svg>
            <div>
              <p className="font-sans text-sm font-semibold text-ink">
                Módulo de simulação desabilitado
              </p>
              <p className="font-sans text-xs text-ink-3 mt-0.5">
                A flag <code className="font-mono">credit_simulation.enabled</code> está desativada.
                Você pode gerir produtos normalmente, mas a publicação de regras está bloqueada.
              </p>
            </div>
          </div>
        )}

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1
              className="font-display font-bold text-ink"
              style={{
                fontSize: 'var(--text-3xl)',
                letterSpacing: '-0.04em',
                fontVariationSettings: "'opsz' 48",
              }}
            >
              Produtos de crédito
            </h1>
            <p className="font-sans text-sm text-ink-3 mt-1">
              Gerencie o catálogo de produtos e as versões de regras.
            </p>
          </div>

          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center justify-center gap-2 px-[22px] py-3 rounded-sm font-sans font-semibold text-sm text-white transition-[transform,box-shadow] duration-fast ease focus-visible:ring-2 focus-visible:ring-azul/40 focus-visible:outline-none hover:-translate-y-0.5 active:translate-y-0"
            style={{
              background: 'var(--grad-azul)',
              boxShadow: 'var(--elev-2),inset 0 1px 0 rgba(255,255,255,0.15)',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow =
                'var(--glow-azul),inset 0 1px 0 rgba(255,255,255,0.2)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow =
                'var(--elev-2),inset 0 1px 0 rgba(255,255,255,0.15)';
            }}
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="w-4 h-4"
              aria-hidden="true"
            >
              <path d="M8 3v10M3 8h10" />
            </svg>
            Novo produto
          </button>
        </div>

        {/* ── Stats row ───────────────────────────────────────────────────────── */}
        <div
          className="grid grid-cols-2 sm:grid-cols-3 gap-3"
          style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) 0.05s both' }}
        >
          <StatCard
            label="Produtos ativos"
            value={isLoading ? '—' : totalAtivos}
            sub={`de ${products.length} carregados`}
            isLoading={isLoading}
          />
          <StatCard
            label="Com regra ativa"
            value={isLoading ? '—' : totalComRegra}
            sub="prontos para simulação"
            isLoading={isLoading}
          />
          <StatCard
            label="Sem regra"
            value={isLoading ? '—' : totalSemRegra}
            sub={totalSemRegra > 0 ? 'requer publicação' : 'todos configurados'}
            isLoading={isLoading}
          />
        </div>

        {/* ── Tabela ──────────────────────────────────────────────────────────── */}
        <div style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) 0.1s both' }}>
          <ProductList
            products={products}
            isLoading={isLoading}
            isError={isError}
            onRefetch={() => void refetch()}
            onAdd={openCreate}
            onEdit={openEdit}
            search={search}
            onSearchChange={handleSearchChange}
            statusFilter={statusFilter}
            onStatusFilterChange={(v) => {
              setStatusFilter(v);
              setPage(1);
            }}
            pagination={pagination}
            onPageChange={(p) => setPage(p)}
          />
        </div>
      </div>

      {/* ── Drawers ────────────────────────────────────────────────────────────── */}
      <ProductDrawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setEditProductId(undefined);
        }}
        productId={editProductId}
        onCreated={handleProductCreated}
      />

      {/* Drawer de publicar primeira regra — abre após criação se flag habilitada */}
      {newlyCreatedProductId && simulationEnabled && (
        <PublishRuleDrawer
          open={publishDrawerOpen}
          onClose={() => {
            setPublishDrawerOpen(false);
            setNewlyCreatedProductId(undefined);
          }}
          productId={newlyCreatedProductId}
          productName={newProduct?.name ?? 'Novo produto'}
          currentVersion={null}
        />
      )}
    </>
  );
}
