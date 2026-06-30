// =============================================================================
// features/admin/notification-rules/RuleList.tsx — Lista de regras de
// notificação com toggle inline (F24-S10).
//
// Colunas: nome, gatilho, categoria, canais, severidade, ativo (toggle), ações.
// Estados: loading (skeleton), empty (CTA), error (retry), success.
// DS: tabela densa §9.7, elev-1 no container, Geist body, Mono em chaves.
// =============================================================================
import type {
  NotificationRuleResponse,
  NotificationCategory,
  NotificationSeverity,
} from '@elemento/shared-schemas';
import * as React from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '../../../components/ui/Badge';
import type { BadgeVariant } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { useToast } from '../../../components/ui/Toast';
import { cn } from '../../../lib/cn';

import { useDeleteNotificationRule, useUpdateNotificationRule } from './hooks';

// ---------------------------------------------------------------------------
// Label maps
// ---------------------------------------------------------------------------

const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  lifecycle_stalled: 'Inatividade',
  assignment: 'Atribuição',
  credit: 'Crédito',
  billing: 'Cobrança',
  handoff: 'Handoff',
  system: 'Sistema',
};

const CATEGORY_VARIANT: Record<NotificationCategory, BadgeVariant> = {
  lifecycle_stalled: 'warning',
  assignment: 'info',
  credit: 'info',
  billing: 'warning',
  handoff: 'danger',
  system: 'neutral',
};

const SEVERITY_VARIANT: Record<NotificationSeverity, BadgeVariant> = {
  info: 'neutral',
  warning: 'warning',
  critical: 'danger',
};

const SEVERITY_LABEL: Record<NotificationSeverity, string> = {
  info: 'Info',
  warning: 'Alerta',
  critical: 'Crítico',
};

