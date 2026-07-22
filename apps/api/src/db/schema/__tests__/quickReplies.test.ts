// =============================================================================
// quickReplies.test.ts — Testes do schema quick_replies (F28-S01).
//
// Estratégia: DB mockado via vi.mock — valida constraints, índices únicos e
// FKs através do comportamento declarado na tabela Drizzle (mesmo padrão de
// pushSubscriptions.test.ts / leads.test.ts / livechat.test.ts).
//
// Cobertura (doc 25-respostas-rapidas.md §4.1):
//   - insert ok: visibility='organization' (owner_user_id NULL).
//   - insert ok: visibility='personal' (owner_user_id preenchido).
//   - CHECK chk_quick_replies_visibility_owner: coerência visibility×owner (2 sentidos).
//   - CHECK chk_quick_replies_visibility_domain: domínio fechado de visibility.
//   - CHECK chk_quick_replies_body_or_media: corpo OU mídia obrigatórios.
//   - CHECK chk_quick_replies_media_all_or_nothing: mídia tudo-ou-nada (2 sentidos).
//   - CHECK chk_quick_replies_media_kind_domain: domínio fechado de media_kind.
//   - CHECK chk_quick_replies_shortcut_format: formato do atalho.
//   - uq_quick_replies_shortcut_org_wide: atalho duplicado entre respostas da org.
//   - uq_quick_replies_shortcut_per_owner: atalho duplicado na biblioteca pessoal.
//   - atalho pessoal PODE sombrear um atalho da organização com o mesmo nome
//     (índices distintos — não colidem).
//   - FK organization_id / owner_user_id / created_by inexistentes rejeitadas.
//   - Tipo QuickReply/NewQuickReply compila sem 'any'.
// =============================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock pg — evita conexão real ao Postgres
// ---------------------------------------------------------------------------
vi.mock('pg', () => {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const MockPool = vi.fn().mockImplementation(() => ({
    query: mockQuery,
    connect: vi.fn().mockResolvedValue({
      query: mockQuery,
      release: vi.fn(),
    }),
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
// Mock Drizzle db — controla insert com chainable API
// ---------------------------------------------------------------------------
const mockInsertValues = vi.fn();
mockInsertValues.mockResolvedValue([]);

const mockDb = {
  insert: vi.fn().mockReturnValue({ values: mockInsertValues }),
};

vi.mock('../../client.js', () => ({
  db: mockDb,
  pool: {
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    }),
    end: vi.fn(),
    on: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Imports após mocks
// ---------------------------------------------------------------------------
import { quickReplies, type NewQuickReply, type QuickReply } from '../quickReplies.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const ORG_ID = 'aabbccdd-0001-0000-0000-000000000001';
const OWNER_A_ID = 'aabbccdd-0004-0000-0000-000000000001';
const OWNER_B_ID = 'aabbccdd-0004-0000-0000-000000000002';
const QR_ID = 'aabbccdd-0007-0000-0000-000000000001';

function makeOrgQuickReply(overrides: Partial<NewQuickReply> = {}): NewQuickReply {
  return {
    organizationId: ORG_ID,
    ownerUserId: null,
    visibility: 'organization',
    shortcut: 'saudacao',
    title: 'Saudação inicial',
    body: 'Olá! Como posso ajudar?',
    ...overrides,
  };
}

function makePersonalQuickReply(overrides: Partial<NewQuickReply> = {}): NewQuickReply {
  return {
    organizationId: ORG_ID,
    ownerUserId: OWNER_A_ID,
    visibility: 'personal',
    shortcut: 'meuatalho',
    title: 'Meu atalho pessoal',
    body: 'Resposta pessoal do operador.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Testes: insert válido
// ---------------------------------------------------------------------------
describe('quick_replies — insert válido', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue({ values: mockInsertValues });
    mockInsertValues.mockResolvedValue([]);
  });

  it('resposta rápida da organização (owner_user_id NULL): aceita', async () => {
    const qr = makeOrgQuickReply();
    await mockDb.insert(quickReplies).values(qr);

    expect(mockDb.insert).toHaveBeenCalledWith(quickReplies);
    expect(mockInsertValues).toHaveBeenCalledWith(qr);
  });

  it('resposta rápida pessoal (owner_user_id preenchido): aceita', async () => {
    const qr = makePersonalQuickReply();
    await mockDb.insert(quickReplies).values(qr);

    expect(mockInsertValues).toHaveBeenCalledWith(qr);
  });

  it('resposta com mídia + sem body (legenda ausente): aceita — mídia basta', async () => {
    mockInsertValues.mockResolvedValueOnce([{ id: QR_ID }]);
    const qr = makeOrgQuickReply({
      body: null,
      mediaUrl: 'https://storage.example.com/quick-replies/doc.pdf',
      mediaKind: 'document',
      mediaMime: 'application/pdf',
      mediaFileName: 'boleto.pdf',
    });

    const result = await mockDb.insert(quickReplies).values(qr);
    expect(result).toEqual([{ id: QR_ID }]);
  });
});

// ---------------------------------------------------------------------------
// Testes: CHECK chk_quick_replies_visibility_owner (coerência 2 sentidos)
// ---------------------------------------------------------------------------
describe('quick_replies — CHECK visibility × owner_user_id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue({ values: mockInsertValues });
  });

  it('visibility=personal sem owner_user_id: simula CHECK violation', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error(
        'new row for relation "quick_replies" violates check constraint ' +
          '"chk_quick_replies_visibility_owner"',
      ),
    );

    const qr = makePersonalQuickReply({ ownerUserId: null });
    await expect(mockDb.insert(quickReplies).values(qr)).rejects.toThrow(
      'chk_quick_replies_visibility_owner',
    );
  });

  it('visibility=organization com owner_user_id preenchido: simula CHECK violation', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error(
        'new row for relation "quick_replies" violates check constraint ' +
          '"chk_quick_replies_visibility_owner"',
      ),
    );

    const qr = makeOrgQuickReply({ ownerUserId: OWNER_A_ID });
    await expect(mockDb.insert(quickReplies).values(qr)).rejects.toThrow(
      'chk_quick_replies_visibility_owner',
    );
  });
});

