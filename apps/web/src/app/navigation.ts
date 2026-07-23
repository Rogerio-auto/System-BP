// =============================================================================
// app/navigation.ts — Metadados de navegação canônicos (F4-S03 e futuros).
//
// Usado por: Sidebar, Topbar, breadcrumbs.
// Cada item declara href, label, icon key e permissão mínima (undefined = pública).
// =============================================================================

export interface NavItem {
  href: string;
  label: string;
  /** Chave do ícone (resolução no componente Sidebar). */
  iconKey: string;
  /** Permissão RBAC mínima. undefined = qualquer autenticado. */
  permission?: string | undefined;
  /** Se deve mostrar apenas quando feature flag ativa. */
  featureFlag?: string | undefined;
}

export interface NavSection {
  heading?: string | undefined;
  items: NavItem[];
}

/**
 * Navegação principal do app autenticado.
 * Sidebar e Topbar devem usar esta lista como fonte de verdade.
 */
export const APP_NAV: NavSection[] = [
  {
    items: [{ href: '/', label: 'Dashboard', iconKey: 'dashboard' }],
  },
  {
    heading: 'Operações',
    items: [
      { href: '/crm', label: 'CRM', iconKey: 'crm' },
      {
        href: '/credit-analyses',
        label: 'Análise',
        iconKey: 'analise',
        permission: 'credit_analyses:read',
      },
      { href: '/contratos', label: 'Contratos', iconKey: 'contratos' },
      {
        href: '/conversas',
        label: 'Conversas',
        iconKey: 'conversas',
        permission: 'livechat:conversation:read',
      },
      // Respostas rápidas: biblioteca de mensagens do live chat (F28-S07).
      // livechat:quick_reply:read cobre admin/gestor_geral/agente (também usam
      // a tela para gerenciar as próprias respostas pessoais, doc 25 §5) —
      // iconKey reaproveitado de 'conversas' (sidebar-icons.tsx é compartilhado,
      // fora de files_allowed deste slot).
      {
        href: '/admin/quick-replies',
        label: 'Respostas rápidas',
        iconKey: 'conversas',
        permission: 'livechat:quick_reply:read',
        featureFlag: 'livechat.quick_replies.enabled',
      },
    ],
  },
  {
    heading: 'Crédito',
    items: [
      {
        href: '/simulator',
        label: 'Simulador',
        iconKey: 'simulator',
        featureFlag: 'credit_simulation.enabled',
      },
    ],
  },
  {
    heading: 'Gestão',
    items: [{ href: '/relatorios', label: 'Relatórios', iconKey: 'relatorios' }],
  },
];

/**
 * Navegação de rodapé (Configurações + Ajuda — isolados como padrão Linear/ClickUp).
 * Ordem: Ajuda primeiro (descobrível por novos usuários), Configurações depois.
 */
export const FOOTER_NAV: NavItem[] = [
  { href: '/ajuda', label: 'Ajuda', iconKey: 'help' },
  { href: '/configuracoes', label: 'Configurações', iconKey: 'configuracoes' },
];

// Nota F8-S18: TEMPLATES_NAV_ITEM e BILLING_NAV_ITEM foram removidos.
// Ambos eram dead code — nunca plugados em APP_NAV.
// O gating de cobrança e templates é feito diretamente em ConfiguracoesPage.tsx
// (grupo Gestão do AdminSection), com permissão + flag conforme billing/routes.ts
// e templates/routes.ts.

// Nota F12-S10: TUTORIAIS_NAV_ITEM removido (dead code do F12-S05).
// O gating de tutoriais é feito em ConfiguracoesPage.tsx (grupo Adm. técnica do AdminSection),
// com hasPermission('tutorials:manage') && flagEnabled('tutorials.enabled').
// A rota /admin/tutoriais está registrada em App.tsx (roteador real).
