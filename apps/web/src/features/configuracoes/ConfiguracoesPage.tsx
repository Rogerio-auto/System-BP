// =============================================================================
// features/configuracoes/ConfiguracoesPage.tsx — Hub de configurações.
//
// Estrutura:
//   - Camada 1 (Conta): Perfil, Segurança e Aparência funcionais (F8-S09).
//     Conteúdo em ContaSection.tsx.
//   - Camada 2 (Administração): cards gated por permissão, divididos em dois grupos:
//       · Gestão         — Produtos & Regras, Cidades, Agentes, Follow-up,
//                          Cobrança (3 cards), Templates WhatsApp, Agente de IA
//       · Adm. técnica   — Usuários & Papéis, Feature Flags
//     Grupos e camada omitidos quando sem permissão.
//
// Layout: abas (Conta · Administração) em desktop; select em mobile.
// DS: elev-2 (cards), Lift hover, tokens canônicos. Light + dark.
//
// Permissões (verificadas no código-fonte de cada página):
//   - Produtos & Regras    : credit_products:read (Products.tsx L12)
//   - Cidades              : sem gating na UI (Cities.tsx L14 — backend valida)
//                            → card sempre visível para usuários autenticados
//   - Agentes              : agents:manage (Agents.tsx + backend agents/routes.ts)
//   - Usuários & Papéis    : users:manage (backend users/routes.ts + roles/routes.ts)
//   - Feature Flags        : flags:manage (FeatureFlags.tsx L14)
//   - Cobrança — Parcelas  : billing:read + flag billing.enabled (billing/routes.ts L69)
//   - Cobrança — Réguas    : billing:write + flag billing.enabled (billing/routes.ts L138)
//   - Cobrança — Jobs      : billing:read + flag billing.enabled (billing/routes.ts L173)
//   - Templates WhatsApp   : templates:read (templates/routes.ts L47)
// =============================================================================

import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { useFeatureFlags } from '../../hooks/useFeatureFlag';
import { useAuth } from '../../lib/auth-store';
import { cn } from '../../lib/cn';
import { ContextualHelp } from '../help/contextual';

import { ContaSection } from './ContaSection';

// ─── Ícones SVG inline (24×24) ────────────────────────────────────────────────

function IconProdutos(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="w-6 h-6 shrink-0"
      aria-hidden="true"
    >
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M6 7V5a4 4 0 0 1 12 0v2" />
      <path d="M9 13h6" />
    </svg>
  );
}

function IconCidades(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="w-6 h-6 shrink-0"
      aria-hidden="true"
    >
      <path d="M3 6l7-3 4 3 7-3v15l-7 3-4-3-7 3V6Z" />
      <circle cx="12" cy="11" r="2.5" />
    </svg>
  );
}

function IconAgentes(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="w-6 h-6 shrink-0"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 22c0-4 3.58-7 8-7s8 3 8 7" />
      <path d="M16 12l2 2 3-3" />
    </svg>
  );
}

function IconUsuarios(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="w-6 h-6 shrink-0"
      aria-hidden="true"
    >
      <path d="M17 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M7 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z" />
      <path d="M1 20c0-3.5 2.69-6 6-6h2" />
      <path d="M13 20c0-3.5 2.69-6 6-6h-2c-3.31 0-6 2.5-6 6Z" />
      <path d="M13 20h6" />
    </svg>
  );
}

function IconFeatureFlags(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="w-6 h-6 shrink-0"
      aria-hidden="true"
    >
      <path d="M4 3v18" />
      <path d="M4 3h14l-3 5 3 5H4" />
    </svg>
  );
}

function IconFollowup(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="w-6 h-6 shrink-0"
      aria-hidden="true"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8 10h.01M12 10h.01M16 10h.01" strokeLinecap="round" />
    </svg>
  );
}

function IconAgenteIA(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="w-6 h-6 shrink-0"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="12" cy="12" r="3" />
      <path d="M7 5V3M12 5V3M17 5V3" strokeLinecap="round" />
      <path d="M9 12h.01M15 12h.01" strokeLinecap="round" />
    </svg>
  );
}

