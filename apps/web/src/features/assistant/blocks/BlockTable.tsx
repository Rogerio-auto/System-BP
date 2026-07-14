// =============================================================================
// features/assistant/blocks/BlockTable.tsx — Tabela compacta reutilizável
// pelos cards de bloco (DS §9.7): wrapper elev-1, th caption-style, hover de
// linha, sem valor abaixo de --text-xs.
// =============================================================================

import * as React from 'react';

interface BlockTableProps {
  columns: string[];
  rows: React.ReactNode[][];
  emptyMessage?: string;
}

export function BlockTable({
  columns,
  rows,
  emptyMessage = 'Sem dados para exibir.',
}: BlockTableProps): React.JSX.Element {
  if (rows.length === 0) {
    return <p className="font-sans text-xs text-ink-4 italic">{emptyMessage}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-sm border border-border-subtle shadow-e1">
      <table className="w-full text-xs border-collapse">
        <thead className="bg-surface-2">
          <tr>
            {columns.map((col) => (
              <th
                key={col}
                className="text-left font-bold uppercase tracking-wide text-ink-3 px-2.5 py-1.5 border-b border-border-subtle"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr:last-child>td]:border-b-0">
          {rows.map((cells, rowIdx) => (
            <tr key={rowIdx} className="transition-colors duration-fast hover:bg-surface-hover">
              {cells.map((cell, cellIdx) => (
                <td
                  key={cellIdx}
                  className="px-2.5 py-1.5 border-b border-border-subtle text-ink-2 font-medium"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
