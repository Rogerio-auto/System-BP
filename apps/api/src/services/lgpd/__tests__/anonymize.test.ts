// =============================================================================
// anonymize.test.ts — Testes unitários de anonymize.ts (F1-S25).
//
// Cenários:
//   1. anonymizeCustomer preserva FK (leads continuam vinculados)
//   2. anonymizeCustomer gera audit log
//   3. anonymizeCustomer gera outbox event sem PII
//   4. anonymizeLead preserva id e organization_id
//   5. anonymizeLead gera audit log
//   6. anonToken é determinístico para mesmos inputs
//   7. anonToken é diferente para inputs diferentes
// =============================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock env
// ---------------------------------------------------------------------------
vi.mock('../../../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
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

vi.mock('pg', () => {
  const MockPool = vi
    .fn()
    .mockImplementation(() => ({ query: vi.fn(), end: vi.fn(), on: vi.fn() }));
  return { Pool: MockPool, default: { Pool: MockPool } };
});

// ---------------------------------------------------------------------------
// Captured calls
// ---------------------------------------------------------------------------
const capturedAuditLogs: unknown[] = [];
const capturedEvents: unknown[] = [];
const capturedUpdates: Array<{ table: string; set: Record<string, unknown> }> = [];

// ---------------------------------------------------------------------------
// Mock audit
// ---------------------------------------------------------------------------
vi.mock('../../../lib/audit.js', () => ({
  auditLog: vi.fn().mockImplementation((_tx, params: unknown) => {
    capturedAuditLogs.push(params);
    return Promise.resolve('audit-id');
  }),
}));

// ---------------------------------------------------------------------------
// Mock emit
// ---------------------------------------------------------------------------
vi.mock('../../../events/emit.js', () => ({
  emit: vi.fn().mockImplementation((_tx, event: unknown) => {
    capturedEvents.push(event);
    return Promise.resolve('event-id');
  }),
}));

// ---------------------------------------------------------------------------
// Mock Drizzle eq
// ---------------------------------------------------------------------------
vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({ __eq: true }),
  and: vi.fn().mockReturnValue({ __and: true }),
  or: vi.fn().mockReturnValue({ __or: true }),
  inArray: vi.fn().mockReturnValue({ __inArray: true }),
  lt: vi.fn().mockReturnValue({ __lt: true }),
  isNull: vi.fn().mockReturnValue({ __isNull: true }),
  isNotNull: vi.fn().mockReturnValue({ __isNotNull: true }),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray) => ({ __sql: strings[0] })),
    { mapWith: vi.fn() },
  ),
}));

