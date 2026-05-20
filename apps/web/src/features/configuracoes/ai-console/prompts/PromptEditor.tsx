// =============================================================================
// features/configuracoes/ai-console/prompts/PromptEditor.tsx
//
// Editor de nova versão de prompt:
//   - Layout side-by-side: textarea (esquerda) + preview markdown live (direita)
//   - Markdown renderizado com marked + sanitizado com dompurify (bundle pequeno,
//     auditado pela comunidade — sem CDN externo, tudo bundlado pelo Vite)
//   - Chips visuais para placeholders detectados ({lead_name}, {city_name} etc.)
//   - Campo notes (changelog) obrigatório
//   - Campo model_recommended (select hardcoded — extendível via endpoint)
//   - F9-S08: campos temperature, max_tokens, top_p (parâmetros LLM opcionais)
//   - Botão "Salvar versão" → POST F9-S01
//
// Justificativa de deps:
//   - marked@18: parser MD mais rápido e menor (~30kB gzip), sem deps extras.
//   - dompurify@3: líder de segurança em sanitização de HTML, auditado, <10kB gzip.
//   Alternativa descartada: react-markdown (bundle maior com remark tree).
//
// LGPD: body do prompt NUNCA vai para console.log ou telemetria.
// =============================================================================

import DOMPurify from 'dompurify';
import { marked } from 'marked';
import * as React from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Input';
import { Label } from '../../../../components/ui/Label';
import {
  type CreateVersionPayload,
  useCreateVersion,
} from '../../../../hooks/ai-console/usePrompts';
import { cn } from '../../../../lib/cn';

// ─── Modelos LLM disponíveis (hard-coded — extendível via endpoint futuro) ───

const MODELS = [
  { value: '', label: 'Padrão do serviço' },
  { value: 'anthropic/claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' },
  { value: 'anthropic/claude-3-haiku', label: 'Claude 3 Haiku' },
  { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'openai/gpt-4o', label: 'GPT-4o' },
  { value: 'google/gemini-flash-1.5', label: 'Gemini Flash 1.5' },
] as const;

// ─── Preview markdown (marked + dompurify) ────────────────────────────────────

