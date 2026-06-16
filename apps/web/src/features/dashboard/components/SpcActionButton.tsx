// =============================================================================
// features/dashboard/components/SpcActionButton.tsx — Ação de avanço de status SPC.
//
// Abre modal de confirmação antes de chamar POST /api/billing/customers/:id/spc.
// Gate: spc:manage — só aparece se o usuário tem a permissão.
// Transições válidas:
//   none              → "Solicitar inclusão"        → pending_inclusion
//   pending_inclusion → "Confirmar inclusão"        → included
//                     + "Cancelar solicitação"      → none
//   included          → "Solicitar remoção"         → removed
//   removed           → "Solicitar inclusão"        → pending_inclusion (reinclusão)
//
// Após sucesso: a mutation (useUpdateSpcStatus) invalida as queries relevantes.
// Idempotência: botão desabilitado durante a requisição (isPending).
// DS: Button canônico (§9.1) + Modal elev-5 + tokens sem hex hardcoded.
// =============================================================================

import type { SpcStatus } from '@elemento/shared-schemas';
import * as React from 'react';
import * as ReactDOM from 'react-dom';

import { Button } from '../../../components/ui/Button';
import { useAuth } from '../../auth/useAuth';
import { useUpdateSpcStatus } from '../api';

// ---------------------------------------------------------------------------
// Transições
// ---------------------------------------------------------------------------

interface SpcTransition {
  label: string;
  nextStatus: SpcStatus;
  variant: 'primary' | 'secondary' | 'danger' | 'outline';
  confirmTitle: string;
  confirmDescription: string;
}

const SPC_TRANSITIONS: Record<SpcStatus, SpcTransition[]> = {
  none: [
    {
      label: 'Solicitar inclusão no SPC',
      nextStatus: 'pending_inclusion',
      variant: 'outline',
      confirmTitle: 'Solicitar inclusão no SPC',
      confirmDescription:
        'O cliente será marcado como pendente de inclusão no SPC. Um gestor precisará confirmar a inclusão. Deseja continuar?',
    },
  ],
  pending_inclusion: [
    {
      label: 'Confirmar inclusão no SPC',
      nextStatus: 'included',
      variant: 'danger',
      confirmTitle: 'Confirmar inclusão no SPC',
      confirmDescription:
        'O cliente será registrado como incluído no SPC. Essa ação é registrada no histórico de cobrança. Deseja confirmar?',
    },
    {
      label: 'Cancelar solicitação',
      nextStatus: 'none',
      variant: 'outline',
      confirmTitle: 'Cancelar solicitação de inclusão',
      confirmDescription:
        'A solicitação de inclusão no SPC será cancelada e o status voltará para "Sem SPC". Deseja continuar?',
    },
  ],
  included: [
    {
      label: 'Solicitar remoção do SPC',
      nextStatus: 'removed',
      variant: 'secondary',
      confirmTitle: 'Solicitar remoção do SPC',
      confirmDescription:
        'O cliente será marcado como removido do SPC. Certifique-se de que o débito foi regularizado antes de remover. Deseja continuar?',
    },
  ],
  removed: [
    {
      label: 'Solicitar inclusão no SPC',
      nextStatus: 'pending_inclusion',
      variant: 'outline',
      confirmTitle: 'Solicitar reinclusão no SPC',
      confirmDescription:
        'O cliente será marcado como pendente de reinclusão no SPC. Deseja continuar?',
    },
  ],
};