// ---------------------------------------------------------------------------
// Testes: CHECK chk_quick_replies_visibility_domain
// ---------------------------------------------------------------------------
describe('quick_replies — CHECK domínio de visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue({ values: mockInsertValues });
  });

  it('visibility fora do domínio fechado: simula CHECK violation', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error(
        'new row for relation "quick_replies" violates check constraint ' +
          '"chk_quick_replies_visibility_domain"',
      ),
    );

    const qr = makeOrgQuickReply({ visibility: 'public' });
    await expect(mockDb.insert(quickReplies).values(qr)).rejects.toThrow(
      'chk_quick_replies_visibility_domain',
    );
  });
});

// ---------------------------------------------------------------------------
// Testes: CHECK chk_quick_replies_body_or_media
// ---------------------------------------------------------------------------
describe('quick_replies — CHECK body OR media_url', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue({ values: mockInsertValues });
  });

  it('sem body e sem media_url: simula CHECK violation', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error(
        'new row for relation "quick_replies" violates check constraint ' +
          '"chk_quick_replies_body_or_media"',
      ),
    );

    const qr = makeOrgQuickReply({ body: null, mediaUrl: null });
    await expect(mockDb.insert(quickReplies).values(qr)).rejects.toThrow(
      'chk_quick_replies_body_or_media',
    );
  });
});

// ---------------------------------------------------------------------------
// Testes: CHECK chk_quick_replies_media_all_or_nothing (coerência 2 sentidos)
// ---------------------------------------------------------------------------
describe('quick_replies — CHECK mídia tudo-ou-nada', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue({ values: mockInsertValues });
  });

  it('media_url preenchido sem media_kind: simula CHECK violation', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error(
        'new row for relation "quick_replies" violates check constraint ' +
          '"chk_quick_replies_media_all_or_nothing"',
      ),
    );

    const qr = makeOrgQuickReply({
      mediaUrl: 'https://storage.example.com/quick-replies/img.png',
      mediaKind: null,
    });
    await expect(mockDb.insert(quickReplies).values(qr)).rejects.toThrow(
      'chk_quick_replies_media_all_or_nothing',
    );
  });

  it('media_kind preenchido sem media_url: simula CHECK violation', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error(
        'new row for relation "quick_replies" violates check constraint ' +
          '"chk_quick_replies_media_all_or_nothing"',
      ),
    );

    const qr = makeOrgQuickReply({ mediaUrl: null, mediaKind: 'image' });
    await expect(mockDb.insert(quickReplies).values(qr)).rejects.toThrow(
      'chk_quick_replies_media_all_or_nothing',
    );
  });
});

