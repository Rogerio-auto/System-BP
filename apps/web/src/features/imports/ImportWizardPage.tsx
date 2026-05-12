// =============================================================================
// features/imports/ImportWizardPage.tsx
//
// Wizard de importação de leads — 4 passos.
//
// Estado em URL (search params) — recarregar mantém passo + batchId:
//   ?step=1|2|3|4
//   ?batchId=<uuid>
//
// Dados em memória:
//   - file: File | null (não persiste em URL — seleção manual obrigatória)
//   - columnMapping: Record<origem, destino>
//
// Rodapé sticky: botão Voltar (outline) + botão Avançar (primary).
// Guard: não avança se pré-condição não cumprida.
// =============================================================================

import { useMutation } from '@tanstack/react-query';
import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';

import { Button } from '../../components/ui/Button';
import { useConfirmImport } from '../../hooks/imports/useConfirmImport';
import { useImportBatch } from '../../hooks/imports/useImportBatch';
import { useImportPreview } from '../../hooks/imports/useImportPreview';
import { uploadLeadsFile } from '../../lib/api/imports';
import { cn } from '../../lib/cn';

import { ImportStepper } from './components/ImportStepper';
import type { WizardStep } from './components/ImportStepper';
import { StepConfirm } from './components/StepConfirm';
import { StepMapping } from './components/StepMapping';
import type { ColumnMapping } from './components/StepMapping';
import { StepPreview } from './components/StepPreview';
import { StepUpload } from './components/StepUpload';

// ─── Helpers de URL state ─────────────────────────────────────────────────────

function parseStep(raw: string | null): WizardStep {
  const n = Number(raw);
  if (n >= 1 && n <= 4) return n as WizardStep;
  return 1;
}

/**
 * L1: valida batchId da URL como UUID antes de repassar para hooks/mutations.
 * Retorna null quando inválido para evitar requisições com IDs malformados.
 */
const UuidSchema = z.string().uuid();

