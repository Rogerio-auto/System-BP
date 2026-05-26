// =============================================================================
// features/configuracoes/ai-console/playground/PlaygroundForm.tsx
//
// Formulário esquerdo do playground — entrada do operador.
//
// Controles:
//   - Textarea: mensagem do operador (multilinha, máx 4000 chars)
//   - Toggle: "Usar contexto real (read-only)" / "Sintético"
//   - Contexto real: campos de lead_id e city_id (autocomplete leve via input)
//   - Contexto sintético: botão "Carregar fixture" com 5 opções
//   - Aviso quando contexto real selecionado
//   - Botão "Rodar" — desabilitado se mensagem vazia ou em loading
//
// Regras de Hooks: TODOS os hooks são chamados antes de qualquer early-return.
// O componente recebe `disabled` via props para casos de loading.
//
// LGPD (doc 17):
//   - Sem console.log da mensagem (pode conter PII do operador)
//   - Sem auto-save local de mensagem
//   - Aviso claro ao usuário quando contexto real for selecionado
//
// DS (doc 18):
//   - Toggle: Switch canônico com tokens de cor
//   - Botão Rodar: variante primary com spinner quando loading
//   - Fixture dropdown: ghost outline sem sombra extra
// =============================================================================

import * as React from 'react';

import { Button } from '../../../../components/ui/Button';
import type { PlaygroundRequest } from '../../../../hooks/ai-console/usePlayground';
import { cn } from '../../../../lib/cn';

// ─── Fixtures sintéticas ──────────────────────────────────────────────────────

interface Fixture {
  label: string;
  data: Omit<PlaygroundRequest, 'message' | 'use_real_context'>;
  messageSample: string;
}

const FIXTURES: Fixture[] = [
  {
    label: 'Lead novo',
    data: { lead_id: null, city_id: null },
    messageSample: 'Olá, tenho interesse em crédito para minha empresa.',
  },
  {
    label: 'Lead com cidade conhecida',
    data: { lead_id: null, city_id: 'fixture-city-001' },
    messageSample: 'Quero saber sobre as linhas de crédito disponíveis na minha cidade.',
  },
  {
    label: 'Pedido de handoff',
    data: { lead_id: null, city_id: null },
    messageSample: 'Preciso falar com um atendente humano, por favor.',
  },
  {
    label: 'Fora de escopo',
    data: { lead_id: null, city_id: null },
    messageSample: 'Qual a previsão do tempo para amanhã?',
  },
  {
    label: 'Simulação direta',
    data: { lead_id: 'fixture-lead-001', city_id: 'fixture-city-001' },
    messageSample: 'Quero simular um empréstimo de R$ 10.000.',
  },
];

// ─── Toggle Switch (inline — sem dependência de componente externo) ────────────

interface ToggleSwitchProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}

function ToggleSwitch({
  id,
  checked,
  onChange,
  label,
  description,
}: ToggleSwitchProps): React.JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative shrink-0 w-10 h-[22px] rounded-full',
          'transition-colors duration-[200ms] ease-out',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/40 focus-visible:ring-offset-2',
          'focus-visible:ring-offset-[var(--bg-elev-1)]',
          checked ? 'bg-azul' : 'bg-border-strong',
        )}
        style={{
          background: checked ? 'var(--brand-azul)' : undefined,
        }}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full',
            'transition-transform duration-[200ms] ease-out',
            'shadow-[0_1px_3px_rgba(0,0,0,0.25)]',
            checked ? 'translate-x-[18px]' : 'translate-x-0',
          )}
          style={{ background: 'var(--brand-branco)' }}
          aria-hidden="true"
        />
      </button>
      <div className="flex flex-col gap-0.5 min-w-0">
        <label
          htmlFor={id}
          className="font-sans text-sm font-medium text-ink cursor-pointer"
          style={{ letterSpacing: '-0.005em' }}
        >
          {label}
        </label>
        {description && (
          <p className="font-sans text-xs text-ink-3 leading-relaxed">{description}</p>
        )}
      </div>
    </div>
  );
}

// ─── Spinner inline ───────────────────────────────────────────────────────────

function Spinner(): React.JSX.Element {
  return (
    <svg
      className="animate-spin w-4 h-4 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" strokeOpacity={0.25} />
      <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
    </svg>
  );
}

// ─── Autocomplete leve (lead / city) ─────────────────────────────────────────

interface SimpleTextFieldProps {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}

