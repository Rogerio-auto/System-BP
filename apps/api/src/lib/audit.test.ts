// =============================================================================
// audit.test.ts — Testes unitários do helper auditLog() (F1-S16).
//
// Estratégia: DB mockado via vi.mock — sem Postgres real.
//   - auditLog() insere na tabela audit_logs com os campos corretos.
//   - Retorna UUID gerado.
//   - Idempotência: cada chamada insere registro independente (design intencional).
//   - FK organização: organizationId é obrigatório e propagado.
//   - Ator nulo: ações de sistema sem userId/role inserem null corretamente.
//   - Truncagem de user_agent a 512 chars.
//   - before/after nullable: criação sem before, exclusão sem after.
//   - correlationId propagado ou null quando ausente.
//   - Erro de inserção propaga para o caller (rollback deve ser feito pelo caller).
//
// Testes de integração com DB real ficam em
// audit.integration.test.ts (requer Postgres rodando — CI/local).
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock de 'pg' — evita tentativa de conexão real
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
// Mock de Drizzle db — controlamos insert().values()
// ---------------------------------------------------------------------------
const mockValues = vi.fn();
const mockInsert = vi.fn();

mockValues.mockResolvedValue(undefined);
mockInsert.mockReturnValue({ values: mockValues });

const mockTx = {
  insert: mockInsert,
};

vi.mock('../db/client.js', () => ({
  db: mockTx,
  pool: {
    connect: vi.fn().mockResolvedValue({ query: vi.fn(), release: vi.fn() }),
    end: vi.fn(),
    on: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Imports após mocks
// ---------------------------------------------------------------------------
import { auditLog } from './audit.js';
import type { AuditLogParams, AuditTx } from './audit.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = 'aaaabbbb-0000-0000-0000-000000000001';
const USER_ID = 'aaaabbbb-0000-0000-0000-000000000002';
const RESOURCE_ID = 'aaaabbbb-0000-0000-0000-000000000003';
const CORRELATION_ID = 'aaaabbbb-0000-0000-0000-000000000004';

function makeTx(): AuditTx {
  return mockTx as unknown as AuditTx;
}

function makeParams(overrides: Partial<AuditLogParams> = {}): AuditLogParams {
  return {
    organizationId: ORG_ID,
    actor: {
      userId: USER_ID,
      role: 'admin',
      ip: '192.168.1.1',
      userAgent: 'Mozilla/5.0 (test)',
    },
    action: 'leads.created',
    resource: { type: 'lead', id: RESOURCE_ID },
    before: null,
    after: { status: 'novo', cityId: 'aaa' },
    correlationId: CORRELATION_ID,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// auditLog() — inserção
// ---------------------------------------------------------------------------

describe('auditLog()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValues.mockResolvedValue(undefined);
    mockInsert.mockReturnValue({ values: mockValues });
  });

  it('retorna um UUID quando a inserção tem sucesso', async () => {
    const tx = makeTx();
    const id = await auditLog(tx, makeParams());

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('chama tx.insert() exatamente uma vez com organizationId correto', async () => {
    const tx = makeTx();
    await auditLog(tx, makeParams());

    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockValues).toHaveBeenCalledOnce();

    const row = mockValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row['organizationId']).toBe(ORG_ID);
  });

  it('persiste action, resourceType e resourceId corretamente', async () => {
    const tx = makeTx();
    await auditLog(tx, makeParams({ action: 'kanban.stage_updated' }));

    const row = mockValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row['action']).toBe('kanban.stage_updated');
    expect(row['resourceType']).toBe('lead');
    expect(row['resourceId']).toBe(RESOURCE_ID);
  });

  it('propaga actorUserId e actorRole quando actor está presente', async () => {
    const tx = makeTx();
    await auditLog(tx, makeParams());

    const row = mockValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row['actorUserId']).toBe(USER_ID);
    expect(row['actorRole']).toBe('admin');
  });

  it('salva actorUserId e actorRole como null para ações de sistema (actor = null)', async () => {
    const tx = makeTx();
    await auditLog(tx, makeParams({ actor: null }));

    const row = mockValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row['actorUserId']).toBeNull();
    expect(row['actorRole']).toBeNull();
    expect(row['ip']).toBeNull();
    expect(row['userAgent']).toBeNull();
  });

  it('propaga ip e user_agent do ator', async () => {
    const tx = makeTx();
    await auditLog(
      tx,
      makeParams({
        actor: { userId: USER_ID, role: 'gestor', ip: '10.0.0.1', userAgent: 'test-agent/1.0' },
      }),
    );

    const row = mockValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row['ip']).toBe('10.0.0.1');
    expect(row['userAgent']).toBe('test-agent/1.0');
  });

  it('trunca user_agent a 512 caracteres', async () => {
    const tx = makeTx();
    const longAgent = 'A'.repeat(600);
    await auditLog(
      tx,
      makeParams({
        actor: { userId: USER_ID, role: 'admin', userAgent: longAgent },
      }),
    );

    const row = mockValues.mock.calls[0]?.[0] as Record<string, unknown>;
    const ua = row['userAgent'] as string;
    expect(ua).toHaveLength(512);
    expect(ua).toBe('A'.repeat(512));
  });

  it('propaga correlationId quando fornecido', async () => {
    const tx = makeTx();
    await auditLog(tx, makeParams({ correlationId: CORRELATION_ID }));

    const row = mockValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row['correlationId']).toBe(CORRELATION_ID);
  });

  it('salva correlationId como null quando não fornecido', async () => {
    const tx = makeTx();
    // exactOptionalPropertyTypes: build params without correlationId (omit the optional key)
    const paramsWithoutCorrelation: AuditLogParams = {
      organizationId: ORG_ID,
      actor: { userId: USER_ID, role: 'admin', ip: '192.168.1.1', userAgent: 'Mozilla/5.0 (test)' },
      action: 'leads.created',
      resource: { type: 'lead', id: RESOURCE_ID },
      before: null,
      after: { status: 'novo', cityId: 'aaa' },
    };
    await auditLog(tx, paramsWithoutCorrelation);

    const row = mockValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row['correlationId']).toBeNull();
  });

  it('salva before como null para ações de criação', async () => {
    const tx = makeTx();
    await auditLog(tx, makeParams({ before: null, after: { id: RESOURCE_ID } }));

    const row = mockValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row['before']).toBeNull();
    expect(row['after']).toMatchObject({ id: RESOURCE_ID });
  });

  it('salva after como null para ações de exclusão', async () => {
    const tx = makeTx();
    await auditLog(tx, makeParams({ before: { id: RESOURCE_ID, status: 'active' }, after: null }));

    const row = mockValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row['before']).toMatchObject({ id: RESOURCE_ID, status: 'active' });
    expect(row['after']).toBeNull();
  });

  it('idempotência de design: cada chamada insere um registro distinto', async () => {
    const tx = makeTx();
    const params = makeParams();

    const id1 = await auditLog(tx, params);
    const id2 = await auditLog(tx, params);

    // Cada chamada deve gerar um UUID diferente
    expect(id1).not.toBe(id2);

    // Ambas as chamadas devem ter chamado insert
    expect(mockInsert).toHaveBeenCalledTimes(2);
    expect(mockValues).toHaveBeenCalledTimes(2);
  });

  it('propagates error quando tx.insert() lança (simula rollback do caller)', async () => {
    const tx = makeTx();
    mockValues.mockRejectedValueOnce(new Error('fk constraint violation'));

    await expect(auditLog(tx, makeParams())).rejects.toThrow('fk constraint violation');
    // O caller deve fazer rollback da transação — log de auditoria NÃO persistido
  });

  it('o campo id no registro inserido coincide com o UUID retornado', async () => {
    const tx = makeTx();
    const returnedId = await auditLog(tx, makeParams());

    const row = mockValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row['id']).toBe(returnedId);
  });
});

