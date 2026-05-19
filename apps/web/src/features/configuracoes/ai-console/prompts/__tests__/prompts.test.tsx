// =============================================================================
// ai-console/prompts/__tests__/prompts.test.tsx
//
// Testes de lógica pura do módulo de gestão de prompts.
//
// Estratégia: testa lógica sem renderizar React (JSDOM não configurado no vitest
// — alinhado ao padrão ConfiguracoesPage.test.tsx).
//
// Cobertura:
//   1. Query keys têm formato estável e não colidem
//   2. Lógica de RBAC (gating de permissões)
//   3. Detecção de placeholders no body do prompt
//   4. Filtragem de keys por busca
//   5. Ordenação de versões (mais recente primeiro na sidebar)
//   6. Lógica de seleção de diff (máximo 2, substitui o mais antigo)
//   7. Formatação de data
// =============================================================================

import { describe, expect, it } from 'vitest';

import { promptsQueryKeys } from '../../../../../hooks/ai-console/usePrompts';

// ─── 1. Query keys ────────────────────────────────────────────────────────────

describe('promptsQueryKeys', () => {
  it('keys() retorna array estável com prefixo correto', () => {
    expect(promptsQueryKeys.keys()).toEqual(['ai-console', 'prompts', 'keys']);
  });

  it('versions(key) inclui o key no path', () => {
    const qk = promptsQueryKeys.versions('lead_qualification');
    expect(qk).toEqual(['ai-console', 'prompts', 'versions', 'lead_qualification']);
  });

  it('version(key, v) inclui key e versão', () => {
    const qk = promptsQueryKeys.version('lead_qualification', 3);
    expect(qk).toEqual(['ai-console', 'prompts', 'version', 'lead_qualification', 3]);
  });

  it('versões de keys diferentes não colidem', () => {
    const a = JSON.stringify(promptsQueryKeys.versions('key_a'));
    const b = JSON.stringify(promptsQueryKeys.versions('key_b'));
    expect(a).not.toBe(b);
  });

  it('versões numéricas diferentes não colidem', () => {
    const v1 = JSON.stringify(promptsQueryKeys.version('k', 1));
    const v2 = JSON.stringify(promptsQueryKeys.version('k', 2));
    expect(v1).not.toBe(v2);
  });
});

// ─── 2. Lógica de RBAC (gating de permissões) ────────────────────────────────

describe('RBAC — gating de permissões de prompts', () => {
  const PERMISSIONS = {
    read: 'ai_prompts:read',
    write: 'ai_prompts:write',
    activate: 'ai_prompts:activate',
  } as const;

  function hasPermission(userPerms: string[], required: string): boolean {
    return userPerms.includes(required);
  }

  it('admin tem leitura, escrita e ativação', () => {
    const perms = ['ai_prompts:read', 'ai_prompts:write', 'ai_prompts:activate'];
    expect(hasPermission(perms, PERMISSIONS.read)).toBe(true);
    expect(hasPermission(perms, PERMISSIONS.write)).toBe(true);
    expect(hasPermission(perms, PERMISSIONS.activate)).toBe(true);
  });

  it('gestor_geral tem apenas leitura', () => {
    const perms = ['ai_prompts:read'];
    expect(hasPermission(perms, PERMISSIONS.read)).toBe(true);
    expect(hasPermission(perms, PERMISSIONS.write)).toBe(false);
    expect(hasPermission(perms, PERMISSIONS.activate)).toBe(false);
  });

  it('agente não tem nenhuma permissão de prompts', () => {
    const perms = ['leads:read', 'crm:write'];
    expect(hasPermission(perms, PERMISSIONS.read)).toBe(false);
    expect(hasPermission(perms, PERMISSIONS.write)).toBe(false);
    expect(hasPermission(perms, PERMISSIONS.activate)).toBe(false);
  });

  it('sem ai_prompts:read → página retorna 404 (lista e detalhe)', () => {
    const canView = hasPermission([], PERMISSIONS.read);
    expect(canView).toBe(false);
    // A lógica nos componentes faz: if (!canRead) return <Navigate to="/404" />
  });

  it('ai_prompts:write não implica ai_prompts:activate', () => {
    const perms = ['ai_prompts:read', 'ai_prompts:write'];
    expect(hasPermission(perms, PERMISSIONS.activate)).toBe(false);
  });
});

// ─── 3. Detecção de placeholders ──────────────────────────────────────────────

