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
 * Navegação de rodapé (Configurações — isolado como padrão Linear).
 */
export const FOOTER_NAV: NavItem[] = [
  { href: '/configuracoes', label: 'Configurações', iconKey: 'configuracoes' },
];

/**
 * Item de navegação para Templates WhatsApp (F5-S09).
 * Adicionado como item de configuração (tab no Hub de Configurações).
 * Visível para usuários com templates:read.
 * Referenciado pela ConfiguracoesPage para inclusão no grupo "Gestão".
 *
 * NOTA: F5-S05 também adiciona itens a navigation.ts.
 * Adicionar apenas este item, sem reorganizar a estrutura existente.
 */
export const TEMPLATES_NAV_ITEM: NavItem = {
  href: '/admin/templates',
  label: 'Templates WhatsApp',
  iconKey: 'templates',
  permission: 'templates:read',
};
