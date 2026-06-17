// =============================================================================
// features/conversations/components/ContactPanel.tsx — Painel de contato (col 3).
//
// Mostra dados reais da conversa selecionada:
//   - Info do contato (nome, remote ID, provider, status)
//   - Dados da conversa (criada em, última msg, não lidas)
//   - Seção de atendente: agente atual + seletor de atribuição
//   - Ações: resolver conversa, liberar para inbox (desatribuir)
//
// RBAC:
//   - Ações de assign/resolve requerem `livechat:conversation:manage`.
//   - Lista de agentes vem de GET /api/admin/users (requer `users:manage`).
//     Se o usuário não tem a permissão, o seletor fica oculto (403 silencioso).
//
// LGPD (doc 17 §8.1):
//   - contactRemoteId pode conter número de telefone — não logar.
//   - contactPhone (decifrado) NÃO é exibido aqui (requer crm:contact:phone:read).
//
// DS: light-first, tokens sem hex hardcoded onde possível. Sem emoji.
// =============================================================================

import * as React from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../../../lib/auth-store';
import {
  useAgentUsers,
  useAssignConversation,
  useConversation,
  useLinkLead,
  useResolveConversation,
} from '../queries';
import type { ChannelProvider, ConversationStatus } from '../types';

// ─── Helpers de formatação ────────────────────────────────────────────────────

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}

function avatarInitial(name: string | null | undefined): string {
  if (!name) return '?';
  return name.charAt(0).toUpperCase();
}

// ─── Paleta de status ────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<ConversationStatus, { label: string; color: string }> = {
  open: { label: 'Aberta', color: '#16a34a' },
  pending: { label: 'Pendente', color: '#d97706' },
  resolved: { label: 'Resolvida', color: 'var(--brand-azul)' },
  snoozed: { label: 'Adiada', color: '#7c3aed' },
};

// ─── Micro-componentes ────────────────────────────────────────────────────────

function Avatar({
  name,
  size = 36,
}: {
  name: string | null | undefined;
  size?: number;
}): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'var(--grad-azul)',
        color: 'var(--brand-branco)',
        fontSize: size * 0.38,
        fontWeight: 700,
        flexShrink: 0,
        boxShadow: 'var(--elev-1)',
        userSelect: 'none',
        fontFamily: 'var(--font-sans)',
        letterSpacing: '-0.01em',
      }}
    >
      {avatarInitial(name)}
    </span>
  );
}

function StatusBadge({ status }: { status: ConversationStatus }): React.JSX.Element {
  const { label, color } = STATUS_CONFIG[status] ?? { label: status, color: 'var(--text-3)' };
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 500,
        fontFamily: 'var(--font-sans)',
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        color,
        border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
      }}
    >
      {label}
    </span>
  );
}

