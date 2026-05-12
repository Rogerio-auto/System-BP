// =============================================================================
// features/imports/components/StepMapping.tsx
//
// Passo 2: Mapeamento de colunas do arquivo → campos do sistema.
//
// Layout:
//   - Tabela: coluna arquivo (esq) + select de destino (dir) + preview 3 linhas
//   - Select do DS canônico
//   - Preview de 3 linhas abaixo de cada mapping (sub-tabela densa)
//
// Estado derivado: columnMapping — Record<origem, destino|"">
// =============================================================================

import * as React from 'react';

import { Select } from '../../../components/ui/Select';
import type { ImportPreviewRow } from '../../../lib/api/imports';
import { cn } from '../../../lib/cn';
import { maskPiiValue } from '../../../lib/format/pii';

// Campos de destino disponíveis para leads
const LEAD_DESTINATION_FIELDS = [
  { value: '', label: '— Ignorar coluna —' },
  { value: 'display_name', label: 'Nome' },
  { value: 'primary_phone', label: 'Telefone principal' },
  { value: 'secondary_phone', label: 'Telefone secundário' },
  { value: 'email', label: 'E-mail' },
  { value: 'cpf', label: 'CPF' },
  { value: 'cnpj', label: 'CNPJ' },
  { value: 'city', label: 'Cidade' },
  { value: 'state', label: 'Estado' },
  { value: 'source', label: 'Origem' },
  { value: 'notes', label: 'Observações' },
  { value: 'stage', label: 'Estágio' },
  { value: 'amount_requested', label: 'Valor solicitado' },
];

// Sugestão automática fuzzy por nome de coluna
function suggestDestination(columnName: string): string {
  const lower = columnName.toLowerCase().replace(/[_\-\s]/g, '');
  const rules: Array<[string[], string]> = [
    [['nome', 'name', 'razaosocial', 'razão', 'cliente'], 'display_name'],
    [['telefone', 'phone', 'celular', 'cel', 'fone', 'contato'], 'primary_phone'],
    [['telefone2', 'phone2', 'celular2', 'outrophone', 'outrotelefone'], 'secondary_phone'],
    [['email', 'mail', 'correio'], 'email'],
    [['cpf', 'documentocpf', 'doc'], 'cpf'],
    [['cnpj', 'documentocnpj'], 'cnpj'],
    [['cidade', 'city', 'municipio', 'municipio'], 'city'],
    [['estado', 'state', 'uf'], 'state'],
    [['origem', 'source', 'canal', 'procedencia'], 'source'],
    [['obs', 'observacao', 'notas', 'notes', 'comentario'], 'notes'],
    [['estagio', 'stage', 'status', 'etapa'], 'stage'],
    [['valor', 'amount', 'solicitado', 'valorsolicitado'], 'amount_requested'],
  ];

  for (const [keywords, dest] of rules) {
    if (keywords.some((kw) => lower.includes(kw))) return dest;
  }
  return '';
}

export interface ColumnMapping {
  [sourceColumn: string]: string;
}

interface StepMappingProps {
  /** Colunas detectadas no arquivo */
  columns: string[];
  /** Amostra de linhas para preview (máx 3) */
  sampleRows: ImportPreviewRow[];
  columnMapping: ColumnMapping;
  onMappingChange: (mapping: ColumnMapping) => void;
}

