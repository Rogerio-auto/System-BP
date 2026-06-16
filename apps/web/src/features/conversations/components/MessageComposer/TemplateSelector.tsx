// =============================================================================
// MessageComposer/TemplateSelector.tsx — Seletor de template para janela 24h expirada.
//
// Aparece acima do compositor quando `showTemplateSelector = true`.
// Fluxo:
//   1. Lista templates aprovados via useConversationTemplates
//   2. Usuário seleciona um template
//   3. Se o template tem variáveis: campos de preenchimento aparecem ({{1}}, {{2}} etc.)
//   4. Botão "Enviar template" → chama onSend → fecha o seletor
//
// DS: Spotlight hover em cards, --elev-3, border top radius, bg-surface-2.
// Sem "any". Sem `as` sem justificativa.
// =============================================================================

import * as React from 'react';

import { cn } from '../../../../lib/cn';
import type { TemplateItem } from '../../hooks/useConversationTemplates';
import { useConversationTemplates } from '../../hooks/useConversationTemplates';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface TemplateSelectorProps {
  conversationId: string;
  onClose: () => void;
  onSend: (
    templateName: string,
    languageCode: string,
    components: unknown[],
    variables: Record<string, string>,
  ) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extrai placeholders {{N}} do body_text em ordem de aparição.
 * Retorna array de posições únicas, ex: ['1', '2'].
 */
function extractPlaceholders(bodyText: string): string[] {
  const matches = bodyText.matchAll(/\{\{(\d+)\}\}/g);
  const seen = new Set<string>();
  const positions: string[] = [];
  for (const match of matches) {
    const pos = match[1];
    if (pos !== undefined && !seen.has(pos)) {
      seen.add(pos);
      positions.push(pos);
    }
  }
  return positions;
}

/**
 * Substitui {{N}} pelo valor da variável correspondente no preview.
 */
function interpolate(bodyText: string, values: Record<string, string>): string {
  return bodyText.replace(/\{\{(\d+)\}\}/g, (_match, pos: string) => values[pos] ?? `{{${pos}}}`);
}

// ─── Skeleton de carregamento ─────────────────────────────────────────────────

function TemplateSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 px-3 py-2" aria-hidden="true">
      {[1, 2, 3].map((n) => (
        <div
          key={n}
          className="rounded-sm border border-border bg-surface-hover animate-pulse h-16"
        />
      ))}
    </div>
  );
}

// ─── Card de template ─────────────────────────────────────────────────────────

const categoryLabel: Record<TemplateItem['category'], string> = {
  utility: 'Utilitário',
  marketing: 'Marketing',
  authentication: 'Autenticação',
};

const categoryStyle: Record<TemplateItem['category'], string> = {
  utility: 'bg-azul/10 text-azul border-azul/20',
  marketing: 'bg-warning/10 text-warning border-warning/20',
  authentication: 'bg-verde/10 text-verde border-verde/20',
};

interface TemplateCardProps {
  template: TemplateItem;
  isSelected: boolean;
  onSelect: () => void;
}

