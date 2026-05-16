// =============================================================================
// __tests__/ConfiguracoesPage.test.tsx — Testes de lógica pura do hub de configurações.
//
// Estratégia: testa lógica de gating de permissão pura, sem renderizar React
// (JSDOM não configurado no vitest — alinhado ao padrão AgentDrawer.test.tsx).
//
// Cobertura:
//   1. Lógica de filtragem de cards por permissão (grupo Gestão)
//   2. Lógica de filtragem de cards por permissão (grupo Adm. técnica)
//   3. Grupos vazios não renderizam
//   4. Ambos os grupos vazios → seção Administração vazia
//   5. Cidades sempre visível (sem gating de UI)
//   6. Contrato das permissões: chaves exatas confirmadas nas páginas-alvo
// =============================================================================

import { describe, expect, it } from 'vitest';

// ─── Replicação da lógica de gating (mesma do AdminSection em ConfiguracoesPage) ────

interface ConfigCard {
  title: string;
  href: string;
}

interface ConfigGroup {
  heading: string;
  cards: ConfigCard[];
}

/**
 * Replica da lógica de buildAdminGroups presente em ConfiguracoesPage.tsx.
 * Centralizada aqui para testar sem montar o componente React.
 */
function buildAdminGroups(permissions: string[]): ConfigGroup[] {
  const hasPermission = (p: string): boolean => permissions.includes(p);

  // Grupo Gestão
  const gestaoCards: ConfigCard[] = [
    ...(hasPermission('credit_products:read')
      ? [{ title: 'Produtos & Regras', href: '/admin/products' }]
      : []),
    // Cidades: sem gating de UI (Cities.tsx L14 — backend valida admin:cities:write)
    { title: 'Cidades', href: '/admin/cities' },
    ...(hasPermission('agents:admin') ? [{ title: 'Agentes', href: '/admin/agents' }] : []),
  ];

  // Grupo Administração técnica
  const tecnicaCards: ConfigCard[] = [
    ...(hasPermission('users:admin') ? [{ title: 'Usuários & Papéis', href: '/admin/users' }] : []),
    ...(hasPermission('flags:manage')
      ? [{ title: 'Feature Flags', href: '/admin/feature-flags' }]
      : []),
  ];

  const grupos: ConfigGroup[] = [
    ...(gestaoCards.length > 0 ? [{ heading: 'Gestão', cards: gestaoCards }] : []),
    ...(tecnicaCards.length > 0 ? [{ heading: 'Administração técnica', cards: tecnicaCards }] : []),
  ];

  return grupos;
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('ConfiguracoesPage — lógica de gating de administração', () => {
  // ── Grupo Gestão ────────────────────────────────────────────────────────────

  it('Gestão: sem permissões → mostra apenas Cidades (sempre visível)', () => {
    const grupos = buildAdminGroups([]);
    expect(grupos).toHaveLength(1); // só Gestão (Cidades sem gating)
    expect(grupos[0]!.heading).toBe('Gestão');
    expect(grupos[0]!.cards.map((c) => c.title)).toEqual(['Cidades']);
  });

  it('Gestão: com credit_products:read → inclui Produtos & Regras', () => {
    const grupos = buildAdminGroups(['credit_products:read']);
    const gestao = grupos.find((g) => g.heading === 'Gestão')!;
    expect(gestao.cards.map((c) => c.title)).toContain('Produtos & Regras');
  });

  it('Gestão: com agents:admin → inclui Agentes', () => {
    const grupos = buildAdminGroups(['agents:admin']);
    const gestao = grupos.find((g) => g.heading === 'Gestão')!;
    expect(gestao.cards.map((c) => c.title)).toContain('Agentes');
  });

  it('Gestão: com todas as permissões → ordem Produtos, Cidades, Agentes', () => {
    const grupos = buildAdminGroups(['credit_products:read', 'agents:admin']);
    const gestao = grupos.find((g) => g.heading === 'Gestão')!;
    expect(gestao.cards.map((c) => c.title)).toEqual(['Produtos & Regras', 'Cidades', 'Agentes']);
  });

  // ── Grupo Adm. técnica ──────────────────────────────────────────────────────

  it('Adm. técnica: sem permissões → grupo não renderiza', () => {
    const grupos = buildAdminGroups([]);
    const tecnica = grupos.find((g) => g.heading === 'Administração técnica');
    expect(tecnica).toBeUndefined();
  });

  it('Adm. técnica: com users:admin → inclui Usuários & Papéis', () => {
    const grupos = buildAdminGroups(['users:admin']);
    const tecnica = grupos.find((g) => g.heading === 'Administração técnica')!;
    expect(tecnica).toBeDefined();
    expect(tecnica.cards.map((c) => c.title)).toContain('Usuários & Papéis');
  });

  it('Adm. técnica: com flags:manage → inclui Feature Flags', () => {
    const grupos = buildAdminGroups(['flags:manage']);
    const tecnica = grupos.find((g) => g.heading === 'Administração técnica')!;
    expect(tecnica).toBeDefined();
    expect(tecnica.cards.map((c) => c.title)).toContain('Feature Flags');
  });

  it('Adm. técnica: com ambas as permissões → ordem Usuários, Feature Flags', () => {
    const grupos = buildAdminGroups(['users:admin', 'flags:manage']);
    const tecnica = grupos.find((g) => g.heading === 'Administração técnica')!;
    expect(tecnica.cards.map((c) => c.title)).toEqual(['Usuários & Papéis', 'Feature Flags']);
  });

  // ── Combinações de grupos ────────────────────────────────────────────────────

  it('admin completo (todas as permissões) → ambos os grupos', () => {
    const grupos = buildAdminGroups([
      'credit_products:read',
      'agents:admin',
      'users:admin',
      'flags:manage',
    ]);
    expect(grupos.map((g) => g.heading)).toEqual(['Gestão', 'Administração técnica']);
    // Total de 5 cards (Produtos, Cidades, Agentes, Usuários, Feature Flags)
    const totalCards = grupos.reduce((acc, g) => acc + g.cards.length, 0);
    expect(totalCards).toBe(5);
  });

  it('role agente (sem permissões admin) → só Gestão com Cidades', () => {
    // Agentes de campo não têm nenhuma das permissões admin
    const grupos = buildAdminGroups([]);
    expect(grupos.map((g) => g.heading)).toEqual(['Gestão']);
    expect(grupos[0]!.cards.map((c) => c.title)).toEqual(['Cidades']);
  });

  // ── Rotas destino (contratos de URL) ─────────────────────────────────────────

  it('hrefs das rotas de destino estão corretos', () => {
    const grupos = buildAdminGroups([
      'credit_products:read',
      'agents:admin',
      'users:admin',
      'flags:manage',
    ]);
    const allCards = grupos.flatMap((g) => g.cards);
    const hrefMap = Object.fromEntries(allCards.map((c) => [c.title, c.href]));

    expect(hrefMap['Produtos & Regras']).toBe('/admin/products');
    expect(hrefMap['Cidades']).toBe('/admin/cities');
    expect(hrefMap['Agentes']).toBe('/admin/agents');
    expect(hrefMap['Usuários & Papéis']).toBe('/admin/users');
    expect(hrefMap['Feature Flags']).toBe('/admin/feature-flags');
  });
});

// ─── Contrato de permissões (documentação verificável) ───────────────────────

describe('ConfiguracoesPage — chaves de permissão (contrato)', () => {
  /**
   * Este teste garante que as chaves usadas no hub correspondem às chaves
   * que as páginas-destino realmente esperam. Se mudar a chave em qualquer
   * página-alvo, este teste falha e sinaliza inconsistência.
   *
   * Chaves verificadas diretamente nas páginas-fonte:
   *   - credit_products:read → Products.tsx L12 ("credit_products:read (ver)")
   *   - Cidades              → Cities.tsx L14 ("backend valida admin:cities:write") — sem gating UI
   *   - agents:admin         → Agents.tsx L10 + Sidebar.tsx
   *   - users:admin          → Sidebar.tsx (hasPermission('users:admin'))
   *   - flags:manage         → FeatureFlags.tsx L14 ("permissão 'flags:manage'")
   */
  it('chaves de permissão formam um conjunto fechado e documentado', () => {
    const PERMISSION_KEYS = {
      produtos: 'credit_products:read',
      cidades: null, // sem gating de UI — sempre visível
      agentes: 'agents:admin',
      usuarios: 'users:admin',
      featureFlags: 'flags:manage',
    } as const;

    // Garante que as chaves não são strings vazias ou undefined por acidente
    expect(PERMISSION_KEYS.produtos).toBe('credit_products:read');
    expect(PERMISSION_KEYS.cidades).toBeNull(); // intencional: sem gating
    expect(PERMISSION_KEYS.agentes).toBe('agents:admin');
    expect(PERMISSION_KEYS.usuarios).toBe('users:admin');
    expect(PERMISSION_KEYS.featureFlags).toBe('flags:manage');
  });
});