function ProviderLabel({ provider }: { provider: ChannelProvider }): React.JSX.Element {
  const color =
    provider === 'meta_whatsapp'
      ? '#25d366'
      : provider === 'meta_instagram'
        ? '#e1306c'
        : 'var(--brand-azul)';
  const label =
    provider === 'meta_whatsapp'
      ? 'WhatsApp'
      : provider === 'meta_instagram'
        ? 'Instagram'
        : 'Chat';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 500,
        fontFamily: 'var(--font-sans)',
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        color,
        border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
      }}
    >
      {label}
    </span>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p
      style={{
        fontFamily: 'var(--font-sans)',
        fontSize: 10,
        fontWeight: 600,
        color: 'var(--text-3)',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        margin: 0,
      }}
    >
      {children}
    </p>
  );
}

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontFamily: 'var(--font-sans)', fontSize: 10, color: 'var(--text-3)' }}>
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--text-sm)',
          color: 'var(--text)',
          lineHeight: 1.4,
        }}
      >
        {children}
      </span>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function ContactPanelSkeleton(): React.JSX.Element {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        background: 'var(--bg-elev-1)',
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-subtle)',
          height: 41,
        }}
      />
      <div
        style={{
          padding: '16px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: 'var(--surface-muted)',
            }}
          />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div
              style={{
                height: 12,
                width: '70%',
                borderRadius: 4,
                background: 'var(--surface-muted)',
              }}
            />
            <div
              style={{
                height: 10,
                width: '50%',
                borderRadius: 4,
                background: 'var(--surface-muted)',
              }}
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <div
            style={{ height: 20, width: 60, borderRadius: 999, background: 'var(--surface-muted)' }}
          />
          <div
            style={{ height: 20, width: 70, borderRadius: 999, background: 'var(--surface-muted)' }}
          />
        </div>
      </div>
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[60, 80, 50].map((w) => (
          <div
            key={w}
            style={{
              height: 10,
              width: `${w}%`,
              borderRadius: 4,
              background: 'var(--surface-muted)',
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Botões de ação ───────────────────────────────────────────────────────────

function ActionButton({
  onClick,
  disabled,
  loading,
  variant = 'primary',
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'ghost' | 'danger';
  children: React.ReactNode;
}): React.JSX.Element {
  const base: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    width: '100%',
    padding: '7px 12px',
    borderRadius: 6,
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-sm)',
    fontWeight: 500,
    cursor: disabled || loading ? 'not-allowed' : 'pointer',
    opacity: disabled || loading ? 0.5 : 1,
    transition: 'all 0.15s ease',
    border: 'none',
    outline: 'none',
  };

  const styles: Record<string, React.CSSProperties> = {
    primary: {
      background: 'var(--grad-azul)',
      color: 'var(--brand-branco)',
      boxShadow: 'var(--elev-1)',
    },
    ghost: {
      background: 'transparent',
      color: 'var(--text)',
      border: '1px solid var(--border-subtle)',
    },
    danger: {
      background: `color-mix(in srgb, #dc2626 10%, transparent)`,
      color: '#dc2626',
      border: `1px solid color-mix(in srgb, #dc2626 25%, transparent)`,
    },
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled ?? loading}
      style={{ ...base, ...(styles[variant] ?? {}) }}
    >
      {loading ? (
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }}
        >
          <circle cx="8" cy="8" r="5" strokeOpacity="0.25" />
          <path d="M8 3a5 5 0 015 5" strokeLinecap="round" />
        </svg>
      ) : null}
      {children}
    </button>
  );
}

// ─── LeadSection ──────────────────────────────────────────────────────────────

/**
 * LeadSection — mostra o lead vinculado ou botão para criar/vincular.
 *
 * - leadId presente: link para /crm/:id (rota canônica em App.tsx).
 * - leadId ausente + canManage: botão "Criar lead" (cria via PATCH sem body leadId).
 *
 * LGPD (doc 17 §8.1): leadId é UUID opaco — sem PII.
 * DS: tokens canônicos do doc 18 — sem hex hardcoded.
 */
function LeadSection({
  conversationId,
  leadId,
  canManage,
}: {
  conversationId: string;
  leadId: string | null;
  canManage: boolean;
}): React.JSX.Element {
  const linkLead = useLinkLead(conversationId);

  function handleCreateLead(): void {
    linkLead.mutate({});
  }

  return (
    <div
      style={{
        padding: '16px',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <SectionHeader>Lead no CRM</SectionHeader>

      {leadId !== null ? (
        /* Lead vinculado — link para o perfil */
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            aria-hidden="true"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'color-mix(in srgb, var(--brand-azul) 14%, transparent)',
              color: 'var(--brand-azul)',
              flexShrink: 0,
            }}
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ width: 14, height: 14 }}
              aria-hidden="true"
            >
              <path d="M8 7a3 3 0 100-6 3 3 0 000 6z" />
              <path d="M2 15a6 6 0 0112 0" />
            </svg>
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Link
              to={`/crm/${leadId}`}
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--text-sm)',
                fontWeight: 500,
                color: 'var(--brand-azul)',
                textDecoration: 'none',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                display: 'block',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.textDecoration = 'underline';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.textDecoration = 'none';
              }}
            >
              Ver perfil do lead
            </Link>
            <p
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--text-3)',
                margin: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {leadId}
            </p>
          </div>
        </div>
      ) : canManage ? (
        /* Sem lead + tem permissão — botão Criar lead */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <p
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--text-xs)',
              color: 'var(--text-3)',
              margin: 0,
              fontStyle: 'italic',
            }}
          >
            Contato sem lead no CRM.
          </p>
          <ActionButton
            onClick={handleCreateLead}
            loading={linkLead.isPending}
            disabled={linkLead.isPending}
          >
            Criar lead
          </ActionButton>
          {linkLead.isError && (
            <p
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 10,
                color: 'var(--danger)',
                margin: 0,
                textAlign: 'center',
              }}
            >
              Falha ao criar lead. Tente novamente.
            </p>
          )}
          {linkLead.isSuccess && (
            <p
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 10,
                color: '#16a34a',
                margin: 0,
                textAlign: 'center',
              }}
            >
              Lead criado e vinculado com sucesso.
            </p>
          )}
        </div>
      ) : (
        /* Sem lead + sem permissão — mensagem informativa */
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-3)',
            margin: 0,
            fontStyle: 'italic',
          }}
        >
          Sem lead vinculado.
        </p>
      )}
    </div>
  );
}

