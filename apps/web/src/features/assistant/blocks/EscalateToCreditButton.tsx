// =============================================================================
// features/assistant/blocks/EscalateToCreditButton.tsx — CTA "Escalar ao
// Crédito" no card `lead_summary` do copiloto interno (F6-S31).
//
// Ação secundária (Button variant="outline" size="sm") — não compete com a
// leitura do card. Visível apenas com a permissão `assistant:escalate`
// (concedida aos 5 roles operacionais, migration 0088 — `leitura` não tem).
// Gating client-side é defesa em profundidade: o backend também aplica
// authorize() na rota (fonte de verdade).
//
// Fluxo human-in-the-loop (doc 22 §12): clique → EscalateToCreditModal
// (confirmação explícita) → POST /api/assistant/escalate. A IA nunca chama
// este fluxo sozinha.
//
// Idempotência honesta: a resposta de sucesso é sempre lida de
// `already_escalated` — se true, o texto exibido reflete que NENHUMA
// notificação nova foi disparada (janela de 1h), nunca finge um novo envio.
// =============================================================================

import * as React from 'react';

import type { EscalateLeadResponse } from '../../../hooks/assistant/useEscalateLead';
import { useAuthStore } from '../../../lib/auth-store';

import { EscalateToCreditModal } from './EscalateToCreditModal';
import { formatDateBR, formatTimeBR } from './format';
import { SendToIcon } from './icons';

interface EscalateToCreditButtonProps {
  leadId: string;
}

export function EscalateToCreditButton({
  leadId,
}: EscalateToCreditButtonProps): React.JSX.Element | null {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canEscalate = hasPermission('assistant:escalate');

  const [modalOpen, setModalOpen] = React.useState(false);
  const [result, setResult] = React.useState<EscalateLeadResponse | null>(null);

  if (!canEscalate) return null;

  const handleSuccess = (data: EscalateLeadResponse): void => {
    setResult(data);
    setModalOpen(false);
  };

  if (result) {
    const label = result.already_escalated
      ? `Este lead já havia sido encaminhado ao Crédito às ${formatTimeBR(result.escalated_at)} de ${formatDateBR(result.escalated_at)}.`
      : `Crédito notificado — ${result.recipient_count} pessoa${result.recipient_count === 1 ? '' : 's'} avisada${result.recipient_count === 1 ? '' : 's'}.`;

    return (
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-sm border self-start"
        style={{ background: 'var(--success-bg)', borderColor: 'var(--success)' }}
        role="status"
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          className="w-4 h-4 shrink-0"
          style={{ color: 'var(--success)' }}
          aria-hidden="true"
        >
          <path d="M3 8l3.5 3.5 6.5-7" />
        </svg>
        <p className="font-sans text-xs leading-snug" style={{ color: 'var(--success)' }}>
          {label}
        </p>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="inline-flex items-center gap-1.5 self-start rounded-sm border border-border-strong bg-surface-1 px-3 py-1.5 font-sans font-semibold text-ink-2 transition-all duration-fast ease-out hover:border-azul hover:text-azul hover:shadow-e1 hover:-translate-y-px active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/40"
        style={{ fontSize: 'var(--text-xs)', minHeight: 40 }}
      >
        <SendToIcon className="w-3.5 h-3.5 shrink-0" />
        Escalar ao Crédito
      </button>

      {modalOpen && (
        <EscalateToCreditModal
          leadId={leadId}
          onClose={() => setModalOpen(false)}
          onSuccess={handleSuccess}
        />
      )}
    </>
  );
}
