// =============================================================================
// features/simulator/AmortizationTable.tsx — Tabela Price de amortização (F2-S06).
//
// DS §9.7: wrapper elev-3, th caption-style, td JetBrains Mono para valores,
// hover de linha, overflow vertical com max-h.
// Colunas: #, Principal, Juros, Parcela, Saldo.
// =============================================================================

import * as React from 'react';

import type { AmortizationRow } from '../../hooks/simulator/types';
import { formatBRL } from '../../hooks/simulator/types';
import { cn } from '../../lib/cn';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface AmortizationTableProps {
  rows: AmortizationRow[];
  className?: string;
}

// ─── Componente ──────────────────────────────────────────────────────────────

/**
 * Tabela de amortização Price com rolagem vertical.
 * Valores em JetBrains Mono (DS §9.7 classe td-amount).
 * Wrapper elev-3 conforme DS §9.2 Card para tabela.
 */
export function AmortizationTable({ rows, className }: AmortizationTableProps): React.JSX.Element {
  return (
    <div
      className={cn('rounded-md border border-border overflow-hidden', className)}
      style={{ boxShadow: 'var(--elev-3)' }}
    >
      {/* Cabeçalho fixo */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" aria-label="Tabela de amortização">
          <thead>
            <tr className="bg-surface-2 border-b border-border">
              {(['#', 'Principal', 'Juros', 'Parcela', 'Saldo'] as const).map((col) => (
                <th
                  key={col}
                  scope="col"
                  className={cn(
                    'px-4 py-3',
                    'font-sans text-[10px] font-bold uppercase tracking-[0.12em] text-ink-3',
                    col === '#' ? 'text-left w-10' : 'text-right',
                  )}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
        </table>
      </div>

      {/* Body com scroll */}
      <div className="overflow-y-auto max-h-72 overflow-x-auto">
        <table className="w-full border-collapse">
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={row.month}
                className={cn(
                  'border-b border-border-subtle last:border-0',
                  'transition-colors duration-fast ease',
                  'hover:bg-surface-hover',
                  idx % 2 === 0 ? 'bg-surface-1' : 'bg-[var(--bg)]',
                )}
              >
                {/* Número da parcela */}
                <td className="px-4 py-[14px] text-left font-sans text-xs font-semibold text-ink-3 w-10">
                  {row.month}
                </td>

                {/* Principal */}
                <td
                  className="px-4 py-[14px] text-right font-medium text-sm text-ink-2"
                  style={{ fontFamily: 'var(--font-mono)', letterSpacing: '-0.01em' }}
                >
                  {formatBRL(row.principal)}
                </td>

                {/* Juros */}
                <td
                  className="px-4 py-[14px] text-right font-medium text-sm"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    letterSpacing: '-0.01em',
                    color: 'var(--warning)',
                  }}
                >
                  {formatBRL(row.interest)}
                </td>

                {/* Parcela */}
                <td
                  className="px-4 py-[14px] text-right font-semibold text-sm text-ink"
                  style={{ fontFamily: 'var(--font-mono)', letterSpacing: '-0.01em' }}
                >
                  {formatBRL(row.installment)}
                </td>

                {/* Saldo */}
                <td
                  className="px-4 py-[14px] text-right font-medium text-sm text-ink-2"
                  style={{ fontFamily: 'var(--font-mono)', letterSpacing: '-0.01em' }}
                >
                  {formatBRL(row.balance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Rodapé com contagem */}
      <div className="px-4 py-2 border-t border-border-subtle bg-surface-2">
        <p className="font-sans text-[10px] text-ink-3">
          {rows.length} parcela{rows.length !== 1 ? 's' : ''} no total
        </p>
      </div>
    </div>
  );
}
