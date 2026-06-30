// =============================================================================
// features/notifications/preferences/PreferencesMatrix.tsx
//
// Matriz categoria × canal (in_app / email) com toggles individuais e
// switch de mute global. Salva otimista via TanStack Query; rollback em erro.
//
// Categorias (enum shared-schemas — não hardcode divergente):
//   lifecycle_stalled | assignment | credit | billing | handoff | system
//
// Design: tokens DS canônicos (doc 18). Switch = DS §9.9 (44×24 pill).
// Nunca hex hardcoded — sempre var(--*) ou classe Tailwind mapeada.
// =============================================================================

import type { NotificationCategory } from '@elemento/shared-schemas';
import * as React from 'react';

import { cn } from '../../../lib/cn';

import type { PreferenceChannel, PreferenceItem } from './api';
import { useNotificationPreferences, useUpdateNotificationPreferences } from './hooks';

// ---------------------------------------------------------------------------
// Constantes (rótulos PT-BR — derivados do enum, não hardcoded divergentes)
// ---------------------------------------------------------------------------

const CATEGORIES: ReadonlyArray<{ key: NotificationCategory; label: string; description: string }> =
  [
    {
      key: 'lifecycle_stalled',
      label: 'Estagnação de lead',
      description: 'Lead parado sem movimentação no funil',
    },
    { key: 'assignment', label: 'Atribuição', description: 'Conversa ou lead atribuído a você' },
    { key: 'credit', label: 'Crédito', description: 'Simulações e análises de crédito' },
    { key: 'billing', label: 'Cobrança', description: 'Parcelas e cobranças pendentes' },
    {
      key: 'handoff',
      label: 'Transferência',
      description: 'IA transferindo para atendimento humano',
    },
    { key: 'system', label: 'Sistema', description: 'Atualizações e alertas da plataforma' },
  ] as const;

const UI_CHANNELS: ReadonlyArray<{ key: 'in_app' | 'email'; label: string }> = [
  { key: 'in_app', label: 'In-app' },
  { key: 'email', label: 'E-mail' },
] as const;

// ---------------------------------------------------------------------------
// Switch (DS §9.9) — 44×24 pill, thumb 20×20, track → verde quando ativo
// ---------------------------------------------------------------------------

interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}

function Switch({ checked, onChange, disabled = false, label }: SwitchProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      disabled={disabled}
      className={cn(
        'relative inline-flex shrink-0 items-center',
        'h-6 w-11 rounded-pill',
        'transition-colors duration-fast ease',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul focus-visible:ring-offset-2',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        checked && !disabled ? 'bg-verde' : 'bg-surface-muted',
      )}
      style={{ boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.15)' }}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none inline-block h-5 w-5 rounded-full bg-white',
          'transition-transform duration-fast ease',
          checked ? 'translate-x-[22px]' : 'translate-x-[2px]',
        )}
        style={{ boxShadow: 'var(--elev-2)' }}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Helpers — modelo de exibição
// ---------------------------------------------------------------------------

type UiChannel = 'in_app' | 'email';

interface DisplayModel {
  globals: Record<UiChannel, boolean>;
  overrides: Partial<Record<NotificationCategory, Record<UiChannel, boolean>>>;
}

function buildDisplayModel(items: PreferenceItem[]): DisplayModel {
  const model: DisplayModel = {
    globals: { in_app: true, email: true },
    overrides: {},
  };
  for (const item of items) {
    if (item.channel === 'whatsapp') continue;
    const ch = item.channel as UiChannel;
    const cat = item.category ?? null;
    if (!cat) {
      model.globals[ch] = item.enabled;
    } else {
      if (!model.overrides[cat]) {
        model.overrides[cat] = { in_app: true, email: true };
      }
      const ov = model.overrides[cat];
      if (ov) ov[ch] = item.enabled;
    }
  }
  return model;
}

function effectiveValue(model: DisplayModel, cat: NotificationCategory, ch: UiChannel): boolean {
  if (!model.globals[ch]) return false;
  return model.overrides[cat]?.[ch] ?? true;
}

// ---------------------------------------------------------------------------
// Skeleton de carregamento
// ---------------------------------------------------------------------------