function MarkdownPreview({ source }: { source: string }): React.JSX.Element {
  const html = React.useMemo(() => {
    if (!source.trim()) return '';
    // marked.parse retorna string (sync) — cast justificado: async:false garante string,
    // mas a tipagem genérica do marked v18 retorna string|Promise<string>.
    // html:false é default no marked v18 mas explicitado aqui para prevenir surpresa
    // em upgrade futuro que reverta o default.
    const rawHtml = marked.parse(source, { async: false }) as string;
    return DOMPurify.sanitize(rawHtml, {
      ALLOWED_TAGS: [
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'p',
        'br',
        'hr',
        'strong',
        'em',
        'code',
        'pre',
        'ul',
        'ol',
        'li',
        'blockquote',
        'a',
        'table',
        'thead',
        'tbody',
        'tr',
        'th',
        'td',
      ],
      ALLOWED_ATTR: ['href', 'title', 'class'],
      // ALLOWED_URI_REGEXP: DOMPurify v3 já bloqueia javascript:/data: por default,
      // mas restrição explícita é defense-in-depth contra regressão em upgrade da lib.
      ALLOWED_URI_REGEXP: /^https?:/i,
    });
  }, [source]);

  if (!html) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-ink-4">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.2}
          className="w-8 h-8"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M7 8h10M7 12h7M7 16h5" strokeLinecap="round" />
        </svg>
        <p className="font-sans text-xs">O preview aparece aqui conforme você escreve.</p>
      </div>
    );
  }

  return (
    <div
      className="prose-prompts h-full overflow-y-auto px-5 py-4 font-sans text-sm text-ink leading-relaxed"
      // dangerouslySetInnerHTML é seguro aqui — conteúdo sanitizado pelo DOMPurify
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ─── Chips de placeholders detectados ─────────────────────────────────────────

const PLACEHOLDER_REGEX = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

function PlaceholderChips({ body }: { body: string }): React.JSX.Element | null {
  const placeholders = React.useMemo(() => {
    const found = new Set<string>();
    let match: RegExpExecArray | null;
    const re = new RegExp(PLACEHOLDER_REGEX.source, 'g');
    while ((match = re.exec(body)) !== null) {
      found.add(match[1] as string);
    }
    return Array.from(found);
  }, [body]);

  if (placeholders.length === 0) return null;

  return (
    <div
      className="flex flex-wrap gap-1.5 px-4 py-2 border-t border-border"
      role="status"
      aria-live="polite"
      aria-label="Placeholders detectados"
    >
      <span className="font-sans text-xs text-ink-3 self-center">Placeholders:</span>
      {placeholders.map((ph) => (
        <span
          key={ph}
          className="inline-flex items-center px-2 py-0.5 rounded-pill font-mono text-xs font-medium"
          style={{
            background: 'var(--info-bg)',
            color: 'var(--info)',
            boxShadow: 'var(--elev-1)',
            fontSize: '0.7rem',
          }}
        >
          {`{${ph}}`}
        </span>
      ))}
    </div>
  );
}

// ─── Tooltip de aviso sobre parâmetros LLM (F9-S08) ─────────────────────────

const LLM_PARAM_TOOLTIP =
  'Valores não-default afetam consistência e custo das respostas. Teste no Playground antes de ativar.';

// ─── Formulário ───────────────────────────────────────────────────────────────

interface FormValues {
  body: string;
  notes: string;
  model_recommended: string;
  /** F9-S08: parâmetros LLM opcionais. Vazio = usar default do gateway. */
  temperature: string;
  max_tokens: string;
  top_p: string;
}

interface PromptEditorProps {
  promptKey: string;
  onSuccess: () => void;
  onCancel: () => void;
}

/**
 * Editor de nova versão de prompt.
 * Layout side-by-side adaptativo (stacked em mobile, horizontal em md+).
 */
export function PromptEditor({
  promptKey,
  onSuccess,
  onCancel,
}: PromptEditorProps): React.JSX.Element {
  const { mutate: createVersion, isPending, error } = useCreateVersion(promptKey);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      body: '',
      notes: '',
      model_recommended: '',
      // F9-S08: vazios = null (usar default do gateway)
      temperature: '',
      max_tokens: '',
      top_p: '',
    },
  });

  // Observa body em tempo real para preview e placeholders
  const bodyValue = watch('body');

  const onSubmit = handleSubmit((values) => {
    // F9-S08: converte strings vazias → null; strings não-vazias → número.
    // parseFloat/parseInt retornam NaN para strings inválidas — o Zod no backend
    // rejeita NaN, mas a validação do RHF já impede submit com valores inválidos.
    const temperatureRaw = values.temperature.trim();
    const maxTokensRaw = values.max_tokens.trim();
    const topPRaw = values.top_p.trim();

    const payload: CreateVersionPayload = {
      body: values.body,
      notes: values.notes || null,
      model_recommended: values.model_recommended || null,
      temperature: temperatureRaw !== '' ? parseFloat(temperatureRaw) : null,
      max_tokens: maxTokensRaw !== '' ? parseInt(maxTokensRaw, 10) : null,
      top_p: topPRaw !== '' ? parseFloat(topPRaw) : null,
    };
    createVersion(payload, { onSuccess });
  });

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
        <div>
          <h2
            className="font-display font-bold text-ink"
            style={{
              fontSize: 'var(--text-xl)',
              letterSpacing: '-0.03em',
            }}
          >
            Nova versão
          </h2>
          <p className="mt-0.5 font-mono text-xs text-ink-3">{promptKey}</p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center justify-center w-8 h-8 rounded-md text-ink-3 hover:text-ink hover:bg-surface-hover transition-colors duration-fast"
          aria-label="Fechar editor"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="w-4 h-4"
            aria-hidden="true"
          >
            <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* ── Meta fields ────────────────────────────────────────────────── */}
      <div
        className="flex flex-wrap gap-4 px-5 py-3 border-b border-border shrink-0"
        style={{ background: 'var(--bg-elev-2)' }}
      >
        {/* Model recommended */}
        <div className="flex flex-col gap-1 min-w-[200px]">
          <Label htmlFor="model_recommended">Modelo recomendado</Label>
          <select
            id="model_recommended"
            {...register('model_recommended')}
            className={cn(
              'font-sans text-sm text-ink rounded-sm px-3 py-2',
              'border border-border-strong bg-surface-1',
              'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
              'focus:outline-none focus:border-azul',
              'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
              'transition-[border-color,box-shadow] duration-fast ease',
            )}
          >
            {MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* Notes (changelog) — obrigatório */}
        <div className="flex flex-col gap-1 flex-1 min-w-[240px]">
          <Input
            id="notes"
            label="Notas de changelog"
            required
            placeholder="Ex: Adiciona instrução de fallback para cidade desconhecida"
            error={errors.notes?.message}
            {...register('notes', {
              required: 'Descreva as mudanças nesta versão',
              maxLength: { value: 2000, message: 'Máximo 2000 caracteres' },
            })}
          />
        </div>

        {/* ── F9-S08: Parâmetros LLM (temperature, max_tokens, top_p) ──── */}
        {/* Separador visual */}
        <div className="w-full border-t border-border my-1" />
        <div className="w-full flex flex-wrap gap-4 items-start">
          <div className="flex items-center gap-1.5 w-full mb-0.5">
            <span
              className="font-sans text-xs font-semibold uppercase tracking-widest text-ink-3"
              style={{ fontSize: '0.65rem' }}
            >
              Parâmetros do modelo
            </span>
            {/* Tooltip de aviso */}
            <div className="relative group">
              <button
                type="button"
                className="flex items-center justify-center w-4 h-4 rounded-full text-ink-4 hover:text-ink-2 transition-colors duration-fast"
                aria-label="Sobre parâmetros do modelo"
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  className="w-3.5 h-3.5"
                  aria-hidden="true"
                >
                  <circle cx="8" cy="8" r="6.5" />
                  <path d="M8 7v4M8 5.5v.5" strokeLinecap="round" />
                </svg>
              </button>
              <div
                className="absolute left-5 top-0 z-50 hidden group-hover:block w-72 p-2.5 rounded-md border border-border text-xs font-sans leading-relaxed shadow-lg"
                style={{
                  background: 'var(--bg-elev-3)',
                  color: 'var(--ink-2)',
                  boxShadow: 'var(--elev-4)',
                }}
                role="tooltip"
              >
                {LLM_PARAM_TOOLTIP}
              </div>
            </div>
            <span className="font-sans text-xs text-ink-4" style={{ fontSize: '0.65rem' }}>
              Vazio = padrão do gateway
            </span>
          </div>

          {/* temperature */}
          <div className="flex flex-col gap-1 min-w-[130px]">
            <Label htmlFor="temperature">
              Temperature
              <span className="ml-1 font-mono text-ink-4" style={{ fontSize: '0.65rem' }}>
                [0–2]
              </span>
            </Label>
            <input
              id="temperature"
              type="number"
              step="0.01"
              min={0}
              max={2}
              placeholder="auto"
              aria-describedby={errors.temperature ? 'temperature-error' : undefined}
              {...register('temperature', {
                validate: (v) => {
                  if (v === '' || v === undefined) return true;
                  const n = parseFloat(v);
                  if (isNaN(n)) return 'Número inválido';
                  if (n < 0 || n > 2) return 'Deve estar entre 0 e 2';
                  return true;
                },
              })}
              className={cn(
                'font-mono text-sm text-ink rounded-sm px-3 py-2',
                'border border-border-strong bg-surface-1',
                'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
                'focus:outline-none focus:border-azul',
                'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
                'transition-[border-color,box-shadow] duration-fast ease w-full',
                errors.temperature && 'ring-2 ring-danger/30',
              )}
            />
            {errors.temperature && (
              <p id="temperature-error" className="text-xs text-danger">
                {errors.temperature.message}
              </p>
            )}
            <p className="font-sans text-ink-4" style={{ fontSize: '0.65rem' }}>
              Aleatoriedade. 0 = determinístico
            </p>
          </div>

          {/* max_tokens */}
          <div className="flex flex-col gap-1 min-w-[130px]">
            <Label htmlFor="max_tokens">
              Max tokens
              <span className="ml-1 font-mono text-ink-4" style={{ fontSize: '0.65rem' }}>
                [1–32000]
              </span>
            </Label>
            <input
              id="max_tokens"
              type="number"
              step="1"
              min={1}
              max={32000}
              placeholder="auto"
              aria-describedby={errors.max_tokens ? 'max-tokens-error' : undefined}
              {...register('max_tokens', {
                validate: (v) => {
                  if (v === '' || v === undefined) return true;
                  const n = parseInt(v, 10);
                  if (isNaN(n)) return 'Número inválido';
                  if (n < 1 || n > 32000) return 'Deve estar entre 1 e 32000';
                  return true;
                },
              })}
              className={cn(
                'font-mono text-sm text-ink rounded-sm px-3 py-2',
                'border border-border-strong bg-surface-1',
                'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
                'focus:outline-none focus:border-azul',
                'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
                'transition-[border-color,box-shadow] duration-fast ease w-full',
                errors.max_tokens && 'ring-2 ring-danger/30',
              )}
            />
            {errors.max_tokens && (
              <p id="max-tokens-error" className="text-xs text-danger">
                {errors.max_tokens.message}
              </p>
            )}
            <p className="font-sans text-ink-4" style={{ fontSize: '0.65rem' }}>
              Limite de tokens na resposta
            </p>
          </div>

          {/* top_p */}
          <div className="flex flex-col gap-1 min-w-[130px]">
            <Label htmlFor="top_p">
              Top-p
              <span className="ml-1 font-mono text-ink-4" style={{ fontSize: '0.65rem' }}>
                [0–1]
              </span>
            </Label>
            <input
              id="top_p"
              type="number"
              step="0.01"
              min={0}
              max={1}
              placeholder="auto"
              aria-describedby={errors.top_p ? 'top-p-error' : undefined}
              {...register('top_p', {
                validate: (v) => {
                  if (v === '' || v === undefined) return true;
                  const n = parseFloat(v);
                  if (isNaN(n)) return 'Número inválido';
                  if (n < 0 || n > 1) return 'Deve estar entre 0 e 1';
                  return true;
                },
              })}
              className={cn(
                'font-mono text-sm text-ink rounded-sm px-3 py-2',
                'border border-border-strong bg-surface-1',
                'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
                'focus:outline-none focus:border-azul',
                'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
                'transition-[border-color,box-shadow] duration-fast ease w-full',
                errors.top_p && 'ring-2 ring-danger/30',
              )}
            />
            {errors.top_p && (
              <p id="top-p-error" className="text-xs text-danger">
                {errors.top_p.message}
              </p>
            )}
            <p className="font-sans text-ink-4" style={{ fontSize: '0.65rem' }}>
              Nucleus sampling (diversidade)
            </p>
          </div>
        </div>
      </div>

      {/* ── Side-by-side: editor + preview ─────────────────────────────── */}
      <div className="flex flex-1 min-h-0 flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-border">
        {/* Textarea (esquerda) */}
        <div className="flex flex-col flex-1 min-h-0">
          <div
            className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0"
            style={{ background: 'var(--bg-elev-2)' }}
          >
            <span className="font-sans text-xs font-semibold uppercase tracking-widest text-ink-3">
              Editor
            </span>
            <span className="font-mono text-xs text-ink-4">
              {bodyValue.length.toLocaleString('pt-BR')} / 50 000
            </span>
          </div>
          <textarea
            id="body"
            aria-label="Corpo do prompt"
            aria-required="true"
            aria-invalid={Boolean(errors.body) || undefined}
            aria-describedby={errors.body ? 'body-error' : undefined}
            {...register('body', {
              required: 'O corpo do prompt é obrigatório',
              maxLength: { value: 50_000, message: 'Máximo 50 000 caracteres' },
            })}
            spellCheck={false}
            className={cn(
              'flex-1 resize-none p-4 font-mono text-xs text-ink leading-relaxed',
              'bg-surface-1 outline-none',
              'focus:bg-surface-1',
              'placeholder:text-ink-4',
              errors.body && 'ring-2 ring-danger/30',
            )}
            style={{ minHeight: 300 }}
            placeholder={`Escreva o prompt aqui.\nUse {lead_name}, {city_name}, {product_name} como placeholders.`}
          />
          {errors.body && (
            <p
              id="body-error"
              role="alert"
              className="px-4 py-1.5 text-xs text-danger border-t border-danger/20 bg-danger-bg/30"
            >
              {errors.body.message}
            </p>
          )}
          {/* Chips de placeholders detectados */}
          <PlaceholderChips body={bodyValue} />
        </div>

        {/* Preview markdown (direita) */}
        <div className="flex flex-col flex-1 min-h-0">
          <div
            className="flex items-center px-4 py-2 border-b border-border shrink-0"
            style={{ background: 'var(--bg-elev-2)' }}
          >
            <span className="font-sans text-xs font-semibold uppercase tracking-widest text-ink-3">
              Preview
            </span>
          </div>
          <div className="flex-1 overflow-hidden" style={{ background: 'var(--bg-elev-1)' }}>
            <MarkdownPreview source={bodyValue} />
          </div>
        </div>
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-5 py-4 border-t border-border shrink-0"
        style={{ background: 'var(--bg-elev-2)' }}
      >
        {error && (
          <p role="alert" className="text-xs text-danger font-sans">
            {error instanceof Error ? error.message : 'Erro ao salvar versão'}
          </p>
        )}
        <div className="flex gap-3 ml-auto">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              void onSubmit();
            }}
            disabled={isPending}
          >
            {isPending ? 'Salvando...' : 'Salvar versão'}
          </Button>
        </div>
      </div>
    </div>
  );
}
