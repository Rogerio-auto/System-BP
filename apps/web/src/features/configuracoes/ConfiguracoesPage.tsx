// =============================================================================
// features/configuracoes/ConfiguracoesPage.tsx — Hub de configurações.
//
// Estrutura:
//   - Camada 1 (Conta): Perfil, Segurança e Aparência funcionais (F8-S09).
//     Conteúdo em ContaSection.tsx.
//   - Camada 2 (Administração): cards gated por permissão, divididos em dois grupos:
//       · Gestão         — Produtos & Regras, Cidades, Agentes
//       · Adm. técnica   — Usuários & Papéis, Feature Flags
//     Grupos e camada omitidos quando sem permissão.
//
// Layout: abas (Conta · Administração) em desktop; select em mobile.
// DS: elev-2 (cards), Lift hover, tokens canônicos. Light + dark.
//
// Permissões (verificadas no código-fonte de cada página):
//   - Produtos & Regras : credit_products:read (Products.tsx L12)
//   - Cidades           : sem gating na UI (Cities.tsx L14 — backend valida)
//                         → card sempre visível para usuários autenticados
//   - Agentes           : agents:manage (Agents.tsx + backend agents/routes.ts)
//   - Usuários & Papéis : users:manage (backend users/routes.ts + roles/routes.ts)
//   - Feature Flags     : flags:manage (FeatureFlags.tsx L14)
// =============================================================================

import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { useAuth } from '../../lib/auth-store';
import { cn } from '../../lib/cn';

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

  // ── Grupo Gestão ─────────────────────────────────────────────────────────────
  // Produtos: credit_products:read — confirmado em Products.tsx L12
  // Cidades: sem gating na UI — Cities.tsx L14 ("backend valida admin:cities:write")
  //          → card sempre visível para qualquer usuário autenticado
  // Agentes: agents:manage — convenção canônica :manage (F8-S10)
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
