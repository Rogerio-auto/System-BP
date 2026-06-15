// =============================================================================
// features/dashboard/CollectionDashboardPage.tsx — Dashboard de cobrança.
//
// Role: cobranca / gestor. Gate: billing:read.
// 5 cards de carteira via GET /api/dashboard/collection.
// Filtro opcional de cidade (dropdown quando há múltiplas cidades disponíveis).
//
// Estados: loading (skeleton), erro (alert + retry), vazio (0 em todos os cards),
//          403 (sem permissão).
//
// DS: light-first, tokens canônicos, profundidade elev-2, hover Spotlight (§9.8).
// Tipografia: Bricolage (heading), Geist (body), JetBrains Mono (valores).
// Sem hex hardcoded — sempre var(--token) ou classe Tailwind mapeada.
// =============================================================================

import type { CollectionDashboardCard } from '@elemento/shared-schemas';
import * as React from 'react';

import { useAuth } from '../auth/useAuth';

import { useCollectionDashboard } from './api';

// ---------------------------------------------------------------------------
// Formatter — total_amount vem como string (numeric serializado)
// ---------------------------------------------------------------------------

function formatAmount(raw: string): string {
  const n = Number.parseFloat(raw);
  if (Number.isNaN(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ---------------------------------------------------------------------------
// Card de carteira individual — DS §9.8 Stat/KPI adaptado
// ---------------------------------------------------------------------------

interface CardConfig {
  key: string;
  accentColor: string; // CSS var — sem hex
  iconPath: string; // SVG path data
}

const CARD_CONFIGS: CardConfig[] = [
  {
    key: 'due_soon',
    accentColor: 'var(--warning)',
    iconPath:
      'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z',
  },
  {
    key: 'overdue_uncollected',
    accentColor: 'var(--danger)',
    iconPath: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
  },
  {
    key: 'in_collection',
    accentColor: 'var(--brand-azul)',
    iconPath: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z',
  },
  {
    key: 'overdue_15d',
    accentColor: 'var(--danger)',
    iconPath:
      'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2z',
  },
  {
    key: 'in_spc',
    accentColor: 'var(--danger)',
    iconPath:
      'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z',
  },
];

interface WalletCardProps {
  card: CollectionDashboardCard;
  accentColor: string;
  iconPath: string;
}

function WalletCard({ card, accentColor, iconPath }: WalletCardProps): React.JSX.Element {
  const cardRef = React.useRef<HTMLDivElement>(null);

  // Spotlight: halo segue cursor (DS §8 — padrão Spotlight)
  const handleMouseMove = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - rect.left}px`);
    el.style.setProperty('--my', `${e.clientY - rect.top}px`);
  }, []);

  const handleMouseLeave = React.useCallback(() => {
    const el = cardRef.current;
    if (!el) return;
    el.style.setProperty('--mx', '-9999px');
    el.style.setProperty('--my', '-9999px');
  }, []);

  const isEmpty = card.count === 0;

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="relative overflow-hidden rounded-md border border-border bg-surface-1 p-5 transition-[transform,box-shadow] duration-[250ms] ease-out hover:-translate-y-0.5 [--mx:-9999px] [--my:-9999px]"
      style={{ boxShadow: 'var(--elev-2)' }}
    >
      {/* Spotlight radial verde segue cursor */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-md"
        style={{
          background:
            'radial-gradient(400px circle at var(--mx) var(--my), rgba(46,155,62,0.05), transparent 60%)',
        }}
      />

      {/* Decoração radial sutil no canto superior direito */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-0 right-0 h-20 w-20 rounded-full opacity-10"
        style={{
          background: `radial-gradient(circle, ${accentColor} 0%, transparent 70%)`,
          transform: 'translate(30%, -30%)',
        }}
      />

      {/* Conteúdo */}
      <div className="relative z-10 flex flex-col gap-3">
        {/* Ícone + Label */}
        <div className="flex items-center gap-2">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xs"
            style={{
              background: `color-mix(in srgb, ${accentColor} 12%, transparent)`,
              boxShadow: 'var(--elev-1)',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill={accentColor} aria-hidden="true">
              <path d={iconPath} />
            </svg>
          </div>
          <p
            className="font-sans font-semibold uppercase text-ink-3"
            style={{ fontSize: '0.7rem', letterSpacing: '0.12em' }}
          >
            {card.label}
          </p>
        </div>

        {/* Valor monetário — JetBrains Mono (DS §4.2) */}
        <div className="flex flex-col gap-1">
          <span
            className="font-display font-extrabold text-ink leading-none"
            style={{
              fontSize: 'var(--text-3xl)',
              letterSpacing: '-0.04em',
              fontVariationSettings: "'opsz' 48",
              opacity: isEmpty ? 0.35 : 1,
            }}
          >
            {formatAmount(card.total_amount)}
          </span>
          <span
            className="font-mono font-medium"
            style={{
              fontSize: 'var(--text-sm)',
              color: isEmpty ? 'var(--text-4)' : 'var(--text-3)',
              letterSpacing: '-0.01em',
            }}
          >
            {isEmpty
              ? 'Nenhum registro'
              : `${card.count.toLocaleString('pt-BR')} registro${card.count !== 1 ? 's' : ''}`}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton dos cards
// ---------------------------------------------------------------------------

function CollectionDashboardSkeleton(): React.JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="rounded-md border border-border bg-surface-1 p-5"
          style={{ boxShadow: 'var(--elev-2)', minHeight: '120px' }}
        >
          {/* Ícone + label skeleton */}
          <div className="mb-4 flex items-center gap-2">
            <div
              className="h-8 w-8 rounded-xs animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
            <div
              className="h-2.5 w-28 rounded-pill animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
          </div>
          {/* Valor skeleton */}
          <div
            className="h-9 w-36 rounded-xs animate-pulse"
            style={{ background: 'var(--surface-muted)' }}
          />
          <div
            className="mt-2 h-2.5 w-20 rounded-pill animate-pulse"
            style={{ background: 'var(--border-subtle)' }}
          />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estado vazio (todos os cards com count === 0)
// ---------------------------------------------------------------------------

function EmptyState(): React.JSX.Element {
  return (
    <div
      className="flex flex-col items-center gap-4 rounded-md border border-border bg-surface-1 p-12 text-center"
      style={{ boxShadow: 'var(--elev-1)' }}
    >
      <div
        className="flex h-14 w-14 items-center justify-center rounded-lg"
        style={{ background: 'var(--surface-muted)', boxShadow: 'var(--elev-2)' }}
      >
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--text-3)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <line x1="2" y1="10" x2="22" y2="10" />
        </svg>
      </div>
      <div>
        <p className="font-sans font-semibold text-ink" style={{ fontSize: 'var(--text-base)' }}>
          Nenhuma parcela encontrada
        </p>
        <p
          className="mt-1 font-sans text-sm text-ink-3"
          style={{ maxWidth: '30ch', margin: '0 auto' }}
        >
          Não há parcelas registradas para os critérios selecionados.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

/** Cidades disponíveis para o filtro — estrutura mínima */
interface CityOption {
  id: string;
  name: string;
}

interface CollectionDashboardPageProps {
  /** Lista de cidades disponíveis para o filtro. Quando vazio, filtro não aparece. */
  availableCities?: CityOption[];
}

/**
 * Dashboard de cobrança para o role `cobranca` / gestor.
 * Gate: billing:read — exibe estado 403 se ausente.
 * 5 cards de carteira com métricas do endpoint /api/dashboard/collection.
 */
export function CollectionDashboardPage({
  availableCities = [],
}: CollectionDashboardPageProps): React.JSX.Element {
  const { hasPermission } = useAuth();
  const [cityId, setCityId] = React.useState<string | undefined>(undefined);

  const { data, isLoading, isError, isForbidden, error, refetch } = useCollectionDashboard(cityId);

  // ---------------------------------------------------------------------------
  // Gate 403
  // ---------------------------------------------------------------------------

  if (!hasPermission('billing:read')) {
    return (
      <div
        className="rounded-md p-6 text-center"
        style={{
          background: 'var(--danger-bg)',
          borderLeft: '3px solid var(--danger)',
          boxShadow: 'var(--elev-1)',
        }}
      >
        <p className="font-sans font-semibold text-sm" style={{ color: 'var(--danger)' }}>
          Você não tem permissão para visualizar o dashboard de cobrança.
        </p>
        <p className="mt-1 font-sans text-sm" style={{ color: 'var(--text-3)' }}>
          Contate o administrador do sistema.
        </p>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Estado vazio: todos os cards com count === 0
  // ---------------------------------------------------------------------------

  const isEmpty =
    data !== null &&
    data !== undefined &&
    data.due_soon.count === 0 &&
    data.overdue_uncollected.count === 0 &&
    data.in_collection.count === 0 &&
    data.overdue_15d.count === 0 &&
    data.in_spc.count === 0;

  // ---------------------------------------------------------------------------
  // Dados dos cards em ordem exibida
  // ---------------------------------------------------------------------------

  const CARD_KEYS = [
    'due_soon',
    'overdue_uncollected',
    'in_collection',
    'overdue_15d',
    'in_spc',
  ] as const;

  return (
    <div
      className="flex flex-col gap-6"
      style={{
        animation:
          'fade-up var(--dur-slow, 400ms) var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both',
      }}
    >
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1
            className="font-display font-bold text-ink"
            style={{
              fontSize: 'var(--text-3xl)',
              letterSpacing: '-0.04em',
              fontVariationSettings: "'opsz' 48",
            }}
          >
            Carteira de Cobrança
          </h1>
          <p className="mt-1 font-sans text-sm" style={{ color: 'var(--text-3)' }}>
            Visão consolidada da carteira por situação.
          </p>
        </div>

        {/* Filtro de cidade — só aparece se houver mais de 1 cidade */}
        {availableCities.length > 1 && (
          <div className="relative">
            <label htmlFor="collection-city" className="sr-only">
              Cidade
            </label>
            <select
              id="collection-city"
              value={cityId ?? ''}
              onChange={(e) => setCityId(e.target.value || undefined)}
              className="font-sans text-sm rounded-sm border pl-3 pr-8 py-2 appearance-none transition-all duration-fast focus:outline-none focus-visible:ring-2"
              style={{
                background: 'var(--bg-elev-1)',
                borderColor: 'var(--border-strong)',
                color: 'var(--text)',
                boxShadow: 'var(--elev-1), inset 0 1px 2px var(--border-inner-dark)',
                ['--tw-ring-color' as string]: 'rgba(27,58,140,0.15)',
              }}
            >
              <option value="">Todas as cidades</option>
              {availableCities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {/* Chevron do select */}
            <svg
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--text-3)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        )}
      </div>

      {/* ── 403 via API ─────────────────────────────────────────────────────── */}
      {isForbidden && (
        <div
          className="rounded-md p-6 text-center"
          style={{
            background: 'var(--danger-bg)',
            borderLeft: '3px solid var(--danger)',
            boxShadow: 'var(--elev-1)',
          }}
        >
          <p className="font-sans font-semibold text-sm" style={{ color: 'var(--danger)' }}>
            Sem permissão para acessar o dashboard de cobrança.
          </p>
          <p className="mt-1 font-sans text-sm" style={{ color: 'var(--text-3)' }}>
            Contate o administrador do sistema.
          </p>
        </div>
      )}

      {/* ── Erro genérico ───────────────────────────────────────────────────── */}
      {isError && !isForbidden && (
        <div
          className="flex items-center justify-between gap-4 rounded-md p-5"
          style={{
            background: 'var(--danger-bg)',
            borderLeft: '3px solid var(--danger)',
            boxShadow: 'var(--elev-1)',
          }}
          role="alert"
        >
          <div>
            <p className="font-sans font-semibold text-sm" style={{ color: 'var(--danger)' }}>
              Erro ao carregar o dashboard de cobrança
            </p>
            <p className="mt-0.5 font-sans text-xs" style={{ color: 'var(--text-3)' }}>
              {error?.message ?? 'Erro desconhecido'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refetch()}
            className="font-sans text-xs font-semibold px-3 py-1.5 rounded-xs border transition-all duration-fast hover:opacity-80 focus:outline-none focus-visible:ring-2 active:scale-95"
            style={{
              borderColor: 'var(--danger)',
              color: 'var(--danger)',
              ['--tw-ring-color' as string]: 'rgba(200,52,31,0.2)',
            }}
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* ── Cards ─────────────────────────────────────────────────────────── */}
      {isLoading ? (
        <CollectionDashboardSkeleton />
      ) : isEmpty ? (
        <EmptyState />
      ) : data ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
          {CARD_KEYS.map((key, i) => {
            // CARD_CONFIGS is a fixed tuple aligned to CARD_KEYS (same length) —
            // access is safe, but non-null assertion is needed due to TS strict
            // array indexing. eslint-disable-next-line is intentional.
            const cfg = CARD_CONFIGS[i]!;
            return (
              <WalletCard
                key={key}
                card={data[key]}
                accentColor={cfg.accentColor}
                iconPath={cfg.iconPath}
              />
            );
          })}
        </div>
      ) : null}

      {/* ── Legenda dos segmentos ──────────────────────────────────────────── */}
      {data && !isEmpty && (
        <div
          className="flex flex-wrap gap-x-6 gap-y-1 rounded-xs border border-border-subtle px-4 py-3"
          style={{ background: 'var(--bg-elev-2)' }}
        >
          <p
            className="w-full font-sans font-semibold uppercase text-ink-3 mb-1"
            style={{ fontSize: '0.65rem', letterSpacing: '0.14em' }}
          >
            Legenda dos segmentos
          </p>
          {[
            { label: data.due_soon.label, desc: 'Parcelas vencendo nos próximos 7 dias' },
            { label: data.overdue_uncollected.label, desc: 'Vencidas sem cobrança ativa' },
            { label: data.in_collection.label, desc: 'Com job de cobrança em andamento' },
            { label: data.overdue_15d.label, desc: 'Inadimplentes há 15 ou mais dias' },
            { label: data.in_spc.label, desc: 'Clientes com status SPC = incluído' },
          ].map((item) => (
            <div key={item.label} className="flex flex-col">
              <span
                className="font-sans font-semibold text-ink"
                style={{ fontSize: 'var(--text-xs)' }}
              >
                {item.label}
              </span>
              <span className="font-sans text-ink-3" style={{ fontSize: 'var(--text-xs)' }}>
                {item.desc}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