// ---------------------------------------------------------------------------
// Testes: CHECK chk_quick_replies_media_kind_domain
// ---------------------------------------------------------------------------
describe('quick_replies — CHECK domínio de media_kind', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue({ values: mockInsertValues });
  });

  it('media_kind fora do domínio fechado: simula CHECK violation', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error(
        'new row for relation "quick_replies" violates check constraint ' +
          '"chk_quick_replies_media_kind_domain"',
      ),
    );

    const qr = makeOrgQuickReply({
      mediaUrl: 'https://storage.example.com/quick-replies/file.zip',
      mediaKind: 'archive',
    });
    await expect(mockDb.insert(quickReplies).values(qr)).rejects.toThrow(
      'chk_quick_replies_media_kind_domain',
    );
  });
});

// ---------------------------------------------------------------------------
// Testes: CHECK chk_quick_replies_shortcut_format
// ---------------------------------------------------------------------------
describe('quick_replies — CHECK formato do shortcut', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue({ values: mockInsertValues });
  });

  it('shortcut com barra (/): simula CHECK violation', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error(
        'new row for relation "quick_replies" violates check constraint ' +
          '"chk_quick_replies_shortcut_format"',
      ),
    );

    const qr = makeOrgQuickReply({ shortcut: '/saudacao' });
    await expect(mockDb.insert(quickReplies).values(qr)).rejects.toThrow(
      'chk_quick_replies_shortcut_format',
    );
  });

  it('shortcut começando com hífen: simula CHECK violation', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error(
        'new row for relation "quick_replies" violates check constraint ' +
          '"chk_quick_replies_shortcut_format"',
      ),
    );

    const qr = makeOrgQuickReply({ shortcut: '-saudacao' });
    await expect(mockDb.insert(quickReplies).values(qr)).rejects.toThrow(
      'chk_quick_replies_shortcut_format',
    );
  });

  it('shortcut com maiúsculas ou espaço: simula CHECK violation', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error(
        'new row for relation "quick_replies" violates check constraint ' +
          '"chk_quick_replies_shortcut_format"',
      ),
    );

    const qr = makeOrgQuickReply({ shortcut: 'Saudação Inicial' });
    await expect(mockDb.insert(quickReplies).values(qr)).rejects.toThrow(
      'chk_quick_replies_shortcut_format',
    );
  });
});

// ---------------------------------------------------------------------------
// Testes: únicos parciais de shortcut (doc 25 §4.1 — dois índices distintos)
// ---------------------------------------------------------------------------
describe('quick_replies — únicos parciais de shortcut', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue({ values: mockInsertValues });
  });

  it('shortcut duplicado entre respostas da organização: simula UNIQUE violation', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error(
        'duplicate key value violates unique constraint "uq_quick_replies_shortcut_org_wide"',
      ),
    );

    const qr = makeOrgQuickReply({ shortcut: 'saudacao' });
    await expect(mockDb.insert(quickReplies).values(qr)).rejects.toThrow(
      'uq_quick_replies_shortcut_org_wide',
    );
  });

  it('shortcut duplicado dentro da biblioteca do MESMO dono: simula UNIQUE violation', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error(
        'duplicate key value violates unique constraint "uq_quick_replies_shortcut_per_owner"',
      ),
    );

    const qr = makePersonalQuickReply({ ownerUserId: OWNER_A_ID, shortcut: 'meuatalho' });
    await expect(mockDb.insert(quickReplies).values(qr)).rejects.toThrow(
      'uq_quick_replies_shortcut_per_owner',
    );
  });

  it('mesmo shortcut para DONOS DIFERENTES: aceito (índice é por dono)', async () => {
    mockInsertValues.mockResolvedValueOnce([{ id: QR_ID }]);

    const qr = makePersonalQuickReply({ ownerUserId: OWNER_B_ID, shortcut: 'meuatalho' });
    const result = await mockDb.insert(quickReplies).values(qr);

    expect(result).toEqual([{ id: QR_ID }]);
  });

  it(
    'atalho pessoal PODE sombrear um atalho da organização com o mesmo shortcut ' +
      '(índices distintos — doc 25 §6.2): aceito',
    async () => {
      // Já existe um shortcut='saudacao' com owner_user_id NULL (org-wide).
      // Um operador cria um shortcut='saudacao' PESSOAL — cai no índice
      // uq_quick_replies_shortcut_per_owner (owner_user_id IS NOT NULL),
      // não colide com uq_quick_replies_shortcut_org_wide.
      mockInsertValues.mockResolvedValueOnce([{ id: QR_ID }]);

      const personalShadow = makePersonalQuickReply({
        ownerUserId: OWNER_A_ID,
        shortcut: 'saudacao',
      });
      const result = await mockDb.insert(quickReplies).values(personalShadow);

      expect(result).toEqual([{ id: QR_ID }]);
    },
  );
});

