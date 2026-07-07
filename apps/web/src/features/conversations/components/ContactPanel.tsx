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

import { CityCombobox } from '../../../components/comboboxes/CityCombobox';
import { useToast } from '../../../components/ui/Toast';
import { useAuth } from '../../../lib/auth-store';
import {
  useAgentUsers,
  useAssignConversation,
  useConversation,
  useLinkLead,
  useSetConversationStatus,
} from '../queries';
import { STATUS_CONFIG } from '../statusConfig';
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

// STATUS_CONFIG importado de '../statusConfig' — fonte única de verdade.

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
  channelCityId,
}: {
  conversationId: string;
  leadId: string | null;
  canManage: boolean;
  /** cityId do canal. null indica canal sem cidade — seletor necessario. */
  channelCityId: string | null;
}): React.JSX.Element {
  const linkLead = useLinkLead(conversationId);
  const [selectedCityId, setSelectedCityId] = React.useState('');
  // Canal sem cidade: seletor obrigatorio antes de criar lead
  const needsCitySelect = channelCityId === null;

  function handleCreateLead(): void {
    if (needsCitySelect && !selectedCityId) return; // guard UI
    linkLead.mutate(needsCitySelect ? { cityId: selectedCityId } : {});
  }

  function extractErrorMessage(err: unknown): string {
    if (err && typeof err === 'object' && 'message' in err) {
      const msg = String((err as { message: string }).message);
      if (msg.includes('422') || msg.toLowerCase().includes('cidade')) {
        return 'Cidade nao encontrada ou invalida. Selecione uma cidade valida.';
      }
      if (msg.includes('422')) return 'Dados invalidos (422). Verifique as informacoes.';
    }
    return 'Falha ao criar lead. Tente novamente.';
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
        /* Sem lead + tem permissao — botao Criar lead */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
          {/* Seletor de cidade: obrigatorio quando canal nao tem cityId (F16-S26) */}
          {needsCitySelect && (
            <CityCombobox
              value={selectedCityId}
              onChange={(id) => setSelectedCityId(id)}
              label="Cidade do lead"
              required
              placeholder="Buscar cidade..."
              disabled={linkLead.isPending}
            />
          )}
          <ActionButton
            onClick={handleCreateLead}
            loading={linkLead.isPending}
            disabled={linkLead.isPending || (needsCitySelect && !selectedCityId)}
          >
            Criar lead
          </ActionButton>
          {linkLead.isError && (
            <p
              role="alert"
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 10,
                color: 'var(--danger)',
                margin: 0,
                textAlign: 'center',
              }}
            >
              {extractErrorMessage(linkLead.error)}
            </p>
          )}
          {linkLead.isSuccess && (
            <p
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 10,
                color: 'var(--success)',
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
  const { toast } = useToast();

  const assign = useAssignConversation(conversationId);
  const setStatus = useSetConversationStatus(conversationId);

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
      <LeadSection
        conversationId={conversationId}
        leadId={conv.leadId}
        canManage={canManage}
        channelCityId={conv.cityId}
      />

      {/* ── Atendente ──────────────────────────────────────────────────────── */}
      <div
        style={{
          padding: '16px',
          borderBottom: canManage ? '1px solid var(--border-subtle)' : undefined,
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
      {canManage && (
        <div
          style={{
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <SectionHeader>Status da conversa</SectionHeader>

          {/* Seletor de status — 4 opções coloridas em grid 2×2 */}
          <StatusSelector
            current={conv.status}
            loading={setStatus.isPending}
            onSelect={(status) => {
              setStatus.mutate(
                { status },
                {
                  onSuccess: () => {
                    const label = STATUS_CONFIG[status]?.label ?? status;
                    toast(`Status alterado para "${label}"`, 'success');
                  },
                  onError: () => {
                    toast('Falha ao alterar status. Tente novamente.', 'danger');
                  },
                },
              );
            }}
          />

          {/* Liberar para inbox — só visível se há agente atribuído */}
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
        </div>
      )}
    </div>
  );
}

// ─── StatusSelector ───────────────────────────────────────────────────────────

/**
 * StatusSelector — grade 2×2 com os 4 status canônicos.
 *
 * O status atual é destacado. Ao clicar em outro, dispara onSelect.
 * Clicar no status atual não faz nada (idempotente pela UI).
 */
const STATUS_ORDER: ConversationStatus[] = ['open', 'pending', 'resolved', 'snoozed'];

function StatusSelector({
  current,
  loading,
  onSelect,
}: {
  current: ConversationStatus;
  loading: boolean;
  onSelect: (status: ConversationStatus) => void;
}): React.JSX.Element {
  return (
    <div
      role="group"
      aria-label="Selecionar status da conversa"
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 6,
      }}
    >
      {STATUS_ORDER.map((s) => {
        const { label, color } = STATUS_CONFIG[s];
        const isActive = s === current;

        return (
          <button
            key={s}
            type="button"
            aria-pressed={isActive}
            aria-label={`Definir status como ${label}`}
            disabled={loading || isActive}
            onClick={() => !isActive && onSelect(s)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 10px',
              borderRadius: 'var(--radius-sm)',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--text-xs)',
              fontWeight: isActive ? 600 : 500,
              cursor: loading || isActive ? 'default' : 'pointer',
              opacity: loading && !isActive ? 0.5 : 1,
              transition: `all var(--dur-fast) var(--ease)`,
              // Ativo: fundo colorido + borda + elev-1 (levantado)
              background: isActive
                ? `color-mix(in srgb, ${color} 14%, var(--bg-elev-1))`
                : 'var(--bg-inset)',
              color: isActive ? color : 'var(--text-2)',
              border: isActive
                ? `1px solid color-mix(in srgb, ${color} 30%, transparent)`
                : '1px solid var(--border-subtle)',
              boxShadow: isActive ? 'var(--elev-1)' : 'none',
              outline: 'none',
              // Focus visível
              WebkitTapHighlightColor: 'transparent',
            }}
            onMouseEnter={(e) => {
              if (!isActive && !loading) {
                (e.currentTarget as HTMLButtonElement).style.background =
                  `color-mix(in srgb, ${color} 8%, var(--bg-elev-1))`;
                (e.currentTarget as HTMLButtonElement).style.color = color;
                (e.currentTarget as HTMLButtonElement).style.borderColor =
                  `color-mix(in srgb, ${color} 20%, transparent)`;
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-inset)';
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-2)';
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-subtle)';
              }
            }}
            onFocus={(e) => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow =
                `0 0 0 2px color-mix(in srgb, ${color} 35%, transparent)`;
            }}
            onBlur={(e) => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = isActive
                ? 'var(--elev-1)'
                : 'none';
            }}
          >
            {/* Dot indicador de cor */}
            <span
              aria-hidden="true"
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: color,
                flexShrink: 0,
                boxShadow: isActive ? `0 0 5px ${color}` : 'none',
                transition: `box-shadow var(--dur-fast) var(--ease)`,
              }}
            />
            {label}
          </button>
        );
      })}
    </div>
  );
}