// ─── ContactPanel ─────────────────────────────────────────────────────────────

interface ContactPanelProps {
  conversationId: string;
}

/**
 * ContactPanel — coluna 3 do livechat com dados reais do contato e ações.
 *
 * Mostra dados da conversa selecionada + permite assign de agente e resolve.
 * Ações ficam ocultas se o usuário não tem `livechat:conversation:manage`.
 */
export function ContactPanel({ conversationId }: ContactPanelProps): React.JSX.Element {
  const { data, isLoading, isError, refetch } = useConversation(conversationId);
  const { data: usersData } = useAgentUsers();
  const { hasPermission } = useAuth();

  const assign = useAssignConversation(conversationId);
  const resolve = useResolveConversation(conversationId);

  const canManage = hasPermission('livechat:conversation:manage');

  if (isLoading) {
    return <ContactPanelSkeleton />;
  }

  if (isError || !data) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: 16,
          background: 'var(--bg-elev-1)',
        }}
      >
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-xs)',
            color: 'var(--danger)',
            textAlign: 'center',
            margin: 0,
          }}
        >
          Erro ao carregar dados do contato.
        </p>
        <button
          type="button"
          onClick={() => void refetch()}
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-xs)',
            color: 'var(--brand-azul)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            textDecoration: 'underline',
            padding: 0,
          }}
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  const conv = data.data;
  const activeUsers = (usersData?.data ?? []).filter((u) => u.status === 'active');
  const assignedAgent = activeUsers.find((u) => u.id === conv.assignedUserId) ?? null;
  const canAssign = canManage && activeUsers.length > 0;

  function handleAgentChange(e: React.ChangeEvent<HTMLSelectElement>): void {
    const val = e.target.value;
    assign.mutate(val === '' ? null : val);
  }

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        background: 'var(--bg-elev-1)',
      }}
    >
      {/* ── Cabeçalho ──────────────────────────────────────────────────────── */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}
      >
        <SectionHeader>Contato</SectionHeader>
      </div>

      {/* ── Dados do contato ───────────────────────────────────────────────── */}
      <div
        style={{
          padding: '16px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {/* Avatar + nome */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Avatar name={conv.contactName ?? conv.contactRemoteId} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <p
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
                color: 'var(--text)',
                margin: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                letterSpacing: '-0.01em',
              }}
            >
              {conv.contactName ?? 'Sem nome'}
            </p>
            {conv.contactRemoteId && conv.contactName !== conv.contactRemoteId && (
              <p
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--text-3)',
                  margin: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {conv.contactRemoteId}
              </p>
            )}
          </div>
        </div>

        {/* Badges: status + provider */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <StatusBadge status={conv.status} />
          <ProviderLabel provider={conv.provider} />
        </div>
      </div>

      {/* ── Dados da conversa ──────────────────────────────────────────────── */}
      <div
        style={{
          padding: '16px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <SectionHeader>Conversa</SectionHeader>
        <InfoRow label="Criada em">{formatDate(conv.createdAt)}</InfoRow>
        {conv.lastMessageAt !== null && (
          <InfoRow label="Última mensagem">{formatDate(conv.lastMessageAt)}</InfoRow>
        )}
        {conv.unreadCount > 0 && (
          <InfoRow label="Mensagens não lidas">
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 20,
                height: 20,
                borderRadius: 999,
                background: '#dc2626',
                color: '#fff',
                fontSize: 11,
                fontWeight: 700,
                padding: '0 6px',
                fontFamily: 'var(--font-sans)',
              }}
            >
              {conv.unreadCount}
            </span>
          </InfoRow>
        )}
      </div>

      {/* ── Lead no CRM ───────────────────────────────────────────────────────── */}
      <LeadSection conversationId={conversationId} leadId={conv.leadId} canManage={canManage} />

      {/* ── Atendente ──────────────────────────────────────────────────────── */}
      <div
        style={{
          padding: '16px',
          borderBottom:
            canManage && conv.status !== 'resolved' ? '1px solid var(--border-subtle)' : undefined,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <SectionHeader>Atendente</SectionHeader>

        {/* Agente atual */}
        {assignedAgent !== null ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Avatar name={assignedAgent.fullName} size={28} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 500,
                  color: 'var(--text)',
                  margin: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {assignedAgent.fullName}
              </p>
              <p
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 10,
                  color: 'var(--text-3)',
                  margin: 0,
                }}
              >
                Atendente responsável
              </p>
            </div>
          </div>
        ) : (
          <p
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--text-xs)',
              color: 'var(--text-3)',
              margin: 0,
              fontStyle: 'italic',
            }}
          >
            Sem atendente atribuído
          </p>
        )}

        {/* Seletor de agente — só visível se tem permissão e lista de usuários */}
        {canAssign && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label
              htmlFor="agent-select"
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 10,
                color: 'var(--text-3)',
              }}
            >
              {conv.assignedUserId !== null ? 'Reatribuir' : 'Atribuir atendente'}
            </label>
            <select
              id="agent-select"
              value={conv.assignedUserId ?? ''}
              onChange={handleAgentChange}
              disabled={assign.isPending}
              style={{
                width: '100%',
                padding: '6px 8px',
                borderRadius: 6,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg)',
                color: 'var(--text)',
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--text-sm)',
                outline: 'none',
                cursor: assign.isPending ? 'not-allowed' : 'pointer',
                opacity: assign.isPending ? 0.6 : 1,
              }}
            >
              <option value="">Nenhum (inbox geral)</option>
              {activeUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </select>
            {assign.isError && (
              <p
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 10,
                  color: '#dc2626',
                  margin: 0,
                }}
              >
                Falha ao atribuir. Tente novamente.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Ações ──────────────────────────────────────────────────────────── */}
      {canManage && conv.status !== 'resolved' && (
        <div
          style={{
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <SectionHeader>Ações</SectionHeader>

          <ActionButton
            onClick={() => resolve.mutate()}
            loading={resolve.isPending}
            disabled={resolve.isPending}
          >
            Resolver conversa
          </ActionButton>

          {conv.assignedUserId !== null && (
            <ActionButton
              variant="ghost"
              onClick={() => assign.mutate(null)}
              loading={assign.isPending}
              disabled={assign.isPending}
            >
              Liberar para inbox
            </ActionButton>
          )}

          {resolve.isError && (
            <p
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 10,
                color: '#dc2626',
                margin: 0,
                textAlign: 'center',
              }}
            >
              Falha ao resolver. Tente novamente.
            </p>
          )}
        </div>
      )}

      {/* Estado resolvido */}
      {conv.status === 'resolved' && (
        <div
          style={{
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            marginTop: 'auto',
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: `color-mix(in srgb, var(--brand-azul) 12%, transparent)`,
              color: 'var(--brand-azul)',
            }}
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ width: 18, height: 18 }}
              aria-hidden="true"
            >
              <path d="M4 10l4 4 8-8" />
            </svg>
          </span>
          <p
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--text-xs)',
              color: 'var(--text-3)',
              textAlign: 'center',
              margin: 0,
            }}
          >
            Conversa resolvida
          </p>
        </div>
      )}
    </div>
  );
}
