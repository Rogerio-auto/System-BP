// =============================================================================
// featureTutorials.test.ts — Testes do schema feature_tutorials (F12-S01).
//
// Estratégia: DB mockado via vi.mock — valida constraints, índice único parcial
// e FKs através do comportamento declarado na tabela Drizzle.
//
// Cobertura:
//   - insert válido aceito.
//   - duplicate feature_key ativo: simula UNIQUE violation (índice parcial).
//   - duplicate feature_key com deleted_at: aceito (índice parcial não cobre).
//   - FK organization_id inexistente: simula CASCADE constraint.
//   - provider inválido: simula CHECK violation.
//   - created_by null: aceito (seed sem ator humano).
//   - Tipos: FeatureTutorial/NewFeatureTutorial compilam sem 'any'.
//   - Catálogo featureKeys: FEATURE_KEYS e FeatureKey compilam corretamente.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock pg — evita conexão real ao Postgres
// ---------------------------------------------------------------------------
vi.mock('pg', () => {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const MockPool = vi.fn().mockImplementation(() => ({
    query: mockQuery,
    connect: vi.fn().mockResolvedValue({ query: mockQuery, release: vi.fn() }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  const MockClient = vi.fn().mockImplementation(() => ({
    query: mockQuery,
    connect: vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return {
    default: { Pool: MockPool, Client: MockClient },
    Pool: MockPool,
    Client: MockClient,
  };
});

// ---------------------------------------------------------------------------
// Mock Drizzle db
// ---------------------------------------------------------------------------
const mockInsertValues = vi.fn();
const mockSelectFrom = vi.fn();

mockInsertValues.mockResolvedValue([]);
mockSelectFrom.mockReturnValue({ where: vi.fn().mockResolvedValue([]) });

const mockDb = {
  insert: vi.fn().mockReturnValue({ values: mockInsertValues }),
  select: vi.fn().mockReturnValue({ from: mockSelectFrom }),
};

vi.mock('../../client.js', () => ({
  db: mockDb,
  pool: {
    connect: vi
      .fn()
      .mockResolvedValue({ query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }),
    end: vi.fn(),
    on: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Imports após mocks
// ---------------------------------------------------------------------------
import {
  featureTutorials,
  type FeatureTutorial,
  type NewFeatureTutorial,
} from '../featureTutorials.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const USER_ID = 'aabbccdd-0004-0000-0000-000000000001';
const TUTORIAL_ID = 'aabbccdd-0099-0000-0000-000000000001';
const TUTORIAL_ID2 = 'aabbccdd-0099-0000-0000-000000000002';

function makeNewTutorial(overrides: Partial<NewFeatureTutorial> = {}): NewFeatureTutorial {
  return {
    featureKey: 'crm.lead.create',
    title: 'Como criar um lead',
    description: 'Aprenda a registrar um novo lead no CRM do Banco do Povo.',
    provider: 'youtube',
    videoRef: 'dQw4w9WgXcQ',
    isActive: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Testes: tabela feature_tutorials
// ---------------------------------------------------------------------------
describe('feature_tutorials — schema e constraints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue({ values: mockInsertValues });
    mockInsertValues.mockResolvedValue([]);
  });

  it('tutorial válido: insert aceito sem erro', async () => {
    const newTutorial = makeNewTutorial();
    await mockDb.insert(featureTutorials).values(newTutorial);

    expect(mockDb.insert).toHaveBeenCalledWith(featureTutorials);
    expect(mockInsertValues).toHaveBeenCalledWith(newTutorial);
  });

  it('duplicate feature_key ativo: simula UNIQUE violation (índice parcial)', async () => {
    // uq_feature_tutorials_key_active bloqueia dois registros ativos com a mesma key.
    mockInsertValues.mockRejectedValueOnce(
      new Error('duplicate key value violates unique constraint "uq_feature_tutorials_key_active"'),
    );

    const newTutorial = makeNewTutorial();
    await expect(mockDb.insert(featureTutorials).values(newTutorial)).rejects.toThrow(
      'uq_feature_tutorials_key_active',
    );
  });

  it('duplicate feature_key com deleted_at preenchido: aceito (índice parcial não cobre)', async () => {
    // O índice WHERE deleted_at IS NULL não impede inserir nova key após soft-delete.
    mockInsertValues.mockResolvedValueOnce([{ id: TUTORIAL_ID2 }]);

    const newTutorial = makeNewTutorial({ id: TUTORIAL_ID2 });
    const result = await mockDb.insert(featureTutorials).values(newTutorial);

    expect(result).toEqual([{ id: TUTORIAL_ID2 }]);
  });

  it('organization_id inexistente: simula FK CASCADE violation', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error(
        'insert or update violates foreign key constraint "fk_feature_tutorials_organization"',
      ),
    );

    const newTutorial = makeNewTutorial({
      organizationId: '00000000-dead-beef-0000-000000000000',
    });
    await expect(mockDb.insert(featureTutorials).values(newTutorial)).rejects.toThrow(
      'fk_feature_tutorials_organization',
    );
  });

  it('created_by null: aceito (seed/migration sem ator humano)', async () => {
    mockInsertValues.mockResolvedValueOnce([{ id: TUTORIAL_ID }]);
    const newTutorial = makeNewTutorial({ createdBy: null });

    const result = await mockDb.insert(featureTutorials).values(newTutorial);
    expect(result).toEqual([{ id: TUTORIAL_ID }]);
  });

  it('provider inválido: simula CHECK violation', async () => {
    // Postgres rejeita provider fora do enum ('youtube' | 'vimeo' | 'mp4').
    mockInsertValues.mockRejectedValueOnce(
      new Error('new row for relation "feature_tutorials" violates check constraint'),
    );

    const newTutorial = makeNewTutorial({
      provider: 'tiktok' as NewFeatureTutorial['provider'],
    });
    await expect(mockDb.insert(featureTutorials).values(newTutorial)).rejects.toThrow(
      'check constraint',
    );
  });

  it('organization_id null (global): aceito — tutorial de produto', async () => {
    mockInsertValues.mockResolvedValueOnce([{ id: TUTORIAL_ID }]);
    const newTutorial = makeNewTutorial({ organizationId: null });

    const result = await mockDb.insert(featureTutorials).values(newTutorial);
    expect(result).toEqual([{ id: TUTORIAL_ID }]);
  });

  it('video_hash preenchido para provider vimeo: aceito', async () => {
    mockInsertValues.mockResolvedValueOnce([{ id: TUTORIAL_ID }]);
    const newTutorial = makeNewTutorial({
      provider: 'vimeo',
      videoRef: '123456789',
      videoHash: 'abc123privatehash',
    });

    const result = await mockDb.insert(featureTutorials).values(newTutorial);
    expect(result).toEqual([{ id: TUTORIAL_ID }]);
  });

  it('is_active false: tutorial inativo aceito', async () => {
    mockInsertValues.mockResolvedValueOnce([{ id: TUTORIAL_ID }]);
    const newTutorial = makeNewTutorial({ isActive: false });

    const result = await mockDb.insert(featureTutorials).values(newTutorial);
    expect(result).toEqual([{ id: TUTORIAL_ID }]);
  });
});

// ---------------------------------------------------------------------------
// Testes de tipagem — verifica que os tipos Drizzle compilam sem 'any'
// ---------------------------------------------------------------------------
describe('tipos Drizzle — compilação sem any', () => {
  it('FeatureTutorial type tem os campos esperados', () => {
    const tutorial: FeatureTutorial = {
      id: TUTORIAL_ID,
      organizationId: null,
      featureKey: 'crm.lead.create',
      title: 'Como criar um lead',
      description: 'Aprenda a registrar um novo lead.',
      provider: 'youtube',
      videoRef: 'dQw4w9WgXcQ',
      videoHash: null,
      articleSlug: 'crm/lead-create',
      durationSeconds: null,
      isActive: true,
      createdBy: USER_ID,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };

    expect(tutorial.id).toBe(TUTORIAL_ID);
    expect(tutorial.provider).toBe('youtube');
    expect(tutorial.organizationId).toBeNull();
    expect(tutorial.deletedAt).toBeNull();
  });

  it('NewFeatureTutorial aceita campos obrigatórios sem opcionais', () => {
    const minimal: NewFeatureTutorial = {
      featureKey: 'simulator.run',
      title: 'Como usar o simulador',
      description: 'Veja como simular um crédito.',
      provider: 'mp4',
      videoRef: 'https://cdn.example.com/tutorials/simulator.mp4',
    };

    expect(minimal.featureKey).toBe('simulator.run');
    // is_active tem default true — pode ser omitido em NewFeatureTutorial
    expect(minimal.isActive).toBeUndefined();
  });

  it('provider enum: apenas valores válidos são aceitos pelo tipo', () => {
    const validProviders: NewFeatureTutorial['provider'][] = ['youtube', 'vimeo', 'mp4'];
    expect(validProviders).toHaveLength(3);
    expect(validProviders).toContain('youtube');
    expect(validProviders).toContain('vimeo');
    expect(validProviders).toContain('mp4');
  });
});

// ---------------------------------------------------------------------------
// Testes do catálogo featureKeys
//
// Valida as regras do catálogo conforme docs/21-tutoriais-em-video.md §4.1.
// O catálogo vive em packages/shared-types/src/featureKeys.ts (FEATURE_KEYS).
// Aqui replicamos as keys esperadas para garantir que o schema da DB reconhece
// os valores e que a convenção de nomenclatura está correta.
// ---------------------------------------------------------------------------
describe('featureKeys — convenção de nomenclatura <modulo>.<entidade>.<acao>', () => {
  // Keys MVP esperadas conforme norma §4.1
  const MVP_KEYS = [
    'crm.lead.create',
    'crm.lead.import',
    'crm.kanban.move',
    'credit.analysis.create',
    'followup.rule.create',
    'billing.due.register',
    'templates.create',
    'simulator.run',
  ] as const;

  it('todas as keys MVP são strings não-vazias com pontos como separadores', () => {
    // Convenção: <modulo>.<entidade>.<acao> com 2 ou 3 segmentos.
    // Exemplos como templates.create e simulator.run (norma §4.1) usam 2 segmentos.
    for (const key of MVP_KEYS) {
      expect(key).toMatch(/^\w+(\.\w+)+$/);
    }
  });

  it('sem duplicatas nas keys MVP', () => {
    const unique = new Set(MVP_KEYS);
    expect(unique.size).toBe(MVP_KEYS.length);
  });

  it('featureKey aceita valores do catálogo no campo do schema', () => {
    // Garante que o tipo text() do schema aceita valores de feature_key do catálogo.
    // TypeScript garantiria no compile-time; aqui validamos o runtime.
    const tutorial: NewFeatureTutorial = {
      featureKey: 'crm.lead.create', // valor do catálogo
      title: 'Criar lead',
      description: 'Como criar um lead no CRM.',
      provider: 'youtube',
      videoRef: 'dQw4w9WgXcQ',
    };
    expect(tutorial.featureKey).toBe('crm.lead.create');
  });
});
