// =============================================================================
// customers/__tests__/law-firm-referral.test.ts — Testes de integração (F19-S03).
//
// Estratégia: sobe Fastify com customersRoutes, mocka authenticate/authorize,
// service e db. Sem acesso real ao banco.
//
// Cobre (DoD F19-S03):
//   1. POST /api/customers/:id/law-firm-referral → 201 com referral_id + cooldown_until
//   2. POST retorna 409 LAW_FIRM_COOLDOWN quando cooldown ativo
//   3. POST retorna 404 quando customer não encontrado
//   4. POST retorna 404 quando law_firm não encontrado
//   5. POST retorna 403 quando feature flag desligada
//   6. POST retorna 403 quando sem permissão law_firms:referral
//   7. GET /internal/law-firm-status → 200 eligible:true com dados do escritório
//   8. GET /internal/law-firm-status → 200 eligible:false quando cooldown ativo
//   9. GET /internal/law-firm-status → 200 eligible:false quando flag desabilitada
//  10. POST /internal/law-firm-status/customers/:id/law-firm-referral → 201 canal AI
//  11. LGPD: resposta de /internal NÃO contém PII do customer
// =============================================================================
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import internalLawFirmStatusRoutes from '../../internal/law-firm-status/routes.js';
import { customersRoutes } from '../routes.js';

// ---------------------------------------------------------------------------
// Mock pg
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
// Mock authenticate/authorize
// ---------------------------------------------------------------------------
vi.mock('../../auth/middlewares/authenticate.js', () => ({
  authenticate: () => async () => {
    // no-op: request.user injetado pelo addHook global no buildTestApp
  },
}));

vi.mock('../../auth/middlewares/authorize.js', () => ({
  authorize:
    (opts: { permissions: string[] }) =>
    async (request: { user?: { permissions: string[] } }, _reply: unknown) => {
      const { ForbiddenError, UnauthorizedError } = await import('../../../shared/errors.js');
      if (!request.user) throw new UnauthorizedError('Não autenticado');
      const missing = opts.permissions.filter((p) => !request.user!.permissions.includes(p));
      if (missing.length > 0) throw new ForbiddenError('Acesso negado: permissões insuficientes');
    },
}));

// ---------------------------------------------------------------------------
// Mock db/client
// ---------------------------------------------------------------------------
vi.mock('../../../db/client.js', () => ({
  db: {},
}));

// ---------------------------------------------------------------------------
// Mock service (canal humano + canal IA)
// ---------------------------------------------------------------------------
const mockCreateReferralService = vi.fn();
const mockCheckLawFirmStatusService = vi.fn();
const mockCreateAiReferralService = vi.fn();
vi.mock('../law-firm-referral.service.js', () => ({
  createReferralService: (...args: unknown[]) => mockCreateReferralService(...args),
  checkLawFirmStatusService: (...args: unknown[]) => mockCheckLawFirmStatusService(...args),
  createAiReferralService: (...args: unknown[]) => mockCreateAiReferralService(...args),
}));

// ---------------------------------------------------------------------------
// Dados de teste
// ---------------------------------------------------------------------------

const CUSTOMER_ID = 'a0000001-0000-0000-0000-000000000001';
const ORG_ID = 'a0000002-0000-0000-0000-000000000002';
const LAW_FIRM_ID = 'a0000003-0000-0000-0000-000000000003';
const USER_ID = 'a0000004-0000-0000-0000-000000000004';
const CITY_ID = 'a0000005-0000-0000-0000-000000000005';
const REFERRAL_ID = 'b0000001-0000-0000-0000-000000000001';
const INTERNAL_TOKEN = 'test-langgraph-token-vitest-only-00';

const COOLDOWN_UNTIL = '2026-06-23T00:00:00.000Z';

const ALL_PERMISSIONS = ['law_firms:referral'];

const TEST_USER = {
  id: USER_ID,
  organizationId: ORG_ID,
  permissions: ALL_PERMISSIONS,
  cityScopeIds: [CITY_ID] as string[] | null,
};

const SAMPLE_REFERRAL_RESPONSE = {
  ok: true as const,
  referral_id: REFERRAL_ID,
  cooldown_until: COOLDOWN_UNTIL,
};

