// =============================================================================
// features/assistant/blocks/BlockCardUnavailable.tsx — Corpo "dado
// indisponível" (F6-S22). Usado hoje como fallback defensivo quando o
// `value` de um bloco conhecido não bate com a forma esperada (guards.ts).
// Na Fase 3 (docs/anexos/lgpd/dpia-historico-copiloto.md) o mesmo estado
// passa a ser usado de verdade: um bloco referenciado no histórico cujo
// titular o usuário não tem mais acesso (RBAC/escopo mudou desde a consulta
// original) renderiza este componente em vez do dado.
// =============================================================================

import * as React from 'react';

import { InboxOffIcon } from './icons';

interface BlockCardUnavailableProps {
  reason?: string;
}

export function BlockCardUnavailable({ reason }: BlockCardUnavailableProps): React.JSX.Element {
  return (
    <div
      className="flex items-center gap-3 rounded-sm border border-dashed border-border-subtle px-3 py-3"
      style={{ background: 'var(--bg-elev-2)' }}
    >
      <span className="shrink-0 text-ink-4">
        <InboxOffIcon className="w-5 h-5" />
      </span>
      <div>
        <p className="font-sans text-sm font-semibold text-ink-3">Dado indisponível</p>
        <p className="font-sans text-xs text-ink-4 mt-0.5">
          {reason ?? 'Não foi possível carregar esta informação com o acesso atual.'}
        </p>
      </div>
    </div>
  );
}