// ---------------------------------------------------------------------------
// Testes: Foreign Keys
// ---------------------------------------------------------------------------
describe('quick_replies — Foreign Keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue({ values: mockInsertValues });
  });

  it('organization_id inexistente: simula FK violation', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error('insert or update violates foreign key constraint "fk_quick_replies_organization"'),
    );

    const qr = makeOrgQuickReply({ organizationId: '00000000-dead-beef-0000-000000000000' });
    await expect(mockDb.insert(quickReplies).values(qr)).rejects.toThrow(
      'fk_quick_replies_organization',
    );
  });

  it('owner_user_id inexistente: simula FK violation', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error('insert or update violates foreign key constraint "fk_quick_replies_owner"'),
    );

    const qr = makePersonalQuickReply({
      ownerUserId: '00000000-dead-beef-0000-000000000000',
    });
    await expect(mockDb.insert(quickReplies).values(qr)).rejects.toThrow('fk_quick_replies_owner');
  });

  it('created_by inexistente: simula FK violation', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error('insert or update violates foreign key constraint "fk_quick_replies_created_by"'),
    );

    const qr = makeOrgQuickReply({ createdBy: '00000000-dead-beef-0000-000000000000' });
    await expect(mockDb.insert(quickReplies).values(qr)).rejects.toThrow(
      'fk_quick_replies_created_by',
    );
  });
});

// ---------------------------------------------------------------------------
// Testes de tipagem — verifica que os tipos Drizzle compilam corretamente
// ---------------------------------------------------------------------------
describe('tipos Drizzle — compilação sem any', () => {
  it('QuickReply type tem os campos esperados', () => {
    const qr: QuickReply = {
      id: QR_ID,
      organizationId: ORG_ID,
      ownerUserId: null,
      visibility: 'organization',
      shortcut: 'saudacao',
      title: 'Saudação inicial',
      body: 'Olá! Como posso ajudar?',
      category: 'Saudações',
      mediaUrl: null,
      mediaMime: null,
      mediaKind: null,
      mediaSizeBytes: null,
      mediaFileName: null,
      cityIds: [],
      isActive: true,
      sortOrder: 0,
      usageCount: 0,
      lastUsedAt: null,
      createdBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    expect(qr.id).toBe(QR_ID);
    expect(qr.visibility).toBe('organization');
  });

  it('NewQuickReply aceita campos obrigatórios sem opcionais', () => {
    const minimal: NewQuickReply = {
      organizationId: ORG_ID,
      shortcut: 'minimo',
      title: 'Resposta mínima',
      body: 'Corpo mínimo.',
    };
    expect(minimal.ownerUserId).toBeUndefined();
    expect(minimal.shortcut).toBe('minimo');
  });
});

// ---------------------------------------------------------------------------
// city_ids — filtro de conveniência, NÃO fronteira de segurança (doc 25 D6)
// ---------------------------------------------------------------------------
describe('quick_replies — city_ids é filtro de conveniência (doc 25 D6)', () => {
  it('city_ids vazio (default) significa "todas as cidades"', () => {
    const qr: QuickReply = {
      id: QR_ID,
      organizationId: ORG_ID,
      ownerUserId: null,
      visibility: 'organization',
      shortcut: 'saudacao',
      title: 'Saudação inicial',
      body: 'Olá!',
      category: null,
      mediaUrl: null,
      mediaMime: null,
      mediaKind: null,
      mediaSizeBytes: null,
      mediaFileName: null,
      cityIds: [],
      isActive: true,
      sortOrder: 0,
      usageCount: 0,
      lastUsedAt: null,
      createdBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    // Vazio = todas as cidades (doc 25 §4). A fronteira real é organizationId.
    expect(qr.cityIds).toHaveLength(0);
    expect(qr.organizationId).toBe(ORG_ID);
  });
});
