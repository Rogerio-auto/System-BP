// =============================================================================
// features/crm/CrmDetailPage.tsx — Tela /crm/:id: detalhe de lead.
//
// DS:
//   - Header: avatar azul + nome Bricolage + meta caption
//   - Timeline lateral: Card com hover Spotlight (halo verde — DS §8)
//   - Dados pessoais em Card agrupado
//   - Status como Badge colorido (DS §9.5)
//   - Botão "Editar": abre drawer inline (coluna direita expande) — decisão de
//     UX: drawer lateral preferido ao modal para edição, pois permite comparar
//     dados existentes com campos editáveis side-by-side sem cobrir a timeline.
//
// LGPD:
//   - Telefone: SEMPRE maskPhone()
//   - Email: truncateEmail() na timeline e em cards
//   - CPF: nunca exibido
//   - Sem console.log(lead)
// =============================================================================

import * as React from 'react';
import { Link, useParams } from 'react-router-dom';

import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { useToast } from '../../components/ui/Toast';
import type { LeadInteraction, LeadStatus } from '../../hooks/crm/types';
import {
  STATUS_META,
  SOURCE_LABEL,
  maskPhone,
  truncateEmail,
  formatDate,
  formatRelativeDate,
} from '../../hooks/crm/types';
import { useLead, useLeadInteractions } from '../../hooks/crm/useLead';
import { useUpdateLead } from '../../hooks/crm/useUpdateLead';
import { cn } from '../../lib/cn';

// ─── Skeletons ────────────────────────────────────────────────────────────────

function HeaderSkeleton(): React.JSX.Element {
  return (
    <div className="flex items-start gap-4 animate-pulse">
      <div
        className="w-14 h-14 rounded-pill shrink-0"
        style={{ background: 'var(--surface-muted)' }}
      />
      <div className="flex flex-col gap-2 flex-1">
        <div className="h-6 w-48 rounded-xs" style={{ background: 'var(--surface-muted)' }} />
        <div className="h-4 w-64 rounded-xs" style={{ background: 'var(--surface-muted)' }} />
      </div>
    </div>
  );
}

function CardSkeleton(): React.JSX.Element {
  return (
    <div
      className="rounded-md border border-border bg-surface-1 p-5 animate-pulse"
      style={{ boxShadow: 'var(--elev-2)' }}
    >
      <div className="h-4 w-28 rounded-xs mb-4" style={{ background: 'var(--surface-muted)' }} />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="mb-3">
          <div
            className="h-3 w-20 rounded-xs mb-1.5"
            style={{ background: 'var(--surface-muted)' }}
          />
          <div
            className="h-4 rounded-xs"
            style={{ width: 100 + i * 30, background: 'var(--surface-muted)' }}
          />
        </div>
      ))}
    </div>
  );
}

// ─── Status options ───────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: 'new', label: 'Novo' },
  { value: 'qualifying', label: 'Qualificando' },
  { value: 'simulation', label: 'Simulação' },
  { value: 'closed_won', label: 'Convertido' },
  { value: 'closed_lost', label: 'Perdido' },
  { value: 'archived', label: 'Arquivado' },
];

// ─── Ícone de tipo de interação ───────────────────────────────────────────────

function InteractionIcon({ type }: { type: LeadInteraction['type'] }): React.JSX.Element {
  const iconProps = {
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    className: 'w-4 h-4',
  };

  switch (type) {
    case 'note':
      return (
        <svg {...iconProps}>
          <path d="M6 2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" />
          <path d="M8 8h4M8 12h3" />
        </svg>
      );
    case 'status_change':
      return (
        <svg {...iconProps}>
          <path d="M5 10h10M13 7l3 3-3 3" />
        </svg>
      );
    case 'whatsapp':
      return (
        <svg {...iconProps}>
          <path d="M18 10a8 8 0 1 1-8-8" />
          <path d="M18 2v6h-6" />
          <path d="M7 13s1 2 3 2 3-2 3-2" />
        </svg>
      );
    case 'call':
      return (
        <svg {...iconProps}>
          <path d="M5 4a1 1 0 0 1 1-1h2l2 5-2 1a11 11 0 0 0 5 5l1-2 5 2v2a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1Z" />
        </svg>
      );
    default: // system
      return (
        <svg {...iconProps}>
          <circle cx="10" cy="10" r="8" />
          <path d="M10 7v4M10 14v.5" />
        </svg>
      );
  }
}