// ---------------------------------------------------------------------------
// Modal de confirmação inline
// ---------------------------------------------------------------------------

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmModal({
  isOpen,
  title,
  description,
  isPending,
  onConfirm,
  onCancel,
}: ConfirmModalProps): React.JSX.Element | null {
  // Fecha com Escape
  React.useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  // Portal ao body para escapar o stacking context do drawer (transform cria novo contexto).
  return ReactDOM.createPortal(
    /* Backdrop */
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: 'rgba(10,18,40,0.6)', backdropFilter: 'blur(4px)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="spc-modal-title"
    >
      {/* Panel — DS §9.3 / §7 elev-5 */}
      <div
        className="relative mx-4 w-full max-w-sm rounded-lg border border-border bg-surface-1 p-6 flex flex-col gap-5"
        style={{ boxShadow: 'var(--elev-5)' }}
      >
        {/* Inset highlight superior (profundidade DS) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-lg"
          style={{ background: 'var(--border-inner-light)' }}
        />

        {/* Cabeçalho */}
        <div className="flex flex-col gap-1.5">
          <h2
            id="spc-modal-title"
            className="font-sans font-bold text-ink"
            style={{ fontSize: 'var(--text-lg)', letterSpacing: '-0.025em' }}
          >
            {title}
          </h2>
          <p className="font-sans text-sm text-ink-3" style={{ lineHeight: 1.5 }}>
            {description}
          </p>
        </div>

        {/* Ações */}
        <div className="flex justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={isPending}>
            Cancelar
          </Button>
          <Button variant="primary" size="sm" onClick={onConfirm} disabled={isPending}>
            {isPending ? 'Aguarde...' : 'Confirmar'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

interface SpcActionButtonProps {
  customerId: string;
  currentStatus: SpcStatus;
  /** Chamado após atualização bem-sucedida (opcional — mutation já invalida queries) */
  onSuccess?: () => void;
  className?: string;
}

/** Roles com poder de confirmação direta — sem etapa pending_inclusion. */
const MANAGER_ROLES = new Set(['admin', 'gestor_geral', 'superadmin']);

/**
 * Botão(ões) de ação SPC com modal de confirmação.
 * Exige permissão spc:manage — retorna null se ausente.
 * Managers (admin/gestor_geral) pulam pending_inclusion e incluem diretamente.
 * Desabilita durante a requisição (idempotência por UI).
 */
export function SpcActionButton({
  customerId,
  currentStatus,
  onSuccess,
  className,
}: SpcActionButtonProps): React.JSX.Element | null {
  const { hasPermission } = useAuth();
  const mutation = useUpdateSpcStatus();

  const [pendingTransition, setPendingTransition] = React.useState<SpcTransition | null>(null);

  // Gate de permissão
  if (!hasPermission('spc:manage')) return null;

  // Managers (role key retornado pelo backend junto com permissions) pulam pending_inclusion.
  const isManager = [...MANAGER_ROLES].some((r) => hasPermission(r));

  const baseTransitions = SPC_TRANSITIONS[currentStatus];
  // Para managers, substitui pending_inclusion por included na transição de 'none'
  const transitions =
    isManager && currentStatus === 'none'
      ? [
          {
            label: 'Incluir no SPC',
            nextStatus: 'included' as const,
            variant: 'danger' as const,
            confirmTitle: 'Incluir cliente no SPC',
            confirmDescription:
              'O cliente será registrado como incluído no SPC imediatamente. Essa ação é registrada no histórico de cobrança. Deseja confirmar?',
          },
        ]
      : baseTransitions;
  if (!transitions || transitions.length === 0) return null;

  function handleClick(transition: SpcTransition) {
    setPendingTransition(transition);
  }

  function handleConfirm() {
    if (!pendingTransition) return;
    const { nextStatus } = pendingTransition;
    mutation.mutate(
      { customerId, status: nextStatus },
      {
        onSuccess: () => {
          setPendingTransition(null);
          onSuccess?.();
        },
        onError: () => {
          // Modal permanece aberto para o usuário tentar novamente
        },
      },
    );
  }

  function handleCancel() {
    if (mutation.isPending) return; // Não fechar durante requisição ativa
    setPendingTransition(null);
  }

  return (
    <>
      <div className={`flex flex-wrap gap-2 ${className ?? ''}`}>
        {transitions.map((t) => (
          <Button
            key={t.nextStatus}
            variant={t.variant}
            size="sm"
            onClick={() => handleClick(t)}
            disabled={mutation.isPending}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {/* Erro inline (abaixo dos botões) */}
      {mutation.isError && !pendingTransition && (
        <p className="mt-2 font-sans text-xs" style={{ color: 'var(--danger)' }} role="alert">
          {mutation.error?.message ?? 'Erro ao atualizar status SPC. Tente novamente.'}
        </p>
      )}

      {/* Modal de confirmação */}
      <ConfirmModal
        isOpen={pendingTransition !== null}
        title={pendingTransition?.confirmTitle ?? ''}
        description={pendingTransition?.confirmDescription ?? ''}
        isPending={mutation.isPending}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </>
  );
}
