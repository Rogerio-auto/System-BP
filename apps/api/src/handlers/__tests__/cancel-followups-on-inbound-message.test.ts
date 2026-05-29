// =============================================================================
// cancel-followups-on-inbound-message.test.ts — Testes do handler F5-S04.
//
// Estratégia: injeção de db mock via parâmetro de handleInboundMessageReceived().
//   Não depende de banco real. Todos os efeitos colaterais são mockados.
//
// Chamadas db.select() no handler — ordem determinística:
//   [0] busca followup_jobs scheduled do lead
//
// Cenários cobertos:
//   1. 0 jobs (no-op): evento sem lead_id → skip sem update/emit/audit
//   2. 0 jobs (no-op): lead_id presente mas sem jobs scheduled → skip idempotente
//   3. N jobs cancelados: N jobs scheduled → todos viram cancelled + emit + audit
//   4. Evento já processado (idempotência): jobs já cancelled, 0 scheduled → no-op
//   5. Erro em transação propaga para o outbox-publisher registrar falha
// =============================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock env (DEVE ser o primeiro mock)
// ---------------------------------------------------------------------------
vi.mock('../../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    JWT_ACCESS_SECRET: 'a'.repeat(64),
    JWT_REFRESH_SECRET: 'b'.repeat(64),
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '30d',
    API_HOST: '0.0.0.0',
    API_PORT: 3333,
    API_PUBLIC_URL: 'http://localhost:3333',
    CORS_ALLOWED_ORIGINS: ['http://localhost:5173'],
    LANGGRAPH_INTERNAL_TOKEN: 'a'.repeat(33),
    LANGGRAPH_SERVICE_URL: 'http://localhost:8000',
    WHATSAPP_APP_SECRET: 'test-whatsapp-secret-at-least-16ch',
    WHATSAPP_VERIFY_TOKEN: 'test-verify-token',
  },
}));

// ---------------------------------------------------------------------------
// Mock pg (evita conexão real)
// ---------------------------------------------------------------------------
vi.mock('pg', () => {
  const MockPool = vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { Pool: MockPool, default: { Pool: MockPool } };
});

// ---------------------------------------------------------------------------
// Mock drizzle-orm (stubs de eq/and)
// ---------------------------------------------------------------------------
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ __eq: val })),
  and: vi.fn((...args: unknown[]) => ({ __and: args })),
  sql: Object.assign(
    vi.fn(() => ({})),
    { mapWith: vi.fn() },
  ),
  relations: vi.fn().mockReturnValue({}),
  asc: vi.fn().mockReturnValue({}),
  desc: vi.fn().mockReturnValue({}),
  count: vi.fn().mockReturnValue({}),
  inArray: vi.fn().mockReturnValue({}),
  isNull: vi.fn().mockReturnValue({}),
}));

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn().mockReturnValue({}),
}));

// ---------------------------------------------------------------------------
// Mock db/client (singleton — não conecta ao Postgres)
// ---------------------------------------------------------------------------
vi.mock('../../db/client.js', () => ({
  db: {},
  pool: {},
}));

// ---------------------------------------------------------------------------
// Mock emit (outbox) — captura chamadas
// ---------------------------------------------------------------------------
const mockEmit = vi.fn().mockResolvedValue('evt-uuid');
vi.mock('../../events/emit.js', () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
}));

// ---------------------------------------------------------------------------
// Mock auditLog — captura chamadas
// ---------------------------------------------------------------------------
const mockAuditLog = vi.fn().mockResolvedValue('audit-uuid');
vi.mock('../../lib/audit.js', () => ({
  auditLog: (...args: unknown[]) => mockAuditLog(...args),
}));

// ---------------------------------------------------------------------------
// Import do handler (após mocks)
// ---------------------------------------------------------------------------
import type { EventOutbox } from '../../db/schema/events.js';
import { handleInboundMessageReceived } from '../cancel-followups-on-inbound-message.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const LEAD_ID = '22222222-2222-2222-2222-222222222222';
const EVENT_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const WA_MESSAGE_ID = 'wamid.abc123';

const JOB_ID_1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const JOB_ID_2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const RULE_ID_1 = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const RULE_ID_2 = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