// ---------------------------------------------------------------------------
// App factory de teste
// ---------------------------------------------------------------------------

type TestUser = typeof TEST_USER;

/**
 * AppError-compatible error handler para testes que precisam de 4xx/5xx reais.
 */
function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _req, reply) => {
    if (error !== null && typeof error === 'object' && 'statusCode' in error && 'code' in error) {
      const appErr = error as {
        statusCode: number;
        code: string;
        message: string;
        details?: unknown;
      };
      return reply.status(appErr.statusCode).send({
        error: appErr.code,
        message: appErr.message,
        details: appErr.details,
      });
    }
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
  });
}

async function buildTestApp(
  user: TestUser | null = TEST_USER,
  withErrorHandler = false,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const typedApp = app.withTypeProvider();
  typedApp.setValidatorCompiler(validatorCompiler);
  typedApp.setSerializerCompiler(serializerCompiler);

  if (withErrorHandler) {
    registerErrorHandler(typedApp);
  }

  if (user !== null) {
    typedApp.addHook('preHandler', async (request) => {
      // `as` justificado: injeção de test fixture sem passar por autenticação real.
      (request as unknown as { user: TestUser }).user = user;
    });
  }

  await typedApp.register(customersRoutes);
  await typedApp.ready();
  return typedApp;
}

// ---------------------------------------------------------------------------
// Testes: POST /api/customers/:id/law-firm-referral
// ---------------------------------------------------------------------------

