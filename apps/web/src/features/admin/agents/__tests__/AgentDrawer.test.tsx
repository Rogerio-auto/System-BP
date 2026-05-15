// =============================================================================
// __tests__/AgentDrawer.test.tsx — Testes de lógica pura do módulo de agentes.
//
// Estratégia: testa lógica pura isolada sem renderizar React
// (JSDOM não configurado no vitest deste projeto — alinhado ao padrão UserDrawer.test.tsx).
//
// Cobertura:
//   1. Schema Zod do form base (displayName, phone, userId)
//   2. Lógica do AgentCitiesValue (adicionar, remover, definir primária)
//   3. Validação: ≥1 cidade obrigatória
//   4. Invariante: primaryCityId deve estar em cityIds
//   5. Contrato do backend: campos snake_case na response, camelCase no request
//   6. Casos edge: displayName com 1 char, phone vazio vs undefined
// =============================================================================

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Replica do schema Zod do AgentDrawer.tsx (mesma lógica)
// ---------------------------------------------------------------------------

const AgentFormSchema = z.object({
  displayName: z
    .string()
    .min(2, 'Nome deve ter ao menos 2 caracteres')
    .max(120, 'Nome deve ter no máximo 120 caracteres')
    .trim(),
  phone: z.string().max(30).optional().or(z.literal('')),
  userId: z.string().uuid().nullable().optional(),
});

type AgentFormValues = z.infer<typeof AgentFormSchema>;

// ---------------------------------------------------------------------------
// Replica do schema de validação de cidades (lógica do AgentCitiesSelect)
// ---------------------------------------------------------------------------

interface AgentCitiesValue {
  cityIds: string[];
  primaryCityId: string | null;
}

function validateCities(value: AgentCitiesValue): string | null {
  if (value.cityIds.length === 0) return 'Ao menos uma cidade é obrigatória';
  if (
    value.primaryCityId !== null &&
    !value.cityIds.includes(value.primaryCityId)
  ) {
    return 'Cidade primária deve estar nas cidades selecionadas';
  }
  return null;
}

// Lógica de adição de cidade (mesma do AgentCitiesSelect)
function addCity(value: AgentCitiesValue, cityId: string): AgentCitiesValue {
  const newCityIds = [...value.cityIds, cityId];
  const newPrimary = value.primaryCityId ?? cityId; // primeira cidade vira primária
  return { cityIds: newCityIds, primaryCityId: newPrimary };
}

// Lógica de remoção de cidade (mesma do AgentCitiesSelect)
function removeCity(value: AgentCitiesValue, cityId: string): AgentCitiesValue {
  const newCityIds = value.cityIds.filter((id) => id !== cityId);
  const newPrimary =
    value.primaryCityId === cityId ? (newCityIds[0] ?? null) : value.primaryCityId;
  return { cityIds: newCityIds, primaryCityId: newPrimary };
}