function makeEvent(overrides: Partial<EventOutbox> = {}): EventOutbox {
  return {
    id: EVENT_ID,
    organizationId: ORG_ID,
    eventName: 'whatsapp.message_received',
    eventVersion: 1,
    aggregateType: 'whatsapp_message',
    aggregateId: WA_MESSAGE_ID,
    payload: {
      whatsapp_message_id: WA_MESSAGE_ID,
      chatwoot_conversation_id: 42,
      lead_id: LEAD_ID,
    },
    correlationId: null,
    idempotencyKey: `whatsapp.message_received:${WA_MESSAGE_ID}`,
    attempts: 0,
    lastError: null,
    processedAt: null,
    failedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// DB mock builder
// ---------------------------------------------------------------------------

/**
 * Constrói um mock mínimo de Database para injeção em handleInboundMessageReceived.
 *
 * scheduledJobs: lista de jobs retornados pelo SELECT (simula followup_jobs scheduled).
 */
function makeMockDb(scheduledJobs: Array<{ id: string; ruleId: string }>): {
  db: unknown;
  updatedJobValues: unknown[];
} {
  const updatedJobValues: unknown[] = [];

  // db.select() → SELECT scheduled jobs
  const mockDb = {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(scheduledJobs),
      }),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((vals: unknown) => {
        updatedJobValues.push(vals);
        return {
          where: vi.fn().mockResolvedValue([]),
        };
      }),
    })),
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      // tx tem select (não chamado no handler dentro da tx), update, insert
      const txMockUpdate = vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation((vals: unknown) => {
          updatedJobValues.push(vals);
          return {
            where: vi.fn().mockResolvedValue([]),
          };
        }),
      }));

      const txMock = {
        update: txMockUpdate,
        // select não é chamado dentro da transação neste handler
        select: vi.fn(),
        insert: vi.fn(),
      };

      return fn(txMock);
    }),
  };

  return { db: mockDb, updatedJobValues };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleInboundMessageReceived', () => {
  beforeEach(() => {
    mockEmit.mockClear();
    mockAuditLog.mockClear();
  });

  // -------------------------------------------------------------------------
  // Cenário 1: evento sem lead_id → skip silencioso
  // -------------------------------------------------------------------------
  it('faz skip silencioso quando o evento não tem lead_id (mensagem não vinculada)', async () => {
    const { db, updatedJobValues } = makeMockDb([]);

    const event = makeEvent({
      payload: {
        whatsapp_message_id: WA_MESSAGE_ID,
        chatwoot_conversation_id: null,
        lead_id: null,
      },
    });

    await expect(handleInboundMessageReceived(db as never, event)).resolves.toBeUndefined();

    expect(updatedJobValues).toHaveLength(0);
    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 2: lead_id presente mas sem jobs scheduled → no-op idempotente
  // -------------------------------------------------------------------------
  it('é no-op quando não há followup_jobs scheduled para o lead (0 jobs)', async () => {
    const { db, updatedJobValues } = makeMockDb([]);

    await expect(handleInboundMessageReceived(db as never, makeEvent())).resolves.toBeUndefined();

    // Nenhum update, emit ou audit disparados
    expect(updatedJobValues).toHaveLength(0);
    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 3: N jobs scheduled → todos cancelados com emit + audit
  // -------------------------------------------------------------------------
  it('cancela N followup_jobs scheduled e emite followup.cancelled + audit por job', async () => {
    const jobs = [
      { id: JOB_ID_1, ruleId: RULE_ID_1 },
      { id: JOB_ID_2, ruleId: RULE_ID_2 },
    ];

    const { db, updatedJobValues } = makeMockDb(jobs);

    await handleInboundMessageReceived(db as never, makeEvent());

    // 1 UPDATE batch via transação
    expect(updatedJobValues).toHaveLength(1);
    const updateVals = updatedJobValues[0] as Record<string, unknown>;
    expect(updateVals['status']).toBe('cancelled');
    expect(updateVals['lastError']).toBe('customer_replied');
    expect(updateVals['updatedAt']).toBeInstanceOf(Date);

    // emit chamado 1x por job
    expect(mockEmit).toHaveBeenCalledTimes(2);

    const emitCall1 = mockEmit.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(emitCall1['eventName']).toBe('followup.cancelled');
    expect(emitCall1['aggregateId']).toBe(JOB_ID_1);
    expect(emitCall1['organizationId']).toBe(ORG_ID);
    const data1 = emitCall1['data'] as Record<string, unknown>;
    expect(data1['followup_job_id']).toBe(JOB_ID_1);
    expect(data1['lead_id']).toBe(LEAD_ID);
    expect(data1['rule_id']).toBe(RULE_ID_1);
    // idempotencyKey deve conter job_id + event_id (determinística)
    expect(emitCall1['idempotencyKey'] as string).toContain(JOB_ID_1);
    expect(emitCall1['idempotencyKey'] as string).toContain(EVENT_ID);

    const emitCall2 = mockEmit.mock.calls[1]?.[1] as Record<string, unknown>;
    expect(emitCall2['aggregateId']).toBe(JOB_ID_2);
    const data2 = emitCall2['data'] as Record<string, unknown>;
    expect(data2['followup_job_id']).toBe(JOB_ID_2);

    // auditLog chamado 1x por job
    expect(mockAuditLog).toHaveBeenCalledTimes(2);

    const auditCall1 = mockAuditLog.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(auditCall1['action']).toBe('followup_cancelled_on_reply');
    expect(auditCall1['actor']).toBeNull();
    expect(auditCall1['correlationId']).toBe(EVENT_ID);
    const auditResource1 = auditCall1['resource'] as Record<string, unknown>;
    expect(auditResource1['type']).toBe('followup_job');
    expect(auditResource1['id']).toBe(JOB_ID_1);
    const auditAfter1 = auditCall1['after'] as Record<string, unknown>;
    expect(auditAfter1['reason']).toBe('customer_replied');
    // LGPD §8.5: sem conteúdo da mensagem no after
    expect(auditAfter1).not.toHaveProperty('message_content');
    expect(auditAfter1).not.toHaveProperty('text');
  });

  // -------------------------------------------------------------------------
  // Cenário 4: idempotência — evento já processado, jobs já cancelled (0 scheduled)
  // -------------------------------------------------------------------------
  it('é no-op idempotente quando o evento é processado pela 2a vez (jobs já cancelled)', async () => {
    // Simula que os jobs foram cancelados na primeira execução:
    // SELECT retorna 0 scheduled (já estão como 'cancelled')
    const { db, updatedJobValues } = makeMockDb([]);

    await handleInboundMessageReceived(db as never, makeEvent());

    expect(updatedJobValues).toHaveLength(0);
    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 5: erro em transação propaga para outbox-publisher registrar falha
  // -------------------------------------------------------------------------
  it('propaga erro de transação para que o outbox-publisher registre a falha', async () => {
    const jobs = [{ id: JOB_ID_1, ruleId: RULE_ID_1 }];
    const { db } = makeMockDb(jobs);

    // Substituir transaction mock para simular falha
    (db as Record<string, unknown>)['transaction'] = vi
      .fn()
      .mockRejectedValue(new Error('DB error simulado'));

    await expect(handleInboundMessageReceived(db as never, makeEvent())).rejects.toThrow(
      'DB error simulado',
    );
  });
});
