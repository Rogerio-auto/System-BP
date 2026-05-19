// =============================================================================
// internal/leads/__tests__/routes.test.ts — Testes de integração F3-S04 + F3-S12.
//
// Estratégia: sobe Fastify com internalLeadsRoutes (default export via autoload),
// mocka db e serviços/repositórios para controlar respostas sem conectar em banco real.
//
// Caminhos de referência (relativos a __tests__/):
//   ../routes.js              = src/modules/internal/leads/routes.ts
//   ../../../leads/service.js = src/modules/leads/service.ts
//   ../../../leads/repository.js = src/modules/leads/repository.ts
//   ../../../../config/env.js = src/config/env.ts
//   ../../../../db/client.js  = src/db/client.ts
//   ../../../../shared/errors.js = src/shared/errors.ts
//   ../../../db/schema/index.js = src/db/schema/index.ts
//   ../../../events/emit.js  = src/events/emit.ts
//   ../../../lib/audit.js    = src/lib/audit.ts
//
// Cobre (F3-S04 — POST /internal/leads/get-or-create):
//   1.  → 200 caminho feliz (lead existente)
//   2.  → 200 caminho feliz (lead criado)
//   3.  → 401 sem X-Internal-Token
//   4.  → 401 com token errado
//   5.  → 400 body inválido (sem phone)
//   6.  → 400 body inválido (phone não E.164)
//   7.  → 400 body inválido (sem organization_id)
//   8.  → 400 body inválido (organization_id não-UUID)
//   9.  → 400 body inválido (source inválido)
//   10. → 422 INVALID_PHONE (serviço)
//   11. → 409 LEAD_MERGE_REQUIRED (serviço)
//   12. → 429 rate limit (>60 req/min)
//   13. → getOrCreateLead chamado 1 vez (sem double-call)
//   14. → campos opcionais aceitos (name, city_id, etc.)
//
// Cobre (F3-S12 — PATCH /internal/leads/:id):
//   15. → 200 caminho feliz (atualiza name e city_id)
//   16. → 200 requested_amount e requested_term_months gravados em metadata
//   17. → 200 idempotente quando nenhum campo muda (não abre transação)
//   18. → 401 sem X-Internal-Token
//   19. → 401 com token errado
//   20. → 404 lead inexistente
//   21. → 422 campo não permitido no body (strict schema)
//   22. → 400 id não-UUID no path
//   23. → 400 organization_id ausente no body
//   24. → emit leads.updated chamado com actor kind=system
//   25. → auditLog chamado com actor=null (ação de IA)
//   26. → lead_history insert chamado com action=profile_updated_by_ai
// =============================================================================
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock pg (previne tentativa de conectar em banco real)
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

// ---------------------------------------------------------------------------
// vi.hoisted() — cria mocks antes do hoisting de vi.mock().
//
// vi.mock() é hoisted (movido para o topo do arquivo pelo Vitest). Variáveis
// declaradas com const/let no escopo do módulo ficam indefinidas no momento
// em que a factory do vi.mock() executa. vi.hoisted() resolve isso criando
// os mocks no contexto correto antes do hoisting.
// ---------------------------------------------------------------------------
const { mockFindLeadById, mockUpdateLead, mockEmit, mockAuditLog, mockTx, mockDb } = vi.hoisted(
  () => {
    // tx mockado: implementa as operações que a rota executa diretamente no tx.
    //   - insert(leadHistory).values(...)  → lead_history row
    //   - select(...).from(...).innerJoin(...).where(...).limit(1) → kanban stage
    const mockTxInsertValues = vi.fn().mockResolvedValue(undefined);
    const mockTxInsert = vi.fn().mockReturnValue({ values: mockTxInsertValues });

    const mockTxSelectLimit = vi.fn().mockResolvedValue([{ stageName: 'Pré-atendimento' }]);
    const mockTxSelectWhere = vi.fn().mockReturnValue({ limit: mockTxSelectLimit });
    const mockTxSelectInnerJoin = vi.fn().mockReturnValue({ where: mockTxSelectWhere });
    const mockTxSelectFrom = vi
      .fn()
      .mockReturnValue({ innerJoin: mockTxSelectInnerJoin, where: mockTxSelectWhere });
    const mockTxSelect = vi.fn().mockReturnValue({ from: mockTxSelectFrom });

    const mockTx = {
      insert: mockTxInsert,
      select: mockTxSelect,
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
        }),
      }),
    };

    // db mockado: transaction() invoca o callback com mockTx.
    const mockDb = {
      transaction: vi
        .fn()
        .mockImplementation((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)),
      select: mockTxSelect,
    };

    return {
      mockFindLeadById: vi.fn(),
      mockUpdateLead: vi.fn(),
      mockEmit: vi.fn().mockResolvedValue('evt-uuid'),
      mockAuditLog: vi.fn().mockResolvedValue('audit-uuid'),
      mockTx,
      mockDb,
    };
  },
);

