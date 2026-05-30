// =============================================================================
// features/billing/components/MarkPaidModal.tsx — Modal de marcação manual.
//
// Permite marcar parcela como "paga" ou "renegociada" com confirmação.
//
// DS:
//   - Overlay: bg-[var(--text)]/60 backdrop-blur-[4px]  (padrão F5-S05 fix).
//   - Modal: --elev-5, border --border, bg --bg-elev-1.
//   - Bricolage Grotesque para título, Geist para corpo.
//   - Botões primários/perigo seguem DS.
//
// LGPD:
//   - Não exibe CPF nem telefone — apenas contract_reference e customer_name curto.
// =============================================================================
import * as React from 'react';

import { Button } from '../../../components/ui/Button';
import type { PaymentDueResponse } from '../schemas';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MarkPaidModalProps {
  due: PaymentDueResponse;
  onMarkPaid: () => void;
  onRenegotiate: () => void;
  onCancel: () => void;
  isPending: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MarkPaidModal({
  due,
  onMarkPaid,
  onRenegotiate,
  onCancel,
  isPending,
}: MarkPaidModalProps): React.JSX.Element {
  // Format amount BR style
  const amountFormatted = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(parseFloat(due.amount));

  // Format due_date BR style
  const dueDateFormatted = new Date(`${due.due_date}T00:00:00`).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--text)]/60 backdrop-blur-[4px]"
      role="dialog"
      aria-modal="true"
      aria-label="Registrar pagamento"
      // Fechar ao clicar fora
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="w-full max-w-md rounded-md flex flex-col gap-6 p-6"
        style={{
          background: 'var(--bg-elev-1)',
          boxShadow: 'var(--elev-5)',
          border: '1px solid var(--border)',
          animation: 'fade-up 200ms var(--ease-out) both',
        }}
      >
        {/* Header */}
        <div className="flex flex-col gap-1.5">
          <h2
            className="font-display font-bold text-ink"
            style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.03em' }}
          >
            Registrar pagamento
          </h2>
          <p className="font-sans text-ink-2" style={{ fontSize: 'var(--text-sm)' }}>
            Escolha a ação para a parcela abaixo. Esta ação cancela as cobranças automáticas
            agendadas.
          </p>
        </div>

        {/* Detalhes da parcela — sem PII */}
        <div
          className="rounded-sm px-4 py-3 flex flex-col gap-2"
          style={{ background: 'var(--bg-elev-2)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center justify-between">
            <span className="font-sans text-ink-3" style={{ fontSize: 'var(--text-xs)' }}>
              Cliente
            </span>
            <span className="font-sans font-medium text-ink" style={{ fontSize: 'var(--text-sm)' }}>
              {due.customer_name ?? '—'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-sans text-ink-3" style={{ fontSize: 'var(--text-xs)' }}>
              Contrato
            </span>
            <span
              className="font-mono font-medium text-azul"
              style={{ fontSize: 'var(--text-sm)' }}
            >
              {due.contract_reference}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-sans text-ink-3" style={{ fontSize: 'var(--text-xs)' }}>
              Parcela
            </span>
            <span className="font-mono font-medium text-ink" style={{ fontSize: 'var(--text-sm)' }}>
              #{due.installment_number}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-sans text-ink-3" style={{ fontSize: 'var(--text-xs)' }}>
              Valor
            </span>
            <span className="font-mono font-bold text-ink" style={{ fontSize: 'var(--text-base)' }}>
              {amountFormatted}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-sans text-ink-3" style={{ fontSize: 'var(--text-xs)' }}>
              Vencimento
            </span>
            <span className="font-mono text-ink-2" style={{ fontSize: 'var(--text-sm)' }}>
              {dueDateFormatted}
            </span>
          </div>
        </div>

        {/* Ações */}
        <div className="flex flex-col gap-2.5">
          <Button
            variant="primary"
            onClick={onMarkPaid}
            disabled={isPending}
            className="w-full justify-center"
          >
            {isPending ? 'Registrando...' : 'Marcar como paga'}
          </Button>
          <Button
            variant="outline"
            onClick={onRenegotiate}
            disabled={isPending}
            className="w-full justify-center"
          >
            Marcar como renegociada
          </Button>
          <Button
            variant="ghost"
            onClick={onCancel}
            disabled={isPending}
            className="w-full justify-center"
          >
            Cancelar
          </Button>
        </div>
      </div>
    </div>
  );
}
