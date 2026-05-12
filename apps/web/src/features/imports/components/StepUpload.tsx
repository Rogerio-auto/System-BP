// =============================================================================
// features/imports/components/StepUpload.tsx
//
// Passo 1: Drop zone para upload de CSV/XLSX.
//
// Estados:
//   idle     — borda dashed border-strong, ícone de upload, microcopy
//   drag     — borda verde + Spotlight (halo segue cursor via --mx/--my)
//   selected — exibe nome do arquivo + botão de substituição
//   uploading— skeleton + microcopy de progresso
//   error    — borda danger + mensagem
//
// Aceita CSV e XLSX. Máximo 10 MB (MVP).
// =============================================================================

import * as React from 'react';

import { Button } from '../../../components/ui/Button';
import { cn } from '../../../lib/cn';

const ACCEPTED_TYPES = [
  'text/csv',
  'application/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];
const ACCEPTED_EXTENSIONS = '.csv,.xlsx,.xls';
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface StepUploadProps {
  file: File | null;
  onFileChange: (file: File | null) => void;
  uploading: boolean;
  error: string | null;
}

export function StepUpload({
  file,
  onFileChange,
  uploading,
  error,
}: StepUploadProps): React.JSX.Element {
  const [isDragging, setIsDragging] = React.useState(false);
  const [validationError, setValidationError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const dropRef = React.useRef<HTMLDivElement>(null);

  // Spotlight: --mx/--my para o halo verde no drag-over
  const handleMouseMove = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = dropRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - rect.left}px`);
    el.style.setProperty('--my', `${e.clientY - rect.top}px`);
  }, []);

  const handleMouseLeave = React.useCallback(() => {
    const el = dropRef.current;
    if (!el) return;
    el.style.setProperty('--mx', '-9999px');
    el.style.setProperty('--my', '-9999px');
  }, []);

  function validateAndSet(candidate: File | null): void {
    if (!candidate) {
      onFileChange(null);
      setValidationError(null);
      return;
    }

    if (candidate.size > MAX_BYTES) {
      setValidationError(`Arquivo muito grande: ${formatBytes(candidate.size)}. Máximo: 10 MB.`);
      return;
    }

    const isValidType =
      ACCEPTED_TYPES.includes(candidate.type) ||
      candidate.name.endsWith('.csv') ||
      candidate.name.endsWith('.xlsx') ||
      candidate.name.endsWith('.xls');

    if (!isValidType) {
      setValidationError('Tipo não suportado. Use CSV ou XLSX.');
      return;
    }

    setValidationError(null);
    onFileChange(candidate);
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>): void => {
    // Só sai do estado drag se o cursor sair do próprio elemento (não de um filho)
    if (!dropRef.current?.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0] ?? null;
    validateAndSet(dropped);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const selected = e.target.files?.[0] ?? null;
    validateAndSet(selected);
  };

  const handleClick = (): void => {
    if (!uploading) inputRef.current?.click();
  };

  const displayError = validationError ?? error;
  const hasError = Boolean(displayError);

  return (
    <div className="flex flex-col gap-4">
      {/* Título da seção */}
      <div>
        <h2
          className="font-display font-bold text-ink leading-tight"
          style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.025em' }}
        >
          Selecionar arquivo
        </h2>
        <p className="font-sans text-sm text-ink-3 mt-1">
          Aceita CSV (UTF-8/Latin-1) ou XLSX — máximo 10 MB.
        </p>
      </div>

      {/* Drop zone */}
      <div
        ref={dropRef}
        role="button"
        tabIndex={uploading ? -1 : 0}
        aria-label="Área de drop de arquivo — clique ou arraste"
        aria-disabled={uploading}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') handleClick();
        }}
        className={cn(
          'relative overflow-hidden',
          'rounded-md border-2 border-dashed',
          'flex flex-col items-center justify-center gap-4',
          'p-10 min-h-[220px]',
          'cursor-pointer select-none',
          'transition-all duration-[250ms] ease-out',
          // Spotlight CSS var init
          '[--mx:-9999px] [--my:-9999px]',
          // Estados de borda
          !isDragging && !file && !hasError && 'border-border-strong bg-surface-1',
          isDragging && 'border-verde bg-surface-hover',
          file && !hasError && 'border-border bg-surface-1',
          hasError && 'border-danger bg-danger/5',
          // Hover idle
          !isDragging && !file && !hasError && 'hover:border-azul hover:bg-surface-hover',
          uploading && 'cursor-not-allowed opacity-70',
        )}
        style={
          isDragging
            ? {
                boxShadow: 'var(--glow-verde), var(--elev-2)',
              }
            : { boxShadow: 'var(--elev-1)' }
        }
      >
        {/* Spotlight radial verde segue cursor (ativo no drag) */}
        {isDragging && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-md"
            style={{
              background:
                'radial-gradient(360px circle at var(--mx) var(--my), rgba(46,155,62,0.10), transparent 60%)',
            }}
          />
        )}

        {/* Input oculto */}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS}
          className="sr-only"
          onChange={handleInputChange}
          tabIndex={-1}
          aria-hidden="true"
        />

        {uploading ? (
          // Estado uploading — skeleton + copy
          <div className="flex flex-col items-center gap-3 relative z-10">
            {/* Skeleton pulsante */}
            <div className="w-12 h-12 rounded-full bg-surface-muted animate-pulse" />
            <div className="w-40 h-3 rounded bg-surface-muted animate-pulse" />
            <div className="w-24 h-3 rounded bg-surface-muted animate-pulse" />
            <p className="font-sans text-sm text-ink-3 mt-1">Enviando arquivo…</p>
          </div>
        ) : file ? (
          // Estado com arquivo selecionado
          <div className="flex flex-col items-center gap-3 relative z-10">
            <div
              className="w-12 h-12 rounded-md flex items-center justify-center"
              style={{ background: 'var(--success-bg)', boxShadow: 'var(--elev-1)' }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--success)"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-6 h-6"
                aria-hidden="true"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            </div>
            <div className="text-center">
              <p className="font-sans font-semibold text-sm text-ink">{file.name}</p>
              <p className="font-mono text-xs text-ink-3 mt-0.5">{formatBytes(file.size)}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onFileChange(null);
                setValidationError(null);
                if (inputRef.current) inputRef.current.value = '';
              }}
            >
              Substituir arquivo
            </Button>
          </div>
        ) : (
          // Estado idle
          <div className="flex flex-col items-center gap-3 relative z-10 text-center">
            {/* Upload icon */}
            <div
              className="w-14 h-14 rounded-lg flex items-center justify-center"
              style={{
                background: isDragging ? 'var(--success-bg)' : 'var(--surface-muted)',
                boxShadow: 'var(--elev-1)',
                transition: 'background 250ms ease',
              }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke={isDragging ? 'var(--brand-verde)' : 'var(--text-3)'}
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-7 h-7"
                aria-hidden="true"
                style={{ transition: 'stroke 250ms ease' }}
              >
                <polyline points="16 16 12 12 8 16" />
                <line x1="12" y1="12" x2="12" y2="21" />
                <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
              </svg>
            </div>

            <div>
              <p className="font-sans font-semibold text-sm text-ink">
                {isDragging ? 'Solte o arquivo aqui' : 'Arraste ou clique para selecionar'}
              </p>
              <p className="font-sans text-xs text-ink-3 mt-1">CSV ou XLSX · Máximo 10 MB</p>
            </div>
          </div>
        )}
      </div>

      {/* Erro de validação */}
      {hasError && (
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
          {displayError}
        </p>
      )}

      {/* Hint */}
      {!hasError && (
        <p className="font-sans text-xs text-ink-4">
          Após o upload, você poderá ajustar o mapeamento de colunas antes de importar.
        </p>
      )}
    </div>
  );
}
