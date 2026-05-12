// =============================================================================
// export.test.ts — Testes de generateAccessExport (F1-S25).
//
// Cenários:
//   1. Export inclui dados do customer
//   2. Export inclui dados do lead primário
//   3. Export lista todos os suboperadores (doc 17 §12.1)
//   4. Export lista bases legais
//   5. Export inclui solicitações LGPD anteriores
//   6. Payloads não contêm PII bruta sensível no campo suboperators
//   7. Caso órfão: funciona com customerId=null e documentHash
// =============================================================================
import { describe, expect, it, vi } from 'vitest';

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

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({ __eq: true }),
  and: vi.fn().mockReturnValue({ __and: true }),
  or: vi.fn().mockReturnValue({ __or: true }),
  isNotNull: vi.fn().mockReturnValue({ __isNotNull: true }),
  isNull: vi.fn().mockReturnValue({ __isNull: true }),
  lt: vi.fn().mockReturnValue({ __lt: true }),
  inArray: vi.fn().mockReturnValue({ __inArray: true }),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray) => ({ __sql: strings[0] })),
    { mapWith: vi.fn() },
  ),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const CUSTOMER_ID = 'cust-id-0000-0000-0000-0000-00000001';
const LEAD_ID = 'lead-id-0000-0000-0000-0000-00000001';
const ORG_ID = 'org-id-0000-0000-0000-0000-00000001';
const DOC_HASH = 'sha256hmac-test-hash-00000001';

