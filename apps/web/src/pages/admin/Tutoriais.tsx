// =============================================================================
// pages/admin/Tutoriais.tsx — /admin/tutoriais
//
// Painel de CRUD de tutoriais em vídeo (norma 21 §8).
// Acesso restrito a tutorials:manage.
//
// Layout:
//   - Header Bricolage + botão "Novo tutorial"
//   - Stats row: total, ativos, inativos
//   - Tabela (TutoriaisList)
//   - Drawer create/edit (TutoriaisDrawer)
// =============================================================================

import * as React from 'react';

import { TutoriaisDrawer } from '../../features/admin/tutoriais/TutoriaisForm';
import { TutoriaisList } from '../../features/admin/tutoriais/TutoriaisList';
import { useTutorials } from '../../hooks/admin/useTutorials';
import type { TutorialResponse } from '../../lib/api/tutorials';
import { useAuth } from '../../lib/auth-store';

// ─── StatCard (DS §9.8 simplificado) ─────────────────────────────────────────

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

// ─── Página ───────────────────────────────────────────────────────────────────

/**
 * Página de administração de tutoriais em vídeo (/admin/tutoriais).
 * Acesso controlado por tutorials:manage.
 * Norma 21 §8.
 */
export function TutoriaisPage(): React.JSX.Element {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('tutorials:manage');

  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');

  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [editTutorial, setEditTutorial] = React.useState<TutorialResponse | undefined>(undefined);

  const { data, isLoading, isError, refetch } = useTutorials({ page, limit: 20 });

  const tutorials = data?.data ?? [];
  const pagination = data?.pagination;

  const totalAtivos = tutorials.filter((t) => t.is_active).length;
  const totalInativos = tutorials.filter((t) => !t.is_active).length;

  function openCreate(): void {
    setEditTutorial(undefined);
    setDrawerOpen(true);
  }

  function openEdit(tutorial: TutorialResponse): void {
    setEditTutorial(tutorial);
    setDrawerOpen(true);
  }

  return (
    <>
      <div
        className="flex flex-col gap-6"
        style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) both' }}
      >
        {/* ── Header ────────────────────────────────────────────────────────── */}
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
              Tutoriais em vídeo
            </h1>
            <p className="font-sans text-sm text-ink-3 mt-1">
              Gerencie os tutoriais de funcionalidades sem precisar de deploy.
            </p>
          </div>

          {canManage && (
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
              Novo tutorial
            </button>
          )}
        </div>

        {/* ── Stats row ────────────────────────────────────────────────────── */}
        <div
          className="grid grid-cols-2 sm:grid-cols-3 gap-3"
          style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) 0.05s both' }}
        >
          <StatCard
            label="Total"
            value={isLoading ? '—' : (pagination?.total ?? tutorials.length)}
            sub="tutoriais cadastrados"
            isLoading={isLoading}
          />
          <StatCard
            label="Ativos"
            value={isLoading ? '—' : totalAtivos}
            sub="publicados para usuários"
            isLoading={isLoading}
          />
          <StatCard
            label="Inativos"
            value={isLoading ? '—' : totalInativos}
            sub="rascunho ou desativados"
            isLoading={isLoading}
          />
        </div>

        {/* ── Tabela ───────────────────────────────────────────────────────── */}
        <div style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) 0.1s both' }}>
          <TutoriaisList
            tutorials={tutorials}
            isLoading={isLoading}
            isError={isError}
            onRefetch={() => void refetch()}
            onAdd={openCreate}
            onEdit={openEdit}
            search={search}
            onSearchChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            pagination={pagination}
            onPageChange={(p) => setPage(p)}
          />
        </div>
      </div>

      {/* ── Drawer ─────────────────────────────────────────────────────────── */}
      <TutoriaisDrawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setEditTutorial(undefined);
        }}
        tutorial={editTutorial}
        onCreated={() => {
          setDrawerOpen(false);
        }}
      />
    </>
  );
}
