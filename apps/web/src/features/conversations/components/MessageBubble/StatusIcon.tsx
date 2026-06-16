// =============================================================================
// MessageBubble/StatusIcon.tsx — Ícone de status de mensagem outbound.
//
// Estados:
//   sent      → 1 checkmark cinza (enviado ao servidor)
//   delivered → 2 checkmarks cinzas (entregue ao dispositivo)
//   read      → 2 checkmarks azuis (lido pelo destinatário)
//   failed    → X vermelho (falha no envio)
//
// Uso: apenas em mensagens outbound (direction === 'out').
// Renderizado inline ao lado do timestamp.
// =============================================================================

import * as React from 'react';

import type { ViewStatus } from '../../types';

interface StatusIconProps {
  status: ViewStatus;
  /** Tamanho do ícone em pixels. Default: 14. */
  size?: number;
}

/**
 * StatusIcon — Ícone de status de entrega/leitura da mensagem.
 *
 * DS: success para read, text-3 para sent/delivered, danger para failed.
 */
export function StatusIcon({ status, size = 14 }: StatusIconProps): React.JSX.Element {
  if (status === 'failed') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 14 14"
        fill="none"
        aria-label="Falha no envio"
        role="img"
        className="inline-block shrink-0"
      >
        <circle cx="7" cy="7" r="6" stroke="var(--danger)" strokeWidth="1.4" />
        <path
          d="M5 5l4 4M9 5l-4 4"
          stroke="var(--danger)"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (status === 'read') {
    return (
      <svg
        width={size + 4}
        height={size}
        viewBox="0 0 18 14"
        fill="none"
        aria-label="Lida"
        role="img"
        className="inline-block shrink-0"
      >
        {/* Dois checkmarks azuis */}
        <path
          d="M1 7l4 4 8-8"
          stroke="var(--brand-azul)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M5 7l4 4 8-8"
          stroke="var(--brand-azul)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (status === 'delivered') {
    return (
      <svg
        width={size + 4}
        height={size}
        viewBox="0 0 18 14"
        fill="none"
        aria-label="Entregue"
        role="img"
        className="inline-block shrink-0"
      >
        {/* Dois checkmarks cinzas */}
        <path
          d="M1 7l4 4 8-8"
          stroke="var(--text-3)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M5 7l4 4 8-8"
          stroke="var(--text-3)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  // sent (pending também cai aqui)
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      aria-label="Enviada"
      role="img"
      className="inline-block shrink-0"
    >
      <path
        d="M2 7l4 4 6-6"
        stroke="var(--text-3)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