function SimpleTextField({
  id,
  label,
  placeholder,
  value,
  onChange,
  hint,
}: SimpleTextFieldProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="font-sans text-xs font-semibold text-ink-2 uppercase tracking-widest"
        style={{ fontSize: '0.65rem' }}
      >
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          'w-full font-sans text-sm font-medium text-ink',
          'bg-surface-1 rounded-sm px-[14px] py-[10px]',
          'border border-border-strong',
          'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
          'transition-[border-color,box-shadow,background] duration-fast ease',
          'placeholder:text-ink-4',
          'hover:border-ink-3 hover:bg-surface-hover',
          'focus:outline-none focus:border-azul',
          'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
          'focus:bg-surface-1',
        )}
      />
      {hint && <p className="font-sans text-xs text-ink-3">{hint}</p>}
    </div>
  );
}

// ─── Aviso de contexto real ───────────────────────────────────────────────────

function RealContextWarning(): React.JSX.Element {
  return (
    <div
      className="flex items-start gap-2.5 px-4 py-3 rounded-md border"
      style={{
        background: 'var(--info-bg)',
        borderColor: 'var(--info)',
        borderWidth: '1px',
      }}
      role="note"
      aria-label="Aviso sobre uso de contexto real"
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="w-4 h-4 shrink-0 mt-0.5"
        style={{ color: 'var(--info)' }}
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="6" />
        <path d="M8 7v4M8 5.5v.5" strokeLinecap="round" />
      </svg>
      <p className="font-sans text-xs leading-relaxed" style={{ color: 'var(--info)' }}>
        Você selecionou um lead real. Dados deste lead serão usados em modo somente leitura. Nenhum
        dado será gravado e nenhuma mensagem será enviada ao cliente.
      </p>
    </div>
  );
}

// ─── Dropdown de fixtures ─────────────────────────────────────────────────────

interface FixtureMenuProps {
  onSelect: (fixture: Fixture) => void;
  disabled: boolean;
}

