// =============================================================================
// MessageComposer/QuickReplyPicker.tsx — Seletor de respostas rápidas (F28-S06).
//
// Painel flutuante ACIMA do composer, no molde estrutural do TemplateSelector
// (`absolute bottom-full left-0 right-0 z-10`, `max-h-[420px]`, corpo rolável).
// A camada de dados vem inteira de features/quick-replies (F28-S05) — nenhum
// hook/cliente HTTP novo aqui.
//
// Decisão de produto (D2, doc 25 §11.1): clique/Enter ENVIA a resposta
// interpolada de imediato, reusando useSendMessage (POST
// /api/conversations/:id/messages) — nenhuma rota de envio nova. Alt+clique /
// Alt+Enter / ícone de lápis apenas INSERE o texto interpolado no composer.
//
// Dois modos de abertura, mesma UI:
//   - 'slash': o operador digitou "/" como primeiro caractere do textarea. O
//     texto do PRÓPRIO textarea (após a barra) é a query — o foco permanece
//     lá, e o composer (MessageComposer.tsx) encaminha ↑/↓/Enter/Alt+Enter/
//     Esc para este componente via QuickReplyPickerHandle (ref). Filtra por
//     `shortcut` (doc 25 §11.1).
//   - 'manual': botão da barra ou Ctrl/Cmd+Shift+E. O painel tem campo de
//     busca próprio (foco entra nele) e filtra por título+corpo+categoria.
//
// Interpolação é 100% client-side (doc 25 §6.2) — usa dados já em cache
// (useConversation → contactName; useAuth → agentName). O nome do contato é
// PII: fica só em memória (variável local), nunca é logado nem persistido.
//
// LGPD: nenhuma chamada de rede nova é criada aqui — apenas os endpoints já
// existentes (mensagens, telemetria de uso) via os hooks compartilhados.
// =============================================================================

import type { QuickReplyMediaKind, QuickReplyResponse } from '@elemento/shared-schemas';
import * as React from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../../../../lib/auth-store';
import { cn } from '../../../../lib/cn';
import {
  interpolateQuickReply,
  useMarkQuickReplyUsed,
  useQuickReplies,
  useQuickRepliesRealtime,
} from '../../../quick-replies';
import { useConversation } from '../../queries';

import type { SendMediaPayload, SendMessagePayload, SendTextPayload } from './useSendMessage';
import { useSendMessage } from './useSendMessage';

// ─── Constantes ─────────────────────────────────────────────────────────────

/**
 * Espelha WRITE_PERMISSION de apps/api/src/modules/quick-replies/service.ts —
 * só usado aqui para decidir se o estado vazio mostra o CTA "Criar resposta
 * rápida" (rota /admin/quick-replies nasce em F28-S07).
 */
const QUICK_REPLY_WRITE_PERMISSION = 'livechat:quick_reply:write';

/** Teto de itens buscados por abertura do painel — biblioteca é curada, não paginada aqui. */
const QUICK_REPLY_PICKER_LIMIT = 100;

// ─── Tipos ──────────────────────────────────────────────────────────────────

export type QuickReplyPickerMode = 'slash' | 'manual';

export interface QuickReplyPickerHandle {
  /** Move o item ativo (clamped, sem wrap) — usado no modo 'slash' via ref. */
  moveActive(direction: 1 | -1): void;
  /** Ativa o item atualmente em destaque. 'send' = D2, 'insert' = editar antes. */
  activateSelected(action: 'send' | 'insert'): void;
}

export interface QuickReplyPickerProps {
  readonly conversationId: string;
  readonly mode: QuickReplyPickerMode;
  /** Query do modo 'slash' — tudo que foi digitado após o "/" no textarea. */
  readonly slashQuery: string;
  /** Botão que abre/fecha o painel no modo manual — excluído do click-outside. */
  readonly triggerRef?: React.RefObject<HTMLElement | null> | undefined;
  readonly onClose: () => void;
  readonly onInsertText: (text: string) => void;
  readonly onSent: () => void;
  /** Modo 'slash': o composer espelha isto em aria-activedescendant do textarea. */
  readonly onActiveDescendantChange?: ((id: string | null) => void) | undefined;
}