export function StepMapping({
  columns,
  sampleRows,
  columnMapping,
  onMappingChange,
}: StepMappingProps): React.JSX.Element {
  // Inicializa com sugestões automáticas quando columns chegam
  React.useEffect(() => {
    if (columns.length === 0) return;
    const initial: ColumnMapping = {};
    columns.forEach((col) => {
      initial[col] = columnMapping[col] ?? suggestDestination(col);
    });
    onMappingChange(initial);
  }, [columns.join(',')]);

  function handleDestinationChange(sourceCol: string, destField: string): void {
    onMappingChange({ ...columnMapping, [sourceCol]: destField });
  }

  const previewRows = sampleRows.slice(0, 3);

  if (columns.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <MappingHeader />
        <EmptyColumns />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <MappingHeader />

      {/* Tabela de mapeamento */}
      <div
        className="rounded-md border border-border overflow-hidden"
        style={{ boxShadow: 'var(--elev-2)' }}
      >
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border" style={{ background: 'var(--bg-elev-2)' }}>
              <th
                scope="col"
                className="px-4 py-3 text-left font-sans font-semibold text-xs text-ink-3 uppercase tracking-[0.08em]"
                style={{ width: '35%' }}
              >
                Coluna do arquivo
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left font-sans font-semibold text-xs text-ink-3 uppercase tracking-[0.08em]"
                style={{ width: '35%' }}
              >
                Campo de destino
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left font-sans font-semibold text-xs text-ink-3 uppercase tracking-[0.08em]"
              >
                Prévia (3 linhas)
              </th>
            </tr>
          </thead>
          <tbody>
            {columns.map((col, idx) => {
              const selectedDest = columnMapping[col] ?? '';
              const isIgnored = selectedDest === '';
              // L4 LGPD §14: aplica máscara de PII usando o campo de destino
              // mapeado (ou detecção de padrão no valor) — CPF é o crítico.
              const colPreviewValues = previewRows.map((row) => {
                const raw = row.rawData[col];
                if (raw === null || raw === undefined) return '—';
                const strVal = String(raw).trim() || '—';
                return maskPiiValue(strVal, selectedDest || undefined);
              });

              return (
                <tr
                  key={col}
                  className={cn(
                    'border-b border-border-subtle last:border-0',
                    'transition-colors duration-fast',
                    'hover:bg-surface-hover',
                    isIgnored && 'opacity-60',
                  )}
                  style={
                    idx % 2 === 0
                      ? { background: 'var(--bg-elev-1)' }
                      : { background: 'var(--bg-elev-2)' }
                  }
                >
                  {/* Coluna fonte */}
                  <td className="px-4 py-3 align-top">
                    <span
                      className="font-mono text-xs text-ink-2 px-2 py-1 rounded-xs"
                      style={{
                        background: 'var(--surface-muted)',
                        boxShadow: 'var(--elev-1)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {col}
                    </span>
                  </td>

                  {/* Select de destino */}
                  <td className="px-4 py-3 align-top">
                    <Select
                      id={`mapping-${col.replace(/\s+/g, '-')}`}
                      options={LEAD_DESTINATION_FIELDS}
                      value={selectedDest}
                      onChange={(e) => handleDestinationChange(col, e.target.value)}
                    />
                  </td>

                  {/* Preview 3 linhas */}
                  <td className="px-4 py-3 align-top">
                    <div className="flex flex-col gap-0.5">
                      {colPreviewValues.length > 0 ? (
                        colPreviewValues.map((val, i) => (
                          <span
                            key={i}
                            className={cn(
                              'font-sans text-xs block truncate max-w-[180px]',
                              val === '—' ? 'text-ink-4 italic' : 'text-ink-2',
                            )}
                            title={val !== '—' ? val : undefined}
                          >
                            {val}
                          </span>
                        ))
                      ) : (
                        <span className="font-sans text-xs text-ink-4 italic">
                          Sem dados de prévia
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Hint sobre colunas ignoradas */}
      <p className="font-sans text-xs text-ink-4">
        Colunas mapeadas como <span className="font-semibold text-ink-3">— Ignorar coluna —</span>{' '}
        não serão importadas.
      </p>
    </div>
  );
}

function MappingHeader(): React.JSX.Element {
  return (
    <div>
      <h2
        className="font-display font-bold text-ink leading-tight"
        style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.025em' }}
      >
        Mapeamento de colunas
      </h2>
      <p className="font-sans text-sm text-ink-3 mt-1">
        Associe cada coluna do arquivo ao campo correspondente no sistema. Sugestões automáticas já
        foram aplicadas — ajuste conforme necessário.
      </p>
    </div>
  );
}

function EmptyColumns(): React.JSX.Element {
  return (
    <div
      className="rounded-md border border-border p-8 flex flex-col items-center gap-3"
      style={{ boxShadow: 'var(--elev-1)', background: 'var(--bg-elev-1)' }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--text-4)"
        strokeWidth={1.5}
        className="w-10 h-10"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="3" y1="9" x2="21" y2="9" />
        <line x1="3" y1="15" x2="21" y2="15" />
        <line x1="9" y1="3" x2="9" y2="21" />
      </svg>
      <p className="font-sans text-sm text-ink-3">
        Nenhuma coluna detectada. O arquivo pode estar vazio ou em formato inválido.
      </p>
    </div>
  );
}