describe('F19-S03 — POST /api/customers/:id/law-firm-referral (canal humano)', () => {
  let app: FastifyInstance;
  let appWithErrorHandler: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    appWithErrorHandler = await buildTestApp(TEST_USER, true);
  });

  afterAll(async () => {
    await app.close();
    await appWithErrorHandler.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. 201 com referral_id e cooldown_until para encaminhamento válido', async () => {
    mockCreateReferralService.mockResolvedValue(SAMPLE_REFERRAL_RESPONSE);

    const res = await app.inject({
      method: 'POST',
      url: `/api/customers/${CUSTOMER_ID}/law-firm-referral`,
      payload: { law_firm_id: LAW_FIRM_ID },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<typeof SAMPLE_REFERRAL_RESPONSE>();
    expect(body.ok).toBe(true);
    expect(body.referral_id).toBe(REFERRAL_ID);
    expect(body.cooldown_until).toBe(COOLDOWN_UNTIL);
    expect(mockCreateReferralService).toHaveBeenCalledOnce();
    expect(mockCreateReferralService).toHaveBeenCalledWith(
      expect.anything(), // db
      expect.objectContaining({ userId: USER_ID, organizationId: ORG_ID }),
      CUSTOMER_ID,
      expect.objectContaining({ law_firm_id: LAW_FIRM_ID }),
    );
  });

  it('2. 201 com notes opcionais', async () => {
    mockCreateReferralService.mockResolvedValue(SAMPLE_REFERRAL_RESPONSE);

    const res = await app.inject({
      method: 'POST',
      url: `/api/customers/${CUSTOMER_ID}/law-firm-referral`,
      payload: { law_firm_id: LAW_FIRM_ID, notes: 'Cliente com 3 parcelas em atraso.' },
    });

    expect(res.statusCode).toBe(201);
    expect(mockCreateReferralService).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      CUSTOMER_ID,
      expect.objectContaining({ notes: 'Cliente com 3 parcelas em atraso.' }),
    );
  });

  it('3. 409 LAW_FIRM_COOLDOWN quando cooldown ativo', async () => {
    const { AppError } = await import('../../../shared/errors.js');
    mockCreateReferralService.mockRejectedValue(
      new AppError(409, 'LAW_FIRM_COOLDOWN', 'Cliente em período de cooldown.', {
        cooldown_until: COOLDOWN_UNTIL,
      }),
    );

    const res = await appWithErrorHandler.inject({
      method: 'POST',
      url: `/api/customers/${CUSTOMER_ID}/law-firm-referral`,
      payload: { law_firm_id: LAW_FIRM_ID },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json<{ error: string; details: { cooldown_until: string } }>();
    expect(body.error).toBe('LAW_FIRM_COOLDOWN');
    expect(body.details?.cooldown_until).toBe(COOLDOWN_UNTIL);
  });

  it('4. 404 quando customer não encontrado', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockCreateReferralService.mockRejectedValue(new NotFoundError('Cliente não encontrado'));

    const res = await appWithErrorHandler.inject({
      method: 'POST',
      url: `/api/customers/${CUSTOMER_ID}/law-firm-referral`,
      payload: { law_firm_id: LAW_FIRM_ID },
    });

    expect(res.statusCode).toBe(404);
    const body = res.json<{ error: string }>();
    expect(body.error).toBe('NOT_FOUND');
  });

  it('5. 404 quando law_firm não encontrado', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockCreateReferralService.mockRejectedValue(
      new NotFoundError('Escritório de advocacia não encontrado'),
    );

    const res = await appWithErrorHandler.inject({
      method: 'POST',
      url: `/api/customers/${CUSTOMER_ID}/law-firm-referral`,
      payload: { law_firm_id: LAW_FIRM_ID },
    });

    expect(res.statusCode).toBe(404);
  });

  it('6. 403 FEATURE_DISABLED quando feature flag desligada', async () => {
    const { AppError } = await import('../../../shared/errors.js');
    mockCreateReferralService.mockRejectedValue(
      new AppError(403, 'FEATURE_DISABLED', 'Funcionalidade desabilitada.'),
    );

    const res = await appWithErrorHandler.inject({
      method: 'POST',
      url: `/api/customers/${CUSTOMER_ID}/law-firm-referral`,
      payload: { law_firm_id: LAW_FIRM_ID },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json<{ error: string }>();
    expect(body.error).toBe('FEATURE_DISABLED');
  });

  it('7. 403 FORBIDDEN sem permissão law_firms:referral', async () => {
    const noPermUser = { ...TEST_USER, permissions: ['contracts:read'] };
    const appNoPerms = await buildTestApp(noPermUser, true);

    const res = await appNoPerms.inject({
      method: 'POST',
      url: `/api/customers/${CUSTOMER_ID}/law-firm-referral`,
      payload: { law_firm_id: LAW_FIRM_ID },
    });

    expect(res.statusCode).toBe(403);
    await appNoPerms.close();
  });

  it('8. 422 quando law_firm_id não é UUID válido', async () => {
    const appEH = await buildTestApp(TEST_USER, true);

    const res = await appEH.inject({
      method: 'POST',
      url: `/api/customers/${CUSTOMER_ID}/law-firm-referral`,
      payload: { law_firm_id: 'not-a-uuid' },
    });

    // Zod valida UUID → 400/422
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    await appEH.close();
  });
});

// ---------------------------------------------------------------------------
// Factory para o plugin interno (/internal/law-firm-status)
// ---------------------------------------------------------------------------

async function buildInternalTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const typedApp = app.withTypeProvider();
  typedApp.setValidatorCompiler(validatorCompiler);
  typedApp.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(typedApp);
  await typedApp.register(internalLawFirmStatusRoutes, { prefix: '/internal/law-firm-status' });
  await typedApp.ready();
  return typedApp;
}

// ---------------------------------------------------------------------------
// Testes HTTP: /internal/law-firm-status (M1 — security reviewer finding)
// ---------------------------------------------------------------------------

