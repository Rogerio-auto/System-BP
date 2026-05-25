// =============================================================================
// features/imports/components/NotionConfigStep.tsx
//
// Componente de configuração Notion para o wizard de importação (F7-S04).
//
// Permite ao usuário:
//   1. Informar o Database ID da database Notion a importar.
//   2. Definir o property mapping: coluna Notion → campo interno do lead.
//
// Property mapping é exibido como tabela editável (selects por linha).
// O usuário informa os nomes das colunas Notion e escolhe o campo destino.
//
// LGPD §12.1: Notion é suboperador internacional temporário (≤30 dias).
//   - Aviso exibido ao usuário sobre o período de operação.
//   - Database ID não é PII — é ID opaco da workspace Notion.
//
// Design: tokens do DS oficial (doc 18) — light-first, Bricolage + Geist.
// =============================================================================

import * as React from 'react';

import { cn } from '../../../lib/cn';
import { NOTION_SUPPORTED_TARGET_FIELDS, NOTION_TARGET_FIELD_LABELS } from '../constants.js';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface NotionPropertyMappingEntry {
  notionPropertyName: string;
  internalField: string;
}

export interface NotionConfig {
  databaseId: string;
  propertyMapping: Record<string, string>;
}

interface NotionConfigStepProps {
  value: NotionConfig;
  onChange: (config: NotionConfig) => void;
  error?: string | null;
}

// ---------------------------------------------------------------------------
// Linha do editor de mapeamento
// ---------------------------------------------------------------------------

interface MappingRowProps {
  index: number;
  entry: NotionPropertyMappingEntry;
  onUpdate: (index: number, entry: NotionPropertyMappingEntry) => void;
  onRemove: (index: number) => void;
}

