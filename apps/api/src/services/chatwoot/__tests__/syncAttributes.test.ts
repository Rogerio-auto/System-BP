// =============================================================================
// syncAttributes.test.ts — Testes do handler Chatwoot sync (F1-S22).
//
// Estratégia: mocks de ChatwootClient, db (Drizzle), pino.
//
// Casos testados:
//   1. leads.created → updateAttributes chamado com payload correto.
//   2. kanban.stage_updated → updateAttributes chamado com payload correto.
//   3. simulations.generated → stub: loga warn + retorna sem chamar Chatwoot.
//   4. Sem mapeamento conversation_id → loga warn + retorna sem retry.
//   5. 5xx do Chatwoot 4x → retry, na 5ª tentativa falha → lança erro.
//   6. 4xx do Chatwoot → sem retry, lança imediatamente.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock pg (prevent real DB connections)
// ---------------------------------------------------------------------------
vi.mock('pg', () => {
  const mockPool = vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn().mockResolvedValue({ query: vi.fn(), release: vi.fn() }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { default: { Pool: mockPool }, Pool: mockPool };
});

// ---------------------------------------------------------------------------
// Mock db client
// ---------------------------------------------------------------------------
const selectMock = vi.fn();
vi.mock('../../../db/client.js', () => ({
  db: {
    select: selectMock,
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock ChatwootClient
// ---------------------------------------------------------------------------
const mockUpdateAttributes = vi.fn();

vi.mock('../../../integrations/chatwoot/client.js', () => ({
  ChatwootClient: vi.fn().mockImplementation(() => ({
    updateAttributes: mockUpdateAttributes,
  })),
}));

// ---------------------------------------------------------------------------
// Mock pino (silence logs in tests)
// ---------------------------------------------------------------------------
vi.mock('pino', () => ({
  default: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  eventName: string,
  data: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: 'event-uuid-test-0001',
    organizationId: 'org-uuid-test-0001',
    eventName,
    eventVersion: 1,
    aggregateType: 'lead',
    aggregateId: 'lead-uuid-test-0001',
    payload: {
      event_id: 'event-uuid-test-0001',
      event_name: eventName,
      event_version: 1,
      occurred_at: new Date().toISOString(),
      actor: { kind: 'user', id: 'user-uuid-0001', ip: null },
      correlation_id: null,
      aggregate: { type: 'lead', id: 'lead-uuid-test-0001' },
      data,
    },
    correlationId: null,
    idempotencyKey: `${eventName}:lead-uuid-test-0001`,
    attempts: 0,
    lastError: null,
    processedAt: null,
    failedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

/**
 * Setup mock para resolveConversationId retornar um conversation_id válido.
 */
function mockConversationFound(externalRef = '42') {
  selectMock.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([{ externalRef }]),
      }),
    }),
  });
}

/**
 * Setup mock para resolveConversationId não encontrar mapeamento.
 */
function mockConversationNotFound() {
  selectMock.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('syncAttributes handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. leads.created → updateAttributes chamado com payload correto
  // -------------------------------------------------------------------------
  it('leads.created → calls updateAttributes with lead_id, lead_status, lead_source', async () => {
    mockConversationFound('42');
    mockUpdateAttributes.mockResolvedValue({ id: 42, custom_attributes: {} });

    const { handleEvent } = await import('../syncAttributes.js');

    const event = makeEvent('leads.created', {
      lead_id: 'lead-uuid-test-0001',
      city_id: 'city-uuid-test-0001',
      source: 'whatsapp',
      assigned_agent_id: null,
      created_by_kind: 'user',
    });

    await expect(handleEvent(event)).resolves.toBeUndefined();

    expect(mockUpdateAttributes).toHaveBeenCalledOnce();
    expect(mockUpdateAttributes).toHaveBeenCalledWith(42, {
      lead_id: 'lead-uuid-test-0001',
      lead_status: 'new',
      lead_source: 'whatsapp',
    });
  });

  // -------------------------------------------------------------------------
  // 2. kanban.stage_updated → updateAttributes chamado com kanban_stage correto
  // -------------------------------------------------------------------------
  it('kanban.stage_updated → calls updateAttributes with kanban_stage', async () => {
    mockConversationFound('99');
    mockUpdateAttributes.mockResolvedValue({ id: 99, custom_attributes: {} });

    const { handleEvent } = await import('../syncAttributes.js');

    const event = makeEvent('kanban.stage_updated', {
      card_id: 'card-uuid-test-0001',
      lead_id: 'lead-uuid-test-0001',
      from_stage: 'new',
      to_stage: 'qualifying',
      from_status: 'normal',
      to_status: 'normal',
      reason: null,
    });

    await expect(handleEvent(event)).resolves.toBeUndefined();

    expect(mockUpdateAttributes).toHaveBeenCalledOnce();
    expect(mockUpdateAttributes).toHaveBeenCalledWith(99, {
      kanban_stage: 'qualifying',
    });
  });

  // -------------------------------------------------------------------------
  // 3. simulations.generated → stub: retorna sem chamar Chatwoot
  // -------------------------------------------------------------------------
  it('simulations.generated → does not call updateAttributes (stub)', async () => {
    // Não deve fazer lookup de conversation nem chamar Chatwoot
    const { handleEvent } = await import('../syncAttributes.js');

    const event = makeEvent('simulations.generated', {
      simulation_id: 'sim-uuid-test-0001',
      lead_id: 'lead-uuid-test-0001',
      product_id: 'prod-uuid-test-0001',
      rule_version_id: 'rule-uuid-test-0001',
      amount: 10000,
      term_months: 12,
      monthly_payment: 900,
      origin: 'ai',
    });

    await expect(handleEvent(event)).resolves.toBeUndefined();

    expect(mockUpdateAttributes).not.toHaveBeenCalled();
    // selectMock should not have been called (no conversation lookup for stub)
    expect(selectMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 4. Sem mapeamento conversation_id → no-op (sem retry)
  // -------------------------------------------------------------------------
  it('leads.created with no conversation mapping → no-op (no Chatwoot call)', async () => {
    mockConversationNotFound();

    const { handleEvent } = await import('../syncAttributes.js');

    const event = makeEvent('leads.created', {
      lead_id: 'lead-uuid-test-0001',
      city_id: null,
      source: 'manual',
      assigned_agent_id: null,
      created_by_kind: 'user',
    });

    await expect(handleEvent(event)).resolves.toBeUndefined();

    expect(mockUpdateAttributes).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 5. 5xx do Chatwoot 4x → retry; 5ª falha → lança erro
  // Usa sleepFn com delay zero para evitar backoff real (1s/2s/4s/8s/16s...).
  // -------------------------------------------------------------------------
  it('5xx Chatwoot 4x then 5th failure → throws after exhausting retries', async () => {
    mockConversationFound('10');

    const { ChatwootApiError } = await import('../../../shared/errors.js');
    const fiveHundredError = new ChatwootApiError(503, 'Service Unavailable');

    // 5 falhas consecutivas = MAX_RETRY_ATTEMPTS
    mockUpdateAttributes.mockRejectedValue(fiveHundredError);

    const { handleEvent } = await import('../syncAttributes.js');

    const event = makeEvent('leads.created', {
      lead_id: 'lead-uuid-test-0001',
      city_id: null,
      source: 'whatsapp',
      assigned_agent_id: null,
      created_by_kind: 'user',
    });

    // Injetar sleepFn com delay zero para pular backoff real
    const noopSleep = (): Promise<void> => Promise.resolve();

    await expect(handleEvent(event, noopSleep)).rejects.toBeInstanceOf(ChatwootApiError);

    // Deve ter tentado 5 vezes (MAX_RETRY_ATTEMPTS)
    expect(mockUpdateAttributes).toHaveBeenCalledTimes(5);
  });

  // -------------------------------------------------------------------------
  // 6. 4xx do Chatwoot → sem retry, lança imediatamente
  // -------------------------------------------------------------------------
  it('4xx Chatwoot → throws immediately without retrying', async () => {
    mockConversationFound('10');

    const { ChatwootApiError } = await import('../../../shared/errors.js');
    const notFoundError = new ChatwootApiError(404, 'Conversation not found');

    mockUpdateAttributes.mockRejectedValue(notFoundError);

    const { handleEvent } = await import('../syncAttributes.js');

    const event = makeEvent('leads.created', {
      lead_id: 'lead-uuid-test-0001',
      city_id: null,
      source: 'whatsapp',
      assigned_agent_id: null,
      created_by_kind: 'user',
    });

    await expect(handleEvent(event)).rejects.toBeInstanceOf(ChatwootApiError);

    // Deve ter tentado apenas 1 vez (sem retry em 4xx)
    expect(mockUpdateAttributes).toHaveBeenCalledTimes(1);
  });
});