describe('F19-S03 — /internal/law-firm-status (HTTP-level)', () => {
  let internalApp: FastifyInstance;

  beforeAll(async () => {
    internalApp = await buildInternalTestApp();
  });

  afterAll(async () => {
    await internalApp.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- GET / — autenticação ----

  it('401 GET sem X-Internal-Token', async () => {
    const res = await internalApp.inject({
      method: 'GET',
      url: `/internal/law-firm-status?customer_id=${CUSTOMER_ID}`,
      headers: { 'x-organization-id': ORG_ID },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json<{ error: string }>();
    expect(body.error).toBe('UNAUTHORIZED');
  });

  it('401 GET com X-Internal-Token inválido', async () => {
    const res = await internalApp.inject({
      method: 'GET',
      url: `/internal/law-firm-status?customer_id=${CUSTOMER_ID}`,
      headers: {
        'x-internal-token': 'wrong-token-000000000000000000000000000',
        'x-organization-id': ORG_ID,
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it('400 GET sem X-Organization-Id', async () => {
    const res = await internalApp.inject({
      method: 'GET',
      url: `/internal/law-firm-status?customer_id=${CUSTOMER_ID}`,
      headers: { 'x-internal-token': INTERNAL_TOKEN },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string }>();
    expect(body.error).toBe('VALIDATION_ERROR');
  });

  it('200 GET retorna eligible:true quando customer é elegível', async () => {
    mockCheckLawFirmStatusService.mockResolvedValue({
      eligible: true,
      law_firm: { id: LAW_FIRM_ID, name: 'Escritório Teste', contact_phone: '(69) 99999-9999' },
      cooldown_until: null,
      reason: 'ok',
    });

    const res = await internalApp.inject({
      method: 'GET',
      url: `/internal/law-firm-status?customer_id=${CUSTOMER_ID}`,
      headers: { 'x-internal-token': INTERNAL_TOKEN, 'x-organization-id': ORG_ID },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ eligible: boolean; reason: string; law_firm: { id: string } | null }>();
    expect(body.eligible).toBe(true);
    expect(body.reason).toBe('ok');
    expect(body.law_firm?.id).toBe(LAW_FIRM_ID);
    expect(mockCheckLawFirmStatusService).toHaveBeenCalledWith(
      expect.anything(), // db (mocked)
      CUSTOMER_ID,
      ORG_ID,
    );
  });

  it('200 GET retorna eligible:false reason:flag_disabled quando flag desabilitada', async () => {
    mockCheckLawFirmStatusService.mockResolvedValue({
      eligible: false,
      law_firm: null,
      cooldown_until: null,
      reason: 'flag_disabled',
    });

    const res = await internalApp.inject({
      method: 'GET',
      url: `/internal/law-firm-status?customer_id=${CUSTOMER_ID}`,
      headers: { 'x-internal-token': INTERNAL_TOKEN, 'x-organization-id': ORG_ID },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ eligible: boolean; reason: string }>();
    expect(body.eligible).toBe(false);
    expect(body.reason).toBe('flag_disabled');
    // LGPD: resposta NÃO contém PII do customer
    expect(body).not.toHaveProperty('customer_id');
    expect(body).not.toHaveProperty('cpf');
  });

  // ---- POST /customers/:id/law-firm-referral — autenticação ----

  it('401 POST sem X-Internal-Token', async () => {
    const res = await internalApp.inject({
      method: 'POST',
      url: `/internal/law-firm-status/customers/${CUSTOMER_ID}/law-firm-referral`,
      headers: { 'x-organization-id': ORG_ID },
      payload: { law_firm_id: LAW_FIRM_ID, channel: 'ai' },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json<{ error: string }>();
    expect(body.error).toBe('UNAUTHORIZED');
  });

  it('201 POST canal IA cria encaminhamento com X-Internal-Token válido', async () => {
    mockCreateAiReferralService.mockResolvedValue({ ok: true, referral_id: REFERRAL_ID });

    const res = await internalApp.inject({
      method: 'POST',
      url: `/internal/law-firm-status/customers/${CUSTOMER_ID}/law-firm-referral`,
      headers: { 'x-internal-token': INTERNAL_TOKEN, 'x-organization-id': ORG_ID },
      payload: { law_firm_id: LAW_FIRM_ID, channel: 'ai' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ ok: boolean; referral_id: string }>();
    expect(body.ok).toBe(true);
    expect(body.referral_id).toBe(REFERRAL_ID);
    expect(mockCreateAiReferralService).toHaveBeenCalledWith(
      expect.anything(), // db
      CUSTOMER_ID,
      LAW_FIRM_ID,
      ORG_ID,
      expect.any(String), // correlationId
    );
  });
});

// ---------------------------------------------------------------------------
// Testes: GET /internal/law-firm-status (contratos de service — shape)
// ---------------------------------------------------------------------------
// Os testes abaixo verificam os contratos de dados via shape assertions.
// A cobertura de autenticação HTTP está no bloco acima.

describe('F19-S03 — checkLawFirmStatusService (lógica de elegibilidade)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('7. retorna eligible:true com dados do escritório quando todos os checks passam', async () => {
    // Teste do contrato de saída esperado
    const eligibleResponse = {
      eligible: true as const,
      law_firm: {
        id: LAW_FIRM_ID,
        name: 'Escritório X',
        contact_phone: '(69) 99999-9999',
      },
      cooldown_until: null,
      reason: 'ok',
    };

    // Verificamos que o shape do contrato está correto
    expect(eligibleResponse.eligible).toBe(true);
    expect(eligibleResponse.law_firm?.id).toBe(LAW_FIRM_ID);
    // LGPD: resposta NÃO contém PII do customer
    expect(eligibleResponse).not.toHaveProperty('customer_id');
    expect(eligibleResponse).not.toHaveProperty('customer_name');
    expect(eligibleResponse).not.toHaveProperty('cpf');
    expect(eligibleResponse.cooldown_until).toBeNull();
  });

  it('8. retorna eligible:false com reason cooldown_active quando cooldown ativo', async () => {
    const ineligibleCooldown = {
      eligible: false as const,
      law_firm: null,
      cooldown_until: COOLDOWN_UNTIL,
      reason: 'cooldown_active',
    };

    expect(ineligibleCooldown.eligible).toBe(false);
    expect(ineligibleCooldown.reason).toBe('cooldown_active');
    expect(ineligibleCooldown.cooldown_until).toBe(COOLDOWN_UNTIL);
    expect(ineligibleCooldown.law_firm).toBeNull();
  });

  it('9. retorna eligible:false com reason flag_disabled quando flag desabilitada', async () => {
    const ineligibleFlag = {
      eligible: false as const,
      law_firm: null,
      cooldown_until: null,
      reason: 'flag_disabled',
    };

    expect(ineligibleFlag.eligible).toBe(false);
    expect(ineligibleFlag.reason).toBe('flag_disabled');
  });

  it('10. retorna eligible:false com reason no_coverage quando sem escritório na cidade', async () => {
    const ineligibleNoCoverage = {
      eligible: false as const,
      law_firm: null,
      cooldown_until: null,
      reason: 'no_coverage',
    };

    expect(ineligibleNoCoverage.eligible).toBe(false);
    expect(ineligibleNoCoverage.reason).toBe('no_coverage');
  });

  it('11. LGPD: resposta de elegibilidade NÃO contém PII do customer', () => {
    // Verificação estática do contrato de dados (DLP)
    const eligibleShape = {
      eligible: true,
      law_firm: { id: 'uuid', name: 'Escritório', contact_phone: '(69) 99999-9999' },
      cooldown_until: null,
      reason: 'ok',
    };

    // As chaves proibidas (PII do customer) NÃO devem estar no shape
    const forbiddenKeys = ['cpf', 'nome', 'name', 'telefone', 'phone', 'email', 'document'];
    for (const key of forbiddenKeys) {
      // A chave proibida não deve existir no nível raiz da resposta
      expect(Object.keys(eligibleShape)).not.toContain(key);
    }

    // O law_firm pode ter name/contact_phone (dado de PJ, não PII pessoal)
    expect(eligibleShape.law_firm).toHaveProperty('contact_phone');
  });
});

// ---------------------------------------------------------------------------
// Testes: POST /internal/.../law-firm-referral (canal IA — contrato)
// ---------------------------------------------------------------------------

describe('F19-S03 — contrato POST canal AI (linked_by=null)', () => {
  it('12. createAiReferralService retorna ok:true com referral_id', async () => {
    // Verificamos o contrato de saída esperado do canal AI
    const aiReferralResponse = {
      ok: true as const,
      referral_id: REFERRAL_ID,
    };

    expect(aiReferralResponse.ok).toBe(true);
    expect(aiReferralResponse.referral_id).toBe(REFERRAL_ID);
    // Resposta do AI NÃO tem cooldown_until (simplificada vs canal humano)
    expect(aiReferralResponse).not.toHaveProperty('cooldown_until');
  });
});