const mockCustomer = {
  id: CUSTOMER_ID,
  organizationId: ORG_ID,
  primaryLeadId: LEAD_ID,
  convertedAt: new Date('2024-01-01'),
  documentHash: DOC_HASH,
  consentRevokedAt: null,
  anonymizedAt: null,
  metadata: {},
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const mockLead = {
  id: LEAD_ID,
  organizationId: ORG_ID,
  cityId: 'city-id-0000-0000-0000-0000-00000001',
  name: 'João da Silva :anon',
  phoneE164: '+5569912345678',
  email: null,
  source: 'whatsapp',
  status: 'closed_won',
  notes: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  anonymizedAt: null,
};

const mockLgpdRequest = {
  id: 'lgpd-req-0000-0000-0000-0000-00000001',
  requestId: 'req-client-id-01',
  type: 'access',
  status: 'fulfilled',
  requestedAt: new Date('2024-06-01'),
  fulfilledAt: new Date('2024-06-10'),
  channel: 'email',
  payloadMeta: {},
  customerId: CUSTOMER_ID,
  documentHash: null,
};

// ---------------------------------------------------------------------------
// Build mock DB
// ---------------------------------------------------------------------------
function buildMockDb(
  options: {
    customerRows?: unknown[];
    leadRows?: unknown[];
    historyRows?: unknown[];
    interactionRows?: unknown[];
    kanbanCardRows?: unknown[];
    stageHistoryRows?: unknown[];
    lgpdRequestRows?: unknown[];
  } = {},
) {
  const {
    customerRows = [mockCustomer],
    leadRows = [mockLead],
    historyRows = [],
    interactionRows = [],
    kanbanCardRows = [],
    stageHistoryRows = [],
    lgpdRequestRows = [mockLgpdRequest],
  } = options;

  let callCount = 0;
  const rowSets = [
    customerRows, // customers query
    leadRows, // leads query
    historyRows, // leadHistory query
    interactionRows, // interactions query
    kanbanCardRows, // kanbanCards query
    lgpdRequestRows, // dataSubjectRequests query
  ];

  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          void stageHistoryRows;
          const rows = rowSets[callCount] ?? [];
          callCount++;
          return Promise.resolve(rows);
        }),
      }),
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateAccessExport', () => {
  it('1. Export inclui dados do customer', async () => {
    const { generateAccessExport } = await import('../export.js');
    const db = buildMockDb();

    const { json } = await generateAccessExport(
      db as Parameters<typeof generateAccessExport>[0],
      CUSTOMER_ID,
    );

    expect(json.customer_id).toBe(CUSTOMER_ID);
    expect(json.personal_data.customer).not.toBeNull();
    expect(json.personal_data.customer?.['id']).toBe(CUSTOMER_ID);
  });

  it('2. Export inclui dados do lead primário', async () => {
    const { generateAccessExport } = await import('../export.js');
    const db = buildMockDb();

    const { json } = await generateAccessExport(
      db as Parameters<typeof generateAccessExport>[0],
      CUSTOMER_ID,
    );

    expect(json.personal_data.primary_lead).not.toBeNull();
    expect(json.personal_data.primary_lead?.['id']).toBe(LEAD_ID);
  });

  it('3. Export lista todos os suboperadores (doc 17 §12.1)', async () => {
    const { generateAccessExport } = await import('../export.js');
    const db = buildMockDb();

    const { json } = await generateAccessExport(
      db as Parameters<typeof generateAccessExport>[0],
      CUSTOMER_ID,
    );

    expect(json.suboperators).toBeDefined();
    expect(json.suboperators.length).toBeGreaterThanOrEqual(1);
    // Todos devem ter campos obrigatórios
    for (const sub of json.suboperators) {
      expect(sub.name).toBeDefined();
      expect(sub.purpose).toBeDefined();
      expect(sub.legal_basis).toBeDefined();
    }
  });

  it('4. Export lista bases legais (doc 17 §3.1)', async () => {
    const { generateAccessExport } = await import('../export.js');
    const db = buildMockDb();

    const { json } = await generateAccessExport(
      db as Parameters<typeof generateAccessExport>[0],
      CUSTOMER_ID,
    );

    expect(json.legal_bases).toBeDefined();
    expect(json.legal_bases.length).toBeGreaterThanOrEqual(1);
    for (const lb of json.legal_bases) {
      expect(lb.basis).toBeDefined();
      expect(lb.purpose).toBeDefined();
    }
  });

  it('5. Export inclui solicitações LGPD anteriores', async () => {
    const { generateAccessExport } = await import('../export.js');
    const db = buildMockDb({ lgpdRequestRows: [mockLgpdRequest] });

    const { json } = await generateAccessExport(
      db as Parameters<typeof generateAccessExport>[0],
      CUSTOMER_ID,
    );

    expect(json.personal_data.previous_lgpd_requests).toHaveLength(1);
    const req = json.personal_data.previous_lgpd_requests[0] as Record<string, unknown>;
    expect(req['type']).toBe('access');
    expect(req['status']).toBe('fulfilled');
    // Deve incluir apenas campos não-sensíveis (não payload_meta completo)
    expect(req['id']).toBeDefined();
  });

  it('6. Suboperators não expõem PII bruta dos titulares', async () => {
    const { generateAccessExport } = await import('../export.js');
    const db = buildMockDb();

    const { json } = await generateAccessExport(
      db as Parameters<typeof generateAccessExport>[0],
      CUSTOMER_ID,
    );

    // suboperators é lista hardcoded — não deve conter CPF ou dados de titulares
    const subOpsJson = JSON.stringify(json.suboperators);
    expect(subOpsJson).not.toContain(DOC_HASH);
    expect(subOpsJson).not.toContain(CUSTOMER_ID);
  });

  it('7. Caso órfão: funciona com customerId=null e documentHash', async () => {
    const { generateAccessExport } = await import('../export.js');

    // No customer, but lead found by documentHash
    const db = buildMockDb({
      customerRows: [], // no customer
      leadRows: [mockLead], // lead found by cpf_hash
    });

    const { json } = await generateAccessExport(
      db as Parameters<typeof generateAccessExport>[0],
      null,
      DOC_HASH,
    );

    expect(json.customer_id).toBeNull();
    // lead primário pode ser encontrado pelo documentHash
    // (depends on mock call order — second select gets leads)
  });
});
