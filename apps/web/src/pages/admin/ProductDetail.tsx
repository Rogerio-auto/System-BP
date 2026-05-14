// =============================================================================
// pages/admin/ProductDetail.tsx — /admin/products/:id
//
// Layout 2 colunas (md+):
//   Esquerda  — Card identidade do produto (nome, key, description, status, datas).
//   Direita   — Card timeline de regras com botão "Publicar nova versão".
//
// DS:
//   - Card elev-2 (§9.3) nas duas colunas.
//   - Bricolage no título da página.
//   - JetBrains Mono para key e valores numéricos.
//   - Aviso amarelo quando feature flag desabilitada.
//   - Loading: skeleton full-page. Erro: card retry.
// =============================================================================

import * as React from 'react';
import { Link, useParams } from 'react-router-dom';

import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ProductDrawer } from '../../features/admin/products/ProductDrawer';
import { PublishRuleDrawer } from '../../features/admin/products/PublishRuleDrawer';
import { RuleTimeline } from '../../features/admin/products/RuleTimeline';
import { useProduct } from '../../hooks/admin/useProducts';
import { useCitiesList } from '../../hooks/useCitiesList';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DATE_FMT = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function formatDate(iso: string): string {
  try {
    return DATE_FMT.format(new Date(iso));
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Skeleton full-page
// ---------------------------------------------------------------------------

function PageSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      {/* Breadcrumb skeleton */}
      <div
        className="h-4 w-48 rounded-xs animate-pulse"
        style={{ background: 'var(--surface-muted)' }}
      />
      {/* Title skeleton */}
      <div
        className="h-9 w-64 rounded-xs animate-pulse"
        style={{ background: 'var(--surface-muted)' }}
      />
      {/* Two col skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_1.6fr] gap-5">
        <div
          className="rounded-md border border-border p-5 flex flex-col gap-3"
          style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-2)' }}
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-4 rounded-xs animate-pulse"
              style={{ width: `${60 + ((i * 13) % 40)}%`, background: 'var(--surface-muted)' }}
            />
          ))}
        </div>
        <div
          className="rounded-md border border-border p-5 flex flex-col gap-3"
          style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-2)' }}
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-16 rounded-sm animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card de identidade do produto
// ---------------------------------------------------------------------------

interface ProductIdentityCardProps {
  id: string;
  name: string;
  productKey: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  onEdit: () => void;
}

function ProductIdentityCard({
  name,
  productKey,
  description,
  isActive,
  createdAt,
  updatedAt,
  onEdit,
}: ProductIdentityCardProps): React.JSX.Element {
  return (
    <div
      className="rounded-md border overflow-hidden"
      style={{
        background: 'var(--bg-elev-1)',
        borderColor: 'var(--border)',
        boxShadow: 'var(--elev-2)',
      }}
    >
      {/* Card header */}
      <div
        className="flex items-center justify-between px-5 py-4 border-b border-border-subtle"
        style={{ background: 'var(--bg-elev-2)' }}
      >
        <h2
          className="font-display font-bold text-ink"
          style={{ fontSize: 'var(--text-lg)', letterSpacing: '-0.03em' }}
        >
          Identidade
        </h2>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm font-sans text-xs font-semibold text-ink-2 border border-border hover:border-azul hover:text-azul hover:bg-surface-hover transition-all duration-fast focus-visible:ring-2 focus-visible:ring-azul/20 focus-visible:outline-none"
        >
          <svg
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            className="w-3.5 h-3.5"
            aria-hidden="true"
          >
            <path d="M9 2l3 3-7 7H2V9L9 2Z" />
          </svg>
          Editar
        </button>
      </div>

      {/* Card body */}
      <div className="px-5 py-5 flex flex-col gap-4">
        {/* Nome */}
        <div>
          <p className="font-sans text-[10px] font-bold uppercase tracking-[0.1em] text-ink-4 mb-1">
            Nome
          </p>
          <p className="font-sans text-base font-semibold text-ink">{name}</p>
        </div>

        {/* Key */}
        <div>
          <p className="font-sans text-[10px] font-bold uppercase tracking-[0.1em] text-ink-4 mb-1">
            Identificador
          </p>
          <code
            className="font-mono text-sm font-semibold"
            style={{ color: 'var(--brand-azul)', letterSpacing: '-0.01em' }}
          >
            {productKey}
          </code>
        </div>

        {/* Status */}
        <div>
          <p className="font-sans text-[10px] font-bold uppercase tracking-[0.1em] text-ink-4 mb-1">
            Status
          </p>
          <Badge variant={isActive ? 'success' : 'neutral'}>{isActive ? 'Ativo' : 'Inativo'}</Badge>
        </div>

        {/* Descrição */}
        {description && (
          <div>
            <p className="font-sans text-[10px] font-bold uppercase tracking-[0.1em] text-ink-4 mb-1">
              Descrição
            </p>
            <p className="font-sans text-sm text-ink-2 leading-relaxed">{description}</p>
          </div>
        )}

        {/* Datas */}
        <div className="flex gap-5 pt-1 border-t border-border-subtle">
          <div>
            <p className="font-sans text-[10px] font-bold uppercase tracking-[0.1em] text-ink-4 mb-0.5">
              Criado em
            </p>
            <p className="font-sans text-xs text-ink-3">{formatDate(createdAt)}</p>
          </div>
          <div>
            <p className="font-sans text-[10px] font-bold uppercase tracking-[0.1em] text-ink-4 mb-0.5">
              Atualizado
            </p>
            <p className="font-sans text-xs text-ink-3">{formatDate(updatedAt)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

/**
 * ProductDetailPage — /admin/products/:id
 *
 * Detalhe de um produto de crédito com timeline de versões de regras.
 */
export function ProductDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [editDrawerOpen, setEditDrawerOpen] = React.useState(false);
  const [publishDrawerOpen, setPublishDrawerOpen] = React.useState(false);

  const { data: product, isLoading, isError, refetch } = useProduct(id);
  const { cities } = useCitiesList();
  const { enabled: simulationEnabled } = useFeatureFlag('credit_simulation.enabled');

  // Map cityId → name para a timeline
  const citiesMap = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of cities) {
      map[c.id] = `${c.name} (${c.state_uf})`;
    }
    return map;
  }, [cities]);

  const activeRule = product?.active_rule ?? null;
  const currentVersion = activeRule?.version ?? null;

  // ── Loading ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) both' }}>
        <PageSkeleton />
      </div>
    );
  }

  // ── Erro ─────────────────────────────────────────────────────────────────
  if (isError || !product) {
    return (
      <div
        className="flex flex-col gap-6"
        style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) both' }}
      >
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb">
          <Link
            to="/admin/products"
            className="font-sans text-sm text-ink-3 hover:text-azul transition-colors duration-fast"
          >
            ← Produtos
          </Link>
        </nav>

        <div
          className="flex flex-col items-center justify-center py-16 gap-4 text-center rounded-md border border-border"
          style={{ background: 'var(--danger-bg)', boxShadow: 'var(--elev-1)' }}
        >
          <p className="font-sans text-sm font-medium text-danger">Erro ao carregar produto.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="font-sans text-xs text-azul hover:underline focus-visible:outline-none focus-visible:underline"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className="flex flex-col gap-6"
        style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) both' }}
      >
        {/* ── Breadcrumb ──────────────────────────────────────────────────────── */}
        <nav aria-label="Breadcrumb">
          <Link
            to="/admin/products"
            className="font-sans text-sm text-ink-3 hover:text-azul transition-colors duration-fast"
          >
            ← Produtos de crédito
          </Link>
        </nav>

        {/* ── Feature flag aviso ──────────────────────────────────────────────── */}
        {!simulationEnabled && (
          <div
            className="flex items-start gap-3 px-4 py-3 rounded-sm border"
            style={{
              background: 'var(--warning-bg)',
              borderColor: 'var(--warning)',
              borderLeftWidth: 3,
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
            <p className="font-sans text-sm text-ink-3">
              Publicação de regras desabilitada — flag{' '}
              <code className="font-mono text-xs">credit_simulation.enabled</code> está off.
            </p>
          </div>
        )}

        {/* ── Header da página ────────────────────────────────────────────────── */}
        <div>
          <h1
            className="font-display font-bold text-ink"
            style={{
              fontSize: 'var(--text-3xl)',
              letterSpacing: '-0.04em',
              fontVariationSettings: "'opsz' 48",
            }}
          >
            {product.name}
          </h1>
          <p className="font-mono text-sm text-ink-4 mt-1" style={{ letterSpacing: '-0.01em' }}>
            {product.key}
          </p>
        </div>

        {/* ── Layout 2 colunas ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.6fr] gap-5 items-start">
          {/* Coluna esquerda — Identidade */}
          <div style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) 0.05s both' }}>
            <ProductIdentityCard
              id={product.id}
              name={product.name}
              productKey={product.key}
              description={product.description}
              isActive={product.is_active}
              createdAt={product.created_at}
              updatedAt={product.updated_at}
              onEdit={() => setEditDrawerOpen(true)}
            />
          </div>

          {/* Coluna direita — Timeline de regras */}
          <div
            className="flex flex-col gap-0"
            style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) 0.1s both' }}
          >
            {/* Card container da timeline */}
            <div
              className="rounded-md border overflow-hidden"
              style={{
                background: 'var(--bg-elev-1)',
                borderColor: 'var(--border)',
                boxShadow: 'var(--elev-2)',
              }}
            >
              {/* Header com botão publicar */}
              <div
                className="flex items-center justify-between px-5 py-4 border-b border-border-subtle"
                style={{ background: 'var(--bg-elev-2)' }}
              >
                <div>
                  <h2
                    className="font-display font-bold text-ink"
                    style={{ fontSize: 'var(--text-lg)', letterSpacing: '-0.03em' }}
                  >
                    Versões de regras
                  </h2>
                  <p className="font-sans text-xs text-ink-4 mt-0.5">
                    {product.rules.length === 0
                      ? 'Nenhuma versão publicada'
                      : `${product.rules.length} versão${product.rules.length !== 1 ? 'ões' : ''}`}
                  </p>
                </div>

                {/* Botão publicar — desabilitado se flag off */}
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!simulationEnabled}
                  onClick={() => setPublishDrawerOpen(true)}
                  title={
                    !simulationEnabled
                      ? 'Módulo de simulação desabilitado'
                      : `Publicar versão v${(currentVersion ?? 0) + 1}`
                  }
                  leftIcon={
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      className="w-3.5 h-3.5"
                      aria-hidden="true"
                    >
                      <path d="M8 3v10M3 8h10" />
                    </svg>
                  }
                >
                  Publicar nova versão
                </Button>
              </div>

              {/* Timeline */}
              <div className="px-4 py-4">
                <RuleTimeline rules={product.rules} citiesMap={citiesMap} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Drawers ────────────────────────────────────────────────────────────── */}
      <ProductDrawer
        open={editDrawerOpen}
        onClose={() => setEditDrawerOpen(false)}
        productId={product.id}
      />

      <PublishRuleDrawer
        open={publishDrawerOpen}
        onClose={() => setPublishDrawerOpen(false)}
        productId={product.id}
        productName={product.name}
        currentVersion={currentVersion}
      />
    </>
  );
}
