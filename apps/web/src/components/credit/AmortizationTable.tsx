// =============================================================================
// components/credit/AmortizationTable.tsx — Tabela de amortização de crédito.
//
// DS §9.7 (Tabela):
//   - Wrapper bg-elev-1, elev-2, radius-md, overflow hidden.
//   - th: uppercase, tracking, peso 700, bg-elev-2, cor text-3.
//   - td: borda inferior border-subtle, peso 500.
//   - Hover de linha: bg surface-hover.
//   - Coluna de valor: JetBrains Mono.
//
// Componente compartilhado — usado em SimulationDetailModal (F2-S08)
// e potencialmente em outros slots de crédito.
// =============================================================================

import * as React from 'react';

import type {
  AmortizationMethod,
  AmortizationTableData,
  InstallmentRow,
} from '../../hooks/crm/types';

// ─── Formatadores ─────────────────────────────────────────────────────────────

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatPercent(decimal: number): string {
  return `${(decimal * 100).toFixed(2)}%`;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface AmortizationTableProps {
  /** Tabela de amortização completa */
  data: AmortizationTableData;
  /** Oculta colunas secundárias para exibição compacta */
  compact?: boolean;
}

// ─── Stats de resumo ──────────────────────────────────────────────────────────

interface StatsRowProps {
  monthlyPayment: number;
  totalAmount: number;
  totalInterest: number;
  rateMonthly: number;
  method: AmortizationMethod;
}

function StatsRow({
  monthlyPayment,
  totalAmount,
  totalInterest,
  rateMonthly,
  method,
}: StatsRowProps): React.JSX.Element {
  const stats: Array<{ label: string; value: string; highlight?: boolean }> = [
    {
      label: method === 'price' ? 'Parcela fixa' : '1ª Parcela',
      value: formatBRL(monthlyPayment),
      highlight: true,
    },
    { label: 'Total a pagar', value: formatBRL(totalAmount) },
    { label: 'Total de juros', value: formatBRL(totalInterest) },
    { label: 'Taxa mensal', value: formatPercent(rateMonthly) },
  ];

  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-4 gap-px border-b"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--border-subtle)' }}
    >
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="flex flex-col gap-1 px-4 py-3"
          style={{ background: 'var(--bg-elev-1)' }}
        >
          <span
            className="font-sans font-semibold uppercase"
            style={{ fontSize: '0.6rem', letterSpacing: '0.1em', color: 'var(--text-3)' }}
          >
            {stat.label}
          </span>
          <span
            className="font-bold"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: stat.highlight ? '1rem' : '0.875rem',
              letterSpacing: '-0.02em',
              color: stat.highlight ? 'var(--brand-azul)' : 'var(--text-1)',
            }}
          >
            {stat.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Linha da tabela ──────────────────────────────────────────────────────────

function InstallmentTr({
  row,
  compact,
}: {
  row: InstallmentRow;
  compact: boolean;
}): React.JSX.Element {
  return (
    <tr
      className="group transition-colors duration-75"
      style={
        {
          '--row-hover-bg': 'var(--surface-hover)',
        } as React.CSSProperties
      }
    >
      <td
        className="px-4 py-2 text-right font-sans font-medium"
        style={{
          fontSize: '0.8rem',
          color: 'var(--text-3)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        {row.number}
      </td>
      <td
        className="px-4 py-2 text-right"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.8rem',
          fontWeight: 600,
          color: 'var(--text-1)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        {formatBRL(row.payment)}
      </td>
      <td
        className="px-4 py-2 text-right"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.8rem',
          color: 'var(--text-2)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        {formatBRL(row.principal)}
      </td>
      <td
        className="px-4 py-2 text-right"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.8rem',
          color: 'var(--text-2)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        {formatBRL(row.interest)}
      </td>
      {!compact && (
        <td
          className="px-4 py-2 text-right"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.8rem',
            color: 'var(--text-3)',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          {formatBRL(row.balance)}
        </td>
      )}
    </tr>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

/**
 * Tabela de amortização de crédito (DS §9.7).
 * Exibe stats de resumo + tabela de parcelas.
 */
export function AmortizationTable({
  data,
  compact = false,
}: AmortizationTableProps): React.JSX.Element {
  const firstInstallment = data.installments[0];
  const monthlyPayment = firstInstallment?.payment ?? 0;

  return (
    <div
      className="rounded-md overflow-hidden border"
      style={{
        background: 'var(--bg-elev-1)',
        boxShadow: 'var(--elev-2)',
        borderColor: 'var(--border)',
      }}
    >
      {/* Resumo de stats */}
      <StatsRow
        monthlyPayment={monthlyPayment}
        totalAmount={data.totalPayment}
        totalInterest={data.totalInterest}
        rateMonthly={data.monthlyRate}
        method={data.method}
      />

      {/* Tabela de parcelas */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" style={{ minWidth: compact ? 320 : 420 }}>
          <thead>
            <tr style={{ background: 'var(--bg-elev-2)' }}>
              {['#', 'Parcela', 'Principal', 'Juros', ...(!compact ? ['Saldo'] : [])].map((col) => (
                <th
                  key={col}
                  className="px-4 py-2.5 text-right first:text-center font-sans font-bold uppercase"
                  style={{
                    fontSize: '0.6rem',
                    letterSpacing: '0.1em',
                    color: 'var(--text-3)',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.installments.map((row) => (
              <InstallmentTr key={row.number} row={row} compact={compact} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