function MatrixSkeleton(): React.JSX.Element {
  return (
    <div
      className="animate-pulse flex flex-col gap-3"
      aria-busy="true"
      aria-label="Carregando preferências"
    >
      <div className="h-8 rounded-sm bg-surface-muted w-48" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-10 rounded-sm bg-surface-muted" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PreferencesMatrix (exportado)
// ---------------------------------------------------------------------------

export function PreferencesMatrix(): React.JSX.Element {
  const { data, isLoading, isError, refetch } = useNotificationPreferences();
  const { mutate } = useUpdateNotificationPreferences();

  if (isLoading) return <MatrixSkeleton />;

  if (isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="font-sans text-danger" style={{ fontSize: 'var(--text-sm)' }}>
          Não foi possível carregar as preferências de notificação.
        </p>
        <button
          type="button"
          onClick={() => {
            void refetch();
          }}
          className="font-sans text-azul underline underline-offset-2 hover:text-azul-deep transition-colors duration-fast"
          style={{ fontSize: 'var(--text-sm)' }}
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  const items: PreferenceItem[] = data?.data ?? [];
  const model = buildDisplayModel(items);
  const globalMuted = !model.globals.in_app && !model.globals.email;

  function toggleGlobal(mute: boolean): void {
    mutate({
      preferences: UI_CHANNELS.map(({ key }) => ({
        channel: key as PreferenceChannel,
        enabled: !mute,
        category: null,
      })),
    });
  }

  function toggleCell(cat: NotificationCategory, ch: UiChannel, current: boolean): void {
    mutate({
      preferences: [{ channel: ch as PreferenceChannel, enabled: !current, category: cat }],
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Mute global */}
      <div className="flex items-center justify-between gap-4 py-3 border-b border-border">
        <div>
          <p className="font-sans font-medium text-ink" style={{ fontSize: 'var(--text-sm)' }}>
            Silenciar todas as notificações
          </p>
          <p className="font-sans text-ink-3" style={{ fontSize: 'var(--text-xs)' }}>
            Pausa in-app e e-mail até você reativar
          </p>
        </div>
        <Switch
          checked={globalMuted}
          onChange={toggleGlobal}
          label="Silenciar todas as notificações"
        />
      </div>

      {/* Cabeçalho da matriz */}
      <div
        className="grid gap-x-4"
        style={{ gridTemplateColumns: '1fr repeat(2, 72px)' }}
        aria-label="Matriz de preferências de notificação"
      >
        <span className="font-sans text-ink-3 text-xs uppercase tracking-widest pb-2">
          Categoria
        </span>
        {UI_CHANNELS.map(({ key, label }) => (
          <span
            key={key}
            className="font-sans text-ink-3 text-xs uppercase tracking-widest pb-2 text-center"
          >
            {label}
          </span>
        ))}

        {/* Linhas da matriz */}
        {CATEGORIES.map(({ key: cat, label, description }) => (
          <React.Fragment key={cat}>
            {/* Célula de descrição da linha */}
            <div className="flex flex-col justify-center py-3 border-t border-border-subtle">
              <span
                className="font-sans font-medium text-ink"
                style={{ fontSize: 'var(--text-sm)' }}
              >
                {label}
              </span>
              <span className="font-sans text-ink-4" style={{ fontSize: 'var(--text-xs)' }}>
                {description}
              </span>
            </div>

            {/* Células de toggle por canal */}
            {UI_CHANNELS.map(({ key: ch, label: chLabel }) => {
              const effective = effectiveValue(model, cat, ch);
              return (
                <div
                  key={ch}
                  className="flex items-center justify-center py-3 border-t border-border-subtle"
                >
                  <Switch
                    checked={effective}
                    onChange={() => {
                      toggleCell(cat, ch, effective);
                    }}
                    disabled={globalMuted}
                    label={`${label} via ${chLabel}`}
                  />
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>

      {/* Legenda quando mudo */}
      {globalMuted && (
        <p
          role="status"
          className="font-sans text-ink-3 italic"
          style={{ fontSize: 'var(--text-xs)' }}
        >
          Todas as notificações estão silenciadas. Desative o mute global para ajustar por
          categoria.
        </p>
      )}
    </div>
  );
}