// ---------------------------------------------------------------------------
// LGPD — garantias de design
// ---------------------------------------------------------------------------

describe('auditLog() — LGPD §8.5', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValues.mockResolvedValue(undefined);
    mockInsert.mockReturnValue({ values: mockValues });
  });

  it('aceita before/after com dados redactados pelo caller (sem PII bruta)', async () => {
    const tx = makeTx();
    const redactedBefore = {
      cpf_hash: 'hmac-sha256-hex-value', // hash HMAC — não é PII bruta
      status: 'active',
    };
    const redactedAfter = {
      cpf_hash: 'hmac-sha256-hex-value',
      status: 'disabled',
    };

    await auditLog(tx, makeParams({ before: redactedBefore, after: redactedAfter }));

    const row = mockValues.mock.calls[0]?.[0] as Record<string, unknown>;
    // Persiste exatamente o que o caller passou (já redactado)
    expect(row['before']).toStrictEqual(redactedBefore);
    expect(row['after']).toStrictEqual(redactedAfter);
  });

  it('metadata é ignorado na inserção (não armazenado na tabela)', async () => {
    const tx = makeTx();
    await auditLog(tx, makeParams({ metadata: { someExtraContext: 'value', requestId: 'abc' } }));

    const row = mockValues.mock.calls[0]?.[0] as Record<string, unknown>;
    // metadata não deve aparecer como coluna na linha inserida
    expect(row).not.toHaveProperty('metadata');
    expect(row).not.toHaveProperty('someExtraContext');
  });
});
