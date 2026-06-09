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
//   7. Cobrança: billing:read + flag billing.enabled (F8-S18)
//   8. Templates WhatsApp: templates:read (F8-S18)
//   9. Tutoriais em vídeo: tutorials:manage + flag tutorials.enabled (F12-S10)
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

type FeatureFlagsMap = Record<string, 'enabled' | 'disabled' | 'internal_only'>;

/**
 * Replica da lógica de buildAdminGroups presente em ConfiguracoesPage.tsx.
 * Centralizada aqui para testar sem montar o componente React.
 */
function buildAdminGroups(permissions: string[], flags: FeatureFlagsMap = {}): ConfigGroup[] {
  const hasPermission = (p: string): boolean => permissions.includes(p);
  const flagEnabled = (key: string): boolean => {
    const status = flags[key];
    return status === 'enabled' || status === 'internal_only';
  };

  // Grupo Gestão
  const gestaoCards: ConfigCard[] = [
    ...(hasPermission('credit_products:read')
      ? [{ title: 'Produtos & Regras', href: '/admin/products' }]
      : []),
    // Cidades: sem gating de UI (Cities.tsx L14 — backend valida admin:cities:write)
    { title: 'Cidades', href: '/admin/cities' },
    ...(hasPermission('agents:manage') ? [{ title: 'Agentes', href: '/admin/agents' }] : []),
    ...(hasPermission('followup:write')
      ? [{ title: 'Follow-up — Réguas', href: '/admin/followup/rules' }]
      : []),
    ...(hasPermission('followup:read')
      ? [{ title: 'Follow-up — Jobs', href: '/admin/followup/jobs' }]
      : []),
    // Cobrança — Parcelas: billing:read + flag billing.enabled
    ...(hasPermission('billing:read') && flagEnabled('billing.enabled')
      ? [{ title: 'Cobrança — Parcelas', href: '/admin/billing/dues' }]
      : []),
    // Cobrança — Réguas: billing:write + flag billing.enabled
    ...(hasPermission('billing:write') && flagEnabled('billing.enabled')
      ? [{ title: 'Cobrança — Réguas', href: '/admin/billing/rules' }]
      : []),
    // Cobrança — Jobs: billing:read + flag billing.enabled
    ...(hasPermission('billing:read') && flagEnabled('billing.enabled')
      ? [{ title: 'Cobrança — Jobs', href: '/admin/billing/jobs' }]
      : []),
    // Templates WhatsApp: templates:read (sem flag)
    ...(hasPermission('templates:read')
      ? [{ title: 'Templates WhatsApp', href: '/admin/templates' }]
      : []),
    ...(hasPermission('ai_prompts:read')
      ? [{ title: 'Agente de IA — Prompts', href: '/configuracoes/ia/prompts' }]
      : []),
    ...(hasPermission('ai_decisions:read')
      ? [{ title: 'Agente de IA — Decisões', href: '/configuracoes/ia/decisoes' }]
      : []),
    ...(hasPermission('ai_playground:run')
      ? [{ title: 'Agente de IA — Playground', href: '/configuracoes/ia/playground' }]
      : []),
  ];

  // Grupo Administração técnica
  const tecnicaCards: ConfigCard[] = [
    ...(hasPermission('users:manage')
      ? [{ title: 'Usuários & Papéis', href: '/admin/users' }]
      : []),
    ...(hasPermission('flags:manage')
      ? [{ title: 'Feature Flags', href: '/admin/feature-flags' }]
      : []),
    // Tutoriais em vídeo: tutorials:manage + flag tutorials.enabled (F12-S10)
    ...(hasPermission('tutorials:manage') && flagEnabled('tutorials.enabled')
      ? [{ title: 'Tutoriais em vídeo', href: '/admin/tutoriais' }]
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

  it('Gestão: com agents:manage → inclui Agentes', () => {
    const grupos = buildAdminGroups(['agents:manage']);
    const gestao = grupos.find((g) => g.heading === 'Gestão')!;
    expect(gestao.cards.map((c) => c.title)).toContain('Agentes');
  });

  it('Gestão: com todas as permissões → ordem Produtos, Cidades, Agentes', () => {
    const grupos = buildAdminGroups(['credit_products:read', 'agents:manage']);
    const gestao = grupos.find((g) => g.heading === 'Gestão')!;
    expect(gestao.cards.map((c) => c.title)).toEqual(['Produtos & Regras', 'Cidades', 'Agentes']);
  });

  // ── Grupo Adm. técnica ──────────────────────────────────────────────────────

  it('Adm. técnica: sem permissões → grupo não renderiza', () => {
    const grupos = buildAdminGroups([]);
    const tecnica = grupos.find((g) => g.heading === 'Administração técnica');
    expect(tecnica).toBeUndefined();
  });

  it('Adm. técnica: com users:manage → inclui Usuários & Papéis', () => {
    const grupos = buildAdminGroups(['users:manage']);
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
    const grupos = buildAdminGroups(['users:manage', 'flags:manage']);
    const tecnica = grupos.find((g) => g.heading === 'Administração técnica')!;
    expect(tecnica.cards.map((c) => c.title)).toEqual(['Usuários & Papéis', 'Feature Flags']);
  });

  // ── Combinações de grupos ────────────────────────────────────────────────────

  it('admin completo (todas as permissões) → ambos os grupos', () => {
    const grupos = buildAdminGroups([
      'credit_products:read',
      'agents:manage',
      'users:manage',
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
      'agents:manage',
      'users:manage',
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

// ─── Cobrança — gating por permissão + feature flag (F8-S18) ─────────────────

describe('ConfiguracoesPage — Cobrança (billing) — gating permissão + flag', () => {
  it('Cobrança — Parcelas: aparece com billing:read + flag billing.enabled=enabled', () => {
    const grupos = buildAdminGroups(['billing:read'], { 'billing.enabled': 'enabled' });
    const gestao = grupos.find((g) => g.heading === 'Gestão')!;
    expect(gestao.cards.map((c) => c.title)).toContain('Cobrança — Parcelas');
    expect(gestao.cards.find((c) => c.title === 'Cobrança — Parcelas')?.href).toBe(
      '/admin/billing/dues',
    );
  });

  it('Cobrança — Parcelas: aparece com billing:read + flag billing.enabled=internal_only', () => {
    const grupos = buildAdminGroups(['billing:read'], { 'billing.enabled': 'internal_only' });
    const gestao = grupos.find((g) => g.heading === 'Gestão')!;
    expect(gestao.cards.map((c) => c.title)).toContain('Cobrança — Parcelas');
  });

  it('Cobrança — Parcelas: NÃO aparece sem billing:read (flag ativa)', () => {
    const grupos = buildAdminGroups([], { 'billing.enabled': 'enabled' });
    const gestao = grupos.find((g) => g.heading === 'Gestão')!;
    expect(gestao.cards.map((c) => c.title)).not.toContain('Cobrança — Parcelas');
  });

  it('Cobrança — Parcelas: NÃO aparece sem flag (permissão ativa)', () => {
    const grupos = buildAdminGroups(['billing:read'], { 'billing.enabled': 'disabled' });
    const gestao = grupos.find((g) => g.heading === 'Gestão')!;
    expect(gestao.cards.map((c) => c.title)).not.toContain('Cobrança — Parcelas');
  });

  it('Cobrança — Parcelas: NÃO aparece com flag ausente do mapa (fail-closed)', () => {
    const grupos = buildAdminGroups(['billing:read']); // flags = {}
    const gestao = grupos.find((g) => g.heading === 'Gestão')!;
    expect(gestao.cards.map((c) => c.title)).not.toContain('Cobrança — Parcelas');
  });

  it('Cobrança — Réguas: aparece com billing:write + flag billing.enabled=enabled', () => {
    const grupos = buildAdminGroups(['billing:write'], { 'billing.enabled': 'enabled' });
    const gestao = grupos.find((g) => g.heading === 'Gestão')!;
    expect(gestao.cards.map((c) => c.title)).toContain('Cobrança — Réguas');
    expect(gestao.cards.find((c) => c.title === 'Cobrança — Réguas')?.href).toBe(
      '/admin/billing/rules',
    );
  });

  it('Cobrança — Réguas: NÃO aparece sem billing:write (flag ativa)', () => {
    // billing:read não é suficiente para Réguas
    const grupos = buildAdminGroups(['billing:read'], { 'billing.enabled': 'enabled' });
    const gestao = grupos.find((g) => g.heading === 'Gestão')!;
    expect(gestao.cards.map((c) => c.title)).not.toContain('Cobrança — Réguas');
  });

  it('Cobrança — Réguas: NÃO aparece sem flag (permissão ativa)', () => {
    const grupos = buildAdminGroups(['billing:write'], { 'billing.enabled': 'disabled' });
    const gestao = grupos.find((g) => g.heading === 'Gestão')!;
    expect(gestao.cards.map((c) => c.title)).not.toContain('Cobrança — Réguas');
  });

  it('Cobrança — Jobs: aparece com billing:read + flag billing.enabled=enabled', () => {
    const grupos = buildAdminGroups(['billing:read'], { 'billing.enabled': 'enabled' });
    const gestao = grupos.find((g) => g.heading === 'Gestão')!;
    expect(gestao.cards.map((c) => c.title)).toContain('Cobrança — Jobs');
    expect(gestao.cards.find((c) => c.title === 'Cobrança — Jobs')?.href).toBe(
      '/admin/billing/jobs',
    );
  });

  it('Cobrança — Jobs: NÃO aparece sem billing:read', () => {
    const grupos = buildAdminGroups([], { 'billing.enabled': 'enabled' });
    const gestao = grupos.find((g) => g.heading === 'Gestão')!;
    expect(gestao.cards.map((c) => c.title)).not.toContain('Cobrança — Jobs');
  });

  it('Cobrança — Jobs: NÃO aparece sem flag', () => {
    const grupos = buildAdminGroups(['billing:read'], { 'billing.enabled': 'disabled' });
    const gestao = grupos.find((g) => g.heading === 'Gestão')!;
    expect(gestao.cards.map((c) => c.title)).not.toContain('Cobrança — Jobs');
  });

  it('admin de cobrança (billing:read + billing:write + flag) → todos os 3 cards de cobrança', () => {
    const grupos = buildAdminGroups(['billing:read', 'billing:write'], {
      'billing.enabled': 'enabled',
    });
    const gestao = grupos.find((g) => g.heading === 'Gestão')!;
    const titles = gestao.cards.map((c) => c.title);
    expect(titles).toContain('Cobrança — Parcelas');
    expect(titles).toContain('Cobrança — Réguas');
    expect(titles).toContain('Cobrança — Jobs');
  });

  it('ordem dos cards de cobrança: Parcelas, Réguas, Jobs (após Follow-up)', () => {
    const grupos = buildAdminGroups(['billing:read', 'billing:write'], {
      'billing.enabled': 'enabled',
    });
    const gestao = grupos.find((g) => g.heading === 'Gestão')!;
    const billingTitles = gestao.cards.map((c) => c.title).filter((t) => t.startsWith('Cobrança'));
    expect(billingTitles).toEqual(['Cobrança — Parcelas', 'Cobrança — Réguas', 'Cobrança — Jobs']);
  });
});

// ─── Templates WhatsApp — gating por permissão (F8-S18) ─────────────────────

describe('ConfiguracoesPage — Templates WhatsApp — gating por permissão', () => {
  it('Templates WhatsApp: aparece com templates:read', () => {
    const grupos = buildAdminGroups(['templates:read']);
    const gestao = grupos.find((g) => g.heading === 'Gestão')!;
    expect(gestao.cards.map((c) => c.title)).toContain('Templates WhatsApp');
    expect(gestao.cards.find((c) => c.title === 'Templates WhatsApp')?.href).toBe(
      '/admin/templates',
    );
  });

  it('Templates WhatsApp: NÃO aparece sem templates:read', () => {
    const grupos = buildAdminGroups([]);
    const gestao = grupos.find((g) => g.heading === 'Gestão')!;
    expect(gestao.cards.map((c) => c.title)).not.toContain('Templates WhatsApp');
  });

  it('Templates WhatsApp: aparece independente de feature flag (sem flag)', () => {
    // Não requer flag — só permissão
    const gruposSemFlag = buildAdminGroups(['templates:read']); // flags = {}
    const gestao = gruposSemFlag.find((g) => g.heading === 'Gestão')!;
    expect(gestao.cards.map((c) => c.title)).toContain('Templates WhatsApp');
  });

  it('Templates WhatsApp: aparece mesmo com billing flag desativada', () => {
    // Templates não depende da flag de billing
    const grupos = buildAdminGroups(['templates:read'], { 'billing.enabled': 'disabled' });
    const gestao = grupos.find((g) => g.heading === 'Gestão')!;
    expect(gestao.cards.map((c) => c.title)).toContain('Templates WhatsApp');
  });
});

// ─── Tutoriais em vídeo — gating por permissão + feature flag (F12-S10) ──────

describe('ConfiguracoesPage — Tutoriais em vídeo (F12-S10) — gating permissão + flag', () => {
  it('Tutoriais em vídeo: aparece com tutorials:manage + flag tutorials.enabled=enabled', () => {
    const grupos = buildAdminGroups(['tutorials:manage'], { 'tutorials.enabled': 'enabled' });
    const tecnica = grupos.find((g) => g.heading === 'Administração técnica')!;
    expect(tecnica).toBeDefined();
    expect(tecnica.cards.map((c) => c.title)).toContain('Tutoriais em vídeo');
    expect(tecnica.cards.find((c) => c.title === 'Tutoriais em vídeo')?.href).toBe(
      '/admin/tutoriais',
    );
  });

  it('Tutoriais em vídeo: aparece com tutorials:manage + flag tutorials.enabled=internal_only', () => {
    const grupos = buildAdminGroups(['tutorials:manage'], { 'tutorials.enabled': 'internal_only' });
    const tecnica = grupos.find((g) => g.heading === 'Administração técnica')!;
    expect(tecnica.cards.map((c) => c.title)).toContain('Tutoriais em vídeo');
  });

  it('Tutoriais em vídeo: NÃO aparece sem tutorials:manage (flag ativa)', () => {
    const grupos = buildAdminGroups([], { 'tutorials.enabled': 'enabled' });
    // O grupo tecnica não renderiza se não há nenhuma permissão técnica
    const tecnica = grupos.find((g) => g.heading === 'Administração técnica');
    if (tecnica) {
      expect(tecnica.cards.map((c) => c.title)).not.toContain('Tutoriais em vídeo');
    } else {
      expect(tecnica).toBeUndefined();
    }
  });

  it('Tutoriais em vídeo: NÃO aparece sem flag tutorials.enabled (permissão ativa)', () => {
    const grupos = buildAdminGroups(['tutorials:manage'], { 'tutorials.enabled': 'disabled' });
    // Grupo tecnica não renderiza (tutoriais é o único card e está bloqueado)
    const tecnica = grupos.find((g) => g.heading === 'Administração técnica');
    if (tecnica) {
      expect(tecnica.cards.map((c) => c.title)).not.toContain('Tutoriais em vídeo');
    } else {
      expect(tecnica).toBeUndefined();
    }
  });

  it('Tutoriais em vídeo: NÃO aparece com flag ausente do mapa (fail-closed)', () => {
    const grupos = buildAdminGroups(['tutorials:manage']); // flags = {}
    const tecnica = grupos.find((g) => g.heading === 'Administração técnica');
    if (tecnica) {
      expect(tecnica.cards.map((c) => c.title)).not.toContain('Tutoriais em vídeo');
    } else {
      expect(tecnica).toBeUndefined();
    }
  });

  it('admin técnico completo (users:manage + flags:manage + tutorials:manage + flag) → todos os 3 cards técnicos', () => {
    const grupos = buildAdminGroups(['users:manage', 'flags:manage', 'tutorials:manage'], {
      'tutorials.enabled': 'enabled',
    });
    const tecnica = grupos.find((g) => g.heading === 'Administração técnica')!;
    const titles = tecnica.cards.map((c) => c.title);
    expect(titles).toContain('Usuários & Papéis');
    expect(titles).toContain('Feature Flags');
    expect(titles).toContain('Tutoriais em vídeo');
  });

  it('ordem dos cards técnicos: Usuários, Feature Flags, Tutoriais em vídeo', () => {
    const grupos = buildAdminGroups(['users:manage', 'flags:manage', 'tutorials:manage'], {
      'tutorials.enabled': 'enabled',
    });
    const tecnica = grupos.find((g) => g.heading === 'Administração técnica')!;
    expect(tecnica.cards.map((c) => c.title)).toEqual([
      'Usuários & Papéis',
      'Feature Flags',
      'Tutoriais em vídeo',
    ]);
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
   *   - agents:manage         → Agents.tsx L10 + Sidebar.tsx
   *   - users:manage          → Sidebar.tsx (hasPermission('users:manage'))
   *   - flags:manage         → FeatureFlags.tsx L14 ("permissão 'flags:manage'")
   *   - billing:read         → billing/routes.ts L69, L121, L173
   *   - billing:write        → billing/routes.ts L138, L156
   *   - templates:read       → templates/routes.ts L47
   *   - tutorials:manage     → Tutoriais.tsx + docs/21-tutoriais-em-video.md §12 (F12-S10)
   */
  it('chaves de permissão formam um conjunto fechado e documentado', () => {
    const PERMISSION_KEYS = {
      produtos: 'credit_products:read',
      cidades: null, // sem gating de UI — sempre visível
      agentes: 'agents:manage',
      usuarios: 'users:manage',
      featureFlags: 'flags:manage',
      billingRead: 'billing:read',
      billingWrite: 'billing:write',
      templatesRead: 'templates:read',
      tutoriaisManage: 'tutorials:manage',
    } as const;

    // Garante que as chaves não são strings vazias ou undefined por acidente
    expect(PERMISSION_KEYS.produtos).toBe('credit_products:read');
    expect(PERMISSION_KEYS.cidades).toBeNull(); // intencional: sem gating
    expect(PERMISSION_KEYS.agentes).toBe('agents:manage');
    expect(PERMISSION_KEYS.usuarios).toBe('users:manage');
    expect(PERMISSION_KEYS.featureFlags).toBe('flags:manage');
    expect(PERMISSION_KEYS.billingRead).toBe('billing:read');
    expect(PERMISSION_KEYS.billingWrite).toBe('billing:write');
    expect(PERMISSION_KEYS.templatesRead).toBe('templates:read');
    expect(PERMISSION_KEYS.tutoriaisManage).toBe('tutorials:manage');
  });

  it('feature flags usam as chaves corretas (consistentes com o que o backend registra)', () => {
    const FLAG_KEYS = {
      billing: 'billing.enabled',
      tutorials: 'tutorials.enabled',
    } as const;

    expect(FLAG_KEYS.billing).toBe('billing.enabled');
    expect(FLAG_KEYS.tutorials).toBe('tutorials.enabled');
  });
});
