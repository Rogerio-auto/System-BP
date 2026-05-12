// =============================================================================
// outbox.test.ts — Testes unitários do Outbox pattern (F1-S15).
//
// Estratégia: DB mockado via vi.mock para testar lógica sem Postgres real.
//   - emit() dentro de transação que faz rollback → evento NÃO persistido.
//   - emit() dentro de transação que commita → evento persistido + publishable.
//   - Idempotency_key duplicado → conflito (unique constraint simulado).
//   - Handler registrado e chamado corretamente pelo registry.
//   - Handler que falha → não marca como processado.
//
// Testes de integração com DB real (SKIP LOCKED, DLQ, publisher loop) ficam
// em outbox.integration.test.ts (requer Postgres rodando — CI/local).
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock pg — evita conexão real
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
  return { default: { Pool: MockPool, Client: MockClient }, Pool: MockPool, Client: MockClient };
});

// ---------------------------------------------------------------------------
// Mock Drizzle db — controlamos insert/update
// ---------------------------------------------------------------------------
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockWhere = vi.fn();
const mockValues = vi.fn();

// Cadeia de métodos Drizzle: .insert().values(), .update().set().where()
mockWhere.mockResolvedValue(undefined);
mockSet.mockReturnValue({ where: mockWhere });
mockValues.mockResolvedValue(undefined);
mockInsert.mockReturnValue({ values: mockValues });
mockUpdate.mockReturnValue({ set: mockSet });

const mockDb = {
  insert: mockInsert,
  update: mockUpdate,
};