const CHANNEL_LABEL: Record<string, string> = {
  in_app: 'In-app',
  email: 'E-mail',
};

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function TableSkeleton(): React.JSX.Element {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i} aria-hidden="true">
          {Array.from({ length: 7 }).map((__, j) => (
            <td key={j} className="px-4 py-3.5">
              <div
                className="h-4 rounded-xs animate-pulse"
                style={{ width: 40 + ((i * 19 + j * 11) % 90), background: 'var(--surface-muted)' }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface RuleRowProps {
  rule: NotificationRuleResponse;
}

function RuleRow({ rule }: RuleRowProps): React.JSX.Element {
  const { toast } = useToast();
  const { mutate: update, isPending: isUpdating } = useUpdateNotificationRule();
  const { mutate: remove, isPending: isDeleting } = useDeleteNotificationRule();

  const handleToggle = (): void => {
    update(
      { id: rule.id, body: { enabled: !rule.enabled } },
      {
        onError: () => {
          toast('Erro ao atualizar regra. Tente novamente.', 'danger');
        },
      },
    );
  };

  const handleDelete = (): void => {
    if (!window.confirm(`Remover a regra "${rule.name}"? Esta ação não pode ser desfeita.`)) return;
    remove(rule.id, {
      onSuccess: () => {
        toast('Regra removida com sucesso.', 'success');
      },
      onError: () => {
        toast('Erro ao remover regra. Tente novamente.', 'danger');
      },
    });
  };

  return (
    <tr
      className={cn(
        'border-b border-border transition-colors duration-[150ms]',
        'hover:bg-[var(--surface-hover)]',
      )}
    >
      {/* Nome */}
      <td className="px-4 py-3.5 max-w-[220px]">
        <p className="font-sans text-sm font-medium text-ink truncate">{rule.name}</p>
      </td>
      {/* Gatilho */}
      <td className="px-4 py-3.5 max-w-[180px]">
        <code
          className="font-mono text-xs text-ink-3 truncate block"
          title={rule.trigger_key}
          style={{ fontSize: '0.72rem' }}
        >
          {rule.trigger_key}
        </code>
      </td>
      {/* Categoria */}
      <td className="px-4 py-3.5 whitespace-nowrap">
        <Badge variant={CATEGORY_VARIANT[rule.category]}>{CATEGORY_LABEL[rule.category]}</Badge>
      </td>
      {/* Canais */}
      <td className="px-4 py-3.5 whitespace-nowrap">
        <span className="font-sans text-xs text-ink-3">
          {rule.channels.map((ch) => CHANNEL_LABEL[ch] ?? ch).join(', ')}
        </span>
      </td>
      {/* Severidade */}
      <td className="px-4 py-3.5 whitespace-nowrap">
        <Badge variant={SEVERITY_VARIANT[rule.severity]}>{SEVERITY_LABEL[rule.severity]}</Badge>
      </td>
      {/* Toggle enabled */}
      <td className="px-4 py-3.5">
        <button
          type="button"
          role="switch"
          aria-checked={rule.enabled}
          aria-label={rule.enabled ? 'Desativar regra' : 'Ativar regra'}
          disabled={isUpdating}
          onClick={handleToggle}
          className={cn(
            'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-pill border-2 border-transparent',
            'transition-colors duration-[200ms] focus-visible:outline-none',
            'focus-visible:ring-2 focus-visible:ring-[rgba(27,58,140,0.25)] focus-visible:ring-offset-1',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            rule.enabled ? 'bg-verde' : 'bg-[var(--surface-muted)]',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none inline-block h-4 w-4 rounded-pill bg-white shadow-e1',
              'transition-transform duration-[200ms]',
              rule.enabled ? 'translate-x-4' : 'translate-x-0',
            )}
          />
        </button>
      </td>
      {/* Ações */}
      <td className="px-4 py-3.5 whitespace-nowrap">
        <div className="flex items-center gap-2">
          {/* Editar — drawer F24-S11 ainda não existe; link placeholder */}
          <Link
            to={`/admin/notificacoes/${rule.id}/editar`}
            className={cn(
              'inline-flex items-center justify-center h-7 w-7 rounded-sm',
              'text-ink-3 transition-colors duration-[150ms]',
              'hover:text-azul hover:bg-[var(--surface-hover)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(27,58,140,0.2)]',
            )}
            aria-label="Editar regra"
            title="Editar regra"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="w-4 h-4"
              aria-hidden="true"
            >
              <path d="M11.5 2.5a1.5 1.5 0 0 1 2 2l-8 8-3 .5.5-3 8-7.5Z" strokeLinejoin="round" />
            </svg>
          </Link>
          {/* Remover */}
          <button
            type="button"
            aria-label="Remover regra"
            title="Remover regra"
            disabled={isDeleting}
            onClick={handleDelete}
            className={cn(
              'inline-flex items-center justify-center h-7 w-7 rounded-sm',
              'text-ink-3 transition-colors duration-[150ms]',
              'hover:text-danger hover:bg-[var(--danger-bg)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(200,52,31,0.2)]',
              'disabled:opacity-40 disabled:cursor-not-allowed',
            )}
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="w-4 h-4"
              aria-hidden="true"
            >
              <path
                d="M3 4h10M6 4V3h4v1M5 4v8a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V4"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// RuleList (export principal)
// ---------------------------------------------------------------------------

export interface RuleListProps {
  rules: NotificationRuleResponse[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onNewRule: () => void;
}

/**
 * Lista tabular de regras de notificação (F24-S10).
 * Inclui toggle enabled inline, ações editar/excluir e skeleton/empty/error.
 */
export function RuleList({
  rules,
  isLoading,
  isError,
  onRetry,
  onNewRule,
}: RuleListProps): React.JSX.Element {
  const TH = ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }): React.JSX.Element => (
    <th
      scope="col"
      className={cn(
        'px-4 py-2.5 text-left font-sans font-bold uppercase text-ink-4 whitespace-nowrap',
        className,
      )}
      style={{ fontSize: '0.68rem', letterSpacing: '0.08em' }}
    >
      {children}
    </th>
  );

  return (
    <div
      className="rounded-lg border border-border overflow-hidden"
      style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-1)' }}
    >
      {/* Header do painel */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <p className="font-sans text-sm font-medium text-ink">
          {isLoading ? ' ' : `${rules.length} ${rules.length === 1 ? 'regra' : 'regras'}`}
        </p>
        <Button
          size="sm"
          variant="primary"
          onClick={onNewRule}
          leftIcon={
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="w-4 h-4"
              aria-hidden="true"
            >
              <path d="M8 3v10M3 8h10" strokeLinecap="round" />
            </svg>
          }
        >
          Nova regra
        </Button>
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead style={{ background: 'var(--surface-muted)' }}>
            <tr>
              <TH>Nome</TH>
              <TH>Gatilho</TH>
              <TH>Categoria</TH>
              <TH>Canais</TH>
              <TH>Severidade</TH>
              <TH>Ativo</TH>
              <TH className="sr-only">Ações</TH>
            </tr>
          </thead>
          <tbody>
            {isLoading && <TableSkeleton />}

            {!isLoading && isError && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center">
                  <p className="font-sans text-sm text-ink-3 mb-3">
                    Erro ao carregar regras de notificação.
                  </p>
                  <Button variant="outline" size="sm" onClick={onRetry}>
                    Tentar novamente
                  </Button>
                </td>
              </tr>
            )}

            {!isLoading && !isError && rules.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-14 text-center">
                  <svg
                    viewBox="0 0 48 48"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.2}
                    className="w-10 h-10 mx-auto mb-3 text-ink-4"
                    aria-hidden="true"
                  >
                    <path d="M6 12h36M6 24h24M6 36h16" strokeLinecap="round" />
                    <circle cx="38" cy="34" r="8" />
                    <path d="M35 34h6M38 31v6" strokeLinecap="round" />
                  </svg>
                  <p className="font-sans text-sm text-ink-3 mb-3">
                    Nenhuma regra de notificação configurada.
                  </p>
                  <Button variant="primary" size="sm" onClick={onNewRule}>
                    Criar primeira regra
                  </Button>
                </td>
              </tr>
            )}

            {!isLoading && !isError && rules.map((rule) => <RuleRow key={rule.id} rule={rule} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