// Cobrança — Parcelas: ícone de recibo / documento de pagamento
function IconBillingDues(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="w-6 h-6 shrink-0"
      aria-hidden="true"
    >
      <path d="M6 2h12a2 2 0 0 1 2 2v16l-3-2-2 2-2-2-2 2-2-2-3 2V4a2 2 0 0 1 2-2Z" />
      <path d="M9 7h6M9 11h6M9 15h4" strokeLinecap="round" />
    </svg>
  );
}

// Cobrança — Réguas: ícone de régua / calendário (regras de cobrança)
function IconBillingRules(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="w-6 h-6 shrink-0"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18" />
      <path d="M8 2v4M16 2v4" strokeLinecap="round" />
      <path d="M7 14h4M13 14h4M7 18h2" strokeLinecap="round" />
    </svg>
  );
}

// Cobrança — Jobs: ícone de relógio / agendamento
function IconBillingJobs(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="w-6 h-6 shrink-0"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Tutoriais em vídeo: play em círculo
function IconTutoriais(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="w-6 h-6 shrink-0"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5l6 3.5-6 3.5V8.5Z" strokeLinejoin="round" />
    </svg>
  );
}

// Canais de Mensagem: balão de chat com raio (conectividade)
function IconCanais(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="w-6 h-6 shrink-0"
      aria-hidden="true"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8 9.5h4M8 12.5h7" strokeLinecap="round" />
      <circle cx="18" cy="5" r="3" fill="currentColor" stroke="none" className="text-verde" />
    </svg>
  );
}

// Templates WhatsApp: balão de fala com linhas de texto
function IconTemplates(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="w-6 h-6 shrink-0"
      aria-hidden="true"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8 9h8M8 13h5" strokeLinecap="round" />
    </svg>
  );
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Tab = 'conta' | 'administracao';

interface ConfigCard {
  title: string;
  description: string;
  icon: React.ReactNode;
  href?: string;
}

interface ConfigGroup {
  heading: string;
  cards: ConfigCard[];
}

// ─── Card navegável (Administração) ──────────────────────────────────────────

function AdminCard({ card }: { card: ConfigCard }): React.JSX.Element {
  return (
    <Link
      to={card.href!}
      className={cn(
        'group flex flex-col gap-3 p-5 rounded-lg border border-border',
        // Hover Lift: translateY(-4px) + sobe elev-1 → elev-4 (DS §8)
        'transition-all duration-[250ms] ease-out',
        'hover:-translate-y-1 focus-visible:-translate-y-1',
        'focus-visible:outline-none focus-visible:ring-2',
        'focus-visible:ring-[rgba(27,58,140,0.2)]',
      )}
      style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-2)' }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = 'var(--elev-4)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = 'var(--elev-2)';
      }}
      onFocus={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = 'var(--elev-4)';
      }}
      onBlur={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = 'var(--elev-2)';
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex items-center justify-center w-10 h-10 rounded-md shrink-0 transition-colors duration-[150ms]"
          style={{
            background: 'var(--surface-muted)',
            color: 'var(--brand-azul)',
          }}
          aria-hidden="true"
        >
          {card.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3
              className="font-sans font-semibold text-ink truncate group-hover:text-azul transition-colors duration-[150ms]"
              style={{ fontSize: 'var(--text-sm)', letterSpacing: '-0.01em' }}
            >
              {card.title}
            </h3>
            {/* Seta chevron */}
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              className="w-4 h-4 shrink-0 text-ink-4 group-hover:text-azul group-hover:translate-x-0.5 transition-all duration-[150ms]"
              aria-hidden="true"
            >
              <path d="M6 4l4 4-4 4" />
            </svg>
          </div>
          <p
            className="mt-1 font-sans text-ink-3 leading-relaxed"
            style={{ fontSize: 'var(--text-xs)' }}
          >
            {card.description}
          </p>
        </div>
      </div>
    </Link>
  );
}