function MappingRow({ index, entry, onUpdate, onRemove }: MappingRowProps): React.JSX.Element {
  return (
    <tr className="border-b border-border-subtle last:border-0">
      {/* Nome da propriedade Notion */}
      <td className="px-3 py-2">
        <input
          type="text"
          value={entry.notionPropertyName}
          placeholder="Ex: Nome"
          aria-label={`Nome da propriedade Notion (linha ${index + 1})`}
          className={cn(
            'w-full rounded-xs border border-border px-2.5 py-1.5',
            'font-mono text-sm text-ink',
            'bg-transparent placeholder:text-ink-4',
            'focus:outline-none focus:ring-2 focus:ring-azul/40',
            'transition-shadow duration-fast',
          )}
          onChange={(e) => onUpdate(index, { ...entry, notionPropertyName: e.target.value })}
        />
      </td>

      {/* Campo interno de destino */}
      <td className="px-3 py-2">
        <select
          value={entry.internalField}
          aria-label={`Campo de destino (linha ${index + 1})`}
          className={cn(
            'w-full rounded-xs border border-border px-2.5 py-1.5',
            'font-sans text-sm text-ink',
            'bg-transparent',
            'focus:outline-none focus:ring-2 focus:ring-azul/40',
            'transition-shadow duration-fast',
            'cursor-pointer',
          )}
          style={{ background: 'var(--bg-elev-1)' }}
          onChange={(e) => onUpdate(index, { ...entry, internalField: e.target.value })}
        >
          <option value="">— Selecionar campo —</option>
          {NOTION_SUPPORTED_TARGET_FIELDS.map((field) => (
            <option key={field} value={field}>
              {NOTION_TARGET_FIELD_LABELS[field] ?? field}
            </option>
          ))}
        </select>
      </td>

      {/* Botão remover */}
      <td className="px-3 py-2 text-right">
        <button
          type="button"
          onClick={() => onRemove(index)}
          aria-label={`Remover linha ${index + 1} do mapeamento`}
          className={cn(
            'rounded-xs p-1 text-ink-3',
            'hover:text-danger hover:bg-danger/10',
            'focus-visible:ring-2 focus-visible:ring-danger/40 outline-none',
            'transition-colors duration-fast',
          )}
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            className="w-4 h-4"
            aria-hidden="true"
          >
            <line x1="4" y1="4" x2="12" y2="12" />
            <line x1="12" y1="4" x2="4" y2="12" />
          </svg>
        </button>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

/**
 * NotionConfigStep — configuração de Database ID + property mapping.
 *
 * Renderiza fora do wizard principal — chamado quando o usuário seleciona
 * "Notion (database)" como fonte de importação.
 *
 * @example
 * <NotionConfigStep
 *   value={notionConfig}
 *   onChange={setNotionConfig}
 *   error={configError}
 * />
 */
export function NotionConfigStep({
  value,
  onChange,
  error,
}: NotionConfigStepProps): React.JSX.Element {
  // ── Estado local do editor de mapeamento ──────────────────────────────────
  const [rows, setRows] = React.useState<NotionPropertyMappingEntry[]>(() =>
    Object.entries(value.propertyMapping).map(([notionPropertyName, internalField]) => ({
      notionPropertyName,
      internalField,
    })),
  );

  // Sincroniza rows → propertyMapping no value
  const syncRows = React.useCallback(
    (nextRows: NotionPropertyMappingEntry[]) => {
      const propertyMapping: Record<string, string> = {};
      for (const row of nextRows) {
        if (row.notionPropertyName.trim() && row.internalField) {
          propertyMapping[row.notionPropertyName.trim()] = row.internalField;
        }
      }
      onChange({ ...value, propertyMapping });
    },
    [value, onChange],
  );

  function handleDatabaseIdChange(e: React.ChangeEvent<HTMLInputElement>): void {
    onChange({ ...value, databaseId: e.target.value.trim() });
  }

  function handleRowUpdate(index: number, entry: NotionPropertyMappingEntry): void {
    const nextRows = rows.map((r, i) => (i === index ? entry : r));
    setRows(nextRows);
    syncRows(nextRows);
  }

  function handleRowRemove(index: number): void {
    const nextRows = rows.filter((_, i) => i !== index);
    setRows(nextRows);
    syncRows(nextRows);
  }

  function handleAddRow(): void {
    const nextRows = [...rows, { notionPropertyName: '', internalField: '' }];
    setRows(nextRows);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6">
      {/* Aviso LGPD — Notion como suboperador temporário */}
      <div
        className="rounded-sm border border-warning/40 px-4 py-3 flex items-start gap-3"
        style={{ background: 'var(--warning-bg)', boxShadow: 'var(--elev-1)' }}
        role="note"
        aria-label="Aviso de privacidade sobre integração Notion"
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="var(--warning)"
          strokeWidth={1.8}
          className="w-4 h-4 shrink-0 mt-0.5"
          aria-hidden="true"
        >
          <path d="M8 1L15 14H1L8 1z" />
          <line x1="8" y1="6" x2="8" y2="9" />
          <circle cx="8" cy="11.5" r="0.5" fill="var(--warning)" />
        </svg>
        <div className="flex flex-col gap-0.5">
          <p className="font-sans font-semibold text-sm" style={{ color: 'var(--warning-text)' }}>
            Integração temporária — LGPD §12.1
          </p>
          <p className="font-sans text-xs text-ink-2">
            O Notion é um suboperador internacional ativo{' '}
            <strong>apenas durante a janela de migração (máx. 30 dias)</strong>. Os dados são
            transmitidos via HTTPS e a integração deve ser desativada após o cutover. Consulte o DPO
            para autorização formal.
          </p>
        </div>
      </div>

      {/* Database ID */}
      <div className="flex flex-col gap-2">
        <label htmlFor="notion-database-id" className="font-sans font-semibold text-sm text-ink">
          ID da Database Notion
          <span className="text-danger ml-1" aria-hidden="true">
            *
          </span>
        </label>
        <input
          id="notion-database-id"
          type="text"
          value={value.databaseId}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          aria-required="true"
          aria-describedby="notion-db-id-hint"
          className={cn(
            'w-full rounded-sm border border-border px-3 py-2',
            'font-mono text-sm text-ink',
            'bg-transparent placeholder:text-ink-4',
            'focus:outline-none focus:ring-2 focus:ring-azul/40',
            'transition-shadow duration-fast',
            error && value.databaseId.length === 0 ? 'border-danger ring-1 ring-danger/30' : '',
          )}
          style={{ background: 'var(--bg-elev-1)' }}
          onChange={handleDatabaseIdChange}
        />
        <p id="notion-db-id-hint" className="font-sans text-xs text-ink-3">
          Encontre o ID na URL da database: notion.so/workspace/
          <strong className="font-mono text-ink-2">xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx</strong>
          ?v=...
        </p>
      </div>

      {/* Editor de mapeamento de propriedades */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-sans font-semibold text-sm text-ink">Mapeamento de propriedades</h3>
            <p className="font-sans text-xs text-ink-3 mt-0.5">
              Relacione cada coluna da database Notion com o campo correspondente do lead.
            </p>
          </div>
        </div>

        <div
          className="rounded-md border border-border overflow-hidden"
          style={{ boxShadow: 'var(--elev-1)' }}
        >
          {rows.length > 0 ? (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border" style={{ background: 'var(--bg-elev-2)' }}>
                  <th
                    scope="col"
                    className="px-3 py-2.5 text-left font-sans font-semibold text-xs text-ink-3 uppercase tracking-[0.08em]"
                  >
                    Coluna no Notion
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2.5 text-left font-sans font-semibold text-xs text-ink-3 uppercase tracking-[0.08em]"
                  >
                    Campo do lead
                  </th>
                  <th scope="col" className="px-3 py-2.5 w-10">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody style={{ background: 'var(--bg-elev-1)' }}>
                {rows.map((row, i) => (
                  <MappingRow
                    key={i}
                    index={i}
                    entry={row}
                    onUpdate={handleRowUpdate}
                    onRemove={handleRowRemove}
                  />
                ))}
              </tbody>
            </table>
          ) : (
            <div className="flex flex-col items-center gap-2 py-6">
              <p className="font-sans text-sm text-ink-3">Nenhum mapeamento definido.</p>
              <p className="font-sans text-xs text-ink-4">
                Adicione linhas abaixo para mapear propriedades Notion → campos do lead.
              </p>
            </div>
          )}
        </div>

        {/* Botão adicionar linha */}
        <button
          type="button"
          onClick={handleAddRow}
          className={cn(
            'flex items-center gap-2 self-start',
            'rounded-xs border border-border px-3 py-1.5',
            'font-sans text-sm text-ink-2',
            'hover:text-ink hover:border-border-strong hover:bg-surface-hover',
            'focus-visible:ring-2 focus-visible:ring-azul/40 outline-none',
            'transition-colors duration-fast',
          )}
          style={{ background: 'var(--bg-elev-1)' }}
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="w-3.5 h-3.5"
            aria-hidden="true"
          >
            <line x1="8" y1="3" x2="8" y2="13" />
            <line x1="3" y1="8" x2="13" y2="8" />
          </svg>
          Adicionar linha
        </button>

        {/* Campos obrigatórios */}
        <p className="font-sans text-xs text-ink-3">
          <span className="text-danger">*</span> Campos obrigatórios:{' '}
          <strong className="font-mono text-ink-2">display_name</strong> (nome do lead) e{' '}
          <strong className="font-mono text-ink-2">primary_phone</strong> (telefone E.164).
        </p>
      </div>

      {/* Erro de validação */}
      {error && (
        <p className="font-sans text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
