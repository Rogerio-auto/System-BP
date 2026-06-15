// =============================================================================
// features/billing/components/BoletoModal.tsx — Modal de boleto da parcela.
//
// Dois modos (abas): Upload PDF (drag-drop) ou Referência (URL + linha + PIX).
// Visualização do boleto já anexado + ação remover.
// Gate billing.boleto.enabled verificado pelo caller (PaymentDuesPage).
//
// DS:
//   - Modal: --elev-5, rounded-md, border --border, bg --bg-elev-1.
//   - Animação: fade-up 200ms var(--ease-out).
//   - Tabs: abas simples com borda ativa em --brand-azul.
//   - Drag-drop: borda dashed + highlight ao drag-over.
//   - Todos os tokens — sem hex hardcoded.
//
// LGPD §14.2:
//   - boleto_url / boleto_digitable_line / pix_copia_cola são PII indireta.
//   - Não persistidos em localStorage; presentes apenas no estado do modal.
//   - Exibição cuidadosa: URL como link, linha/PIX com botão de cópia.
// =============================================================================
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '../../../components/ui/Button';
import {
  useAttachBoletoReference,
  useAttachBoletoUpload,
  useRemoveBoleto,
} from '../hooks/useBilling';
import type { BoletoReferenceForm, BoletoResponse, PaymentDueResponse } from '../schemas';
import {
  BOLETO_ACCEPTED_MIME_TYPES,
  BOLETO_MAX_FILE_SIZE_BYTES,
  BoletoReferenceFormSchema,
} from '../schemas';

