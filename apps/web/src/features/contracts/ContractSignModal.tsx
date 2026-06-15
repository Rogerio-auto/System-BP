// =============================================================================
// features/contracts/ContractSignModal.tsx — Confirmação de assinatura (F17-S05).
//
// Transição: draft → signed.
// Gate: caller verifica contracts:sign antes de abrir o modal.
//
// DS:
//   - Overlay: bg-[var(--text)]/60 backdrop-blur-[4px] (padrão F5-S05).
//   - Diálogo: --elev-5, border --border, bg --bg-elev-1 (DS §9 modal).
//   - Bricolage Grotesque para título, Geist para corpo.
//   - Botão primário desabilitado durante isPending.
//
// LGPD: exibe apenas contract_reference — sem CPF, telefone ou email.
// =============================================================================

import * as React from 'react';

import { Button } from '../../components/ui/Button';

import type { Contract } from './schemas';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ContractSignModalProps {
  contract: Contract;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(value: string): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(parseFloat(value));
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function ContractSignModal({
  contract,
  onConfirm,
  onCancel,
  isPending,
}: ContractSignModalProps): React.JSX.Element {
  // Fechar com Escape
  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape' && !isPending) onCancel();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isPending, onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'color-mix(in srgb, var(--text) 60%, transparent)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sign-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isPending) onCancel();
      }}
    >
      {/* Painel do diálogo — DS §9 modal: elev-5, border, bg-elev-1 */}
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
            id="sign-modal-title"
            className="font-display font-bold text-ink"
            style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.03em' }}
          >
            Marcar como assinado
          </h2>
          <p className="font-sans text-ink-2" style={{ fontSize: 'var(--text-sm)' }}>
            Esta ação registra a assinatura do contrato e avança o status de{' '}
            <strong>Rascunho</strong> para <strong>Assinado</strong>. Não pode ser desfeita
            diretamente.
          </p>
        </div>

        {/* Resumo do contrato */}
        <div
          className="rounded-sm px-4 py-3 flex flex-col gap-2"
          style={{ background: 'var(--bg-elev-2)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center justify-between">
            <span className="font-sans text-ink-3" style={{ fontSize: 'var(--text-xs)' }}>
              Referência
            </span>
            <span
              className="font-mono font-semibold text-azul"
              style={{ fontSize: 'var(--text-sm)' }}
            >
              {contract.contract_reference}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="font-sans text-ink-3" style={{ fontSize: 'var(--text-xs)' }}>
              Valor principal
            </span>
            <span className="font-mono font-bold text-ink" style={{ fontSize: 'var(--text-base)' }}>
              {formatCurrency(contract.principal_amount)}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="font-sans text-ink-3" style={{ fontSize: 'var(--text-xs)' }}>
              Prazo
            </span>
            <span className="font-mono text-ink-2" style={{ fontSize: 'var(--text-sm)' }}>
              {contract.term_months} {contract.term_months === 1 ? 'mês' : 'meses'}
            </span>
          </div>

          {contract.first_due_date && (
            <div className="flex items-center justify-between">
              <span className="font-sans text-ink-3" style={{ fontSize: 'var(--text-xs)' }}>
                1ª parcela
              </span>
              <span className="font-mono text-ink-2" style={{ fontSize: 'var(--text-sm)' }}>
                {new Date(`${contract.first_due_date}T00:00:00`).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })}
              </span>
            </div>
          )}
        </div>

        {/* Ações */}
        <div className="flex flex-col gap-2.5">
          <Button
            variant="primary"
            onClick={onConfirm}
            disabled={isPending}
            className="w-full justify-center"
          >
            {isPending ? 'Assinando...' : 'Confirmar assinatura'}
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