type VisibilityTab = 'organization' | 'personal';

// ─── Helpers puros (testados em __tests__/QuickReplyPicker.test.ts) ─────────

/**
 * Deriva o modo de abertura do painel (doc 25 §11.1). Único ponto de
 * verdade usado por MessageComposer.tsx — garante estruturalmente que
 * NENHUM modo é retornado (logo, o `<QuickReplyPicker>` nem monta) quando a
 * flag está desligada ou o composer está indisponível (permissão/janela
 * 24h fechada/carregando), fechando a lacuna "nenhuma chamada de envio deve
 * partir com a janela fechada" no nível de composição, não de tela.
 */
export function computeQuickReplyMode(params: {
  readonly available: boolean;
  readonly manualOpen: boolean;
  readonly text: string;
  readonly slashDismissed: boolean;
}): QuickReplyPickerMode | null {
  if (!params.available) return null;
  if (params.manualOpen) return 'manual';
  if (params.text.startsWith('/') && !params.slashDismissed) return 'slash';
  return null;
}

/** Modo 'slash' — filtra só pelo atalho (doc 25 §11.1). */
export function filterQuickRepliesByShortcut(
  items: readonly QuickReplyResponse[],
  query: string,
): QuickReplyResponse[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return [...items];
  return items.filter((item) => item.shortcut.toLowerCase().includes(normalized));
}

/** Modo 'manual' — filtra por título + corpo + categoria. */
export function filterQuickRepliesByText(
  items: readonly QuickReplyResponse[],
  query: string,
): QuickReplyResponse[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return [...items];
  return items.filter((item) => {
    const haystack = `${item.title} ${item.body ?? ''} ${item.category ?? ''}`.toLowerCase();
    return haystack.includes(normalized);
  });
}

export interface QuickReplyGroup {
  readonly category: string | null;
  readonly items: readonly QuickReplyResponse[];
}

/** Agrupa preservando a ordem de primeira aparição (a lista já vem ordenada do backend). */
export function groupQuickRepliesByCategory(
  items: readonly QuickReplyResponse[],
): QuickReplyGroup[] {
  const groups: QuickReplyGroup[] = [];
  const indexByCategory = new Map<string | null, number>();
  for (const item of items) {
    const key = item.category;
    const existingIndex = indexByCategory.get(key);
    if (existingIndex === undefined) {
      indexByCategory.set(key, groups.length);
      groups.push({ category: key, items: [item] });
    } else {
      const group = groups[existingIndex];
      if (group) groups[existingIndex] = { ...group, items: [...group.items, item] };
    }
  }
  return groups;
}

/**
 * Monta o payload de `useSendMessage` a partir de uma resposta rápida já
 * interpolada. Mídia é tudo-ou-nada (mediaUrl+mediaMime+mediaKind juntos,
 * doc 25 §4) — quando ausente, cai para texto.
 *
 * `caption` não está tipado em SendMediaPayload (useSendMessage.ts é arquivo
 * fora do escopo deste slot — F28-S06 não pode tocá-lo), mas o backend aceita
 * esse campo opcional em SendMediaSchema (apps/api/src/modules/conversations/
 * send.schema.ts) e o doc 25 §7.4 exige caption = corpo interpolado. Cast
 * justificado: adiciona o campo aceito pelo backend sem alterar a mutation
 * compartilhada nem o contrato de fila.
 */
export function buildQuickReplySendPayload(
  quickReply: QuickReplyResponse,
  interpolatedBody: string,
  idempotencyKey: string,
): SendMessagePayload {
  if (
    quickReply.mediaUrl !== null &&
    quickReply.mediaMime !== null &&
    quickReply.mediaKind !== null
  ) {
    const mediaPayload: SendMediaPayload = {
      type: 'media',
      mediaKind: quickReply.mediaKind,
      publicMediaUrl: quickReply.mediaUrl,
      mime: quickReply.mediaMime,
      fileName: quickReply.mediaFileName ?? quickReply.title,
      idempotencyKey,
    };
    return {
      ...mediaPayload,
      ...(interpolatedBody.length > 0 ? { caption: interpolatedBody } : {}),
    } as SendMessagePayload;
  }

  const textPayload: SendTextPayload = {
    type: 'text',
    content: interpolatedBody,
    idempotencyKey,
  };
  return textPayload;
}