// UUID v4 via Web Crypto — sem dependência externa
function randomUUID(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ModalTab = 'view' | 'upload' | 'reference';

interface BoletoModalProps {
  due: PaymentDueResponse;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Formata tamanho de arquivo legível. */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Valida arquivo localmente antes do upload. */
function validateFile(file: File): string | null {
  if (
    !BOLETO_ACCEPTED_MIME_TYPES.includes(file.type as (typeof BOLETO_ACCEPTED_MIME_TYPES)[number])
  ) {
    return 'Tipo de arquivo não suportado. Use PDF, JPG ou PNG.';
  }
  if (file.size > BOLETO_MAX_FILE_SIZE_BYTES) {
    return `Arquivo muito grande. Máximo: ${formatFileSize(BOLETO_MAX_FILE_SIZE_BYTES)}.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sub-componente: aba de visualização do boleto já anexado
// ---------------------------------------------------------------------------

interface BoletoViewPanelProps {
  due: PaymentDueResponse;
  boletoData: BoletoResponse | null;
  onRemove: () => void;
  isRemoving: boolean;
  onAttachNew: () => void;
}

function BoletoViewPanel({
  due,
  boletoData,
  onRemove,
  isRemoving,
  onAttachNew,
}: BoletoViewPanelProps): React.JSX.Element {
  const [copied, setCopied] = React.useState<'line' | 'pix' | null>(null);

  const handleCopy = async (text: string, type: 'line' | 'pix'): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard não disponível — falha silenciosa */
    }
  };

  if (!due.has_boleto) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
        <svg viewBox="0 0 48 48" fill="none" className="w-12 h-12 opacity-40" aria-hidden="true">
          <rect
            x="8"
            y="12"
            width="32"
            height="24"
            rx="3"
            stroke="var(--border-strong)"
            strokeWidth="1.5"
          />
          <path
            d="M16 20h16M16 24h10"
            stroke="var(--border-strong)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        <p className="font-sans font-semibold text-ink" style={{ fontSize: 'var(--text-sm)' }}>
          Nenhum boleto anexado
        </p>
        <p className="font-sans text-ink-3 max-w-xs" style={{ fontSize: 'var(--text-xs)' }}>
          Parcela {due.contract_reference} #{due.installment_number} ainda não tem boleto.
        </p>
        <Button variant="primary" size="sm" onClick={onAttachNew}>
          Anexar boleto
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Indicador de arquivo */}
      <div
        className="flex items-center gap-3 px-4 py-3 rounded-sm"
        style={{
          background: 'var(--bg-elev-2)',
          border: '1px solid var(--border)',
        }}
      >
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className="w-5 h-5 shrink-0"
          style={{ color: 'var(--brand-azul)' }}
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
            clipRule="evenodd"
          />
        </svg>
        <div className="flex flex-col min-w-0">
          <span
            className="font-sans font-medium text-ink truncate"
            style={{ fontSize: 'var(--text-sm)' }}
          >
            {boletoData?.boleto_filename ?? due.boleto_filename ?? 'boleto.pdf'}
          </span>
          {boletoData?.boleto_attached_at && (
            <span className="font-sans text-ink-3" style={{ fontSize: 'var(--text-xs)' }}>
              Anexado em{' '}
              {new Date(boletoData.boleto_attached_at).toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })}
            </span>
          )}
        </div>
        {/* Link externo */}
        {boletoData?.boleto_url && (
          <a
            href={boletoData.boleto_url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto shrink-0 font-sans text-azul hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20 rounded-xs"
            style={{ fontSize: 'var(--text-xs)' }}
            aria-label="Abrir boleto em nova aba"
          >
            Abrir
          </a>
        )}
      </div>

      {/* Linha digitável */}
      {boletoData?.boleto_digitable_line && (
        <div className="flex flex-col gap-1">
          <label
            className="font-sans font-medium text-ink-3"
            style={{
              fontSize: 'var(--text-xs)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            Linha digitável
          </label>
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-xs"
            style={{
              background: 'var(--bg-elev-2)',
              border: '1px solid var(--border)',
            }}
          >
            <span
              className="font-mono text-ink flex-1 break-all"
              style={{ fontSize: 'var(--text-xs)' }}
            >
              {boletoData.boleto_digitable_line}
            </span>
            <button
              type="button"
              onClick={() => void handleCopy(boletoData.boleto_digitable_line!, 'line')}
              className="shrink-0 font-sans transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20 rounded-xs px-2 py-1"
              style={{
                color: copied === 'line' ? 'var(--success)' : 'var(--brand-azul)',
                fontSize: 'var(--text-xs)',
              }}
              aria-label="Copiar linha digitável"
            >
              {copied === 'line' ? 'Copiado' : 'Copiar'}
            </button>
          </div>
        </div>
      )}

      {/* PIX copia-e-cola */}
      {boletoData?.pix_copia_cola && (
        <div className="flex flex-col gap-1">
          <label
            className="font-sans font-medium text-ink-3"
            style={{
              fontSize: 'var(--text-xs)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            PIX copia-e-cola
          </label>
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-xs"
            style={{
              background: 'var(--bg-elev-2)',
              border: '1px solid var(--border)',
            }}
          >
            <span
              className="font-mono text-ink flex-1 truncate"
              style={{ fontSize: 'var(--text-xs)' }}
            >
              {boletoData.pix_copia_cola.slice(0, 40)}…
            </span>
            <button
              type="button"
              onClick={() => void handleCopy(boletoData.pix_copia_cola!, 'pix')}
              className="shrink-0 font-sans transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20 rounded-xs px-2 py-1"
              style={{
                color: copied === 'pix' ? 'var(--success)' : 'var(--brand-azul)',
                fontSize: 'var(--text-xs)',
              }}
              aria-label="Copiar PIX copia-e-cola"
            >
              {copied === 'pix' ? 'Copiado' : 'Copiar'}
            </button>
          </div>
        </div>
      )}

      {/* Ações */}
      <div className="flex gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={onAttachNew}>
          Substituir boleto
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemove}
          disabled={isRemoving}
          className="text-danger hover:bg-danger/8"
        >
          {isRemoving ? 'Removendo...' : 'Remover boleto'}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-componente: aba de upload
// ---------------------------------------------------------------------------

interface UploadPanelProps {
  onUpload: (file: File) => void;
  isPending: boolean;
}

function UploadPanel({ onUpload, isPending }: UploadPanelProps): React.JSX.Element {
  const [dragOver, setDragOver] = React.useState(false);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleFile = (file: File): void => {
    const err = validateFile(file);
    if (err) {
      setFileError(err);
      setSelectedFile(null);
      return;
    }
    setFileError(null);
    setSelectedFile(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleSubmit = (): void => {
    if (selectedFile) onUpload(selectedFile);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Área de upload do boleto. Clique ou arraste um arquivo PDF, JPG ou PNG."
        className="flex flex-col items-center justify-center gap-3 rounded-sm cursor-pointer transition-colors duration-fast"
        style={{
          padding: 'var(--space-6) var(--space-4)',
          border: dragOver ? '2px dashed var(--brand-azul)' : '2px dashed var(--border-strong)',
          background: dragOver ? 'var(--bg-elev-2)' : 'transparent',
          outline: 'none',
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
      >
        <svg
          viewBox="0 0 40 40"
          fill="none"
          className="w-10 h-10"
          aria-hidden="true"
          style={{ color: dragOver ? 'var(--brand-azul)' : 'var(--border-strong)' }}
        >
          <path
            d="M20 8v16M13 15l7-7 7 7"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M8 28v4h24v-4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div className="text-center">
          <p className="font-sans font-medium text-ink" style={{ fontSize: 'var(--text-sm)' }}>
            {selectedFile ? selectedFile.name : 'Arraste ou clique para selecionar'}
          </p>
          <p className="font-sans text-ink-3 mt-0.5" style={{ fontSize: 'var(--text-xs)' }}>
            {selectedFile ? formatFileSize(selectedFile.size) : 'PDF, JPG ou PNG — máx. 10 MB'}
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          className="sr-only"
          onChange={handleInputChange}
          aria-hidden="true"
        />
      </div>

      {/* Erro de validação local */}
      {fileError && (
        <p
          role="alert"
          className="font-sans"
          style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)' }}
        >
          {fileError}
        </p>
      )}

      {/* Botão de envio */}
      <Button
        variant="primary"
        disabled={!selectedFile || isPending}
        onClick={handleSubmit}
        className="w-full justify-center"
      >
        {isPending ? 'Enviando...' : 'Enviar boleto'}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-componente: aba de referência
// ---------------------------------------------------------------------------

interface ReferencePanelProps {
  onSubmit: (data: BoletoReferenceForm) => void;
  isPending: boolean;
}

function ReferencePanel({ onSubmit, isPending }: ReferencePanelProps): React.JSX.Element {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<BoletoReferenceForm>({
    resolver: zodResolver(BoletoReferenceFormSchema),
    defaultValues: {
      boletoUrl: '',
      digitableLine: '',
      pixCopiaCola: '',
      filename: '',
    },
  });

  // CSS class para inputs — focus ring via CSS pseudo-classes para evitar conflito com RHF onBlur
  const inputBase =
    'w-full rounded-xs px-3 py-2 font-sans text-sm outline-none transition-colors duration-fast ' +
    'bg-[var(--bg-elev-1)] text-[var(--text)] ' +
    'border border-[var(--border)] ' +
    'focus:border-[var(--brand-azul)] ' +
    '[box-shadow:inset_0_1px_2px_var(--shadow-inset)]';

  const inputError = 'border-[var(--danger)]';

  const labelCls = 'font-sans font-semibold uppercase tracking-wide text-ink-3 block mb-1';

  return (
    <form
      onSubmit={(e) => void handleSubmit(onSubmit)(e)}
      className="flex flex-col gap-4"
      noValidate
    >
      <p className="font-sans text-ink-3" style={{ fontSize: 'var(--text-xs)' }}>
        Preencha ao menos um dos campos abaixo.
      </p>

      {/* URL do boleto */}
      <div className="flex flex-col gap-1">
        <label htmlFor="boletoUrl" className={labelCls} style={{ fontSize: 'var(--text-xs)' }}>
          URL do boleto
        </label>
        <input
          id="boletoUrl"
          type="url"
          autoComplete="off"
          placeholder="https://banco.exemplo.com.br/boleto/..."
          className={[inputBase, errors.boletoUrl ? inputError : ''].join(' ')}
          style={{ fontSize: 'var(--text-sm)' }}
          {...register('boletoUrl')}
        />
        {errors.boletoUrl && (
          <span
            className="font-sans"
            style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)' }}
          >
            {errors.boletoUrl.message}
          </span>
        )}
      </div>

      {/* Linha digitável */}
      <div className="flex flex-col gap-1">
        <label htmlFor="digitableLine" className={labelCls} style={{ fontSize: 'var(--text-xs)' }}>
          Linha digitável
        </label>
        <input
          id="digitableLine"
          type="text"
          autoComplete="off"
          placeholder="00190.000090 01234.567891 23456.789012 9 99990000010000"
          className={[inputBase, errors.digitableLine ? inputError : ''].join(' ')}
          style={{ fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono)' }}
          {...register('digitableLine')}
        />
        {errors.digitableLine && (
          <span
            className="font-sans"
            style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)' }}
          >
            {errors.digitableLine.message}
          </span>
        )}
      </div>

      {/* PIX copia-e-cola */}
      <div className="flex flex-col gap-1">
        <label htmlFor="pixCopiaCola" className={labelCls} style={{ fontSize: 'var(--text-xs)' }}>
          PIX copia-e-cola
        </label>
        <textarea
          id="pixCopiaCola"
          rows={3}
          placeholder="00020126580014BR.GOV.BCB.PIX..."
          className={[inputBase, errors.pixCopiaCola ? inputError : ''].join(' ')}
          style={{ fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono)', resize: 'vertical' }}
          {...register('pixCopiaCola')}
        />
        {errors.pixCopiaCola && (
          <span
            className="font-sans"
            style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)' }}
          >
            {errors.pixCopiaCola.message}
          </span>
        )}
      </div>

      {/* Nome amigável */}
      <div className="flex flex-col gap-1">
        <label htmlFor="filename" className={labelCls} style={{ fontSize: 'var(--text-xs)' }}>
          Nome do arquivo (opcional)
        </label>
        <input
          id="filename"
          type="text"
          autoComplete="off"
          placeholder="boleto-parcela-3.pdf"
          className={[inputBase, errors.filename ? inputError : ''].join(' ')}
          style={{ fontSize: 'var(--text-sm)' }}
          {...register('filename')}
        />
        {errors.filename && (
          <span
            className="font-sans"
            style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)' }}
          >
            {errors.filename.message}
          </span>
        )}
        <span className="font-sans text-ink-4" style={{ fontSize: 'var(--text-xs)' }}>
          Nunca incluir CPF ou dados pessoais no nome do arquivo.
        </span>
      </div>

      {/* Erro de validação cruzada (refine) */}
      {errors.root && (
        <p
          role="alert"
          className="font-sans"
          style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)' }}
        >
          {errors.root.message}
        </p>
      )}

      <Button
        type="submit"
        variant="primary"
        disabled={isPending}
        className="w-full justify-center"
      >
        {isPending ? 'Salvando...' : 'Salvar referência'}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

export function BoletoModal({ due, onClose }: BoletoModalProps): React.JSX.Element {
  // Estado inicial: se já tem boleto, mostra visualização; caso contrário upload
  const [tab, setTab] = React.useState<ModalTab>(due.has_boleto ? 'view' : 'upload');
  // Resposta detalhada do boleto (com url, linha, pix) — retornada pelas mutações
  const [boletoData, setBoletoData] = React.useState<BoletoResponse | null>(null);
  const [operationError, setOperationError] = React.useState<string | null>(null);

  const { mutate: attachUpload, isPending: isUploading } = useAttachBoletoUpload();
  const { mutate: attachReference, isPending: isReferencePending } = useAttachBoletoReference();
  const { mutate: removeBoleto, isPending: isRemoving } = useRemoveBoleto();

  const isPending = isUploading || isReferencePending || isRemoving;

  const handleUpload = (file: File): void => {
    setOperationError(null);
    attachUpload(
      { dueId: due.id, file, idempotencyKey: randomUUID() },
      {
        onSuccess: (data) => {
          setBoletoData(data);
          setTab('view');
        },
        onError: (err) => {
          setOperationError(err.message);
        },
      },
    );
  };

  const handleReference = (data: BoletoReferenceForm): void => {
    setOperationError(null);
    attachReference(
      { dueId: due.id, body: data, idempotencyKey: randomUUID() },
      {
        onSuccess: (result) => {
          setBoletoData(result);
          setTab('view');
        },
        onError: (err) => {
          setOperationError(err.message);
        },
      },
    );
  };

  const handleRemove = (): void => {
    setOperationError(null);
    removeBoleto(due.id, {
      onSuccess: (data) => {
        setBoletoData(data);
        setTab('upload');
      },
      onError: (err) => {
        setOperationError(err.message);
      },
    });
  };

  // Sincroniza tab quando due.has_boleto muda (após invalidação do cache)
  const hasBoleto = boletoData?.has_boleto ?? due.has_boleto;

  const tabList: { id: ModalTab; label: string }[] = hasBoleto
    ? [
        { id: 'view', label: 'Boleto anexado' },
        { id: 'upload', label: 'Upload PDF' },
        { id: 'reference', label: 'Referência' },
      ]
    : [
        { id: 'upload', label: 'Upload PDF' },
        { id: 'reference', label: 'Referência' },
      ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--text)]/60 backdrop-blur-[4px]"
      role="dialog"
      aria-modal="true"
      aria-label={`Boleto da parcela ${due.contract_reference} #${due.installment_number}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isPending) onClose();
      }}
    >
      <div
        className="w-full max-w-lg rounded-md flex flex-col"
        style={{
          background: 'var(--bg-elev-1)',
          boxShadow: 'var(--elev-5)',
          border: '1px solid var(--border)',
          animation: 'fade-up 200ms var(--ease-out) both',
          maxHeight: 'calc(100dvh - 2rem)',
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between gap-4 px-6 pt-6 pb-4"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div>
            <h2
              className="font-display font-bold text-ink"
              style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.03em' }}
            >
              Boleto
            </h2>
            <p className="font-sans text-ink-3 mt-0.5" style={{ fontSize: 'var(--text-xs)' }}>
              {due.contract_reference} · Parcela #{due.installment_number}
              {due.customer_name ? ` · ${due.customer_name}` : ''}
            </p>
          </div>
          {/* Botão fechar */}
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="flex items-center justify-center w-8 h-8 rounded-xs transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20"
            aria-label="Fechar modal"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              className="w-4 h-4 text-ink-3"
              aria-hidden="true"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 px-6 pt-3" role="tablist" aria-label="Modos de boleto">
          {tabList.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`boleto-panel-${t.id}`}
              id={`boleto-tab-${t.id}`}
              onClick={() => setTab(t.id)}
              className="font-sans font-medium px-4 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20 rounded-xs"
              style={{
                fontSize: 'var(--text-sm)',
                color: tab === t.id ? 'var(--brand-azul)' : 'var(--text-3)',
                borderBottom:
                  tab === t.id ? '2px solid var(--brand-azul)' : '2px solid transparent',
                background: 'transparent',
                marginBottom: '-1px',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="border-t" style={{ borderColor: 'var(--border)' }} />

        {/* Painel ativo */}
        <div className="px-6 py-5 flex flex-col gap-4">
          {/* Erro de operação */}
          {operationError && (
            <div
              role="alert"
              aria-live="assertive"
              className="flex items-start gap-2 px-3 py-2.5 rounded-xs"
              style={{
                background: 'var(--danger-bg)',
                border: '1px solid var(--danger)',
                borderLeft: '3px solid var(--danger)',
              }}
            >
              <svg
                viewBox="0 0 16 16"
                fill="currentColor"
                className="w-4 h-4 shrink-0 mt-0.5"
                style={{ color: 'var(--danger)' }}
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M8 1a7 7 0 100 14A7 7 0 008 1zm1 10H7V9h2v2zm0-4H7V5h2v2z"
                  clipRule="evenodd"
                />
              </svg>
              <span
                className="font-sans"
                style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)' }}
              >
                {operationError}
              </span>
              <button
                type="button"
                className="ml-auto shrink-0 font-sans transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/20 rounded-xs"
                style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)' }}
                onClick={() => setOperationError(null)}
                aria-label="Fechar mensagem de erro"
              >
                Fechar
              </button>
            </div>
          )}

          {/* Painel: visualização */}
          {tab === 'view' && (
            <div id="boleto-panel-view" role="tabpanel" aria-labelledby="boleto-tab-view">
              <BoletoViewPanel
                due={due}
                boletoData={boletoData}
                onRemove={handleRemove}
                isRemoving={isRemoving}
                onAttachNew={() => setTab('upload')}
              />
            </div>
          )}

          {/* Painel: upload */}
          {tab === 'upload' && (
            <div id="boleto-panel-upload" role="tabpanel" aria-labelledby="boleto-tab-upload">
              <UploadPanel onUpload={handleUpload} isPending={isUploading} />
            </div>
          )}

          {/* Painel: referência */}
          {tab === 'reference' && (
            <div id="boleto-panel-reference" role="tabpanel" aria-labelledby="boleto-tab-reference">
              <ReferencePanel onSubmit={handleReference} isPending={isReferencePending} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