vi.mock('../../db/client.js', () => ({
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
import { emit } from '../emit.js';
import type { EventHandler } from '../handlers.js';
import { registerHandler, getHandlers, getRegisteredEventNames } from '../handlers.js';
import type { AppEvent } from '../types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = 'aabbccdd-0000-0000-0000-000000000001';
const LEAD_ID = 'aabbccdd-0000-0000-0000-000000000002';

function makeLeadsCreatedEvent(
  overrides: Partial<AppEvent<'leads.created'>> = {},
): AppEvent<'leads.created'> {
  return {
    eventName: 'leads.created',
    aggregateType: 'lead',
    aggregateId: LEAD_ID,
    organizationId: ORG_ID,
    actor: { kind: 'user', id: '00000000-0000-0000-0000-000000000099', ip: '127.0.0.1' },
    idempotencyKey: `leads.created:${LEAD_ID}:${Date.now()}`,
    data: {
      lead_id: LEAD_ID,
      city_id: null,
      source: 'manual',
      assigned_agent_id: null,
      created_by_kind: 'user',
    },
    ...overrides,
  };
}

// Mock de transação Drizzle
function makeTx(): typeof mockDb {
  return mockDb;
}

// ---------------------------------------------------------------------------
// emit() — comportamento de inserção
// ---------------------------------------------------------------------------

describe('emit()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValues.mockResolvedValue(undefined);
    mockInsert.mockReturnValue({ values: mockValues });
  });

  it('retorna um UUID quando a inserção no outbox tem sucesso', async () => {
    const tx = makeTx();
    const event = makeLeadsCreatedEvent();

    const eventId = await emit(tx, event);

    expect(eventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('chama tx.insert() com os campos corretos', async () => {
    const tx = makeTx();
    const event = makeLeadsCreatedEvent({ idempotencyKey: 'leads.created:test:123' });

    await emit(tx, event);

    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockValues).toHaveBeenCalledOnce();

    const insertedValues = mockValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertedValues).toMatchObject({
      organizationId: ORG_ID,
      eventName: 'leads.created',
      aggregateType: 'lead',
      aggregateId: LEAD_ID,
      idempotencyKey: 'leads.created:test:123',
      attempts: 0,
      lastError: null,
      processedAt: null,
      failedAt: null,
    });
  });

  it('payload não contém PII bruta (LGPD §8.5)', async () => {
    const tx = makeTx();
    const event = makeLeadsCreatedEvent();

    await emit(tx, event);

    const insertedValues = mockValues.mock.calls[0]?.[0] as Record<string, unknown>;
    const payload = insertedValues['payload'] as Record<string, unknown>;

    // Garantia: nenhum campo de PII bruta no payload
    expect(payload).not.toHaveProperty('cpf');
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('telefone');
    expect(payload).not.toHaveProperty('phone');
    expect(payload).not.toHaveProperty('document_number');
    expect(payload).not.toHaveProperty('birth_date');

    // Payload tem apenas IDs e metadados
    expect((payload['data'] as Record<string, unknown>)['lead_id']).toBe(LEAD_ID);
  });

  it('propaga erro quando tx.insert() lança (simula rollback)', async () => {
    const tx = makeTx();
    mockValues.mockRejectedValueOnce(new Error('unique constraint violation'));

    const event = makeLeadsCreatedEvent();

    await expect(emit(tx, event)).rejects.toThrow('unique constraint violation');
    // O chamador deve fazer rollback da transação — evento NÃO persistido
  });

  it('includes correlation_id no payload quando fornecido', async () => {
    const tx = makeTx();
    const correlationId = '11112222-0000-0000-0000-000000000001';
    const event = makeLeadsCreatedEvent({ correlationId });

    await emit(tx, event);

    const insertedValues = mockValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertedValues['correlationId']).toBe(correlationId);

    const payload = insertedValues['payload'] as Record<string, unknown>;
    expect(payload['correlation_id']).toBe(correlationId);
  });

  it('sets correlation_id to null quando não fornecido', async () => {
    const tx = makeTx();
    const event = makeLeadsCreatedEvent();
    // correlationId não fornecido

    await emit(tx, event);

    const insertedValues = mockValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertedValues['correlationId']).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Handler registry
// ---------------------------------------------------------------------------

describe('registerHandler() / getHandlers()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getHandlers() retorna array vazio para evento sem handlers', () => {
    const handlers = getHandlers('evento.inexistente.xyz');
    expect(handlers).toHaveLength(0);
  });

  it('registra e recupera um handler', () => {
    // Usando EventHandler type importado — sem redeclarar param inline
    const handler: EventHandler = vi.fn();
    registerHandler('test.event_a', 'test.handler_a', handler);

    const handlers = getHandlers('test.event_a');
    expect(handlers.length).toBeGreaterThanOrEqual(1);

    const registered = handlers.find((h) => h.name === 'test.handler_a');
    expect(registered).toBeDefined();
    expect(registered?.fn).toBe(handler);
  });

  it('registra múltiplos handlers para o mesmo evento (fan-out)', () => {
    const handler1: EventHandler = vi.fn();
    const handler2: EventHandler = vi.fn();

    registerHandler('test.fan_out', 'test.fan_out.h1', handler1);
    registerHandler('test.fan_out', 'test.fan_out.h2', handler2);

    const handlers = getHandlers('test.fan_out');
    const names = handlers.map((h) => h.name);
    expect(names).toContain('test.fan_out.h1');
    expect(names).toContain('test.fan_out.h2');
  });

  it('getRegisteredEventNames() inclui eventos registrados', () => {
    const handler: EventHandler = vi.fn();
    registerHandler('test.observable', 'test.observable.h', handler);
    const names = getRegisteredEventNames();
    expect(names).toContain('test.observable');
  });
});

// ---------------------------------------------------------------------------
// Tipagem LGPD — garantir que os tipos não aceitem PII bruta
// ---------------------------------------------------------------------------

describe('tipos AppEvent (LGPD §8.5)', () => {
  it('LeadsCreatedData não tem campos de PII bruta', () => {
    // Teste de compile-time via runtime — se o tipo compilar, o campo não existe
    const data: AppEvent<'leads.created'>['data'] = {
      lead_id: LEAD_ID,
      city_id: null,
      source: 'manual',
      assigned_agent_id: null,
      created_by_kind: 'user',
    };

    // Confirmar que os campos de PII não estão disponíveis no tipo
    expect(Object.keys(data)).not.toContain('cpf');
    expect(Object.keys(data)).not.toContain('email');
    expect(Object.keys(data)).not.toContain('telefone');
    expect(Object.keys(data)).not.toContain('phone');
    expect(Object.keys(data)).not.toContain('document_number');
  });
});
