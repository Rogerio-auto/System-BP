// =============================================================================
// features/quick-replies/admin/QuickRepliesPageContent.tsx — Conteúdo real da
// tela de administração (F28-S07, doc 25 §11.2).
//
// Só é montado por pages/admin/QuickReplies.tsx DEPOIS que o gate de
// permissão + flag passa — é aqui que useQuickReplies() é chamado, então
// nunca dispara requisição com a flag desligada (doc 25 — 403 em toda rota).
// =============================================================================

import * as React from 'react';

import { useQuickReplies, useReorderQuickReplies } from '../index';
import type { QuickReplyListParams } from '../types';

import { QuickReplyDrawer } from './QuickReplyDrawer';
import { QuickReplyList } from './QuickReplyList';
import { moveItem, toReorderPatch } from './reorder';
import type { QuickReplyTab } from './tabs';
import { useDebouncedValue } from './useDebouncedValue';

// Teto de itens carregados por vez — biblioteca de respostas rápidas é
// tipicamente pequena (dezenas por organização); em vez de paginação/"carregar
// mais", usamos o limite máximo aceito pela API (100) e avisamos quando há
// mais resultados do que o exibido, orientando a refinar a busca.
const LIST_LIMIT = 100;

interface StatCardProps {
  label: string;
  value: string | number;
  isLoading?: boolean;
}

function StatCard({ label, value, isLoading }: StatCardProps): React.JSX.Element {
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
    </div>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function TabButton({ active, onClick, children }: TabButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative pb-3 font-sans text-sm font-medium transition-colors duration-[150ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(27,58,140,0.2)] rounded-sm ${active ? 'text-azul' : 'text-ink-3 hover:text-ink'}`}
    >
      {children}
      {active && (
        <span
          className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
          style={{ background: 'var(--brand-azul)' }}
          aria-hidden="true"
        />
      )}
    </button>
  );
}

interface QuickRepliesPageContentProps {
  canManage: boolean;
  canWrite: boolean;
}

export function QuickRepliesPageContent({
  canManage,
  canWrite,
}: QuickRepliesPageContentProps): React.JSX.Element {
  const [tab, setTab] = React.useState<QuickReplyTab>('organization');
  const [search, setSearch] = React.useState('');
  const [category, setCategory] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('');
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [editId, setEditId] = React.useState<string | undefined>(undefined);

  const searchDebounced = useDebouncedValue(search, 300);
  const categoryDebounced = useDebouncedValue(category, 300);

  const queryParams = React.useMemo<QuickReplyListParams>(
    () => ({
      visibility: tab,
      limit: LIST_LIMIT,
      ...(searchDebounced ? { search: searchDebounced } : {}),
      ...(categoryDebounced ? { category: categoryDebounced } : {}),
      ...(statusFilter === 'true'
        ? { isActive: true }
        : statusFilter === 'false'
          ? { isActive: false }
          : {}),
    }),
    [tab, searchDebounced, categoryDebounced, statusFilter],
  );

  const { data, isLoading, isError, refetch } = useQuickReplies(queryParams);
  const reorderMutation = useReorderQuickReplies();
  const items = React.useMemo(() => data?.data ?? [], [data]);

  function openCreate(): void {
    setEditId(undefined);
    setDrawerOpen(true);
  }

  function openEdit(id: string): void {
    setEditId(id);
    setDrawerOpen(true);
  }

  function handleMove(id: string, direction: 'up' | 'down'): void {
    const fromIndex = items.findIndex((i) => i.id === id);
    if (fromIndex === -1) return;
    const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
    const reordered = moveItem(items, fromIndex, toIndex);
    reorderMutation.mutate(toReorderPatch(reordered.map((i) => i.id)));
  }

  const canReorder = tab === 'organization' && canManage;
  const canCreate = canWrite || canManage;
  const totalAtivas = items.filter((i) => i.isActive).length;
  const totalComMidia = items.filter((i) => i.mediaUrl !== null).length;

  return (
    <>
      <div
        className="flex flex-col gap-6"
        style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) both' }}
      >
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
              Respostas rápidas
            </h1>
            <p className="font-sans text-sm text-ink-3 mt-1">
              Modelos de mensagem para agilizar o atendimento no WhatsApp.
            </p>
          </div>

          {canCreate && (
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
              Nova resposta
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatCard
            label={tab === 'organization' ? 'Ativas na organização' : 'Ativas pessoais'}
            value={isLoading ? '—' : totalAtivas}
            isLoading={isLoading}
          />
          <StatCard
            label="Carregadas"
            value={isLoading ? '—' : items.length}
            isLoading={isLoading}
          />
          <StatCard
            label="Com mídia"
            value={isLoading ? '—' : totalComMidia}
            isLoading={isLoading}
          />
        </div>

        <div
          role="tablist"
          aria-label="Escopo das respostas rápidas"
          className="flex gap-6 border-b border-border-subtle"
        >
          <TabButton active={tab === 'organization'} onClick={() => setTab('organization')}>
            Organização
          </TabButton>
          <TabButton active={tab === 'personal'} onClick={() => setTab('personal')}>
            Minhas
          </TabButton>
        </div>

        {data?.nextCursor && (
          <p className="font-sans text-xs text-ink-4 -mt-2">
            Mostrando os primeiros {LIST_LIMIT} resultados. Refine a busca para itens específicos.
          </p>
        )}

        <QuickReplyList
          items={items}
          isLoading={isLoading}
          isError={isError}
          onRefetch={() => void refetch()}
          onAdd={openCreate}
          onEdit={openEdit}
          search={search}
          onSearchChange={setSearch}
          category={category}
          onCategoryChange={setCategory}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          tab={tab}
          canManage={canManage}
          canWrite={canWrite}
          onMoveUp={canReorder ? (id) => handleMove(id, 'up') : undefined}
          onMoveDown={canReorder ? (id) => handleMove(id, 'down') : undefined}
        />
      </div>

      <QuickReplyDrawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setEditId(undefined);
        }}
        quickReplyId={editId}
        canManage={canManage}
      />
    </>
  );
}