function parseBatchId(raw: string | null): string | null {
  if (!raw) return null;
  const result = UuidSchema.safeParse(raw);
  return result.success ? result.data : null;
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function ImportWizardPage(): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // Estado persistido em URL
  const step = parseStep(searchParams.get('step'));
  // L1: batchId validado como UUID — evita requisições com IDs malformados
  // (ex.: XSS via URL, links manipulados). Se inválido, trata como null (step 1).
  const batchId = parseBatchId(searchParams.get('batchId'));

  // Estado em memória (não sobrevive reload — por design: arquivo deve ser re-selecionado)
  const [file, setFile] = React.useState<File | null>(null);
  const [columnMapping, setColumnMapping] = React.useState<ColumnMapping>({});
  const [uploadError, setUploadError] = React.useState<string | null>(null);

  // L1: avisa quando batchId da URL era inválido (URL manipulada / link quebrado)
  const rawBatchIdInUrl = searchParams.get('batchId');
  const batchIdWasInvalid = rawBatchIdInUrl !== null && batchId === null;

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: batch, isLoading: batchLoading } = useImportBatch({
    batchId,
    enabled: Boolean(batchId) && step >= 2,
  });

  // Preview mínimo para extrair colunas detectadas (passo 2)
  const { data: previewData } = useImportPreview({
    batchId,
    params: { page: 1, perPage: 3 },
    enabled: Boolean(batchId) && step === 2,
  });

  // ── Mutations ──────────────────────────────────────────────────────────────

  const uploadMutation = useMutation({
    mutationFn: (f: File) => uploadLeadsFile(f),
    onSuccess: (data) => {
      setUploadError(null);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('batchId', data.batchId);
        next.set('step', '2');
        return next;
      });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Erro ao enviar arquivo.';
      setUploadError(msg);
    },
  });

  const { mutate: confirmBatch, isPending: isConfirming } = useConfirmImport();
  const [isConfirmed, setIsConfirmed] = React.useState(false);
  const [confirmError, setConfirmError] = React.useState<string | null>(null);

  // Detecta quando batch volta para polling depois de confirmed
  React.useEffect(() => {
    if (batch?.status === 'completed' || batch?.status === 'failed') {
      setIsConfirmed(true);
    }
  }, [batch?.status]);

  // ── Navegação entre passos ─────────────────────────────────────────────────

  function goToStep(target: WizardStep): void {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('step', String(target));
      return next;
    });
  }

  function handleBack(): void {
    if (step === 1) {
      void navigate('/leads');
      return;
    }
    goToStep((step - 1) as WizardStep);
  }

  async function handleNext(): Promise<void> {
    if (step === 1) {
      if (!file) return;
      uploadMutation.mutate(file);
      return;
    }

    if (step === 2) {
      goToStep(3);
      return;
    }

    if (step === 3) {
      goToStep(4);
      return;
    }

    if (step === 4) {
      if (!batchId) return;
      confirmBatch(batchId, {
        onSuccess: () => {
          setIsConfirmed(true);
          setConfirmError(null);
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : 'Erro ao confirmar importação.';
          setConfirmError(msg);
        },
      });
    }
  }

  // ── Derivações para UI ─────────────────────────────────────────────────────

  // Colunas detectadas: vêm das chaves das rawData das linhas de preview
  const detectedColumns = React.useMemo<string[]>(() => {
    if (!previewData?.rows.length) return [];
    const row = previewData.rows[0];
    if (!row) return [];
    return Object.keys(row.rawData);
  }, [previewData?.rows]);

  // Guard de avanço por passo
  const canAdvance = React.useMemo(() => {
    if (step === 1) return Boolean(file) && !uploadMutation.isPending;
    if (step === 2) return Boolean(batchId);
    if (step === 3) return Boolean(batchId) && Boolean(batch);
    if (step === 4) return false; // o botão fica no StepConfirm
    return false;
  }, [step, file, uploadMutation.isPending, batchId, batch]);

  const isLoading = step >= 2 && batchLoading;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto">
      {/* Cabeçalho da página */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleBack}
          className={cn(
            'flex items-center gap-1.5 font-sans text-sm text-ink-3',
            'hover:text-ink transition-colors duration-fast',
            'focus-visible:ring-2 focus-visible:ring-azul/40 rounded-xs outline-none',
          )}
          aria-label="Voltar"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            className="w-4 h-4"
            aria-hidden="true"
          >
            <path d="M10 4L6 8l4 4" />
          </svg>
          Voltar
        </button>
        <h1
          className="font-display font-extrabold text-ink"
          style={{
            fontSize: 'var(--text-2xl)',
            letterSpacing: '-0.04em',
            fontVariationSettings: "'opsz' 32",
          }}
        >
          Importar leads
        </h1>
      </div>

      {/* L1: aviso de batchId inválido na URL */}
      {batchIdWasInvalid && (
        <div
          className="rounded-sm border border-warning/40 px-4 py-3 flex items-start gap-3"
          style={{ background: 'var(--warning-bg)', boxShadow: 'var(--elev-1)' }}
          role="alert"
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
          <p className="font-sans text-sm text-ink-2">
            O link de importação está inválido ou expirou. Inicie um novo upload no passo 1.
          </p>
        </div>
      )}

      {/* Stepper */}
      <div
        className="rounded-md border border-border p-5"
        style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-2)' }}
      >
        <ImportStepper current={step} />
      </div>

      {/* Conteúdo do passo */}
      <div
        className="rounded-md border border-border p-6"
        style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-2)' }}
      >
        {isLoading ? (
          <LoadingState />
        ) : step === 1 ? (
          <StepUpload
            file={file}
            onFileChange={setFile}
            uploading={uploadMutation.isPending}
            error={uploadError}
          />
        ) : step === 2 && batch ? (
          <StepMapping
            columns={detectedColumns}
            sampleRows={previewData?.rows ?? []}
            columnMapping={columnMapping}
            onMappingChange={setColumnMapping}
          />
        ) : step === 3 && batch ? (
          <StepPreview batch={batch} />
        ) : step === 4 && batch ? (
          <StepConfirm
            batch={batch}
            columnMapping={columnMapping}
            onConfirm={() => void handleNext()}
            isConfirming={isConfirming}
            isConfirmed={isConfirmed}
            confirmError={confirmError}
          />
        ) : (
          <BatchNotReady batchId={batchId} />
        )}
      </div>

      {/* Rodapé sticky — apenas para passos 1-3 (passo 4 tem seu próprio botão) */}
      {step < 4 && !isLoading && (
        <div
          className={cn(
            'sticky bottom-0 z-20',
            'flex items-center justify-between gap-4',
            'rounded-md border border-border p-4',
            'mt-2',
          )}
          style={{
            background: 'var(--bg-elev-1)',
            boxShadow: 'var(--elev-3)',
          }}
        >
          {/* Botão Voltar */}
          <Button variant="outline" size="default" onClick={handleBack}>
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              className="w-4 h-4"
              aria-hidden="true"
            >
              <path d="M10 4L6 8l4 4" />
            </svg>
            {step === 1 ? 'Cancelar' : 'Voltar'}
          </Button>

          {/* Indicador de passo */}
          <span className="font-sans text-xs text-ink-4">Passo {step} de 4</span>

          {/* Botão Avançar */}
          <Button
            variant="primary"
            size="default"
            onClick={() => void handleNext()}
            disabled={!canAdvance || uploadMutation.isPending}
          >
            {uploadMutation.isPending ? (
              <span className="flex items-center gap-2">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  className="w-4 h-4 animate-spin"
                  aria-hidden="true"
                >
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                </svg>
                Enviando…
              </span>
            ) : step === 3 ? (
              'Revisar confirmação'
            ) : (
              'Avançar'
            )}
            {!uploadMutation.isPending && (
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                className="w-4 h-4"
                aria-hidden="true"
              >
                <path d="M6 4l4 4-4 4" />
              </svg>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function LoadingState(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4 py-4" aria-busy="true" aria-label="Carregando…">
      <div className="h-6 w-40 bg-surface-muted rounded-xs animate-pulse" />
      <div className="h-4 w-80 bg-surface-muted rounded-xs animate-pulse" />
      <div className="h-32 bg-surface-muted rounded-md animate-pulse mt-2" />
    </div>
  );
}

function BatchNotReady({ batchId }: { batchId: string | null }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-4 py-8">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--text-4)"
        strokeWidth={1.5}
        className="w-12 h-12"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <circle cx="12" cy="16" r="0.5" fill="var(--text-4)" />
      </svg>
      <div className="text-center">
        <p className="font-sans font-semibold text-sm text-ink-2">
          {batchId ? 'Aguardando o processamento do arquivo…' : 'Nenhum arquivo carregado.'}
        </p>
        <p className="font-sans text-xs text-ink-3 mt-1">
          {batchId
            ? 'O backend está parseando o arquivo. Aguarde ou volte ao início.'
            : 'Volte ao passo 1 e selecione um arquivo para importar.'}
        </p>
      </div>
    </div>
  );
}