// ─── Ícones ───────────────────────────────────────────────────────────────

function IconSpinner({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="7" strokeOpacity="0.3" />
      <path d="M10 3a7 7 0 017 7" strokeLinecap="round" />
    </svg>
  );
}

function IconPencil({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      aria-hidden="true"
    >
      <path d="M10.5 2.5l3 3L5 14H2v-3l8.5-8.5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const mediaKindIconPaths: Record<QuickReplyMediaKind, string> = {
  image: 'M3 4a1 1 0 011-1h8a1 1 0 011 1v8a1 1 0 01-1 1H4a1 1 0 01-1-1V4z M3 10l3-3 2 2 3-3 3 3',
  video:
    'M2 5a1.5 1.5 0 011.5-1.5h6A1.5 1.5 0 0111 5v6a1.5 1.5 0 01-1.5 1.5h-6A1.5 1.5 0 012 11V5z M11 6.5L14 5v6l-3-1.5',
  audio: 'M6.5 2.5H4A1.5 1.5 0 002.5 4v3A1.5 1.5 0 004 8.5h2.5l4 3.5v-11l-4 3.5z',
  document:
    'M3.5 2.5A1.5 1.5 0 015 1h3.5L12 4.5V13a1.5 1.5 0 01-1.5 1.5h-6A1.5 1.5 0 013 13V4a1.5 1.5 0 01.5-1.5z',
};

function IconMediaKind({
  kind,
  className,
}: {
  kind: QuickReplyMediaKind;
  className?: string;
}): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      aria-hidden="true"
    >
      <path d={mediaKindIconPaths[kind]} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Skeleton / estados ─────────────────────────────────────────────────────

function PickerSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 px-3 py-2" aria-hidden="true">
      {[1, 2, 3].map((n) => (
        <div
          key={n}
          className="rounded-sm border border-border bg-surface-hover animate-pulse h-14"
        />
      ))}
    </div>
  );
}

function PickerErrorState(): React.JSX.Element {
  return (
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
      <p className="font-sans text-xs text-ink-3">
        Não foi possível carregar as respostas rápidas.
      </p>
    </div>
  );
}

function PickerEmptyState({ canCreate }: { canCreate: boolean }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-6 text-center">
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="w-8 h-8 text-ink-4"
        aria-hidden="true"
      >
        <path d="M4 6h12M4 10h8M4 14h5" strokeLinecap="round" />
      </svg>
      <p className="font-sans text-xs text-ink-3 max-w-[220px]">
        Nenhuma resposta rápida encontrada.
      </p>
      {canCreate && (
        <Link
          to="/admin/quick-replies"
          className={cn(
            'font-sans text-xs font-semibold text-azul',
            'hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/30 rounded-xs',
          )}
        >
          Criar resposta rápida
        </Link>
      )}
    </div>
  );
}

// ─── Segmented control (Organização | Minhas) ───────────────────────────────