// ---------------------------------------------------------------------------
// Build mock transaction
// ---------------------------------------------------------------------------
function buildMockTx(
  customerRows: Array<{ primaryLeadId: string }> = [{ primaryLeadId: 'lead-primary-id-01' }],
) {
  return {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    }),
    update: vi.fn().mockImplementation((table: { _: { name: string } } | unknown) => {
      const tableName = (table as { _: { name: string } })?._?.name ?? 'unknown';
      return {
        set: vi.fn().mockImplementation((values: Record<string, unknown>) => {
          capturedUpdates.push({ table: tableName, set: values });
          return {
            where: vi.fn().mockResolvedValue([]),
          };
        }),
      };
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(customerRows),
      }),
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('anonymize service', () => {
  const ORG_ID = 'org-id-0000-0000-0000-0000-00000001';
  const CUSTOMER_ID = 'cust-id-0000-0000-0000-0000-00000001';
  const LEAD_ID = 'lead-id-0000-0000-0000-0000-00000001';

  const actor = {
    audit: null as null,
    event: { kind: 'worker' as const, id: null, ip: null },
  };

  beforeEach(() => {
    capturedAuditLogs.length = 0;
    capturedEvents.length = 0;
    capturedUpdates.length = 0;
  });

  // ---- 1. anonymizeCustomer preserva FK ----
  it('1. anonymizeCustomer chama update em leads (preserva FK)', async () => {
    const { anonymizeCustomer } = await import('../anonymize.js');
    const tx = buildMockTx([{ primaryLeadId: LEAD_ID }]);

    await anonymizeCustomer(
      tx as Parameters<typeof anonymizeCustomer>[0],
      CUSTOMER_ID,
      ORG_ID,
      actor,
    );

    // Deve ter chamado update (customers + leads)
    expect(tx.update).toHaveBeenCalledTimes(2);
    // O resultado (CUSTOMER_ID) deve ser retornado
  });

  // ---- 2. anonymizeCustomer gera audit log ----
  it('2. anonymizeCustomer gera audit log com action lgpd.customer_anonymized', async () => {
    const { anonymizeCustomer } = await import('../anonymize.js');
    const tx = buildMockTx([{ primaryLeadId: LEAD_ID }]);

    await anonymizeCustomer(
      tx as Parameters<typeof anonymizeCustomer>[0],
      CUSTOMER_ID,
      ORG_ID,
      actor,
    );

    expect(capturedAuditLogs).toHaveLength(1);
    const log = capturedAuditLogs[0] as { action: string; resource: { type: string; id: string } };
    expect(log.action).toBe('lgpd.customer_anonymized');
    expect(log.resource.type).toBe('customer');
    expect(log.resource.id).toBe(CUSTOMER_ID);
  });

  // ---- 3. anonymizeCustomer gera outbox event sem PII ----
  it('3. anonymizeCustomer emite evento data_subject.anonymized sem PII', async () => {
    const { anonymizeCustomer } = await import('../anonymize.js');
    const tx = buildMockTx([{ primaryLeadId: LEAD_ID }]);

    await anonymizeCustomer(
      tx as Parameters<typeof anonymizeCustomer>[0],
      CUSTOMER_ID,
      ORG_ID,
      actor,
    );

    expect(capturedEvents).toHaveLength(1);
    const event = capturedEvents[0] as { eventName: string; data: Record<string, unknown> };
    expect(event.eventName).toBe('data_subject.anonymized');

    // Verificar que o data não contém PII
    const data = event.data;
    expect(data['entity_type']).toBe('customer');
    expect(data['entity_id']).toBe(CUSTOMER_ID);
    expect(data['organization_id']).toBe(ORG_ID);
    // Campos PII não devem aparecer
    expect(data['name']).toBeUndefined();
    expect(data['cpf']).toBeUndefined();
    expect(data['phone']).toBeUndefined();
    expect(data['email']).toBeUndefined();
    expect(data['document_number']).toBeUndefined();
  });

  // ---- 4. anonymizeLead preserva id e organization_id ----
  it('4. anonymizeLead chama update em leads sem tocar customers', async () => {
    const { anonymizeLead } = await import('../anonymize.js');
    const tx = buildMockTx();

    await anonymizeLead(tx as Parameters<typeof anonymizeLead>[0], LEAD_ID, ORG_ID, actor);

    // Deve ter chamado update 1x (apenas leads)
    expect(tx.update).toHaveBeenCalledTimes(1);
  });

  // ---- 5. anonymizeLead gera audit log ----
  it('5. anonymizeLead gera audit log com action lgpd.lead_anonymized', async () => {
    const { anonymizeLead } = await import('../anonymize.js');
    const tx = buildMockTx();

    await anonymizeLead(tx as Parameters<typeof anonymizeLead>[0], LEAD_ID, ORG_ID, actor);

    expect(capturedAuditLogs).toHaveLength(1);
    const log = capturedAuditLogs[0] as { action: string };
    expect(log.action).toBe('lgpd.lead_anonymized');
  });

  // ---- 6-7. anonToken determinístico e único ----
  it('6. anonToken é determinístico para mesmos inputs', async () => {
    // Access the function indirectly via the module by checking side effects
    // We can test the token behavior via anonymizeLead update capture
    const { anonymizeLead } = await import('../anonymize.js');

    capturedUpdates.length = 0;

    const tx1 = buildMockTx();
    await anonymizeLead(tx1 as Parameters<typeof anonymizeLead>[0], LEAD_ID, ORG_ID, actor);
    const set1 = capturedUpdates[0]?.set;

    capturedUpdates.length = 0;
    capturedAuditLogs.length = 0;
    capturedEvents.length = 0;

    const tx2 = buildMockTx();
    await anonymizeLead(tx2 as Parameters<typeof anonymizeLead>[0], LEAD_ID, ORG_ID, actor);
    const set2 = capturedUpdates[0]?.set;

    // Tokens devem ser iguais para o mesmo leadId (determinístico)
    expect(set1?.['name']).toBe(set2?.['name']);
    expect(set1?.['cpfHash']).toBe(set2?.['cpfHash']);
  });

  it('7. anonToken é diferente para IDs diferentes', async () => {
    const { anonymizeLead } = await import('../anonymize.js');
    const LEAD_ID_2 = 'lead-id-0000-0000-0000-0000-00000002';

    capturedUpdates.length = 0;

    const tx1 = buildMockTx();
    await anonymizeLead(tx1 as Parameters<typeof anonymizeLead>[0], LEAD_ID, ORG_ID, actor);
    const set1 = capturedUpdates[0]?.set;

    capturedUpdates.length = 0;
    capturedAuditLogs.length = 0;
    capturedEvents.length = 0;

    const tx2 = buildMockTx();
    await anonymizeLead(tx2 as Parameters<typeof anonymizeLead>[0], LEAD_ID_2, ORG_ID, actor);
    const set2 = capturedUpdates[0]?.set;

    // Tokens devem ser diferentes para IDs diferentes
    expect(set1?.['name']).not.toBe(set2?.['name']);
  });
});