const INTERACTION_COLORS: Record<LeadInteraction['type'], string> = {
  note: 'var(--info)',
  status_change: 'var(--brand-azul)',
  whatsapp: 'var(--brand-verde)',
  call: 'var(--brand-amarelo)',
  system: 'var(--text-3)',
};

// ─── Spotlight Card ───────────────────────────────────────────────────────────

function SpotlightCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  const cardRef = React.useRef<HTMLDivElement>(null);

  const handleMouseMove = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - rect.left}px`);
    el.style.setProperty('--my', `${e.clientY - rect.top}px`);
  }, []);

  const handleMouseLeave = React.useCallback(() => {
    const el = cardRef.current;
    if (!el) return;
    el.style.setProperty('--mx', '-9999px');
    el.style.setProperty('--my', '-9999px');
  }, []);

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={cn(
        'relative overflow-hidden rounded-md border border-border bg-surface-1',
        'transition-[transform,box-shadow] duration-[250ms] ease-out',
        'hover:-translate-y-0.5',
        '[--mx:-9999px] [--my:-9999px]',
        className,
      )}
      style={{ boxShadow: 'var(--elev-2)' }}
    >
      {/* Spotlight radial */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-md"
        style={{
          background:
            'radial-gradient(350px circle at var(--mx) var(--my), rgba(46,155,62,0.07), transparent 60%)',
        }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

// ─── Painel de edição (drawer inline) ────────────────────────────────────────

interface EditPanelProps {
  leadId: string;
  currentStatus: LeadStatus;
  currentNotes: string | null;
  onClose: () => void;
}

function EditPanel({
  leadId,
  currentStatus,
  currentNotes,
  onClose,
}: EditPanelProps): React.JSX.Element {
  const { toast } = useToast();
  const [status, setStatus] = React.useState<string>(currentStatus);
  const [notes, setNotes] = React.useState(currentNotes ?? '');

  const { updateLead, isPending } = useUpdateLead(leadId, {
    onSuccess: () => {
      toast('Lead atualizado!', 'success');
      onClose();
    },
    onError: (msg) => {
      toast(msg, 'danger');
    },
  });

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    updateLead({
      status: status as LeadStatus,
      notes: notes || null,
    });
  };

  return (
    <div
      className="rounded-md border border-border bg-surface-1 p-5"
      style={{ boxShadow: 'var(--elev-3)' }}
    >
      <div className="flex items-center justify-between mb-4">
        <h3
          className="font-display font-bold text-ink"
          style={{ fontSize: 'var(--text-base)', letterSpacing: '-0.02em' }}
        >
          Editar lead
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar edição"
          className="w-7 h-7 flex items-center justify-center rounded-xs text-ink-3 hover:text-ink hover:bg-surface-hover transition-all duration-fast"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            className="w-4 h-4"
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Select
          id="edit-status"
          label="Status"
          options={STATUS_OPTIONS}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        />

        <div className="flex flex-col gap-2">
          <label
            htmlFor="edit-notes"
            className="font-sans text-xs font-semibold text-ink-2 uppercase tracking-[0.1em]"
          >
            Notas
          </label>
          <textarea
            id="edit-notes"
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={cn(
              'w-full font-sans text-sm font-medium text-ink',
              'bg-surface-1 rounded-sm px-[14px] py-[11px]',
              'border border-border-strong',
              'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
              'transition-[border-color,box-shadow] duration-fast ease',
              'placeholder:text-ink-4',
              'hover:border-ink-3',
              'focus:outline-none focus:border-azul',
              'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
              'resize-none',
            )}
          />
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isPending}
            className="flex-1"
          >
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={isPending} className="flex-1">
            {isPending ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

/**
 * CrmDetailPage — /crm/:id
 * Layout de 2 colunas: dados principais (esq) + timeline (dir).
 */
export function CrmDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const leadId = id ?? '';

  const { lead, isLoading, isError } = useLead(leadId);
  const { interactions, isLoading: loadingInteractions } = useLeadInteractions(leadId);
  const [editOpen, setEditOpen] = React.useState(false);

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <p className="font-sans text-sm text-danger">Erro ao carregar lead.</p>
        <Link to="/crm">
          <Button variant="outline">← Voltar para CRM</Button>
        </Link>
      </div>
    );
  }

  // LGPD: mascarar PII antes de qualquer uso
  const phoneMasked = lead ? maskPhone(lead.phone_e164) : null;
  const emailTrunc = lead?.email ? truncateEmail(lead.email) : null;
  const statusMeta = lead ? STATUS_META[lead.status] : null;

  return (
    <div
      className="flex flex-col gap-6"
      style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) both' }}
    >
      {/* Breadcrumb + voltar */}
      <div className="flex items-center gap-2">
        <Link
          to="/crm"
          className="font-sans text-sm text-ink-3 hover:text-azul transition-colors flex items-center gap-1"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            className="w-4 h-4"
          >
            <path d="M10 4l-4 4 4 4" />
          </svg>
          CRM
        </Link>
        <span className="text-ink-4 text-sm">/</span>
        <span className="font-sans text-sm text-ink truncate max-w-xs">
          {isLoading ? '...' : (lead?.name ?? 'Lead')}
        </span>
      </div>

      {/* Header do lead */}
      {isLoading ? (
        <HeaderSkeleton />
      ) : lead ? (
        <div
          className="flex items-start justify-between gap-4"
          style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) 0.05s both' }}
        >
          <div className="flex items-center gap-4">
            {/* Avatar variante azul conforme spec */}
            <Avatar name={lead.name} variant="azul" size="lg" />
            <div>
              <h1
                className="font-display font-bold text-ink"
                style={{
                  fontSize: 'var(--text-2xl)',
                  letterSpacing: '-0.035em',
                  fontVariationSettings: "'opsz' 32",
                }}
              >
                {lead.name}
              </h1>
              <div className="flex items-center flex-wrap gap-2 mt-1">
                {statusMeta && <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>}
                <span
                  className="font-sans text-xs text-ink-3 uppercase font-semibold"
                  style={{ letterSpacing: '0.1em' }}
                >
                  {SOURCE_LABEL[lead.source] ?? lead.source}
                </span>
                <span className="text-ink-4 text-xs">Criado {formatDate(lead.created_at)}</span>
              </div>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditOpen((v) => !v)}
            leftIcon={
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                className="w-4 h-4"
              >
                <path d="M11 3l2 2-8 8H3v-2l8-8Z" />
              </svg>
            }
          >
            Editar
          </Button>
        </div>
      ) : null}

      {/* Layout 2 colunas */}
      <div
        className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5"
        style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) 0.1s both' }}
      >
        {/* ── Coluna esquerda: dados + edição ─────────────────────────────── */}
        <div className="flex flex-col gap-5">
          {/* Card dados pessoais */}
          {isLoading ? (
            <CardSkeleton />
          ) : lead ? (
            <SpotlightCard>
              <div className="p-5">
                <h2
                  className="font-sans font-bold text-ink-3 uppercase mb-4"
                  style={{ fontSize: '0.7rem', letterSpacing: '0.12em' }}
                >
                  Dados de contato
                </h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Telefone — LGPD mascarado */}
                  <div>
                    <p
                      className="font-sans font-semibold text-ink-3 uppercase mb-1"
                      style={{ fontSize: '0.65rem', letterSpacing: '0.1em' }}
                    >
                      Telefone
                    </p>
                    <p
                      className="font-mono text-ink-2"
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.875rem',
                        letterSpacing: '-0.01em',
                      }}
                    >
                      {phoneMasked}
                    </p>
                  </div>

                  {/* Email — LGPD truncado */}
                  <div>
                    <p
                      className="font-sans font-semibold text-ink-3 uppercase mb-1"
                      style={{ fontSize: '0.65rem', letterSpacing: '0.1em' }}
                    >
                      E-mail
                    </p>
                    <p className="font-sans text-sm text-ink-2">
                      {emailTrunc ?? <span className="text-ink-4">—</span>}
                    </p>
                  </div>

                  {/* Status */}
                  <div>
                    <p
                      className="font-sans font-semibold text-ink-3 uppercase mb-1"
                      style={{ fontSize: '0.65rem', letterSpacing: '0.1em' }}
                    >
                      Status
                    </p>
                    {statusMeta && <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>}
                  </div>

                  {/* Canal */}
                  <div>
                    <p
                      className="font-sans font-semibold text-ink-3 uppercase mb-1"
                      style={{ fontSize: '0.65rem', letterSpacing: '0.1em' }}
                    >
                      Canal de origem
                    </p>
                    <p className="font-sans text-sm text-ink-2">
                      {SOURCE_LABEL[lead.source] ?? lead.source}
                    </p>
                  </div>
                </div>

                {/* Notas */}
                {lead.notes && (
                  <div className="mt-4 pt-4 border-t border-border-subtle">
                    <p
                      className="font-sans font-semibold text-ink-3 uppercase mb-2"
                      style={{ fontSize: '0.65rem', letterSpacing: '0.1em' }}
                    >
                      Notas
                    </p>
                    <p className="font-sans text-sm text-ink-2 leading-relaxed">{lead.notes}</p>
                  </div>
                )}
              </div>
            </SpotlightCard>
          ) : null}

          {/* Painel de edição inline (drawer-like) */}
          {editOpen && lead && (
            <EditPanel
              leadId={lead.id}
              currentStatus={lead.status}
              currentNotes={lead.notes}
              onClose={() => setEditOpen(false)}
            />
          )}
        </div>

        {/* ── Coluna direita: timeline ─────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <h2
            className="font-sans font-bold text-ink-3 uppercase"
            style={{ fontSize: '0.7rem', letterSpacing: '0.12em' }}
          >
            Timeline
          </h2>

          {loadingInteractions ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-md border border-border bg-surface-1 p-4 animate-pulse"
                  style={{ boxShadow: 'var(--elev-1)' }}
                >
                  <div
                    className="h-3 w-20 rounded-xs mb-2"
                    style={{ background: 'var(--surface-muted)' }}
                  />
                  <div
                    className="h-4 w-full rounded-xs mb-1.5"
                    style={{ background: 'var(--surface-muted)' }}
                  />
                  <div
                    className="h-4 w-3/4 rounded-xs"
                    style={{ background: 'var(--surface-muted)' }}
                  />
                </div>
              ))}
            </div>
          ) : interactions.length === 0 ? (
            <SpotlightCard className="p-4">
              <p className="font-sans text-sm text-ink-3 text-center py-4">
                Nenhuma interação registrada.
              </p>
            </SpotlightCard>
          ) : (
            <div className="flex flex-col gap-3">
              {interactions.map((interaction, idx) => (
                <div
                  key={interaction.id}
                  style={{ animationDelay: `${idx * 40}ms` } as React.CSSProperties}
                >
                  <SpotlightCard className="p-4">
                    {/* Tipo + timestamp */}
                    <div className="flex items-center justify-between mb-2">
                      <span
                        className="flex items-center gap-1.5 font-sans font-semibold text-xs uppercase"
                        style={{
                          color: INTERACTION_COLORS[interaction.type],
                          letterSpacing: '0.08em',
                        }}
                      >
                        <InteractionIcon type={interaction.type} />
                        {interaction.type === 'note' && 'Nota'}
                        {interaction.type === 'status_change' && 'Status'}
                        {interaction.type === 'whatsapp' && 'WhatsApp'}
                        {interaction.type === 'call' && 'Ligação'}
                        {interaction.type === 'system' && 'Sistema'}
                      </span>
                      <span className="font-sans text-xs text-ink-4">
                        {formatRelativeDate(interaction.createdAt)}
                      </span>
                    </div>

                    {/* Conteúdo */}
                    <p className="font-sans text-sm text-ink-2 leading-relaxed">
                      {interaction.content}
                    </p>

                    {/* Ator */}
                    <p className="font-sans text-xs text-ink-4 mt-2">por {interaction.actorName}</p>
                  </SpotlightCard>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
