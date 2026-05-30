// =============================================================================
// features/billing/components/BillingGatedBanner.tsx — Banner módulo em desenv.
//
// Exibido quando feature flag 'billing.enabled' está desligada.
// DS §9.6 Alert — border-left warning, fundo --warning-bg.
// =============================================================================
import * as React from 'react';

/**
 * Banner warning para quando o módulo de cobrança está desligado.
 * Visível nas 3 páginas (dues + rules + jobs) quando billing.enabled=disabled.
 */
export function BillingGatedBanner(): React.JSX.Element {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex items-start gap-3 rounded-sm px-4 py-3"
      style={{
        background: 'var(--warning-bg)',
        borderLeft: '3px solid var(--warning)',
        boxShadow: 'var(--elev-1)',
      }}
    >
      {/* Ícone */}
      <svg
        viewBox="0 0 20 20"
        fill="currentColor"
        className="w-5 h-5 shrink-0 mt-0.5"
        style={{ color: 'var(--warning)' }}
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
          clipRule="evenodd"
        />
      </svg>

      <div className="flex flex-col gap-0.5">
        <span
          className="font-sans font-semibold"
          style={{ fontSize: 'var(--text-sm)', color: 'var(--warning)' }}
        >
          Módulo de cobrança em desenvolvimento
        </span>
        <span className="font-sans" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-2)' }}>
          Os envios automáticos de cobrança estão desligados. Você pode configurar as réguas agora —
          elas só dispararão quando a feature for ativada pelo administrador no Hub de
          Configurações.
        </span>
      </div>
    </div>
  );
}
