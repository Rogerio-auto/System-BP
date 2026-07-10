// =============================================================================
// features/ai-actions/components/AiActionsThresholds.tsx
//
// Bloco de configuração dos limiares do worker funnel-housekeeping
// (stagnant_after_days / abandon_after_days — doc 22 §7.2).
//
// IMPORTANTE — só leitura + aviso:
//   O backend do F25-S06 NÃO expõe endpoint HTTP de configuração. A tabela
//   `ai_funnel_settings` (apps/api/src/db/schema/aiFunnelSettings.ts) existe
//   e é lida pelo worker (apps/api/src/workers/funnel-housekeeping.ts), mas
//   não há GET/PUT em apps/api/src/modules/ai-actions/routes.ts nem em
//   nenhum outro módulo. Expor esse endpoint está fora do escopo do F25-S07
//   (files_allowed não inclui apps/api) — conforme instruído no próprio slot,
//   esta seção entrega apenas leitura dos valores padrão documentados +
//   aviso de que a edição ainda não tem interface administrativa.
//
// Gated por ai_actions:manage (AiActionsPage.tsx).
// =============================================================================

import * as React from 'react';

// Defaults documentados em doc 22 §7.2 / aiFunnelSettings.ts — únicos valores
// que podem ser exibidos sem um endpoint de leitura por organização.
const DEFAULT_STAGNANT_AFTER_DAYS = 7;
const DEFAULT_ABANDON_AFTER_DAYS = 30;

export function AiActionsThresholds(): React.JSX.Element {
  return (
    <section
      className="rounded-lg border border-border overflow-hidden"
      style={{ boxShadow: 'var(--elev-2)' }}
      aria-labelledby="ai-thresholds-title"
    >
      <div
        className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border"
        style={{ background: 'var(--bg-elev-2)' }}
      >
        <h2
          id="ai-thresholds-title"
          className="font-display font-bold text-ink"
          style={{ fontSize: 'var(--text-base)', letterSpacing: '-0.02em' }}
        >
          Limiares do agente proativo
        </h2>
      </div>

      <div className="p-4 flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div
            className="flex flex-col gap-1 p-3 rounded-md border border-border"
            style={{ background: 'var(--bg-elev-2)' }}
          >
            <span className="font-sans uppercase tracking-widest text-ink-3 text-xs">
              Estagnação após
            </span>
            <span
              className="font-mono font-semibold text-ink"
              style={{ fontSize: 'var(--text-lg)' }}
            >
              {DEFAULT_STAGNANT_AFTER_DAYS} dias
            </span>
          </div>
          <div
            className="flex flex-col gap-1 p-3 rounded-md border border-border"
            style={{ background: 'var(--bg-elev-2)' }}
          >
            <span className="font-sans uppercase tracking-widest text-ink-3 text-xs">
              Abandono após
            </span>
            <span
              className="font-mono font-semibold text-ink"
              style={{ fontSize: 'var(--text-lg)' }}
            >
              {DEFAULT_ABANDON_AFTER_DAYS} dias
            </span>
          </div>
        </div>

        <div
          className="flex items-start gap-3 p-3 rounded-md border"
          style={{ background: 'var(--warning-bg)', borderColor: 'var(--brand-amarelo)' }}
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
            Valores padrão da plataforma. A edição por organização ainda não tem interface
            administrativa — apenas o time técnico pode ajustar esses limiares diretamente no banco
            de dados. Fale com o time técnico para alterar.
          </p>
        </div>
      </div>
    </section>
  );
}
