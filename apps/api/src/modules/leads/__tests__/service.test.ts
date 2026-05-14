// =============================================================================
// leads/service.test.ts — Testes unitários de leads/service.ts (F1-S11).
//
// Estratégia: mocks de banco/outbox/audit — sem conexão real com Postgres.
//
// Cenários cobertos (>= 15 testes):
//   1.  Create básico → 201 (lead retornado).
//   2.  Create com phone duplicado mesma org → 409 LEAD_PHONE_DUPLICATE.
//   3.  Create com phone duplicado em outra org → 201 (multi-tenant).
//   4.  Create com phone de lead deletado (mesma org) → 201 (parcial unique).
//   5.  Read scope: lead em city do scope → ok.
//   6.  Read scope: lead fora do city scope → 404.
//   7.  Update dentro do scope → ok.
//   8.  Update fora do scope → 404.
//   9.  Soft delete → 204 (lead com deleted_at).
//  10.  Listagem não retorna leads deletados.
//  11.  Restore → desfaz deleted_at.
//  12.  Restore com phone já duplicado em scope ativo → 409.
//  13.  Outbox leads.created não contém phone_e164 nem email no payload.
//  14.  Audit log leads.create: before=null, after sanitizado (sem PII bruta).
//  15.  CPF fornecido → gera cpf_hash; CPF bruto não aparece no retorno.
//  16.  Create com phone em outra org não conflita (multi-tenant).
//  17.  Race condition DB (unique violation 23505) → LeadPhoneDuplicateError.
// =============================================================================
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock pg — evita conexão real
// ---------------------------------------------------------------------------
vi.mock('pg', () => {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const MockPool = vi.fn().mockImplementation(() => ({
    query: mockQuery,
    connect: vi.fn().mockResolvedValue({ query: mockQuery, release: vi.fn() }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { Pool: MockPool, default: { Pool: MockPool } };
});

vi.mock('../../../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    LANGGRAPH_INTERNAL_TOKEN: 'test-internal-token-32-chars-minimum!!',
    LANGGRAPH_SERVICE_URL: 'http://localhost:8000',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    JWT_ACCESS_SECRET: 'a'.repeat(64),
    JWT_REFRESH_SECRET: 'b'.repeat(64),
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '30d',
    API_HOST: '0.0.0.0',
    API_PORT: 3333,
    API_PUBLIC_URL: 'http://localhost:3333',
    CORS_ALLOWED_ORIGINS: ['http://localhost:5173'],
  },
}));

// ---------------------------------------------------------------------------
// Mocks de repository
// ---------------------------------------------------------------------------
const mockFindLeads = vi.fn();
const mockFindLeadById = vi.fn();
const mockFindLeadByPhoneInOrg = vi.fn();
const mockFindLeadByPhoneInOrgExcluding = vi.fn();
const mockInsertLead = vi.fn();
const mockUpdateLead = vi.fn();
const mockSoftDeleteLead = vi.fn();
const mockRestoreLead = vi.fn();

vi.mock('../repository.js', () => ({
  findLeads: (...args: unknown[]) => mockFindLeads(...args),
  findLeadById: (...args: unknown[]) => mockFindLeadById(...args),
  findLeadByPhoneInOrg: (...args: unknown[]) => mockFindLeadByPhoneInOrg(...args),
  findLeadByPhoneInOrgExcluding: (...args: unknown[]) => mockFindLeadByPhoneInOrgExcluding(...args),
  insertLead: (...args: unknown[]) => mockInsertLead(...args),
  updateLead: (...args: unknown[]) => mockUpdateLead(...args),
  softDeleteLead: (...args: unknown[]) => mockSoftDeleteLead(...args),
  restoreLead: (...args: unknown[]) => mockRestoreLead(...args),
}));

// ---------------------------------------------------------------------------
// Mock kanban/repository — createLead cria card automaticamente (doc 01 §72)
// ---------------------------------------------------------------------------
const mockFindInitialStage = vi.fn();
const mockInsertCard = vi.fn();
const mockInsertHistory = vi.fn();

vi.mock('../../kanban/repository.js', () => ({
  findInitialStage: (...args: unknown[]) => mockFindInitialStage(...args),
  insertCard: (...args: unknown[]) => mockInsertCard(...args),
  insertHistory: (...args: unknown[]) => mockInsertHistory(...args),
}));

// ---------------------------------------------------------------------------
// Mock outbox emit
// ---------------------------------------------------------------------------
const mockEmit = vi.fn().mockResolvedValue('mock-event-id');

vi.mock('../../../events/emit.js', () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
}));