// ─── Seção Conta ──────────────────────────────────────────────────────────────
// Implementação funcional em ContaSection.tsx (F8-S09).
// Re-exportada aqui via import para manter a estrutura de composição da página.

// ─── Seção Administração ──────────────────────────────────────────────────────

function AdminSection(): React.JSX.Element {
  const { hasPermission } = useAuth();
  const { flags } = useFeatureFlags();

  // Helper: flag ativa quando status === 'enabled' ou 'internal_only' (padrão Sidebar)
  const flagEnabled = (key: string): boolean => {
    const status = flags[key];
    return status === 'enabled' || status === 'internal_only';
  };

  // ── Grupo Gestão ─────────────────────────────────────────────────────────────
  // Produtos: credit_products:read — confirmado em Products.tsx L12
  // Cidades: sem gating na UI — Cities.tsx L14 ("backend valida admin:cities:write")
  //          → card sempre visível para qualquer usuário autenticado
  // Agentes: agents:manage — convenção canônica :manage (F8-S10)
  // Cobrança: billing:read|write + flag billing.enabled — confirmado em billing/routes.ts
  // Templates: templates:read — confirmado em templates/routes.ts L47
  const gestaoCards: ConfigCard[] = [
    ...(hasPermission('credit_products:read')
      ? [
          {
            title: 'Produtos & Regras',
            description: 'Linhas de crédito, taxas, prazos e regras de publicação.',
            icon: <IconProdutos />,
            href: '/admin/products',
          },
        ]
      : []),
    // Cidades: visível a todos (sem gating de UI confirmado)
    {
      title: 'Cidades',
      description: 'Municípios atendidos, IBGE codes e cobertura do Banco do Povo.',
      icon: <IconCidades />,
      href: '/admin/cities',
    },
    ...(hasPermission('agents:manage')
      ? [
          {
            title: 'Agentes',
            description: 'Agentes de crédito, vínculos com cidades e perfis de acesso.',
            icon: <IconAgentes />,
            href: '/admin/agents',
          },
        ]
      : []),
    // Follow-up — Réguas: gated por followup:write (admin + gestor_geral)
    ...(hasPermission('followup:write')
      ? [
          {
            title: 'Follow-up — Réguas',
            description: 'Configure quando e como contatar leads inativos automaticamente.',
            icon: <IconFollowup />,
            href: '/admin/followup/rules',
          },
        ]
      : []),
    // Follow-up — Jobs: gated por followup:read (admin + gestor_geral + gestor_regional)
    ...(hasPermission('followup:read')
      ? [
          {
            title: 'Follow-up — Jobs',
            description: 'Monitore e gerencie envios de follow-up agendados.',
            icon: <IconFollowup />,
            href: '/admin/followup/jobs',
          },
        ]
      : []),
    // Cobrança — Parcelas: billing:read + flag billing.enabled
    ...(hasPermission('billing:read') && flagEnabled('billing.enabled')
      ? [
          {
            title: 'Cobrança — Parcelas',
            description: 'Visualize e gerencie parcelas de contratos em cobrança.',
            icon: <IconBillingDues />,
            href: '/admin/billing/dues',
          },
        ]
      : []),
    // Cobrança — Réguas: billing:write + flag billing.enabled
    ...(hasPermission('billing:write') && flagEnabled('billing.enabled')
      ? [
          {
            title: 'Cobrança — Réguas',
            description: 'Configure as réguas de cobrança: prazos, canais e escalonamento.',
            icon: <IconBillingRules />,
            href: '/admin/billing/rules',
          },
        ]
      : []),
    // Cobrança — Jobs: billing:read + flag billing.enabled
    ...(hasPermission('billing:read') && flagEnabled('billing.enabled')
      ? [
          {
            title: 'Cobrança — Jobs',
            description: 'Monitore execuções agendadas do motor de cobrança.',
            icon: <IconBillingJobs />,
            href: '/admin/billing/jobs',
          },
        ]
      : []),
    // Templates WhatsApp: templates:read (sem flag — sempre disponível quando autorizado)
    ...(hasPermission('templates:read')
      ? [
          {
            title: 'Templates WhatsApp',
            description: 'Gerencie modelos de mensagem aprovados pelo Meta para envios em massa.',
            icon: <IconTemplates />,
            href: '/admin/templates',
          },
        ]
      : []),
    // Canais de Mensagem: gated por channel.connect
    ...(hasPermission('channel.connect')
      ? [
          {
            title: 'Canais de Mensagem',
            description: 'Conecte o WhatsApp Business para receber e enviar mensagens no inbox.',
            icon: <IconCanais />,
            href: '/admin/canais',
          },
        ]
      : []),
    // Agente de IA — Prompts: gated por ai_prompts:read (admin + gestor_geral)
    ...(hasPermission('ai_prompts:read')
      ? [
          {
            title: 'Agente de IA — Prompts',
            description:
              'Gerencie os prompts do agente de IA e controle versões ativas em produção.',
            icon: <IconAgenteIA />,
            href: '/configuracoes/ia/prompts',
          },
        ]
      : []),
    // Agente de IA — Decisões: gated por ai_decisions:read (admin + gestor_geral + gestor_regional)
    ...(hasPermission('ai_decisions:read')
      ? [
          {
            title: 'Agente de IA — Decisões',
            description:
              'Visualize decisões do agente conversa a conversa: intent, prompt, modelo, tokens e custo.',
            icon: <IconAgenteIA />,
            href: '/configuracoes/ia/decisoes',
          },
        ]
      : []),
    // Agente de IA — Playground: gated por ai_playground:run (admin)
    ...(hasPermission('ai_playground:run')
      ? [
          {
            title: 'Agente de IA — Playground',
            description:
              'Teste o grafo do agente em modo dry-run sem persistir nem enviar ao cliente.',
            icon: <IconAgenteIA />,
            href: '/configuracoes/ia/playground',
          },
        ]
      : []),
  ];

  // ── Grupo Administração técnica ───────────────────────────────────────────────
  // Usuários: users:manage — convenção canônica :manage (F8-S10)
  // Feature Flags: flags:manage — confirmado em FeatureFlags.tsx L14
  const tecnicaCards: ConfigCard[] = [
    ...(hasPermission('users:manage')
      ? [
          {
            title: 'Usuários & Papéis',
            description: 'Contas de usuário, papéis RBAC e controle de acesso.',
            icon: <IconUsuarios />,
            href: '/admin/users',
          },
        ]
      : []),
    ...(hasPermission('flags:manage')
      ? [
          {
            title: 'Feature Flags',
            description: 'Ativar e desativar funcionalidades da plataforma em tempo real.',
            icon: <IconFeatureFlags />,
            href: '/admin/feature-flags',
          },
        ]
      : []),
    // Tutoriais em vídeo: tutorials:manage + flag tutorials.enabled (F12-S10)
    ...(hasPermission('tutorials:manage') && flagEnabled('tutorials.enabled')
      ? [
          {
            title: 'Tutoriais em vídeo',
            description: 'Gerencie tutoriais em vídeo exibidos na Central de Ajuda da plataforma.',
            icon: <IconTutoriais />,
            href: '/admin/tutoriais',
          },
        ]
      : []),
  ];

  const grupos: ConfigGroup[] = [
    ...(gestaoCards.length > 0 ? [{ heading: 'Gestão', cards: gestaoCards }] : []),
    ...(tecnicaCards.length > 0 ? [{ heading: 'Administração técnica', cards: tecnicaCards }] : []),
  ];

  if (grupos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
        <svg
          viewBox="0 0 48 48"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.2}
          className="w-12 h-12 text-ink-4"
          aria-hidden="true"
        >
          <circle cx="24" cy="24" r="20" />
          <path d="M24 16v8M24 32v.5" strokeLinecap="round" />
        </svg>
        <p className="font-sans text-sm text-ink-3 max-w-xs">
          Você não tem acesso a nenhuma configuração administrativa. Entre em contato com um
          administrador se precisar de acesso.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {grupos.map((grupo) => (
        <div key={grupo.heading} className="flex flex-col gap-3">
          <h2
            className="font-sans font-semibold uppercase tracking-widest text-ink-3"
            style={{ fontSize: '0.7rem', letterSpacing: '0.12em' }}
          >
            {grupo.heading}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {grupo.cards.map((card) => (
              <AdminCard key={card.title} card={card} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Tabs de navegação ────────────────────────────────────────────────────────

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function TabButton({ active, onClick, children }: TabButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'relative pb-3 font-sans text-sm font-medium transition-colors duration-[150ms]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(27,58,140,0.2)] rounded-sm',
        active ? 'text-azul' : 'text-ink-3 hover:text-ink',
      )}
    >
      {children}
      {/* Indicador ativo */}
      {active && (
        <span
          className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
          style={{ background: 'var(--brand-azul)' }}
          aria-hidden="true"
        />
      )}
    </button>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

/**
 * Hub de configurações `/configuracoes`.
 *
 * Duas abas:
 *   - Conta: perfil, segurança, aparência (funcional — F8-S09).
 *   - Administração: cards gated por permissão, subdivididos em Gestão e Adm. técnica.
 */
export function ConfiguracoesPage(): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();

  // Aba ativa via query param ?tab= (preserva deep link / histórico)
  const tabParam = searchParams.get('tab');
  const activeTab: Tab = tabParam === 'administracao' ? 'administracao' : 'conta';

  const setTab = React.useCallback(
    (tab: Tab) => {
      setSearchParams(tab === 'conta' ? {} : { tab }, { replace: true });
    },
    [setSearchParams],
  );

  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-1">
          <h1
            className="font-display font-bold text-ink"
            style={{
              fontSize: 'var(--text-3xl)',
              letterSpacing: '-0.04em',
              lineHeight: '1',
              fontVariationSettings: "'opsz' 32",
            }}
          >
            Configurações
          </h1>
          {/* ⓘ tutorial de configurações — norma 21 §7 */}
          <ContextualHelp
            featureKey="settings.organization.edit"
            permission="users:manage"
            className="ml-0.5"
          />
        </div>
        <p className="mt-1.5 font-sans text-ink-3" style={{ fontSize: 'var(--text-sm)' }}>
          Gerencie sua conta e as configurações administrativas da plataforma.
        </p>
      </div>

      {/* ── Tabs (desktop) / Select (mobile) ────────────────────────────── */}
      {/* Desktop: tabs horizontais com indicador de linha */}
      <div
        className="hidden sm:flex gap-6 border-b border-border"
        role="tablist"
        aria-label="Seções de configurações"
      >
        <TabButton active={activeTab === 'conta'} onClick={() => setTab('conta')}>
          Conta
        </TabButton>
        <TabButton active={activeTab === 'administracao'} onClick={() => setTab('administracao')}>
          Administração
        </TabButton>
      </div>

      {/* Mobile: select nativo */}
      <div className="sm:hidden">
        <select
          value={activeTab}
          onChange={(e) => setTab(e.target.value as Tab)}
          className={cn(
            'w-full rounded-md border border-border px-3 py-2',
            'font-sans text-sm text-ink bg-surface-1',
            'focus:outline-none focus:ring-2 focus:ring-[rgba(27,58,140,0.2)]',
          )}
          style={{ boxShadow: 'var(--elev-1)' }}
          aria-label="Navegar entre seções"
        >
          <option value="conta">Conta</option>
          <option value="administracao">Administração</option>
        </select>
      </div>

      {/* ── Conteúdo da aba ─────────────────────────────────────────────── */}
      <div role="tabpanel" aria-label={activeTab === 'conta' ? 'Conta' : 'Administração'}>
        {activeTab === 'conta' ? <ContaSection /> : <AdminSection />}
      </div>
    </div>
  );
}