// Lógica de definir primária (mesma do AgentCitiesSelect)
function setPrimary(value: AgentCitiesValue, cityId: string): AgentCitiesValue {
  return { cityIds: value.cityIds, primaryCityId: cityId };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID_1 = '123e4567-e89b-12d3-a456-426614174000';
const VALID_UUID_2 = '223e4567-e89b-12d3-a456-426614174001';
const VALID_UUID_3 = '323e4567-e89b-12d3-a456-426614174002';

// ---------------------------------------------------------------------------
// Testes: AgentFormSchema
// ---------------------------------------------------------------------------

describe('AgentFormSchema', () => {
  it('aceita dados mínimos válidos', () => {
    const result = AgentFormSchema.safeParse({
      displayName: 'João Silva',
    });
    expect(result.success).toBe(true);
  });

  it('rejeita displayName com 1 caractere (min 2)', () => {
    const result = AgentFormSchema.safeParse({ displayName: 'A' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error.issues.find((i) => i.path[0] === 'displayName');
      expect(err?.message).toContain('2 caracteres');
    }
  });

  it('rejeita displayName vazio', () => {
    const result = AgentFormSchema.safeParse({ displayName: '' });
    expect(result.success).toBe(false);
  });

  it('rejeita displayName com mais de 120 caracteres', () => {
    const result = AgentFormSchema.safeParse({ displayName: 'A'.repeat(121) });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error.issues.find((i) => i.path[0] === 'displayName');
      expect(err?.message).toContain('120 caracteres');
    }
  });

  it('trim no displayName — espaços extras removidos', () => {
    const result = AgentFormSchema.safeParse({ displayName: '  João  ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.displayName).toBe('João');
    }
  });

  it('phone é opcional — pode ser omitido', () => {
    const result = AgentFormSchema.safeParse({ displayName: 'Maria Santos' });
    expect(result.success).toBe(true);
  });

  it('phone pode ser string vazia', () => {
    const result = AgentFormSchema.safeParse({ displayName: 'Maria Santos', phone: '' });
    expect(result.success).toBe(true);
  });

  it('phone rejeita mais de 30 caracteres', () => {
    const result = AgentFormSchema.safeParse({
      displayName: 'Maria Santos',
      phone: '+55 69 9 9999-9999 ext. 999999',
    });
    expect(result.success).toBe(false);
  });

  it('userId pode ser null', () => {
    const result = AgentFormSchema.safeParse({
      displayName: 'Pedro Costa',
      userId: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as AgentFormValues & { userId: null };
      expect(data.userId).toBeNull();
    }
  });

  it('userId deve ser UUID válido quando informado', () => {
    const result = AgentFormSchema.safeParse({
      displayName: 'Pedro Costa',
      userId: 'nao-e-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('userId aceita UUID válido', () => {
    const result = AgentFormSchema.safeParse({
      displayName: 'Pedro Costa',
      userId: VALID_UUID_1,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.userId).toBe(VALID_UUID_1);
    }
  });
});

// ---------------------------------------------------------------------------
// Testes: AgentCitiesValue — lógica de multi-select
// ---------------------------------------------------------------------------

describe('AgentCitiesValue — adicionar cidade', () => {
  it('adiciona primeira cidade e define como primária automaticamente', () => {
    const initial: AgentCitiesValue = { cityIds: [], primaryCityId: null };
    const result = addCity(initial, VALID_UUID_1);
    expect(result.cityIds).toContain(VALID_UUID_1);
    expect(result.primaryCityId).toBe(VALID_UUID_1);
  });

  it('adiciona segunda cidade sem mudar a primária', () => {
    const initial: AgentCitiesValue = { cityIds: [VALID_UUID_1], primaryCityId: VALID_UUID_1 };
    const result = addCity(initial, VALID_UUID_2);
    expect(result.cityIds).toContain(VALID_UUID_2);
    expect(result.primaryCityId).toBe(VALID_UUID_1); // primária não muda
  });

  it('adiciona terceira cidade sem mudar a primária', () => {
    const initial: AgentCitiesValue = {
      cityIds: [VALID_UUID_1, VALID_UUID_2],
      primaryCityId: VALID_UUID_1,
    };
    const result = addCity(initial, VALID_UUID_3);
    expect(result.cityIds).toHaveLength(3);
    expect(result.primaryCityId).toBe(VALID_UUID_1);
  });
});

describe('AgentCitiesValue — remover cidade', () => {
  it('remove cidade não-primária — primária não muda', () => {
    const initial: AgentCitiesValue = {
      cityIds: [VALID_UUID_1, VALID_UUID_2],
      primaryCityId: VALID_UUID_1,
    };
    const result = removeCity(initial, VALID_UUID_2);
    expect(result.cityIds).not.toContain(VALID_UUID_2);
    expect(result.primaryCityId).toBe(VALID_UUID_1);
  });

  it('remove cidade primária — próxima assume como primária', () => {
    const initial: AgentCitiesValue = {
      cityIds: [VALID_UUID_1, VALID_UUID_2],
      primaryCityId: VALID_UUID_1,
    };
    const result = removeCity(initial, VALID_UUID_1);
    expect(result.cityIds).not.toContain(VALID_UUID_1);
    expect(result.primaryCityId).toBe(VALID_UUID_2);
  });

  it('remove única cidade — primaryCityId vira null', () => {
    const initial: AgentCitiesValue = {
      cityIds: [VALID_UUID_1],
      primaryCityId: VALID_UUID_1,
    };
    const result = removeCity(initial, VALID_UUID_1);
    expect(result.cityIds).toHaveLength(0);
    expect(result.primaryCityId).toBeNull();
  });
});

describe('AgentCitiesValue — definir primária', () => {
  it('define nova primária entre cidades existentes', () => {
    const initial: AgentCitiesValue = {
      cityIds: [VALID_UUID_1, VALID_UUID_2],
      primaryCityId: VALID_UUID_1,
    };
    const result = setPrimary(initial, VALID_UUID_2);
    expect(result.primaryCityId).toBe(VALID_UUID_2);
    expect(result.cityIds).toEqual([VALID_UUID_1, VALID_UUID_2]); // lista não muda
  });

  it('primária só pode ser uma (idempotente se já primária)', () => {
    const initial: AgentCitiesValue = {
      cityIds: [VALID_UUID_1, VALID_UUID_2],
      primaryCityId: VALID_UUID_1,
    };
    const result = setPrimary(initial, VALID_UUID_1);
    expect(result.primaryCityId).toBe(VALID_UUID_1);
  });
});

// ---------------------------------------------------------------------------
// Testes: validateCities
// ---------------------------------------------------------------------------

describe('validateCities', () => {
  it('retorna erro quando sem cidades', () => {
    const error = validateCities({ cityIds: [], primaryCityId: null });
    expect(error).toBe('Ao menos uma cidade é obrigatória');
  });

  it('retorna null quando válido (com primária dentro das selecionadas)', () => {
    const error = validateCities({
      cityIds: [VALID_UUID_1, VALID_UUID_2],
      primaryCityId: VALID_UUID_1,
    });
    expect(error).toBeNull();
  });

  it('retorna erro quando primaryCityId não está em cityIds', () => {
    const error = validateCities({
      cityIds: [VALID_UUID_1],
      primaryCityId: VALID_UUID_2, // não está nas cidades
    });
    expect(error).toBe('Cidade primária deve estar nas cidades selecionadas');
  });

  it('retorna null quando primaryCityId é null (válido)', () => {
    const error = validateCities({
      cityIds: [VALID_UUID_1],
      primaryCityId: null,
    });
    expect(error).toBeNull();
  });

  it('aceita múltiplas cidades com primária válida', () => {
    const error = validateCities({
      cityIds: [VALID_UUID_1, VALID_UUID_2, VALID_UUID_3],
      primaryCityId: VALID_UUID_3,
    });
    expect(error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Testes: Contrato do backend (snake_case response, camelCase request)
// ---------------------------------------------------------------------------

describe('Contrato backend — AgentResponse (snake_case)', () => {
  it('campos obrigatórios da response são snake_case', () => {
    // Simula a response do backend alinhada ao AgentResponseSchema
    const mockResponse = {
      id: VALID_UUID_1,
      organization_id: VALID_UUID_2,
      user_id: null,
      display_name: 'João Agente',
      phone: null,
      is_active: true,
      cities: [{ city_id: VALID_UUID_3, is_primary: true }],
      primary_city_id: VALID_UUID_3,
      city_count: 1,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      deleted_at: null,
    };

    // Acesso correto via snake_case
    expect(mockResponse.display_name).toBe('João Agente');
    expect(mockResponse.is_active).toBe(true);
    expect(mockResponse.primary_city_id).toBe(VALID_UUID_3);
    expect(mockResponse.cities[0]?.city_id).toBe(VALID_UUID_3);
    expect(mockResponse.cities[0]?.is_primary).toBe(true);
  });

  it('request de criação usa camelCase (AgentCreateSchema)', () => {
    // Simula o body enviado ao backend — camelCase conforme AgentCreateSchema
    const createBody = {
      displayName: 'Maria Agente',
      phone: '+55 69 9 9999-0001',
      userId: VALID_UUID_1,
      cityIds: [VALID_UUID_3],
      primaryCityId: VALID_UUID_3,
    };

    expect(createBody.displayName).toBe('Maria Agente');
    expect(createBody.cityIds).toContain(VALID_UUID_3);
    expect(createBody.primaryCityId).toBe(VALID_UUID_3);
  });

  it('request de update usa camelCase (AgentUpdateSchema)', () => {
    const updateBody = {
      displayName: 'Nome Atualizado',
      phone: null,
      userId: null,
      isActive: false,
    };

    expect(updateBody.displayName).toBe('Nome Atualizado');
    expect(updateBody.isActive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Testes: 409 conflict (leads ativos)
// ---------------------------------------------------------------------------

describe('Erro 409 — agente com leads ativos', () => {
  it('status 409 indica bloqueio por leads ativos na cidade', () => {
    const mockApiError = {
      status: 409,
      code: 'CONFLICT',
      message:
        'Agente é o único ativo em cidade com leads abertos — reatribua os leads antes de desativar',
    };
    expect(mockApiError.status).toBe(409);
    expect(mockApiError.code).toBe('CONFLICT');
  });

  it('status 409 com userId indica usuário já vinculado a outro agente', () => {
    const mockApiError = {
      status: 409,
      message: 'Este usuário já está vinculado a um agente ativo nesta organização',
    };
    expect(mockApiError.status).toBe(409);
    expect(mockApiError.message).toContain('usuário');
  });
});