// ---------------------------------------------------------------------------
// Mock leads/repository — findLeadById e updateLead para o PATCH endpoint.
// Caminho relativo a __tests__/: ../../../leads/repository.js = src/modules/leads/repository.ts.
// ---------------------------------------------------------------------------
vi.mock('../../../leads/repository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    findLeadById: (...args: unknown[]) => mockFindLeadById(...args),
    updateLead: (...args: unknown[]) => mockUpdateLead(...args),
  };
});

// ---------------------------------------------------------------------------
// Mock db/schema/index — exporta objetos simbólicos para satisfazer o import.
// Não precisamos de valores reais pois Drizzle não é chamado em testes.
// Caminho relativo a __tests__/: ../../../../db/schema/index.js = src/db/schema/index.ts.
// ---------------------------------------------------------------------------
vi.mock('../../../../db/schema/index.js', () => ({
  leadHistory: { name: 'lead_history' },
  kanbanCards: { name: 'kanban_cards' },
  kanbanStages: { name: 'kanban_stages' },
  // Mantém re-exports dos outros schemas que possam ser usados indiretamente.
}));

// ---------------------------------------------------------------------------
// Mock events/emit — previne inserção em event_outbox sem banco real.
// Caminho relativo a __tests__/: ../../../../events/emit.js = src/events/emit.ts.
// ---------------------------------------------------------------------------
vi.mock('../../../../events/emit.js', () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
}));

// ---------------------------------------------------------------------------
// Mock lib/audit — previne inserção em audit_logs sem banco real.
// Caminho relativo a __tests__/: ../../../../lib/audit.js = src/lib/audit.ts.
// ---------------------------------------------------------------------------
vi.mock('../../../../lib/audit.js', () => ({
  auditLog: (...args: unknown[]) => mockAuditLog(...args),
}));

// ---------------------------------------------------------------------------
// Mock env — provê LANGGRAPH_INTERNAL_TOKEN controlável.
// Caminho relativo a __tests__/: ../../../../config/env.js = src/config/env.ts.
// ---------------------------------------------------------------------------
const VALID_TOKEN = 'valid-internal-token-32-chars-minimum-x';

vi.mock('../../../../config/env.js', () => ({
  env: {
    LANGGRAPH_INTERNAL_TOKEN: VALID_TOKEN,
    LOG_LEVEL: 'silent',
    NODE_ENV: 'test',
  },
}));