function VisibilitySegmentedControl({
  value,
  onChange,
}: {
  value: VisibilityTab;
  onChange: (value: VisibilityTab) => void;
}): React.JSX.Element {
  const options: { value: VisibilityTab; label: string }[] = [
    { value: 'organization', label: 'Organização' },
    { value: 'personal', label: 'Minhas' },
  ];

  return (
    <div
      role="tablist"
      aria-label="Filtrar biblioteca de respostas rápidas"
      className="inline-flex items-center gap-0.5 p-0.5 rounded-sm bg-surface-3 shrink-0"
    >
      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(opt.value)}
            className={cn(
              'px-2.5 py-1 rounded-xs font-sans text-xs font-medium transition-all duration-fast ease',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/30',
              isActive
                ? 'bg-surface-1 text-ink [box-shadow:var(--elev-1)]'
                : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Item da lista ───────────────────────────────────────────────────────────

interface QuickReplyItemRowProps {
  readonly item: QuickReplyResponse;
  readonly domId: string;
  readonly isActive: boolean;
  readonly preview: string;
  readonly onActivate: (action: 'send' | 'insert') => void;
  readonly onHover: () => void;
}

function QuickReplyItemRow({
  item,
  domId,
  isActive,
  preview,
  onActivate,
  onHover,
}: QuickReplyItemRowProps): React.JSX.Element {
  const hasBody = item.body !== null && item.body.length > 0;

  return (
    <div
      id={domId}
      role="option"
      aria-selected={isActive}
      onMouseEnter={onHover}
      onClick={(e) => onActivate(e.altKey ? 'insert' : 'send')}
      className={cn(
        'group flex items-start gap-2 px-3 py-2 cursor-pointer select-none rounded-xs mx-1.5',
        'transition-colors duration-fast ease',
        isActive ? 'bg-surface-hover' : 'hover:bg-surface-hover/60',
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
          <span className="font-sans text-xs font-semibold text-ink truncate">{item.title}</span>
          <span className="shrink-0 font-mono text-[10px] font-medium px-1.5 py-0.5 rounded-xs border bg-azul/10 text-azul border-azul/20">
            /{item.shortcut}
          </span>
          {item.mediaKind !== null && (
            <span
              className="shrink-0 inline-flex items-center gap-1 font-sans text-[10px] font-medium px-1.5 py-0.5 rounded-xs border bg-surface-3 text-ink-3 border-border-subtle"
              title={`Inclui mídia (${item.mediaKind})`}
            >
              <IconMediaKind kind={item.mediaKind} className="w-3 h-3" />
            </span>
          )}
          {item.visibility === 'personal' && (
            <span className="shrink-0 font-sans text-[10px] font-medium px-1.5 py-0.5 rounded-xs border bg-verde/10 text-verde border-verde/20">
              Pessoal
            </span>
          )}
        </div>
        <p className="font-sans text-xs text-ink-3 leading-relaxed line-clamp-2">
          {hasBody ? preview : 'Resposta com mídia, sem texto.'}
        </p>
      </div>

      {hasBody && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Editar "${item.title}" antes de enviar`}
          title="Editar antes de enviar (Alt+clique)"
          onClick={(e) => {
            e.stopPropagation();
            onActivate('insert');
          }}
          className={cn(
            'shrink-0 w-6 h-6 flex items-center justify-center rounded-xs',
            'text-ink-4 opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
            'hover:bg-surface-muted hover:text-ink-2 transition-all duration-fast ease',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/30',
          )}
        >
          <IconPencil className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export const QuickReplyPicker = React.forwardRef<QuickReplyPickerHandle, QuickReplyPickerProps>(
  function QuickReplyPicker(
    {
      conversationId,
      mode,
      slashQuery,
      triggerRef,
      onClose,
      onInsertText,
      onSent,
      onActiveDescendantChange,
    },
    ref,
  ): React.JSX.Element {
    const domIdPrefix = React.useId();
    const [visibilityTab, setVisibilityTab] = React.useState<VisibilityTab>('organization');
    const [manualQuery, setManualQuery] = React.useState('');
    const [activeIndex, setActiveIndex] = React.useState(0);

    const containerRef = React.useRef<HTMLDivElement>(null);
    const searchInputRef = React.useRef<HTMLInputElement>(null);

    const { user } = useAuth();
    const { data: conversation } = useConversation(conversationId);
    // LGPD: contactName é PII — permanece só nesta variável em memória, nunca
    // logado nem persistido (doc 25 §6.2).
    const contactName = conversation?.data.contactName ?? null;

    const { data, isLoading, isError } = useQuickReplies({
      visibility: visibilityTab,
      isActive: true,
      limit: QUICK_REPLY_PICKER_LIMIT,
    });
    useQuickRepliesRealtime();

    const sendMutation = useSendMessage(conversationId);
    const { markUsed } = useMarkQuickReplyUsed();

    const rawItems = React.useMemo(() => data?.data ?? [], [data]);
    const query = mode === 'slash' ? slashQuery : manualQuery;
    const filteredItems = React.useMemo(
      () =>
        mode === 'slash'
          ? filterQuickRepliesByShortcut(rawItems, query)
          : filterQuickRepliesByText(rawItems, query),
      [mode, rawItems, query],
    );
    const groups = React.useMemo(() => groupQuickRepliesByCategory(filteredItems), [filteredItems]);

    // Instante fixo por abertura do painel — evita recomputar Date a cada render.
    const referenceNow = React.useRef(new Date()).current;
    const interpolationContext = React.useMemo(
      () => ({
        now: referenceNow,
        contactName,
        agentName: user?.fullName ?? null,
        // organizacao.nome ainda não está disponível em cache no frontend —
        // a chave fica OMITIDA de propósito (exactOptionalPropertyTypes) e o
        // interpolador usa o fallback do próprio texto quando presente (doc
        // 25 §6.2: 100% client-side, zero round-trip; sem endpoint novo).
      }),
      [referenceNow, contactName, user?.fullName],
    );

    // Clamp do índice ativo quando a lista filtrada muda de tamanho.
    React.useEffect(() => {
      setActiveIndex((i) => Math.max(0, Math.min(i, filteredItems.length - 1)));
    }, [filteredItems.length]);

    const activeItem = filteredItems[activeIndex] ?? null;
    const activeDomId = activeItem ? `${domIdPrefix}-item-${activeItem.id}` : null;

    React.useEffect(() => {
      onActiveDescendantChange?.(activeDomId);
    }, [activeDomId, onActiveDescendantChange]);

    // Rola o item ativo para a viewport do painel.
    React.useEffect(() => {
      if (!activeDomId) return;
      const el = containerRef.current?.querySelector(`#${CSS.escape(activeDomId)}`);
      el?.scrollIntoView({ block: 'nearest' });
    }, [activeDomId]);

    // Foco inicial: modo manual move o foco para a busca própria do painel.
    React.useEffect(() => {
      if (mode === 'manual') searchInputRef.current?.focus();
    }, [mode]);

    // Click-outside — fecha o painel em ambos os modos (não depende de blur).
    React.useEffect(() => {
      function handlePointerDown(e: MouseEvent): void {
        // `MouseEvent.target` é `EventTarget | null`; `Node.contains` exige
        // `Node | null`. Cast justificado — mesmo padrão já usado em
        // ChatListFilters.tsx (StatusDropdown) para click-outside.
        const target = e.target as Node;
        if (containerRef.current?.contains(target)) return;
        if (triggerRef?.current?.contains(target)) return;
        onClose();
      }
      document.addEventListener('mousedown', handlePointerDown);
      return () => document.removeEventListener('mousedown', handlePointerDown);
    }, [onClose, triggerRef]);

    const handleActivate = React.useCallback(
      (item: QuickReplyResponse, action: 'send' | 'insert') => {
        const interpolatedBody =
          item.body !== null ? interpolateQuickReply(item.body, interpolationContext) : '';

        // Item sem corpo (mídia pura) não tem o que inserir — cai para envio.
        const effectiveAction =
          action === 'insert' && interpolatedBody.length === 0 ? 'send' : action;

        if (effectiveAction === 'insert') {
          onInsertText(interpolatedBody);
          return;
        }

        const idempotencyKey = crypto.randomUUID();
        const payload = buildQuickReplySendPayload(item, interpolatedBody, idempotencyKey);
        sendMutation.mutate(payload, {
          onSuccess: () => {
            // Telemetria fire-and-forget (doc 25 §10) — nunca bloqueia/desfaz o envio.
            markUsed(item.id);
            onSent();
          },
        });
      },
      [interpolationContext, onInsertText, onSent, sendMutation, markUsed],
    );

    React.useImperativeHandle(
      ref,
      () => ({
        moveActive(direction: 1 | -1) {
          setActiveIndex((i) => Math.max(0, Math.min(i + direction, filteredItems.length - 1)));
        },
        activateSelected(action: 'send' | 'insert') {
          const item = filteredItems[activeIndex];
          if (item) handleActivate(item, action);
        },
      }),
      [filteredItems, activeIndex, handleActivate],
    );

    function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex((i) => Math.min(i + 1, filteredItems.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Enter': {
          e.preventDefault();
          const item = filteredItems[activeIndex];
          if (item) handleActivate(item, e.altKey ? 'insert' : 'send');
          break;
        }
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'Tab':
          onClose();
          break;
        default:
          break;
      }
    }

    const canCreate = user?.permissions.includes(QUICK_REPLY_WRITE_PERMISSION) ?? false;
    const hasItems = !isLoading && !isError && filteredItems.length > 0;

    return (
      <div
        ref={containerRef}
        role="dialog"
        aria-label="Respostas rápidas"
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
        <div className="flex items-center gap-2 px-3 pt-3 pb-2 border-b border-border-subtle shrink-0">
          {mode === 'manual' ? (
            <div className="relative flex-1 min-w-0">
              <input
                ref={searchInputRef}
                type="text"
                role="combobox"
                aria-expanded="true"
                aria-controls={`${domIdPrefix}-listbox`}
                aria-activedescendant={activeDomId ?? undefined}
                value={manualQuery}
                onChange={(e) => setManualQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Buscar por título, texto ou categoria..."
                aria-label="Buscar resposta rápida"
                className={cn(
                  'w-full rounded-xs px-2.5 py-1.5',
                  'font-sans text-sm text-ink',
                  'bg-surface-inset border border-border',
                  '[box-shadow:inset_0_1px_3px_rgba(20,33,61,0.06)]',
                  'placeholder:text-ink-4',
                  'focus:outline-none focus:border-azul',
                  'focus:[box-shadow:inset_0_1px_3px_rgba(20,33,61,0.06),0_0_0_2px_rgba(27,58,140,0.12)]',
                )}
              />
            </div>
          ) : (
            <p className="flex-1 min-w-0 font-sans text-xs text-ink-3 truncate">
              Filtrando por atalho:{' '}
              <span className="font-mono text-ink font-medium">/{slashQuery || '…'}</span>
            </p>
          )}
          <VisibilitySegmentedControl value={visibilityTab} onChange={setVisibilityTab} />
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar respostas rápidas"
            className={cn(
              'shrink-0 w-7 h-7 flex items-center justify-center rounded-xs',
              'text-ink-3 transition-colors duration-fast ease',
              'hover:bg-surface-hover hover:text-ink',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/30',
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
        <div
          id={`${domIdPrefix}-listbox`}
          role="listbox"
          aria-label="Respostas rápidas disponíveis"
          className="flex-1 overflow-y-auto min-h-0 py-1"
        >
          {isLoading && <PickerSkeleton />}
          {isError && !isLoading && <PickerErrorState />}
          {!isLoading && !isError && filteredItems.length === 0 && (
            <PickerEmptyState canCreate={canCreate} />
          )}

          {hasItems &&
            groups.map((group) => (
              <div key={group.category ?? '__none__'}>
                <div className="sticky top-0 z-[1] bg-surface-2 px-3 py-1 font-sans text-[10px] font-semibold uppercase tracking-wide text-ink-4 border-b border-border-subtle">
                  {group.category ?? 'Sem categoria'}
                </div>
                {group.items.map((item) => {
                  const globalIndex = filteredItems.indexOf(item);
                  const preview =
                    item.body !== null
                      ? interpolateQuickReply(item.body, interpolationContext)
                      : '';
                  return (
                    <QuickReplyItemRow
                      key={item.id}
                      item={item}
                      domId={`${domIdPrefix}-item-${item.id}`}
                      isActive={globalIndex === activeIndex}
                      preview={preview}
                      onHover={() => setActiveIndex(globalIndex)}
                      onActivate={(action) => handleActivate(item, action)}
                    />
                  );
                })}
              </div>
            ))}
        </div>

        {sendMutation.isPending && (
          <div className="shrink-0 flex items-center justify-center gap-2 px-3 py-2 border-t border-border-subtle">
            <IconSpinner className="w-3.5 h-3.5 text-ink-3 animate-spin" />
            <span className="font-sans text-xs text-ink-3">Enviando...</span>
          </div>
        )}
      </div>
    );
  },
);
