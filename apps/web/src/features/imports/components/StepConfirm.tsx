// =============================================================================
// features/imports/components/StepConfirm.tsx
//
// Passo 4: Confirmação final.
//
// Layout:
//   - Card de resumo com --elev-3
//   - Sample de 10 linhas válidas destacadas
//   - Aviso de irreversibilidade
//   - Botão primário lg 100% width
//
// Após confirmação → estado "processing" → polling até completed/failed.
// =============================================================================

import * as React from 'react';

import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import type { ImportBatch } from '../../../lib/api/imports';
import { cn } from '../../../lib/cn';

import type { ColumnMapping } from './StepMapping';

interface StepConfirmProps {
  batch: ImportBatch;
  columnMapping: ColumnMapping;
  onConfirm: () => void;
  isConfirming: boolean;
  isConfirmed: boolean;
  confirmError: string | null;
}

export function StepConfirm({
  batch,
  columnMapping,
  onConfirm,
  isConfirming,
  isConfirmed,
  confirmError,
}: StepConfirmProps): React.JSX.Element {
  // Mapeamentos ativos (não ignorados)
  const activeMappings = Object.entries(columnMapping).filter(([, dest]) => Boolean(dest));
  const ignoredCount = Object.values(columnMapping).filter((d) => !d).length;

  if (isConfirmed) {
    return <ProcessingState batch={batch} />;
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Cabeçalho */}
      <div>
        <h2
          className="font-display font-bold text-ink leading-tight"
          style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.025em' }}
        >
          Confirmar importação
        </h2>
        <p className="font-sans text-sm text-ink-3 mt-1">
          Revise o resumo abaixo antes de iniciar o processamento.
        </p>
      </div>

      {/* Card de resumo */}
      <div
        className="rounded-lg border border-border p-6 flex flex-col gap-6"
        style={{ boxShadow: 'var(--elev-3)', background: 'var(--bg-elev-1)' }}
      >
        {/* Stats do batch */}
        <section>
          <SectionTitle>Dados do arquivo</SectionTitle>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <SummaryItem label="Arquivo" value={batch.fileName} mono />
            <SummaryItem label="Tamanho" value={formatBytes(batch.fileSize)} mono />
            <SummaryItem
              label="Total de linhas"
              value={batch.totalRows.toLocaleString('pt-BR')}
              mono
            />
            <SummaryItem label="Tipo" value={batch.entityType} />
          </div>
        </section>

        {/* Divisor */}
        <div className="border-t border-border-subtle" />

        {/* Validação */}
        <section>
          <SectionTitle>Resultado da validação</SectionTitle>
          <div className="flex flex-col gap-2 mt-3">
            <ValidationRow
              label="Linhas válidas"
              count={batch.validRows}
              total={batch.totalRows}
              variant="success"
            />
            <ValidationRow
              label="Linhas inválidas"
              count={batch.invalidRows}
              total={batch.totalRows}
              variant="danger"
            />
            <ValidationRow
              label="Linhas pendentes"
              count={batch.totalRows - batch.validRows - batch.invalidRows}
              total={batch.totalRows}
              variant="warning"
            />
          </div>
        </section>

        {/* Divisor */}
        <div className="border-t border-border-subtle" />

        {/* Mapeamento ativo */}
        <section>
          <div className="flex items-center justify-between">
            <SectionTitle>Mapeamento de colunas</SectionTitle>
            {ignoredCount > 0 && (
              <span className="font-sans text-xs text-ink-4">
                {ignoredCount} coluna{ignoredCount !== 1 ? 's' : ''} ignorada
                {ignoredCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {activeMappings.length > 0 ? (
            <div className="flex flex-wrap gap-2 mt-3">
              {activeMappings.map(([src, dest]) => (
                <div
                  key={src}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-xs border border-border-subtle"
                  style={{
                    background: 'var(--surface-muted)',
                    boxShadow: 'var(--elev-1)',
                  }}
                >
                  <span
                    className="font-mono text-xs text-ink-3"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    {src}
                  </span>
                  <svg
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="var(--text-4)"
                    strokeWidth={1.5}
                    className="w-3 h-3"
                    aria-hidden="true"
                  >
                    <path d="M1 6h10M7 2l4 4-4 4" />
                  </svg>
                  <span className="font-sans text-xs font-medium text-ink-2">{dest}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="font-sans text-sm text-ink-4 mt-2 italic">
              Nenhum campo mapeado — apenas dados brutos serão preservados.
            </p>
          )}
        </section>
      </div>

      {/* Aviso de irreversibilidade */}
      <div
        className="flex gap-3 items-start rounded-md border border-warning/40 p-4"
        style={{
          background: 'var(--warning-bg)',
          boxShadow: 'var(--elev-1)',
        }}
        role="alert"
      >
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="var(--warning)"
          strokeWidth={1.8}
          className="w-5 h-5 shrink-0 mt-0.5"
          aria-hidden="true"
        >
          <path d="M10 1L1 18h18L10 1z" />
          <line x1="10" y1="8" x2="10" y2="12" />
          <circle cx="10" cy="15" r="0.6" fill="var(--warning)" />
        </svg>
        <div>
          <p className="font-sans font-semibold text-sm" style={{ color: 'var(--warning)' }}>
            Ação irreversível
          </p>
          <p className="font-sans text-xs text-ink-2 mt-0.5">
            Após confirmar, somente linhas <strong>válidas</strong> serão importadas. Esta ação não
            pode ser desfeita. Linhas inválidas serão ignoradas.
          </p>
        </div>
      </div>

      {/* Erro de confirmação */}
      {confirmError && (
        <p role="alert" className="font-sans text-sm text-danger flex items-center gap-2">
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            className="w-4 h-4 shrink-0"
            aria-hidden="true"
          >
            <circle cx="8" cy="8" r="7" />
            <line x1="8" y1="5" x2="8" y2="8" />
            <circle cx="8" cy="11" r="0.5" fill="currentColor" />
          </svg>
          {confirmError}
        </p>
      )}

      {/* Botão primário lg 100% width */}
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        onClick={onConfirm}
        disabled={isConfirming || batch.validRows === 0}
      >
        {isConfirming ? (
          <span className="flex items-center gap-2">
            <LoadingSpinner />
            Confirmando…
          </span>
        ) : (
          <>
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-4 h-4"
              aria-hidden="true"
            >
              <path d="M3 8l3.5 3.5L13 5" />
            </svg>
            Confirmar e importar {batch.validRows.toLocaleString('pt-BR')} linha
            {batch.validRows !== 1 ? 's' : ''}
          </>
        )}
      </Button>

      {batch.validRows === 0 && (
        <p className="font-sans text-xs text-center text-ink-3">
          Não há linhas válidas para importar. Revise o mapeamento e o arquivo.
        </p>
      )}
    </div>
  );
}

// ─── Estado de processamento ──────────────────────────────────────────────────

function ProcessingState({ batch }: { batch: ImportBatch }): React.JSX.Element {
  const isCompleted = batch.status === 'completed';
  const isFailed = batch.status === 'failed';
  const isProcessing = !isCompleted && !isFailed;

  return (
    <div className="flex flex-col items-center gap-6 py-8">
      {isProcessing ? (
        <>
          <div className="relative w-16 h-16">
            {/* Ring pulsante */}
            <div
              className="absolute inset-0 rounded-pill animate-ping"
              style={{ background: 'rgba(27,58,140,0.15)' }}
            />
            <div
              className="w-16 h-16 rounded-pill flex items-center justify-center"
              style={{
                background: 'var(--brand-azul)',
                boxShadow: 'var(--glow-azul)',
              }}
            >
              <LoadingSpinner className="w-7 h-7 text-white" />
            </div>
          </div>
          <div className="text-center">
            <p
              className="font-display font-bold text-ink"
              style={{ fontSize: 'var(--text-lg)', letterSpacing: '-0.02em' }}
            >
              Processando importação…
            </p>
            <p className="font-sans text-sm text-ink-3 mt-1">
              Isso pode levar alguns instantes. Esta tela atualiza automaticamente.
            </p>
          </div>
          {/* Skeleton de progresso */}
          <div className="w-full max-w-sm flex flex-col gap-2">
            <div className="flex justify-between">
              <span className="font-sans text-xs text-ink-3">Progresso</span>
              <span
                className="font-mono text-xs text-ink-3"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {batch.processedRows}/{batch.totalRows}
              </span>
            </div>
            <div
              className="h-2 rounded-pill overflow-hidden"
              style={{ background: 'var(--surface-muted)' }}
            >
              <div
                className="h-full rounded-pill transition-all duration-slow"
                style={{
                  width:
                    batch.totalRows > 0
                      ? `${(batch.processedRows / batch.totalRows) * 100}%`
                      : '0%',
                  background: 'var(--brand-azul)',
                  boxShadow: 'var(--glow-azul)',
                }}
              />
            </div>
          </div>
        </>
      ) : isCompleted ? (
        <>
          <div
            className="w-16 h-16 rounded-pill flex items-center justify-center"
            style={{
              background: 'var(--brand-verde)',
              boxShadow: 'var(--glow-verde)',
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-8 h-8"
              aria-hidden="true"
            >
              <path d="M5 12l5 5L20 7" />
            </svg>
          </div>
          <div className="text-center">
            <p
              className="font-display font-bold text-ink"
              style={{ fontSize: 'var(--text-lg)', letterSpacing: '-0.02em' }}
            >
              Importação concluída!
            </p>
            <p className="font-sans text-sm text-ink-3 mt-1">
              {batch.processedRows.toLocaleString('pt-BR')} linha
              {batch.processedRows !== 1 ? 's' : ''} importada
              {batch.processedRows !== 1 ? 's' : ''} com sucesso.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap justify-center">
            <Badge variant="success">
              {batch.processedRows.toLocaleString('pt-BR')} importadas
            </Badge>
            {batch.invalidRows > 0 && (
              <Badge variant="warning">{batch.invalidRows.toLocaleString('pt-BR')} ignoradas</Badge>
            )}
          </div>
        </>
      ) : (
        <>
          <div
            className="w-16 h-16 rounded-pill flex items-center justify-center"
            style={{ background: 'var(--danger)', boxShadow: 'var(--elev-3)' }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth={2.5}
              strokeLinecap="round"
              className="w-8 h-8"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </div>
          <div className="text-center">
            <p
              className="font-display font-bold text-danger"
              style={{ fontSize: 'var(--text-lg)', letterSpacing: '-0.02em' }}
            >
              Importação com falha
            </p>
            <p className="font-sans text-sm text-ink-3 mt-1">
              Erro durante o processamento. Verifique o CSV de erros.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p
      className="font-sans font-semibold uppercase text-ink-3"
      style={{ fontSize: '0.65rem', letterSpacing: '0.10em' }}
    >
      {children}
    </p>
  );
}

interface SummaryItemProps {
  label: string;
  value: string | number;
  mono?: boolean;
}

function SummaryItem({ label, value, mono }: SummaryItemProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-sans text-xs text-ink-3">{label}</span>
      <span
        className={cn('text-sm font-medium text-ink', mono && 'font-mono')}
        style={mono ? { fontFamily: 'var(--font-mono)' } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

interface ValidationRowProps {
  label: string;
  count: number;
  total: number;
  variant: 'success' | 'danger' | 'warning';
}

function ValidationRow({ label, count, total, variant }: ValidationRowProps): React.JSX.Element {
  const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
  const colorMap = {
    success: { bar: 'var(--brand-verde)', text: 'var(--success)' },
    danger: { bar: 'var(--danger)', text: 'var(--danger)' },
    warning: { bar: 'var(--warning)', text: 'var(--warning)' },
  };
  const colors = colorMap[variant];

  return (
    <div className="flex items-center gap-3">
      <span className="font-sans text-xs text-ink-2 w-32 shrink-0">{label}</span>
      <div
        className="flex-1 h-1.5 rounded-pill overflow-hidden"
        style={{ background: 'var(--surface-muted)' }}
      >
        <div
          className="h-full rounded-pill transition-all duration-slow"
          style={{ width: `${percentage}%`, background: colors.bar }}
        />
      </div>
      <span
        className="font-mono text-xs font-medium w-16 text-right shrink-0"
        style={{ fontFamily: 'var(--font-mono)', color: colors.text }}
      >
        {count.toLocaleString('pt-BR')}
      </span>
    </div>
  );
}

function LoadingSpinner({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      className={cn('w-4 h-4 animate-spin', className)}
      aria-hidden="true"
    >
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
