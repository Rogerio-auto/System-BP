// =============================================================================
// features/ai-actions/AiActionsPage.tsx — Painel "IA no funil" (F25-S07).
//
// Rota: /configuracoes/ia/acoes
//
// Superfície visual do doc 22 §11: gestor vê o que a IA fez no funil na
// janela selecionada (24h/7d/30d) e reverte qualificações/abandonos em
// 1 clique. Admin/gestor_geral também veem os limiares do agente proativo
// (leitura — ver AiActionsThresholds.tsx).
//
// Gating (doc 09 §4.1 + convenção já usada em ConfiguracoesPage para
// billing/tutorials — card só aparece com permissão E flag habilitadas):
//   - Painel inteiro: ai_actions:read E flag internal_assistant.actions.enabled.
//     Sem qualquer um dos dois → 404 (mesmo padrão de DecisionsListPage).
//   - Botão Reverter: ai_actions:revert (por item).
//   - Bloco de limiares: ai_actions:manage.
//
// Nota: as rotas do backend NÃO são gateadas pela flag (são ferramentas de
// supervisão humana — devem funcionar mesmo com o "kill switch" desligado).
// O gate de flag aqui é só de UI, conforme instruído no slot.
//
// LGPD (doc 17 §8.5): lead_name_masked já vem mascarado do backend.
// =============================================================================

import * as React from 'react';
import { Navigate } from 'react-router-dom';

import { useToast } from '../../components/ui/Toast';
import {
  type AiActionItem,
  type AiActionsWindow,
  useAiActionsList,
  useRevertAiAction,
} from '../../hooks/ai-actions/useAiActions';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { useAuth } from '../../lib/auth-store';
import { cn } from '../../lib/cn';

import { AiActionRow } from './components/AiActionRow';
import { AiActionsThresholds } from './components/AiActionsThresholds';
import { RevertConfirmModal } from './components/RevertConfirmModal';

const PAGE_SIZE = 20;

const WINDOW_OPTIONS: { value: AiActionsWindow; label: string }[] = [
  { value: '24h', label: '24 horas' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
];

// ─── Banner LGPD ─────────────────────────────────────────────────────────────

function LgpdBanner(): React.JSX.Element {
  return (
    <div
      className="flex items-start gap-2.5 px-4 py-2.5 rounded-md border"
      style={{ background: 'var(--info-bg)', borderColor: 'var(--info)', borderWidth: '1px' }}
      role="note"
      aria-label="Aviso de proteção de dados"
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="w-4 h-4 shrink-0 mt-0.5"
        style={{ color: 'var(--info)' }}
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="6" />
        <path d="M8 7v4M8 5.5v.5" strokeLinecap="round" />
      </svg>
      <p className="font-sans text-xs leading-relaxed" style={{ color: 'var(--info)' }}>
        Nomes de leads exibidos mascarados conforme política de proteção de dados (LGPD).
      </p>
    </div>
  );
}

// ─── Banner "em desenvolvimento" (flag desligada) ────────────────────────────

function FeatureDisabledBanner(): React.JSX.Element {
  return (
    <div
      className="flex items-start gap-2.5 px-4 py-2.5 rounded-md border"
      style={{
        background: 'var(--warning-bg)',
        borderColor: 'var(--brand-amarelo)',
        borderWidth: '1px',
      }}
      role="note"
    >
      <svg
        viewBox="0 0 20 20"
        fill="currentColor"
        className="w-4 h-4 shrink-0 mt-0.5 text-[var(--warning)]"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
          clipRule="evenodd"
        />
      </svg>
      <p className="font-sans text-xs leading-relaxed text-ink">
        As ações autônomas do agente de IA estão desligadas para esta organização. Este painel
        mostra o histórico de execuções passadas, se houver.
      </p>
    </div>
  );
}

// ─── Skeleton ──────────────────────────────────────────────────────────────

function SkeletonRow({ index }: { index: number }): React.JSX.Element {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3.5 border-b border-border last:border-b-0 animate-pulse"
      aria-hidden="true"
      key={index}
    >
      <div className="h-3 w-36 rounded shrink-0" style={{ background: 'var(--surface-muted)' }} />
      <div
        className="h-5 w-44 rounded-pill shrink-0"
        style={{ background: 'var(--surface-muted)' }}
      />
      <div className="h-3 flex-1 rounded" style={{ background: 'var(--surface-muted)' }} />
      <div
        className="h-8 w-24 rounded-sm shrink-0"
        style={{ background: 'var(--surface-muted)' }}
      />
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ windowLabel }: { windowLabel: string }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 text-center px-4">
      <svg
        viewBox="0 0 48 48"
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        className="w-12 h-12 text-ink-4"
        aria-hidden="true"
      >
        <rect x="6" y="10" width="36" height="28" rx="3" />
        <path d="M14 20h20M14 26h12" strokeLinecap="round" />
        <circle cx="36" cy="30" r="8" fill="var(--bg)" />
        <path d="M33 30l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="flex flex-col gap-1">
        <p
          className="font-display font-semibold text-ink"
          style={{ fontSize: 'var(--text-base)', letterSpacing: '-0.02em' }}
        >
          Sem ações da IA em {windowLabel}
        </p>
        <p className="font-sans text-sm text-ink-3 max-w-xs">
          Quando o agente qualificar, sinalizar estagnação ou abandonar leads automaticamente, as
          ações aparecerão aqui.
        </p>
      </div>
    </div>
  );
}