// ---------------------------------------------------------------------------
// Mock auditLog
// ---------------------------------------------------------------------------
const mockAuditLog = vi.fn().mockResolvedValue('mock-audit-id');

vi.mock('../../../lib/audit.js', () => ({
  auditLog: (...args: unknown[]) => mockAuditLog(...args),
}));

// ---------------------------------------------------------------------------
// Mock db.transaction
// ---------------------------------------------------------------------------
const mockTransaction = vi.fn((fn: (tx: unknown) => unknown) =>
  fn({ insert: vi.fn(), update: vi.fn(), select: vi.fn() }),
);

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  transaction: (...args: unknown[]) => mockTransaction(...args),
};

vi.mock('../../../db/client.js', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

// ---------------------------------------------------------------------------
// Mock hashDocument (pii.ts) — determinístico em tests
// ---------------------------------------------------------------------------
vi.mock('../../../lib/crypto/pii.js', () => ({
  hashDocument: (plain: string) => `hmac:${plain}`,
  encryptPii: async (plain: string) => Buffer.from(plain),
  decryptPii: async (buf: Buffer) => buf.toString(),
  compareHash: (a: string, b: string) => a === b,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const OTHER_ORG = 'bbbbbbbb-0000-0000-0000-000000000002';
const CITY_A = 'cccccccc-0000-0000-0000-000000000001';
// CITY_B reserved for future cross-city scope tests
const _CITY_B = 'dddddddd-0000-0000-0000-000000000001';
const LEAD_ID = 'eeeeeeee-0000-0000-0000-000000000001';
const AGENT_ID = 'ffffffff-0000-0000-0000-000000000001';

const ACTOR = {
  userId: 'user-aaaa-0000-0000-0000-000000000001',
  organizationId: ORG_ID,
  role: 'agente',
  cityScopeIds: [CITY_A],
  ip: '127.0.0.1',
  userAgent: 'vitest',
};

const ACTOR_ADMIN = {
  ...ACTOR,
  role: 'admin',
  cityScopeIds: null, // acesso global
};

function makeLead(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAD_ID,
    organizationId: ORG_ID,
    cityId: CITY_A,
    agentId: AGENT_ID,
    name: 'Maria Silva',
    phoneE164: '+5569912345678',
    phoneNormalized: '5569912345678',
    source: 'manual' as const,
    status: 'new' as const,
    email: 'maria@example.com',
    cpfEncrypted: null,
    cpfHash: null,
    notes: null,
    lastSimulationId: null,
    metadata: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

const CREATE_BODY = {
  name: 'João Santos',
  phone_e164: '+5569987654321',
  city_id: CITY_A,
  source: 'manual' as const,
  status: 'new' as const,
  email: 'joao@example.com',
  cpf: null,
  notes: null,
  metadata: {},
  agent_id: null,
};

// ---------------------------------------------------------------------------
// beforeEach reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();
  mockEmit.mockResolvedValue('mock-event-id');
  mockAuditLog.mockResolvedValue('mock-audit-id');
  // Stage inicial padrão para testes — createLead em sucesso cria card.
  mockFindInitialStage.mockResolvedValue({
    id: 'stage-pre-atendimento',
    organizationId: ORG_ID,
    name: 'Pré-atendimento',
    orderIndex: 0,
    color: '#1B3A8C',
    isTerminalWon: false,
    isTerminalLost: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  mockInsertCard.mockResolvedValue({
    id: 'card-test-id',
    organizationId: ORG_ID,
    leadId: LEAD_ID,
    stageId: 'stage-pre-atendimento',
    assigneeUserId: null,
    priority: 0,
    notes: null,
    enteredStageAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  mockInsertHistory.mockResolvedValue('history-id');
  const txImpl = (fn: (tx: unknown) => unknown) =>
    fn({ insert: vi.fn(), update: vi.fn(), select: vi.fn() });
  mockTransaction.mockImplementation(txImpl);
  // Ensure mockDb.transaction delegates to mockTransaction (vi.resetAllMocks clears it)
  vi.spyOn(mockDb, 'transaction').mockImplementation((...args: unknown[]) =>
    mockTransaction(...args),
  );
});

// ---------------------------------------------------------------------------
// Suite 1: Create
// ---------------------------------------------------------------------------

describe('createLead', () => {
  it('create básico → retorna lead criado', async () => {
    const newLead = makeLead({
      id: 'new-lead-id',
      name: 'João Santos',
      phoneE164: '+5569987654321',
    });

    mockFindLeadByPhoneInOrg.mockResolvedValueOnce(null); // sem duplicata
    mockInsertLead.mockResolvedValueOnce(newLead);

    const { createLead } = await import('../service.js');
    const result = await createLead(
      mockDb as unknown as Parameters<typeof createLead>[0],
      ACTOR,
      CREATE_BODY,
    );

    expect(result.id).toBe('new-lead-id');
    expect(result.phone_e164).toBe('+5569987654321');
    expect(mockInsertLead).toHaveBeenCalledOnce();
  });

  it('phone duplicado mesma org → 409 LEAD_PHONE_DUPLICATE', async () => {
    mockFindLeadByPhoneInOrg.mockResolvedValueOnce({ id: 'existing-id' });

    const { createLead, LeadPhoneDuplicateError } = await import('../service.js');

    await expect(
      createLead(mockDb as unknown as Parameters<typeof createLead>[0], ACTOR, CREATE_BODY),
    ).rejects.toBeInstanceOf(LeadPhoneDuplicateError);

    // Não deve chamar insert
    expect(mockInsertLead).not.toHaveBeenCalled();
  });

  it('phone duplicado em OUTRA org → 201 (multi-tenant)', async () => {
    const actorOtherOrg = { ...ACTOR, organizationId: OTHER_ORG };
    const newLead = makeLead({ organizationId: OTHER_ORG });

    // Para a OUTRA org, não há duplicata
    mockFindLeadByPhoneInOrg.mockResolvedValueOnce(null);
    mockInsertLead.mockResolvedValueOnce(newLead);

    const { createLead } = await import('../service.js');
    await expect(
      createLead(mockDb as unknown as Parameters<typeof createLead>[0], actorOtherOrg, CREATE_BODY),
    ).resolves.toBeDefined();
  });

  it('phone duplicado de lead DELETADO → 201 (parcial unique permite)', async () => {
    // findLeadByPhoneInOrg só considera deleted_at IS NULL — então retorna null
    mockFindLeadByPhoneInOrg.mockResolvedValueOnce(null);
    const newLead = makeLead({ phoneE164: '+5569987654321' });
    mockInsertLead.mockResolvedValueOnce(newLead);

    const { createLead } = await import('../service.js');
    await expect(
      createLead(mockDb as unknown as Parameters<typeof createLead>[0], ACTOR, CREATE_BODY),
    ).resolves.toBeDefined();
  });

  it('CPF fornecido → cpf_hash derivado; cpf bruto não no retorno', async () => {
    const bodyWithCpf = { ...CREATE_BODY, cpf: '123.456.789-00' };
    const newLead = makeLead({ cpfHash: 'hmac:12345678900' });

    mockFindLeadByPhoneInOrg.mockResolvedValueOnce(null);
    mockInsertLead.mockResolvedValueOnce(newLead);

    const { createLead } = await import('../service.js');
    const result = await createLead(
      mockDb as unknown as Parameters<typeof createLead>[0],
      ACTOR,
      bodyWithCpf,
    );

    // cpf_hash derivado deve ter sido passado ao insertLead
    const insertCall = mockInsertLead.mock.calls[0] as unknown[];
    const insertArg = insertCall[1] as Record<string, unknown>;
    expect(insertArg['cpfHash']).toBe('hmac:12345678900');

    // cpf bruto nunca aparece na resposta
    expect(result).not.toHaveProperty('cpf');
    expect(result).not.toHaveProperty('cpf_hash');
  });

  it('race condition DB (unique violation 23505) → LeadPhoneDuplicateError', async () => {
    mockFindLeadByPhoneInOrg.mockResolvedValueOnce(null); // pre-flight ok
    const pgError = Object.assign(new Error('unique violation'), { code: '23505' });
    mockInsertLead.mockRejectedValueOnce(pgError);

    const { createLead, LeadPhoneDuplicateError } = await import('../service.js');

    await expect(
      createLead(mockDb as unknown as Parameters<typeof createLead>[0], ACTOR, CREATE_BODY),
    ).rejects.toBeInstanceOf(LeadPhoneDuplicateError);
  });

  it('outbox leads.created não contém phone_e164 nem email no payload', async () => {
    const newLead = makeLead({ phoneE164: '+5569987654321', email: 'secreto@test.com' });
    mockFindLeadByPhoneInOrg.mockResolvedValueOnce(null);
    mockInsertLead.mockResolvedValueOnce(newLead);

    const { createLead } = await import('../service.js');
    await createLead(mockDb as unknown as Parameters<typeof createLead>[0], ACTOR, CREATE_BODY);

    // createLead emite 2 eventos: leads.created + kanban.card_created (doc 01 §72)
    const leadsCreatedCall = (mockEmit.mock.calls as unknown[][]).find((call) => {
      const evt = call[1] as Record<string, unknown>;
      return evt['eventName'] === 'leads.created';
    });
    expect(leadsCreatedCall).toBeDefined();

    const event = leadsCreatedCall![1] as Record<string, unknown>;
    const data = event['data'] as Record<string, unknown>;

    // O payload do outbox deve ter apenas IDs/enums — sem PII bruta
    expect(data).not.toHaveProperty('phone_e164');
    expect(data).not.toHaveProperty('email');
    expect(data).not.toHaveProperty('name');
    expect(data).toHaveProperty('lead_id');
    expect(data).toHaveProperty('source');
  });

  it('createLead também emite kanban.card_created (doc 01 §72)', async () => {
    const newLead = makeLead();
    mockFindLeadByPhoneInOrg.mockResolvedValueOnce(null);
    mockInsertLead.mockResolvedValueOnce(newLead);

    const { createLead } = await import('../service.js');
    await createLead(mockDb as unknown as Parameters<typeof createLead>[0], ACTOR, CREATE_BODY);

    expect(mockInsertCard).toHaveBeenCalledOnce();
    expect(mockInsertHistory).toHaveBeenCalledOnce();

    const cardEventCall = (mockEmit.mock.calls as unknown[][]).find((call) => {
      const evt = call[1] as Record<string, unknown>;
      return evt['eventName'] === 'kanban.card_created';
    });
    expect(cardEventCall).toBeDefined();
    const cardEvent = cardEventCall![1] as Record<string, unknown>;
    const cardData = cardEvent['data'] as Record<string, unknown>;
    expect(cardData['lead_id']).toBe(newLead.id);
    expect(cardData['stage']).toBe('Pré-atendimento');
  });

  it('createLead sem stages configurados → ainda cria lead (kanban opcional)', async () => {
    const newLead = makeLead();
    mockFindLeadByPhoneInOrg.mockResolvedValueOnce(null);
    mockInsertLead.mockResolvedValueOnce(newLead);
    mockFindInitialStage.mockResolvedValueOnce(undefined); // org sem stages

    const { createLead } = await import('../service.js');
    const result = await createLead(
      mockDb as unknown as Parameters<typeof createLead>[0],
      ACTOR,
      CREATE_BODY,
    );

    expect(result.id).toBe(newLead.id);
    expect(mockInsertCard).not.toHaveBeenCalled();
    expect(mockInsertHistory).not.toHaveBeenCalled();
  });

  it('audit log leads.create: before=null, after sanitizado (sem PII bruta)', async () => {
    const newLead = makeLead({ phoneE164: '+5569987654321', email: 'secreto@test.com' });
    mockFindLeadByPhoneInOrg.mockResolvedValueOnce(null);
    mockInsertLead.mockResolvedValueOnce(newLead);

    const { createLead } = await import('../service.js');
    await createLead(mockDb as unknown as Parameters<typeof createLead>[0], ACTOR, CREATE_BODY);

    expect(mockAuditLog).toHaveBeenCalledOnce();

    const auditCall = mockAuditLog.mock.calls[0] as unknown[];
    const params = auditCall[1] as Record<string, unknown>;

    expect(params['action']).toBe('leads.create');
    expect(params['before']).toBeNull();

    // after deve ter PII redactada
    const after = params['after'] as Record<string, unknown>;
    expect(after['phone_e164']).toBe('[redacted]');
    expect(after['email']).toBe('[redacted]');
    expect(after['name']).toBe('[redacted]');
  });
});

// ---------------------------------------------------------------------------
// Suite 2: City scope
// ---------------------------------------------------------------------------

describe('city scope — read e update', () => {
  it('lead na city do scope → retorna lead', async () => {
    const lead = makeLead({ cityId: CITY_A });
    mockFindLeadById.mockResolvedValueOnce(lead);

    const { getLeadById } = await import('../service.js');
    const result = await getLeadById(
      mockDb as unknown as Parameters<typeof getLeadById>[0],
      ACTOR,
      LEAD_ID,
    );

    expect(result.id).toBe(LEAD_ID);
  });

  it('lead em city B (fora do scope) → 404 (não 403)', async () => {
    // O repository aplica o scope e retorna null quando fora do escopo
    mockFindLeadById.mockResolvedValueOnce(null);

    const { getLeadById } = await import('../service.js');
    const { NotFoundError } = await import('../../../shared/errors.js');

    await expect(
      getLeadById(mockDb as unknown as Parameters<typeof getLeadById>[0], ACTOR, LEAD_ID),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('update dentro do scope → ok', async () => {
    const lead = makeLead({ cityId: CITY_A });
    const updatedLead = { ...lead, status: 'qualifying' as const };

    mockFindLeadById.mockResolvedValueOnce(lead);
    mockUpdateLead.mockResolvedValueOnce(updatedLead);

    const { updateLeadService } = await import('../service.js');
    const result = await updateLeadService(
      mockDb as unknown as Parameters<typeof updateLeadService>[0],
      ACTOR,
      LEAD_ID,
      { status: 'qualifying' },
    );

    expect(result.status).toBe('qualifying');
  });

  it('update fora do scope → 404', async () => {
    // findLeadById retorna null para scope inválido
    mockFindLeadById.mockResolvedValueOnce(null);

    const { updateLeadService } = await import('../service.js');
    const { NotFoundError } = await import('../../../shared/errors.js');

    await expect(
      updateLeadService(
        mockDb as unknown as Parameters<typeof updateLeadService>[0],
        ACTOR,
        LEAD_ID,
        { status: 'qualifying' },
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Delete / Restore
// ---------------------------------------------------------------------------

describe('soft delete e restore', () => {
  it('soft delete → seta deleted_at', async () => {
    const lead = makeLead();
    const deletedLead = { ...lead, deletedAt: new Date() };

    mockFindLeadById.mockResolvedValueOnce(lead);
    mockSoftDeleteLead.mockResolvedValueOnce(deletedLead);

    const { deleteLeadService } = await import('../service.js');
    await expect(
      deleteLeadService(
        mockDb as unknown as Parameters<typeof deleteLeadService>[0],
        ACTOR,
        LEAD_ID,
      ),
    ).resolves.toBeUndefined();

    expect(mockSoftDeleteLead).toHaveBeenCalledOnce();
  });

  it('restore → limpa deleted_at', async () => {
    const deletedLead = makeLead({ deletedAt: new Date('2026-01-10') });
    const restoredLead = { ...deletedLead, deletedAt: null, updatedAt: new Date() };

    mockFindLeadById.mockResolvedValueOnce(deletedLead); // includeDeleted=true
    mockFindLeadByPhoneInOrgExcluding.mockResolvedValueOnce(null); // sem conflito
    mockRestoreLead.mockResolvedValueOnce(restoredLead);

    const { restoreLeadService } = await import('../service.js');
    const result = await restoreLeadService(
      mockDb as unknown as Parameters<typeof restoreLeadService>[0],
      ACTOR,
      LEAD_ID,
    );

    expect(result.deleted_at).toBeNull();
    expect(mockRestoreLead).toHaveBeenCalledOnce();
  });

  it('restore com phone duplicado ativo → 409', async () => {
    const deletedLead = makeLead({ deletedAt: new Date('2026-01-10') });

    mockFindLeadById.mockResolvedValueOnce(deletedLead);
    // Há outro lead ativo com mesmo phone
    mockFindLeadByPhoneInOrgExcluding.mockResolvedValueOnce({ id: 'other-lead-id' });

    const { restoreLeadService, LeadPhoneDuplicateError } = await import('../service.js');

    await expect(
      restoreLeadService(
        mockDb as unknown as Parameters<typeof restoreLeadService>[0],
        ACTOR,
        LEAD_ID,
      ),
    ).rejects.toBeInstanceOf(LeadPhoneDuplicateError);
  });

  it('leads deletados não aparecem na listagem padrão', async () => {
    // O repository filtra deleted_at IS NULL por padrão — mock retorna lista sem deletados
    mockFindLeads.mockResolvedValueOnce({
      data: [makeLead({ deletedAt: null })],
      total: 1,
    });

    const { listLeads } = await import('../service.js');
    const result = await listLeads(
      mockDb as unknown as Parameters<typeof listLeads>[0],
      ACTOR_ADMIN,
      { page: 1, limit: 20 },
    );

    // Todos os leads retornados devem ter deleted_at null
    result.data.forEach((lead) => {
      expect(lead.deleted_at).toBeNull();
    });
  });
});