// ---------------------------------------------------------------------------
// Mock db/client — usa mockDb criado via vi.hoisted() acima.
//
// Caminho relativo a __tests__/: ../../../../db/client.js = src/db/client.ts.
// ---------------------------------------------------------------------------
vi.mock('../../../../db/client.js', () => ({
  db: mockDb,
  pool: { end: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mock getOrCreateLead service.
// Caminho relativo a __tests__/: ../../../leads/service.js = src/modules/leads/service.ts.
// ---------------------------------------------------------------------------
const mockGetOrCreateLead = vi.fn();

vi.mock('../../../leads/service.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getOrCreateLead: (...args: unknown[]) => mockGetOrCreateLead(...args),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_LEAD_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const FIXTURE_CITY_ID = 'cccccccc-0000-0000-0000-000000000001';

const VALID_BODY = {
  organization_id: FIXTURE_ORG_ID,
  phone: '+5569999999999',
  source: 'whatsapp',
};

function makeLeadResult(overrides: Record<string, unknown> = {}) {
  return {
    lead_id: FIXTURE_LEAD_ID,
    customer_id: null,
    created: false,
    current_stage: 'Pré-atendimento',
    city_id: FIXTURE_CITY_ID,
    assigned_agent_id: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Build test app
//
// Registra internalLeadsRoutes com prefix /internal/leads para simular o
// comportamento do autoload + prefix '/internal' do app.ts.
// ---------------------------------------------------------------------------

async function buildTestApp(): Promise<FastifyInstance> {
  const [
    { default: Fastify },
    { serializerCompiler, validatorCompiler },
    { default: internalLeadsRoutes },
    { isAppError },
    rateLimitModule,
  ] = await Promise.all([
    import('fastify'),
    import('fastify-type-provider-zod'),
    // Default export — padrão exigido pelo @fastify/autoload (F3-S04).
    import('../routes.js'),
    // Caminho relativo a __tests__/: ../../../../shared/errors.js = src/shared/errors.ts
    import('../../../../shared/errors.js'),
    import('@fastify/rate-limit'),
  ]);

  const app = Fastify({ logger: false }).withTypeProvider();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Rate limit plugin necessário para o config.rateLimit da rota funcionar.
  // `as` justificado: ESM default export de CJS pode vir como .default ou como módulo
  // dependendo do runtime — cast para função de registro Fastify é seguro aqui.
  await app.register(rateLimitModule.default as Parameters<typeof app.register>[0], {
    max: 100,
    timeWindow: '1 minute',
  });

  app.setErrorHandler(
    // `as` justificado: tipos de error/request/reply são any em setErrorHandler no Fastify 5
    // quando não há TypeProvider — padrão adotado em todos os testes de integração do projeto.
    (
      error: Error & { validation?: unknown; statusCode?: number },
      _request: unknown,
      reply: { status: (n: number) => { send: (b: unknown) => void } },
    ) => {
      if (isAppError(error)) {
        const body: Record<string, unknown> = {
          error: error.code,
          message: error.message,
        };
        if (error.details !== undefined) body['details'] = error.details;
        return reply.status(error.statusCode).send(body);
      }
      if (error.validation !== undefined) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: error.validation,
        });
      }
      // rate-limit retorna erro com statusCode 429
      if (error.statusCode === 429) {
        return reply.status(429).send({
          error: 'RATE_LIMITED',
          message: error.message,
        });
      }
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
    },
  );

  // Registra o plugin com prefixo /internal/leads (simula o autoload + app.ts prefix).
  await app.register(internalLeadsRoutes, { prefix: '/internal/leads' });

  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Suite principal
// ---------------------------------------------------------------------------

describe('POST /internal/leads/get-or-create', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. 200 — lead existente (created: false)
  // -------------------------------------------------------------------------
  it('retorna 200 com lead existente (created: false)', async () => {
    const serviceResult = makeLeadResult({ created: false });
    mockGetOrCreateLead.mockResolvedValueOnce(serviceResult);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/leads/get-or-create',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.lead_id).toBe(FIXTURE_LEAD_ID);
    expect(body.created).toBe(false);
    expect(body.customer_id).toBeNull();
    expect(body.current_stage).toBe('Pré-atendimento');
    expect(body.city_id).toBe(FIXTURE_CITY_ID);
    expect(body.assigned_agent_id).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 2. 200 — lead criado (created: true)
  // -------------------------------------------------------------------------
  it('retorna 200 com lead criado (created: true)', async () => {
    const serviceResult = makeLeadResult({ created: true, current_stage: 'Pré-atendimento' });
    mockGetOrCreateLead.mockResolvedValueOnce(serviceResult);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/leads/get-or-create',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { ...VALID_BODY, name: 'Maria Silva', city_id: FIXTURE_CITY_ID },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.lead_id).toBe(FIXTURE_LEAD_ID);
    expect(body.created).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 3. 401 — sem X-Internal-Token
  // -------------------------------------------------------------------------
  it('retorna 401 sem X-Internal-Token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/leads/get-or-create',
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(401);
    expect(mockGetOrCreateLead).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 4. 401 — token errado
  // -------------------------------------------------------------------------
  it('retorna 401 com token inválido', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/leads/get-or-create',
      headers: { 'x-internal-token': 'wrong-token' },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(401);
    expect(mockGetOrCreateLead).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 5. 400 — sem phone
  // -------------------------------------------------------------------------
  it('retorna 400 quando phone está ausente', async () => {
    const { phone: _phone, ...bodyWithoutPhone } = VALID_BODY;

    const response = await app.inject({
      method: 'POST',
      url: '/internal/leads/get-or-create',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: bodyWithoutPhone,
    });

    expect(response.statusCode).toBe(400);
    expect(mockGetOrCreateLead).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 6. 400 — phone fora do formato E.164
  // -------------------------------------------------------------------------
  it('retorna 400 quando phone não é E.164', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/leads/get-or-create',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { ...VALID_BODY, phone: '69999999999' }, // sem o +55
    });

    expect(response.statusCode).toBe(400);
    expect(mockGetOrCreateLead).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 7. 400 — sem organization_id
  // -------------------------------------------------------------------------
  it('retorna 400 quando organization_id está ausente', async () => {
    const { organization_id: _org, ...bodyWithoutOrg } = VALID_BODY;

    const response = await app.inject({
      method: 'POST',
      url: '/internal/leads/get-or-create',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: bodyWithoutOrg,
    });

    expect(response.statusCode).toBe(400);
    expect(mockGetOrCreateLead).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 8. 400 — organization_id não é UUID
  // -------------------------------------------------------------------------
  it('retorna 400 quando organization_id não é UUID', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/leads/get-or-create',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { ...VALID_BODY, organization_id: 'not-a-uuid' },
    });

    expect(response.statusCode).toBe(400);
    expect(mockGetOrCreateLead).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 9. 400 — source inválido ('manual' não é aceito neste endpoint)
  // -------------------------------------------------------------------------
  it('retorna 400 quando source é inválido para o canal interno', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/leads/get-or-create',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { ...VALID_BODY, source: 'manual' }, // 'manual' não é aceito aqui
    });

    expect(response.statusCode).toBe(400);
    expect(mockGetOrCreateLead).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 10. 422 — INVALID_PHONE (service layer)
  // -------------------------------------------------------------------------
  it('retorna 422 INVALID_PHONE quando serviço lança InvalidPhoneError', async () => {
    // Caminho relativo a __tests__/: ../../../leads/service.js = src/modules/leads/service.ts
    const { InvalidPhoneError } = await import('../../../leads/service.js');
    mockGetOrCreateLead.mockRejectedValueOnce(new InvalidPhoneError('formato inválido'));

    const response = await app.inject({
      method: 'POST',
      url: '/internal/leads/get-or-create',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.error).toBe('VALIDATION_ERROR');
  });

  // -------------------------------------------------------------------------
  // 11. 409 — LEAD_MERGE_REQUIRED (service layer)
  // -------------------------------------------------------------------------
  it('retorna 409 LEAD_MERGE_REQUIRED quando serviço lança LeadMergeRequiredError', async () => {
    const { LeadMergeRequiredError } = await import('../../../leads/service.js');
    mockGetOrCreateLead.mockRejectedValueOnce(new LeadMergeRequiredError());

    const response = await app.inject({
      method: 'POST',
      url: '/internal/leads/get-or-create',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body.error).toBe('CONFLICT');
  });

  // -------------------------------------------------------------------------
  // 12. 429 — rate limit testado com app isolado
  //
  // O endpoint registra config.rateLimit: { max: 60, timeWindow: '1 minute' }.
  // Para testar sem enviar 60 requisições (lento), usamos um app isolado com
  // global max=200 e verificamos que o per-route config é respeitado:
  // enviamos 61 requisições → a 61ª retorna 429.
  //
  // App isolado evita contaminar o contador do app compartilhado pelos outros testes.
  // -------------------------------------------------------------------------
  it('retorna 429 quando rate limit de 60 req/min é excedido', async () => {
    // App isolado para este teste: não contamina o contador do app principal.
    const [
      { default: Fastify },
      { serializerCompiler, validatorCompiler },
      { default: internalLeadsRoutes },
      { isAppError },
      rateLimitModule,
    ] = await Promise.all([
      import('fastify'),
      import('fastify-type-provider-zod'),
      import('../routes.js'),
      import('../../../../shared/errors.js'),
      import('@fastify/rate-limit'),
    ]);

    const isolatedApp = Fastify({ logger: false }).withTypeProvider();
    isolatedApp.setValidatorCompiler(validatorCompiler);
    isolatedApp.setSerializerCompiler(serializerCompiler);

    // Global max=200 — acima do per-route max=60.
    // Per-route config.rateLimit { max: 60 } será o limite efetivo para esta rota.
    await isolatedApp.register(
      rateLimitModule.default as Parameters<typeof isolatedApp.register>[0],
      { max: 200, timeWindow: '1 minute' },
    );

    isolatedApp.setErrorHandler(
      (
        error: Error & { validation?: unknown; statusCode?: number },
        _request: unknown,
        reply: { status: (n: number) => { send: (b: unknown) => void } },
      ) => {
        if (isAppError(error)) {
          return reply.status(error.statusCode).send({
            error: error.code,
            message: error.message,
          });
        }
        if (error.statusCode === 429) {
          return reply.status(429).send({ error: 'RATE_LIMITED', message: error.message });
        }
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: error.message });
      },
    );

    await isolatedApp.register(internalLeadsRoutes, { prefix: '/internal/leads' });
    await isolatedApp.ready();

    mockGetOrCreateLead.mockResolvedValue(makeLeadResult());

    // Envia 60 requisições — todas dentro do per-route limit (max=60)
    for (let i = 0; i < 60; i++) {
      const res = await isolatedApp.inject({
        method: 'POST',
        url: '/internal/leads/get-or-create',
        headers: { 'x-internal-token': VALID_TOKEN },
        payload: VALID_BODY,
      });
      expect(res.statusCode).toBe(200);
    }

    // 61ª requisição — deve ser bloqueada pelo per-route limit (max=60)
    const blocked = await isolatedApp.inject({
      method: 'POST',
      url: '/internal/leads/get-or-create',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: VALID_BODY,
    });
    expect(blocked.statusCode).toBe(429);

    await isolatedApp.close();
  });

  // -------------------------------------------------------------------------
  // 13. getOrCreateLead chamado exatamente uma vez (sem double-call)
  //
  // Garante que a rota não processa duplicadamente quando o service retorna.
  // Verificação indireta de que outbox NÃO é emitido quando created=false
  // (a responsabilidade de emitir leads.created é do service, e o mock
  // retorna created:false — portanto outbox não seria emitido pelo service).
  // -------------------------------------------------------------------------
  it('chama getOrCreateLead exatamente uma vez com os parâmetros corretos', async () => {
    mockGetOrCreateLead.mockResolvedValueOnce(makeLeadResult({ created: false }));

    const response = await app.inject({
      method: 'POST',
      url: '/internal/leads/get-or-create',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(200);
    expect(mockGetOrCreateLead).toHaveBeenCalledTimes(1);
    expect(mockGetOrCreateLead).toHaveBeenCalledWith(
      expect.anything(), // db (mockado)
      FIXTURE_ORG_ID,
      expect.objectContaining({
        phone: '+5569999999999',
        source: 'whatsapp',
      }),
      expect.any(String), // requestIp
    );
  });

  // -------------------------------------------------------------------------
  // 14. Campos opcionais aceitos (name, city_id, chatwoot_conversation_id, correlation_id)
  // -------------------------------------------------------------------------
  it('aceita e repassa todos os campos opcionais ao service', async () => {
    mockGetOrCreateLead.mockResolvedValueOnce(
      makeLeadResult({ created: true, city_id: FIXTURE_CITY_ID }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/internal/leads/get-or-create',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: {
        ...VALID_BODY,
        name: 'João da Silva',
        city_id: FIXTURE_CITY_ID,
        chatwoot_conversation_id: '12345',
        correlation_id: '11111111-2222-3333-4444-555555555555',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockGetOrCreateLead).toHaveBeenCalledWith(
      expect.anything(), // db
      FIXTURE_ORG_ID,
      expect.objectContaining({
        name: 'João da Silva',
        cityId: FIXTURE_CITY_ID,
        chatwootConversationId: '12345',
        correlationId: '11111111-2222-3333-4444-555555555555',
      }),
      expect.any(String), // requestIp
    );
  });
});

// =============================================================================
// Suite F3-S12 — PATCH /internal/leads/:id (update_lead_profile)
// =============================================================================

/**
 * Cria um fixture de lead completo compatível com o tipo Lead do Drizzle.
 * Campos PII (name) são intencionalmente valores de teste — não dados reais.
 */
function makeLeadFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: FIXTURE_LEAD_ID,
    organizationId: FIXTURE_ORG_ID,
    cityId: FIXTURE_CITY_ID,
    agentId: null,
    name: 'Desconhecido',
    phoneE164: '+5569999999999',
    phoneNormalized: '5569999999999',
    source: 'whatsapp',
    status: 'new',
    email: null,
    cpfHash: null,
    notes: null,
    metadata: {},
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

const VALID_PATCH_BODY = {
  organization_id: FIXTURE_ORG_ID,
  name: 'Maria Silva',
  city_id: FIXTURE_CITY_ID,
};

describe('PATCH /internal/leads/:id', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    // Limpar call history e restaurar implementações de forma explícita.
    // vi.clearAllMocks() pode não rastrear mocks criados via vi.hoisted(),
    // então chamamos .mockClear() diretamente para garantia.
    mockFindLeadById.mockClear();
    mockUpdateLead.mockClear();
    mockEmit.mockClear().mockResolvedValue('evt-uuid');
    mockAuditLog.mockClear().mockResolvedValue('audit-uuid');
    mockDb.transaction
      .mockClear()
      .mockImplementation((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx));
    mockTx.insert.mockClear().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    mockTx.select.mockClear().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ stageName: 'Pré-atendimento' }]),
          }),
        }),
      }),
    });
  });

  // -------------------------------------------------------------------------
  // 15. 200 — caminho feliz: atualiza name e city_id
  // -------------------------------------------------------------------------
  it('retorna 200 e atualiza name e city_id corretamente', async () => {
    const existingLead = makeLeadFixture({ name: 'Desconhecido', cityId: null });
    const updatedLead = makeLeadFixture({
      name: 'Maria Silva',
      cityId: FIXTURE_CITY_ID,
      updatedAt: new Date(),
    });

    mockFindLeadById.mockResolvedValueOnce(existingLead);
    mockUpdateLead.mockResolvedValueOnce(updatedLead);

    const response = await app.inject({
      method: 'PATCH',
      url: `/internal/leads/${FIXTURE_LEAD_ID}`,
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: VALID_PATCH_BODY,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.lead_id).toBe(FIXTURE_LEAD_ID);
    expect(body.city_id).toBe(FIXTURE_CITY_ID);
    expect(body.assigned_agent_id).toBeNull();
    expect(body.current_stage).toBe('Pré-atendimento');
    // Campos PII não retornados na resposta.
    expect(body.name).toBeUndefined();
    expect(body.phone).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 16. 200 — requested_amount e requested_term_months gravados em metadata
  // -------------------------------------------------------------------------
  it('retorna 200 e aceita requested_amount e requested_term_months', async () => {
    const existingLead = makeLeadFixture({ metadata: {} });
    const updatedLead = makeLeadFixture({
      metadata: { requested_amount: 15000, requested_term_months: 36 },
    });

    mockFindLeadById.mockResolvedValueOnce(existingLead);
    mockUpdateLead.mockResolvedValueOnce(updatedLead);

    const response = await app.inject({
      method: 'PATCH',
      url: `/internal/leads/${FIXTURE_LEAD_ID}`,
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: {
        organization_id: FIXTURE_ORG_ID,
        requested_amount: 15000,
        requested_term_months: 36,
      },
    });

    expect(response.statusCode).toBe(200);
    // updateLead chamado com metadata mesclada.
    expect(mockUpdateLead).toHaveBeenCalledWith(
      expect.anything(), // tx
      FIXTURE_LEAD_ID,
      FIXTURE_ORG_ID,
      null, // cityScopeIds null (IA tem visibilidade global)
      expect.objectContaining({
        metadata: expect.objectContaining({
          requested_amount: 15000,
          requested_term_months: 36,
        }),
      }),
    );
  });

  // -------------------------------------------------------------------------
  // 17. 200 — idempotente quando nenhum campo muda (não abre transação)
  // -------------------------------------------------------------------------
  it('retorna 200 idempotente quando nenhum campo é alterado', async () => {
    // Lead com os mesmos valores que o body — nenhum campo changed.
    const existingLead = makeLeadFixture({
      name: 'Maria Silva',
      cityId: FIXTURE_CITY_ID,
    });
    mockFindLeadById.mockResolvedValueOnce(existingLead);

    // mockDb.select para o kanban stage lookup fora da transação.
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ stageName: 'Pré-atendimento' }]),
          }),
        }),
      }),
    });

    const response = await app.inject({
      method: 'PATCH',
      url: `/internal/leads/${FIXTURE_LEAD_ID}`,
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: {
        organization_id: FIXTURE_ORG_ID,
        name: 'Maria Silva', // mesmo valor — sem mudança
        city_id: FIXTURE_CITY_ID, // mesmo valor — sem mudança
      },
    });

    expect(response.statusCode).toBe(200);
    // Nenhuma transação foi aberta — updateLead, emit e auditLog não chamados.
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockUpdateLead).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 18. 401 — sem X-Internal-Token
  // -------------------------------------------------------------------------
  it('retorna 401 sem X-Internal-Token', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/internal/leads/${FIXTURE_LEAD_ID}`,
      payload: VALID_PATCH_BODY,
    });

    expect(response.statusCode).toBe(401);
    expect(mockFindLeadById).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 19. 401 — token inválido
  // -------------------------------------------------------------------------
  it('retorna 401 com token inválido', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/internal/leads/${FIXTURE_LEAD_ID}`,
      headers: { 'x-internal-token': 'wrong-token' },
      payload: VALID_PATCH_BODY,
    });

    expect(response.statusCode).toBe(401);
    expect(mockFindLeadById).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 20. 404 — lead inexistente
  // -------------------------------------------------------------------------
  it('retorna 404 quando lead não existe', async () => {
    mockFindLeadById.mockResolvedValueOnce(null);

    const response = await app.inject({
      method: 'PATCH',
      url: `/internal/leads/${FIXTURE_LEAD_ID}`,
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: VALID_PATCH_BODY,
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error).toBe('NOT_FOUND');
    expect(mockUpdateLead).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 21. 422 — campo não permitido no body (strict schema)
  //
  // Campos fora do schema Zod strict (ex: status, source, agent_id) devem
  // retornar 400 VALIDATION_ERROR — o schema usa .strict() para rejeitar.
  // -------------------------------------------------------------------------
  it('retorna 400 quando body contém campo não permitido', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/internal/leads/${FIXTURE_LEAD_ID}`,
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: {
        ...VALID_PATCH_BODY,
        status: 'qualifying', // campo não permitido para IA
      },
    });

    expect(response.statusCode).toBe(400);
    expect(mockFindLeadById).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 22. 400 — id não-UUID no path
  // -------------------------------------------------------------------------
  it('retorna 400 quando :id no path não é UUID', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/internal/leads/not-a-uuid',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: VALID_PATCH_BODY,
    });

    expect(response.statusCode).toBe(400);
    expect(mockFindLeadById).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 23. 400 — organization_id ausente no body
  // -------------------------------------------------------------------------
  it('retorna 400 quando organization_id está ausente', async () => {
    const { organization_id: _org, ...bodyWithoutOrg } = VALID_PATCH_BODY;

    const response = await app.inject({
      method: 'PATCH',
      url: `/internal/leads/${FIXTURE_LEAD_ID}`,
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: bodyWithoutOrg,
    });

    expect(response.statusCode).toBe(400);
    expect(mockFindLeadById).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 24. emit chamado com actor kind=system (não 'user' nem 'ai' como string)
  // -------------------------------------------------------------------------
  it('chama emit leads.updated com actor kind=system e lead_id correto', async () => {
    const existingLead = makeLeadFixture({ name: 'Desconhecido', cityId: null });
    const updatedLead = makeLeadFixture({ name: 'Maria Silva', cityId: FIXTURE_CITY_ID });

    mockFindLeadById.mockResolvedValueOnce(existingLead);
    mockUpdateLead.mockResolvedValueOnce(updatedLead);

    await app.inject({
      method: 'PATCH',
      url: `/internal/leads/${FIXTURE_LEAD_ID}`,
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: VALID_PATCH_BODY,
    });

    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledWith(
      expect.anything(), // tx
      expect.objectContaining({
        eventName: 'leads.updated',
        aggregateId: FIXTURE_LEAD_ID,
        actor: expect.objectContaining({ kind: 'system', id: 'langgraph' }),
        data: expect.objectContaining({ lead_id: FIXTURE_LEAD_ID }),
      }),
    );
  });

  // -------------------------------------------------------------------------
  // 25. auditLog chamado com actor=null (ação de IA — sem usuário humano)
  // -------------------------------------------------------------------------
  it('chama auditLog com actor=null e action=leads.update_profile', async () => {
    const existingLead = makeLeadFixture({ name: 'Desconhecido', cityId: null });
    const updatedLead = makeLeadFixture({ name: 'Maria Silva', cityId: FIXTURE_CITY_ID });

    mockFindLeadById.mockResolvedValueOnce(existingLead);
    mockUpdateLead.mockResolvedValueOnce(updatedLead);

    await app.inject({
      method: 'PATCH',
      url: `/internal/leads/${FIXTURE_LEAD_ID}`,
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: VALID_PATCH_BODY,
    });

    expect(mockAuditLog).toHaveBeenCalledTimes(1);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.anything(), // tx
      expect.objectContaining({
        actor: null,
        action: 'leads.update_profile',
        resource: { type: 'lead', id: FIXTURE_LEAD_ID },
      }),
    );
  });

  // -------------------------------------------------------------------------
  // 26. lead_history insert chamado com action=profile_updated_by_ai
  //     e actor_user_id=null (ação de sistema).
  // -------------------------------------------------------------------------
  it('insere em lead_history com action=profile_updated_by_ai e actor_user_id=null', async () => {
    const existingLead = makeLeadFixture({ name: 'Desconhecido', cityId: null });
    const updatedLead = makeLeadFixture({ name: 'Maria Silva', cityId: FIXTURE_CITY_ID });

    mockFindLeadById.mockResolvedValueOnce(existingLead);
    mockUpdateLead.mockResolvedValueOnce(updatedLead);

    await app.inject({
      method: 'PATCH',
      url: `/internal/leads/${FIXTURE_LEAD_ID}`,
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: VALID_PATCH_BODY,
    });

    // mockTx.insert deve ter sido chamado com leadHistory (nome simbólico mockado).
    expect(mockTx.insert).toHaveBeenCalledTimes(1);
    const valuesArg = mockTx.insert.mock.results[0]?.value as
      | {
          values: ReturnType<typeof vi.fn>;
        }
      | undefined;
    expect(valuesArg).toBeDefined();
    expect(valuesArg?.values).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: FIXTURE_LEAD_ID,
        action: 'profile_updated_by_ai',
        actorUserId: null,
        metadata: expect.objectContaining({ actor_type: 'ai' }),
      }),
    );
  });
});