// ─── Error state ──────────────────────────────────────────────────────────────

function ErrorState({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 text-center px-4">
      <svg
        viewBox="0 0 48 48"
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        className="w-12 h-12 text-danger"
        aria-hidden="true"
      >
        <circle cx="24" cy="24" r="18" />
        <path d="M24 16v10M24 30v2" strokeLinecap="round" />
      </svg>
      <div className="flex flex-col gap-1">
        <p
          className="font-display font-semibold text-ink"
          style={{ fontSize: 'var(--text-base)', letterSpacing: '-0.02em' }}
        >
          Falha ao carregar ações da IA
        </p>
        <p className="font-sans text-sm text-ink-3 max-w-xs">
          Verifique sua conexão e tente novamente.
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className={cn(
          'inline-flex items-center gap-2 px-4 py-2.5 rounded-sm',
          'font-sans text-sm font-semibold',
          'border border-border-strong bg-surface-1 text-ink',
          'hover:border-azul hover:text-azul',
          'transition-[border-color,color] duration-[150ms] ease-out',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
        )}
      >
        Tentar novamente
      </button>
    </div>
  );
}

// ─── Tabs de janela ────────────────────────────────────────────────────────

function WindowTabs({
  value,
  onChange,
}: {
  value: AiActionsWindow;
  onChange: (w: AiActionsWindow) => void;
}): React.JSX.Element {
  return (
    <div
      role="tablist"
      aria-label="Janela de observação"
      className="inline-flex gap-1 p-1 rounded-md border border-border w-fit"
      style={{ background: 'var(--bg-elev-2)' }}
    >
      {WINDOW_OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'px-3 py-1.5 rounded-sm font-sans text-xs font-semibold',
              'transition-colors duration-[150ms] ease-out',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
              active ? 'bg-surface-1 text-azul' : 'text-ink-3 hover:text-ink',
            )}
            style={active ? { boxShadow: 'var(--elev-1)' } : undefined}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export function AiActionsPage(): React.JSX.Element {
  const { hasPermission } = useAuth();
  const { enabled: flagEnabled, isLoading: isFlagLoading } = useFeatureFlag(
    'internal_assistant.actions.enabled',
  );
  const { toast } = useToast();

  const [windowValue, setWindowValue] = React.useState<AiActionsWindow>('24h');
  const [page, setPage] = React.useState(1);
  const [revertTarget, setRevertTarget] = React.useState<AiActionItem | null>(null);

  const canRead = hasPermission('ai_actions:read');
  const canRevert = hasPermission('ai_actions:revert');
  const canManage = hasPermission('ai_actions:manage');

  const filters = { window: windowValue, page, limit: PAGE_SIZE };

  // Hooks de dados sempre chamados (Rules of Hooks) — enabled evita fetch
  // antes do gate de permissão+flag ser confirmado.
  const { data, isLoading, isError, refetch } = useAiActionsList(filters, {
    enabled: canRead && !isFlagLoading,
  });
  const revertMutation = useRevertAiAction(filters);

  // Gate: sem ai_actions:read → 404. A checagem de flag só decide o que
  // é exibido DENTRO da página (banner de módulo desligado), pois as ações
  // já ocorridas continuam relevantes para auditoria mesmo com o
  // "kill switch" desligado.
  if (!canRead) {
    return <Navigate to="/404" replace />;
  }

  function handleWindowChange(next: AiActionsWindow): void {
    setWindowValue(next);
    setPage(1);
  }

  function handleRevertConfirm(): void {
    if (!revertTarget) return;
    const target = revertTarget;
    revertMutation.mutate(target.action_id, {
      onSuccess: () => {
        toast('Ação revertida com sucesso.', 'success');
        setRevertTarget(null);
      },
      onError: (err) => {
        toast(err.message || 'Falha ao reverter a ação.', 'danger');
      },
    });
  }

  const items = data?.data ?? [];
  const pagination = data?.pagination;
  const windowLabel = WINDOW_OPTIONS.find((o) => o.value === windowValue)?.label ?? windowValue;

  return (
    <div className="flex flex-col gap-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
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
            IA no funil
          </h1>
          <p className="mt-1.5 font-sans text-ink-3" style={{ fontSize: 'var(--text-sm)' }}>
            Acompanhe as ações autônomas do agente de IA no funil e reverta quando necessário.
          </p>
        </div>
      </div>

      {/* ── Banners ─────────────────────────────────────────────────── */}
      <LgpdBanner />
      {!isFlagLoading && !flagEnabled && <FeatureDisabledBanner />}

      {/* ── Filtro de janela ────────────────────────────────────────── */}
      <WindowTabs value={windowValue} onChange={handleWindowChange} />

      {/* ── Lista ───────────────────────────────────────────────────── */}
      <div
        className="rounded-lg border border-border overflow-hidden"
        style={{ boxShadow: 'var(--elev-2)' }}
      >
        {isLoading && (
          <div aria-busy="true" aria-label="Carregando ações da IA">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonRow key={i} index={i} />
            ))}
          </div>
        )}

        {isError && !isLoading && <ErrorState onRetry={refetch} />}

        {!isLoading && !isError && items.length === 0 && <EmptyState windowLabel={windowLabel} />}

        {!isLoading && !isError && items.length > 0 && (
          <div>
            {items.map((item) => (
              <AiActionRow
                key={item.action_id}
                item={item}
                canRevert={canRevert}
                onRevertClick={setRevertTarget}
                isReverting={
                  revertMutation.isPending && revertMutation.variables === item.action_id
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Paginação ───────────────────────────────────────────────── */}
      {!isLoading && !isError && pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between gap-4">
          <span className="font-sans text-xs text-ink-3">
            {pagination.total.toLocaleString('pt-BR')} ações no total — página {pagination.page} de{' '}
            {pagination.totalPages}
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className={cn(
                'inline-flex items-center gap-1.5 px-4 py-2 rounded-sm',
                'font-sans text-sm font-medium text-ink-2',
                'border border-border bg-surface-1',
                'hover:border-azul hover:text-azul',
                'transition-[border-color,color] duration-[150ms] ease-out',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
                'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:text-ink-2',
              )}
            >
              Anterior
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
              disabled={page >= pagination.totalPages}
              className={cn(
                'inline-flex items-center gap-1.5 px-4 py-2 rounded-sm',
                'font-sans text-sm font-semibold',
                '[background:var(--grad-azul)] text-[var(--text-on-brand)]',
                '[box-shadow:var(--elev-2),inset_0_1px_0_rgba(255,255,255,0.15)]',
                'hover:-translate-y-0.5 hover:[box-shadow:var(--glow-azul)]',
                'active:translate-y-0 active:[box-shadow:var(--elev-1)]',
                'transition-[transform,box-shadow] duration-[150ms] ease-out',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/40',
                'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:[box-shadow:var(--elev-2)]',
              )}
            >
              Próxima
            </button>
          </div>
        </div>
      )}

      {/* ── Limiares (gestão) ──────────────────────────────────────────── */}
      {canManage && <AiActionsThresholds />}

      {/* ── Modal de confirmação de reversão ────────────────────────── */}
      {revertTarget && (
        <RevertConfirmModal
          item={revertTarget}
          onConfirm={handleRevertConfirm}
          onClose={() => {
            if (!revertMutation.isPending) setRevertTarget(null);
          }}
          isPending={revertMutation.isPending}
          error={revertMutation.error}
        />
      )}
    </div>
  );
}