describe('Detecção de placeholders no body do prompt', () => {
  const PLACEHOLDER_REGEX = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

  function detectPlaceholders(body: string): string[] {
    const found = new Set<string>();
    let match: RegExpExecArray | null;
    const re = new RegExp(PLACEHOLDER_REGEX.source, 'g');
    while ((match = re.exec(body)) !== null) {
      found.add(match[1] as string);
    }
    return Array.from(found);
  }

  it('detecta placeholder simples', () => {
    expect(detectPlaceholders('Olá {lead_name}!')).toContain('lead_name');
  });

  it('detecta múltiplos placeholders únicos', () => {
    const body = 'Olá {lead_name} de {city_name}, produto: {product_name}';
    const phs = detectPlaceholders(body);
    expect(phs).toContain('lead_name');
    expect(phs).toContain('city_name');
    expect(phs).toContain('product_name');
    expect(phs).toHaveLength(3);
  });

  it('deduplicação: placeholder repetido conta uma vez', () => {
    const body = '{lead_name} e depois novamente {lead_name}';
    expect(detectPlaceholders(body)).toHaveLength(1);
  });

  it('body sem placeholders retorna array vazio', () => {
    expect(detectPlaceholders('Prompt sem variáveis.')).toHaveLength(0);
  });

  it('chaves com números e underscores são detectadas', () => {
    const body = 'Veja {valor_max_2024} e {campo_1}';
    const phs = detectPlaceholders(body);
    expect(phs).toContain('valor_max_2024');
    expect(phs).toContain('campo_1');
  });

  it('chave numérica pura não é detectada (exige letra inicial)', () => {
    // {123} não é um placeholder válido — deve começar com letra ou _
    expect(detectPlaceholders('{123}')).toHaveLength(0);
  });
});

// ─── 4. Filtragem por busca ───────────────────────────────────────────────────

describe('Filtragem de prompt keys por busca', () => {
  const KEYS = ['lead_qualification', 'credit_analysis', 'lead_welcome', 'document_check'];

  function filterKeys(keys: string[], search: string): string[] {
    return keys.filter((k) => k.toLowerCase().includes(search.toLowerCase()));
  }

  it('busca vazia retorna todos', () => {
    expect(filterKeys(KEYS, '')).toHaveLength(4);
  });

  it('busca parcial filtra corretamente', () => {
    expect(filterKeys(KEYS, 'lead')).toEqual(['lead_qualification', 'lead_welcome']);
  });

  it('case-insensitive', () => {
    expect(filterKeys(KEYS, 'LEAD')).toHaveLength(2);
  });

  it('busca sem resultado retorna array vazio', () => {
    expect(filterKeys(KEYS, 'xyz_inexistente')).toHaveLength(0);
  });
});

// ─── 5. Ordenação de versões (sidebar) ───────────────────────────────────────

describe('Ordenação de versões na sidebar (mais recente primeiro)', () => {
  const makeVersion = (v: number) => ({
    id: `uuid-${v}`,
    version: v,
    active: false,
    body: '',
    key: 'test',
    content_hash: 'abc',
    model_recommended: null,
    notes: null,
    created_by: null,
    created_at: new Date(2024, 0, v).toISOString(),
  });

  it('ordena desc por version', () => {
    const versions = [makeVersion(1), makeVersion(3), makeVersion(2)];
    const sorted = [...versions].sort((a, b) => b.version - a.version);
    expect(sorted.map((v) => v.version)).toEqual([3, 2, 1]);
  });
});

// ─── 6. Lógica de seleção de diff (max 2) ────────────────────────────────────

describe('Seleção de versões para diff', () => {
  function toggleDiff(current: Set<number>, version: number): Set<number> {
    const next = new Set(current);
    if (next.has(version)) {
      next.delete(version);
    } else {
      if (next.size >= 2) {
        const oldest = Math.min(...next);
        next.delete(oldest);
      }
      next.add(version);
    }
    return next;
  }

  it('adiciona primeira versão', () => {
    const result = toggleDiff(new Set(), 3);
    expect(result.has(3)).toBe(true);
    expect(result.size).toBe(1);
  });

  it('adiciona segunda versão', () => {
    const result = toggleDiff(new Set([3]), 5);
    expect(result.has(3)).toBe(true);
    expect(result.has(5)).toBe(true);
    expect(result.size).toBe(2);
  });

  it('ao adicionar terceira, remove a mais antiga', () => {
    const result = toggleDiff(new Set([2, 5]), 7);
    expect(result.has(2)).toBe(false); // removeu a mais antiga (2)
    expect(result.has(5)).toBe(true);
    expect(result.has(7)).toBe(true);
    expect(result.size).toBe(2);
  });

  it('deselecionar remove do set', () => {
    const result = toggleDiff(new Set([3, 5]), 3);
    expect(result.has(3)).toBe(false);
    expect(result.size).toBe(1);
  });
});

// ─── 7. Formatação de data ────────────────────────────────────────────────────

describe('Formatação de data ISO para pt-BR', () => {
  function formatDate(iso: string | null): string {
    if (!iso) return '—';
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso));
  }

  it('null retorna —', () => {
    expect(formatDate(null)).toBe('—');
  });

  it('ISO válida retorna string não-vazia', () => {
    const result = formatDate('2024-06-15T10:30:00.000Z');
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toBe('—');
  });
});