function FixtureMenu({ onSelect, disabled }: FixtureMenuProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora
  React.useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          'inline-flex items-center gap-1.5',
          'font-sans text-xs font-semibold text-ink-2',
          'px-3 py-2 rounded-sm border border-border',
          'transition-[border-color,background,color] duration-[150ms] ease',
          'hover:border-azul hover:text-azul hover:bg-surface-hover',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/30',
          'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
        )}
        style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-1)' }}
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="w-3.5 h-3.5 shrink-0"
          aria-hidden="true"
        >
          <rect x="2" y="4" width="12" height="2" rx="0.5" />
          <rect x="2" y="8" width="9" height="2" rx="0.5" />
          <rect x="2" y="12" width="6" height="2" rx="0.5" />
        </svg>
        Carregar fixture
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          className={cn(
            'w-3.5 h-3.5 shrink-0 transition-transform duration-[150ms]',
            open && 'rotate-180',
          )}
          aria-hidden="true"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 w-56 rounded-lg border border-border py-1 z-20"
          style={{
            background: 'var(--bg-elev-1)',
            boxShadow: 'var(--elev-4)',
          }}
          role="listbox"
          aria-label="Fixtures disponíveis"
        >
          {FIXTURES.map((fixture) => (
            <button
              key={fixture.label}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => {
                onSelect(fixture);
                setOpen(false);
              }}
              className={cn(
                'w-full text-left px-3 py-2',
                'font-sans text-sm text-ink',
                'transition-colors duration-[100ms]',
                'hover:bg-surface-hover hover:text-azul',
                'focus-visible:outline-none focus-visible:bg-surface-hover',
              )}
            >
              {fixture.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Props do formulário ──────────────────────────────────────────────────────

interface PlaygroundFormProps {
  onSubmit: (payload: PlaygroundRequest) => void;
  isPending: boolean;
}

// ─── Componente principal ─────────────────────────────────────────────────────

const MAX_MESSAGE_LENGTH = 4000;

/**
 * Formulário esquerdo do playground.
 *
 * Rules-of-Hooks: todos useState/useCallback são declarados antes de qualquer
 * condicional de render. O componente nunca faz early-return antes dos hooks.
 *
 * LGPD: sem console.log da mensagem. Sem auto-save local.
 */
export function PlaygroundForm({ onSubmit, isPending }: PlaygroundFormProps): React.JSX.Element {
  // ── State (todos antes de qualquer condicional) ─────────────────────────────
  const [message, setMessage] = React.useState('');
  const [useRealContext, setUseRealContext] = React.useState(false);
  const [leadId, setLeadId] = React.useState('');
  const [cityId, setCityId] = React.useState('');

  // ── Derivado ────────────────────────────────────────────────────────────────
  const canSubmit = message.trim().length > 0 && !isPending;
  const charCount = message.length;
  const charWarning = charCount > MAX_MESSAGE_LENGTH * 0.9;

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleLoadFixture = React.useCallback((fixture: Fixture) => {
    setMessage(fixture.messageSample);
    setLeadId(fixture.data.lead_id ?? '');
    setCityId(fixture.data.city_id ?? '');
  }, []);

  const handleSubmit = React.useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;

      onSubmit({
        message: message.trim(),
        lead_id: useRealContext && leadId.trim() ? leadId.trim() : null,
        city_id: useRealContext && cityId.trim() ? cityId.trim() : null,
        use_real_context: useRealContext,
      });
    },
    [canSubmit, message, useRealContext, leadId, cityId, onSubmit],
  );

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      {/* Seção: Mensagem */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label
            htmlFor="playground-message"
            className="font-sans text-xs font-semibold text-ink-2 uppercase tracking-widest"
            style={{ fontSize: '0.65rem' }}
          >
            Mensagem do operador
          </label>
          {/* Contador de caracteres */}
          <span
            className={cn(
              'font-mono text-xs tabular-nums',
              charWarning ? 'text-warning' : 'text-ink-4',
            )}
            aria-live="polite"
          >
            {charCount.toLocaleString('pt-BR')} / {MAX_MESSAGE_LENGTH.toLocaleString('pt-BR')}
          </span>
        </div>

        <textarea
          id="playground-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Digite a mensagem que o lead enviaria ao agente..."
          maxLength={MAX_MESSAGE_LENGTH}
          rows={6}
          aria-required="true"
          aria-describedby="playground-message-hint"
          className={cn(
            'w-full font-sans text-sm font-medium text-ink resize-y',
            'bg-surface-1 rounded-sm px-[14px] py-[11px]',
            'border border-border-strong',
            'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
            'transition-[border-color,box-shadow,background] duration-fast ease',
            'placeholder:text-ink-4',
            'hover:border-ink-3 hover:bg-surface-hover',
            'focus:outline-none focus:border-azul',
            'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
            'focus:bg-surface-1',
            charWarning && 'border-warning focus:border-warning',
          )}
        />
        <p id="playground-message-hint" className="font-sans text-xs text-ink-3">
          Simule a mensagem que seria enviada pelo lead ao agente de IA.
        </p>
      </div>

      {/* Divider */}
      <hr className="border-border" />

      {/* Toggle: contexto real vs sintético */}
      <ToggleSwitch
        id="playground-real-context"
        checked={useRealContext}
        onChange={setUseRealContext}
        label="Usar contexto real (read-only)"
        description={
          useRealContext
            ? 'Selecione um lead e/ou cidade reais abaixo.'
            : 'Usando dados sintéticos — nenhum dado real será acessado.'
        }
      />

      {/* Aviso de contexto real */}
      {useRealContext && <RealContextWarning />}

      {/* Contexto real: campos de lead + city */}
      {useRealContext && (
        <div className="flex flex-col gap-4">
          <SimpleTextField
            id="playground-lead-id"
            label="Lead ID (opcional)"
            placeholder="UUID do lead ou nome/telefone"
            value={leadId}
            onChange={setLeadId}
            hint="Cole o UUID do lead ou use o nome para busca futura."
          />
          <SimpleTextField
            id="playground-city-id"
            label="City ID (opcional)"
            placeholder="UUID da cidade ou nome"
            value={cityId}
            onChange={setCityId}
            hint="Identificador da cidade para contextualização geográfica."
          />
        </div>
      )}

      {/* Contexto sintético: carregar fixture */}
      {!useRealContext && (
        <div className="flex flex-col gap-2">
          <p className="font-sans text-xs text-ink-3">
            Carregue um cenário de teste pré-definido para preencher a mensagem rapidamente.
          </p>
          <FixtureMenu onSelect={handleLoadFixture} disabled={isPending} />
        </div>
      )}

      {/* Botão Rodar */}
      <div className="pt-1">
        <Button
          type="submit"
          variant="primary"
          disabled={!canSubmit}
          aria-label={isPending ? 'Executando playground...' : 'Rodar playground'}
          leftIcon={isPending ? <Spinner /> : undefined}
          className="w-full sm:w-auto"
        >
          {isPending ? 'Rodando...' : 'Rodar'}
        </Button>
      </div>
    </form>
  );
}