function TemplateCard({ template, isSelected, onSelect }: TemplateCardProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      className={cn(
        'w-full text-left rounded-sm border px-3 py-2.5 transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/30',
        // Spotlight hover — DS §6 padrão para cards
        'relative overflow-hidden',
        isSelected
          ? [
              'border-azul/40 bg-azul/5',
              '[box-shadow:var(--elev-1),inset_0_1px_0_rgba(27,58,140,0.08)]',
            ]
          : [
              'border-border bg-surface-1',
              '[box-shadow:var(--elev-1),inset_0_1px_0_rgba(255,255,255,0.06)]',
              'hover:border-border-subtle hover:bg-surface-hover',
              'hover:[box-shadow:var(--elev-2),inset_0_1px_0_rgba(255,255,255,0.08)]',
              'active:[box-shadow:var(--elev-0)]',
            ],
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="font-sans text-xs font-semibold text-ink truncate">{template.name}</span>
        <span
          className={cn(
            'shrink-0 font-sans text-[10px] font-medium px-1.5 py-0.5 rounded-xs border',
            categoryStyle[template.category],
          )}
        >
          {categoryLabel[template.category]}
        </span>
      </div>
      <p className="font-sans text-xs text-ink-3 leading-relaxed line-clamp-2">
        {template.body_text}
      </p>
    </button>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

/**
 * TemplateSelector — painel que aparece acima do compositor para selecionar
 * e preencher um template WhatsApp quando a janela de 24h expirou.
 */
export function TemplateSelector({
  conversationId,
  onClose,
  onSend,
}: TemplateSelectorProps): React.JSX.Element {
  const { data: templates, isLoading, isError } = useConversationTemplates(conversationId);

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [variableValues, setVariableValues] = React.useState<Record<string, string>>({});

  const selectedTemplate = templates?.find((t) => t.id === selectedId) ?? null;
  const placeholders = selectedTemplate ? extractPlaceholders(selectedTemplate.body_text) : [];
  const allFilled = placeholders.every((pos) => (variableValues[pos] ?? '').trim().length > 0);
  const canSend = selectedTemplate !== null && (placeholders.length === 0 || allFilled);

  // Reset variáveis ao trocar de template
  function handleSelectTemplate(templateId: string): void {
    setSelectedId(templateId);
    setVariableValues({});
  }

  function handleVariableChange(pos: string, value: string): void {
    setVariableValues((prev) => ({ ...prev, [pos]: value }));
  }

  function handleSend(): void {
    if (!selectedTemplate || !canSend) return;

    // Monta components da Meta: body com variáveis preenchidas
    const components: unknown[] =
      placeholders.length > 0
        ? [
            {
              type: 'body',
              parameters: placeholders.map((pos) => ({
                type: 'text',
                text: (variableValues[pos] ?? '').trim(),
              })),
            },
          ]
        : [];

    onSend(selectedTemplate.name, 'pt_BR', components, variableValues);
  }

  return (
    <div
      role="dialog"
      aria-label="Selecionar template"
      aria-modal="false"
      className={cn(
        'absolute bottom-full left-0 right-0 z-10',
        'flex flex-col',
        'bg-surface-2 border border-border border-b-0',
        'rounded-t-md',
        '[box-shadow:var(--elev-3),inset_0_1px_0_rgba(255,255,255,0.07)]',
        'max-h-[420px]',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2 border-b border-border-subtle shrink-0">
        <h2 className="font-sans text-sm font-semibold text-ink">Selecionar template</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar seletor de template"
          className={cn(
            'w-7 h-7 flex items-center justify-center rounded-xs',
            'text-ink-3 transition-colors duration-fast ease',
            'hover:bg-surface-hover hover:text-ink',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/30',
            'active:bg-surface-muted',
          )}
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="w-4 h-4"
            aria-hidden="true"
          >
            <path d="M12 4L4 12M4 4l8 8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Corpo — rolável */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Estado: loading */}
        {isLoading && <TemplateSkeleton />}

        {/* Estado: erro */}
        {isError && !isLoading && (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-6 text-center">
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="w-8 h-8 text-ink-4"
              aria-hidden="true"
            >
              <circle cx="10" cy="10" r="8" />
              <path d="M10 6v5M10 13.5v.5" strokeLinecap="round" />
            </svg>
            <p className="font-sans text-xs text-ink-3">Não foi possível carregar os templates.</p>
          </div>
        )}

        {/* Estado: vazio */}
        {!isLoading && !isError && templates !== undefined && templates.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-6 text-center">
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="w-8 h-8 text-ink-4"
              aria-hidden="true"
            >
              <rect x="3" y="5" width="14" height="10" rx="1.5" />
              <path d="M7 9h6M7 12h4" strokeLinecap="round" />
            </svg>
            <p className="font-sans text-xs text-ink-3 max-w-[220px]">
              Nenhum template aprovado. Configure em{' '}
              <span className="font-medium text-azul">Configurações → Templates</span>.
            </p>
          </div>
        )}

        {/* Lista de templates */}
        {!isLoading && !isError && templates !== undefined && templates.length > 0 && (
          <div className="flex flex-col gap-1.5 p-3">
            {templates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                isSelected={selectedId === template.id}
                onSelect={() => handleSelectTemplate(template.id)}
              />
            ))}
          </div>
        )}

        {/* Campos de variável — só quando template selecionado tem variáveis */}
        {selectedTemplate !== null && placeholders.length > 0 && (
          <div className="px-3 pb-3 flex flex-col gap-2 border-t border-border-subtle pt-3">
            {/* Preview com interpolação em tempo real */}
            {(Object.keys(variableValues).length > 0 || placeholders.length > 0) && (
              <div
                className={cn(
                  'rounded-xs border border-border px-3 py-2',
                  'bg-surface-inset',
                  '[box-shadow:inset_0_1px_3px_rgba(20,33,61,0.06)]',
                )}
              >
                <p className="font-sans text-xs text-ink-3 leading-relaxed">
                  {interpolate(selectedTemplate.body_text, variableValues)}
                </p>
              </div>
            )}

            {placeholders.map((pos) => {
              const label = selectedTemplate.variables[Number(pos) - 1] ?? `Variável ${pos}`;
              const inputId = `tmpl-var-${pos}`;
              return (
                <div key={pos} className="flex flex-col gap-1">
                  <label htmlFor={inputId} className="font-sans text-xs font-medium text-ink-2">
                    {label} <span className="font-mono text-ink-4 font-normal">{`{{${pos}}}`}</span>
                  </label>
                  <input
                    id={inputId}
                    type="text"
                    value={variableValues[pos] ?? ''}
                    onChange={(e) => handleVariableChange(pos, e.target.value)}
                    placeholder={`Preencher ${label.toLowerCase()}...`}
                    className={cn(
                      'w-full rounded-xs px-3 py-1.5',
                      'font-sans text-sm text-ink',
                      'bg-surface-inset border border-border',
                      '[box-shadow:inset_0_1px_3px_rgba(20,33,61,0.06),inset_0_0_0_1px_var(--border)]',
                      'placeholder:text-ink-4',
                      'transition-[border-color,box-shadow] duration-fast ease',
                      'focus:outline-none focus:border-azul',
                      'focus:[box-shadow:inset_0_1px_3px_rgba(20,33,61,0.06),0_0_0_2px_rgba(27,58,140,0.12)]',
                    )}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer — botão de envio */}
      <div className="shrink-0 px-3 py-2.5 border-t border-border-subtle">
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          className={cn(
            'w-full h-9 flex items-center justify-center gap-2 rounded-sm',
            'font-sans text-sm font-semibold',
            'transition-[transform,box-shadow,background,opacity] duration-fast ease',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/30',
            canSend
              ? [
                  '[background:var(--grad-azul)] text-white',
                  '[box-shadow:var(--elev-2),inset_0_1px_0_rgba(255,255,255,0.15)]',
                  'hover:-translate-y-0.5',
                  'hover:[box-shadow:var(--glow-azul),inset_0_1px_0_rgba(255,255,255,0.2)]',
                  'active:translate-y-0',
                  'active:[box-shadow:var(--elev-1),inset_0_2px_4px_rgba(0,0,0,0.2)]',
                ]
              : 'bg-surface-muted text-ink-3 cursor-not-allowed opacity-50',
          )}
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            className="w-4 h-4"
            aria-hidden="true"
          >
            <path d="M18 10L2 3l3 7-3 7 16-7z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Enviar template
        </button>
      </div>
    </div>
  );
}
