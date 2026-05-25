// =============================================================================
// internal/credit-analyses/__tests__/internal.credit-analyses.test.ts — F4-S04.
//
// Testes de integração para GET /internal/customers/:id/credit-analyses.
//
// Estratégia: sobe Fastify com internalCreditAnalysesRoutes, mocka db (drizzle)
// e env. Não conecta em banco real.
//
// DoD F4-S04:
//   1.  200 — lead sem análises (items: [])
//   2.  200 — 1 análise em curso (status: em_analise, current_version_number: 1)
//   3.  200 — múltiplas análises finalizadas, ordenadas por created_at DESC
//   4.  401 — sem X-Internal-Token
//   5.  401 — token inválido
//   6.  400 — X-Organization-Id ausente (multi-tenant scope)
//   7.  400 — :id não é UUID válido
//   8.  404 — lead não existe na organização (org scope incorreto)
//   9.  Payload NÃO contém parecer_text, pendencias, attachments, internal_score,
//       analyst_user_id, approved_amount (teste crítico LGPD)
//   10. 200 — análise sem versão ainda (current_version_number: 0)
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
// Mock env
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
// Mock do repositório
//
// Mockamos o módulo de repositório diretamente — evita qualquer acesso a DB.
// O repositório exporta getMaskedAnalysisHistory e LeadNotFoundInOrgError.
// ---------------------------------------------------------------------------

const mockGetMaskedAnalysisHistory = vi.fn();

vi.mock('../repository.js', () => {
  class LeadNotFoundInOrgError extends Error {
    readonly leadId: string;
    readonly organizationId: string;
    constructor(leadId: string, organizationId: string) {
      super(`Lead não encontrado na organização: leadId=${leadId}`);
      this.name = 'LeadNotFoundInOrgError';
      this.leadId = leadId;
      this.organizationId = organizationId;
      Object.setPrototypeOf(this, new.target.prototype);
    }
  }
  return {
    getMaskedAnalysisHistory: mockGetMaskedAnalysisHistory,
    LeadNotFoundInOrgError,
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_LEAD_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_ORG_ID = 'ffffffff-0000-0000-0000-000000000001';
const FIXTURE_ANALYSIS_ID_1 = 'cccccccc-0000-0000-0000-000000000001';
const FIXTURE_ANALYSIS_ID_2 = 'dddddddd-0000-0000-0000-000000000002';

const NOW = new Date('2026-05-18T12:00:00.000Z');
const EARLIER = new Date('2026-04-01T09:00:00.000Z');

type MaskedAnalysisRow = {
  analysisId: string;
  status: 'em_analise' | 'pendente' | 'aprovado' | 'recusado' | 'cancelado';
  currentVersionNumber: number;
  createdAt: Date;
  updatedAt: Date;
};

function makeAnalysisRow(overrides: Partial<MaskedAnalysisRow> = {}): MaskedAnalysisRow {
  return {
    analysisId: FIXTURE_ANALYSIS_ID_1,
    status: 'em_analise',
    currentVersionNumber: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------

async function buildTestApp(): Promise<FastifyInstance> {
  const [
    { default: Fastify },
    { serializerCompiler, validatorCompiler },
    { default: internalCreditAnalysesRoutes },
    { isAppError },
  ] = await Promise.all([
    import('fastify'),
    import('fastify-type-provider-zod'),
    import('../routes.js'),
    import('../../../../shared/errors.js'),
  ]);

  const app = Fastify({ logger: false }).withTypeProvider();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

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
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
    },
  );

  // Registra o plugin com prefixo /internal/customers (simula internal/index.ts + app.ts).
  await app.register(internalCreditAnalysesRoutes, { prefix: '/internal/customers' });

  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Suite principal
// ---------------------------------------------------------------------------

describe('GET /internal/customers/:id/credit-analyses', () => {
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
  // 1. 200 — lead sem análises (items: [])
  // -------------------------------------------------------------------------
  it('retorna 200 com items vazio quando lead não tem análises', async () => {
    mockGetMaskedAnalysisHistory.mockResolvedValue([]);

    const response = await app.inject({
      method: 'GET',
      url: `/internal/customers/${FIXTURE_LEAD_ID}/credit-analyses`,
      headers: { 'x-internal-token': VALID_TOKEN, 'x-organization-id': FIXTURE_ORG_ID },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.lead_id).toBe(FIXTURE_LEAD_ID);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 2. 200 — 1 análise em curso (status: em_analise, current_version_number: 1)
  // -------------------------------------------------------------------------
  it('retorna 200 com 1 análise em curso e version_number correto', async () => {
    mockGetMaskedAnalysisHistory.mockResolvedValue([
      makeAnalysisRow({ status: 'em_analise', currentVersionNumber: 1 }),
    ]);

    const response = await app.inject({
      method: 'GET',
      url: `/internal/customers/${FIXTURE_LEAD_ID}/credit-analyses`,
      headers: { 'x-internal-token': VALID_TOKEN, 'x-organization-id': FIXTURE_ORG_ID },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.lead_id).toBe(FIXTURE_LEAD_ID);
    expect(body.items).toHaveLength(1);

    const item = body.items[0];
    expect(item.analysis_id).toBe(FIXTURE_ANALYSIS_ID_1);
    expect(item.status).toBe('em_analise');
    expect(item.current_version_number).toBe(1);
    expect(typeof item.created_at).toBe('string');
    expect(typeof item.updated_at).toBe('string');
    // Verificar ISO 8601 — deve parsear sem erro
    expect(new Date(item.created_at).getTime()).not.toBeNaN();
  });

  // -------------------------------------------------------------------------
  // 3. 200 — múltiplas análises finalizadas, ordenadas por created_at DESC
  // -------------------------------------------------------------------------
  it('retorna 200 com múltiplas análises em ordem cronológica inversa', async () => {
    mockGetMaskedAnalysisHistory.mockResolvedValue([
      // Mais recente primeiro (repositório já ordena DESC)
      makeAnalysisRow({
        analysisId: FIXTURE_ANALYSIS_ID_1,
        status: 'aprovado',
        currentVersionNumber: 3,
        createdAt: NOW,
        updatedAt: NOW,
      }),
      makeAnalysisRow({
        analysisId: FIXTURE_ANALYSIS_ID_2,
        status: 'cancelado',
        currentVersionNumber: 1,
        createdAt: EARLIER,
        updatedAt: EARLIER,
      }),
    ]);

    const response = await app.inject({
      method: 'GET',
      url: `/internal/customers/${FIXTURE_LEAD_ID}/credit-analyses`,
      headers: { 'x-internal-token': VALID_TOKEN, 'x-organization-id': FIXTURE_ORG_ID },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(2);

    const [first, second] = body.items;
    expect(first.analysis_id).toBe(FIXTURE_ANALYSIS_ID_1);
    expect(first.status).toBe('aprovado');
    expect(first.current_version_number).toBe(3);

    expect(second.analysis_id).toBe(FIXTURE_ANALYSIS_ID_2);
    expect(second.status).toBe('cancelado');
    expect(second.current_version_number).toBe(1);

    // Verificar ordem cronológica inversa (NOW > EARLIER)
    const firstDate = new Date(first.created_at).getTime();
    const secondDate = new Date(second.created_at).getTime();
    expect(firstDate).toBeGreaterThan(secondDate);
  });

  // -------------------------------------------------------------------------
  // 4. 401 — sem X-Internal-Token
  // -------------------------------------------------------------------------
  it('retorna 401 sem X-Internal-Token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/internal/customers/${FIXTURE_LEAD_ID}/credit-analyses`,
      headers: { 'x-organization-id': FIXTURE_ORG_ID },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('UNAUTHORIZED');
    // Repositório não deve ter sido chamado
    expect(mockGetMaskedAnalysisHistory).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 5. 401 — token inválido
  // -------------------------------------------------------------------------
  it('retorna 401 com token inválido', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/internal/customers/${FIXTURE_LEAD_ID}/credit-analyses`,
      headers: { 'x-internal-token': 'wrong-token-here', 'x-organization-id': FIXTURE_ORG_ID },
    });

    expect(response.statusCode).toBe(401);
    expect(mockGetMaskedAnalysisHistory).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 6. 400 — X-Organization-Id ausente (multi-tenant scope)
  // -------------------------------------------------------------------------
  it('retorna 400 quando X-Organization-Id está ausente (regra inviolável #3)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/internal/customers/${FIXTURE_LEAD_ID}/credit-analyses`,
      headers: { 'x-internal-token': VALID_TOKEN },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('VALIDATION_ERROR');
    expect(mockGetMaskedAnalysisHistory).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 7. 400 — :id não é UUID válido
  // -------------------------------------------------------------------------
  it('retorna 400 quando :id não é UUID válido', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/customers/not-a-uuid/credit-analyses',
      headers: { 'x-internal-token': VALID_TOKEN, 'x-organization-id': FIXTURE_ORG_ID },
    });

    expect(response.statusCode).toBe(400);
    expect(mockGetMaskedAnalysisHistory).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 8. 404 — lead não existe na organização
  // -------------------------------------------------------------------------
  it('retorna 404 quando lead não existe na organização (org scope incorreto)', async () => {
    // O repositório lança LeadNotFoundInOrgError quando o lead não pertence à org
    const { LeadNotFoundInOrgError } = await import('../repository.js');
    mockGetMaskedAnalysisHistory.mockRejectedValue(
      new LeadNotFoundInOrgError(FIXTURE_LEAD_ID, FIXTURE_ORG_ID),
    );

    const response = await app.inject({
      method: 'GET',
      url: `/internal/customers/${FIXTURE_LEAD_ID}/credit-analyses`,
      headers: { 'x-internal-token': VALID_TOKEN, 'x-organization-id': FIXTURE_ORG_ID },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('NOT_FOUND');
  });

  // -------------------------------------------------------------------------
  // 9. LGPD — payload NÃO contém campos sensíveis
  //
  // Teste crítico: verifica ausência de parecer_text, pendencias, attachments,
  // internal_score, analyst_user_id, approved_amount, approved_term_months,
  // approved_rate_monthly.
  // Defesa em profundidade: mesmo com prompt injection, IA não obtém parecer.
  // -------------------------------------------------------------------------
  it('payload não contém parecer_text, internal_score, analyst_user_id, approved_amount', async () => {
    mockGetMaskedAnalysisHistory.mockResolvedValue([
      makeAnalysisRow({ status: 'aprovado', currentVersionNumber: 2 }),
    ]);

    const response = await app.inject({
      method: 'GET',
      url: `/internal/customers/${FIXTURE_LEAD_ID}/credit-analyses`,
      headers: { 'x-internal-token': VALID_TOKEN, 'x-organization-id': FIXTURE_ORG_ID },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const rawJson = response.body;

    // Verificar ausência no JSON serializado (segurança extra — detecta vazamento via serialização)
    const FORBIDDEN_FIELDS = [
      'parecer_text',
      'pendencias',
      'attachments',
      'internal_score',
      'analyst_user_id',
      'approved_amount',
      'approved_term_months',
      'approved_rate_monthly',
    ];

    for (const field of FORBIDDEN_FIELDS) {
      expect(rawJson).not.toContain(field);
    }

    // Verificar no objeto parsed também
    expect(body).not.toHaveProperty('parecer_text');
    expect(body).not.toHaveProperty('internal_score');
    expect(body).not.toHaveProperty('analyst_user_id');
    expect(body).not.toHaveProperty('approved_amount');

    // Itens individuais também não devem conter campos proibidos
    const item = body.items[0];
    for (const field of FORBIDDEN_FIELDS) {
      expect(item).not.toHaveProperty(field);
    }
  });

  // -------------------------------------------------------------------------
  // 10. 200 — análise sem versão ainda (current_version_number: 0)
  // -------------------------------------------------------------------------
  it('retorna current_version_number:0 quando análise ainda não tem parecer', async () => {
    mockGetMaskedAnalysisHistory.mockResolvedValue([
      makeAnalysisRow({ status: 'em_analise', currentVersionNumber: 0 }),
    ]);

    const response = await app.inject({
      method: 'GET',
      url: `/internal/customers/${FIXTURE_LEAD_ID}/credit-analyses`,
      headers: { 'x-internal-token': VALID_TOKEN, 'x-organization-id': FIXTURE_ORG_ID },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items[0].current_version_number).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 11. Repositório recebe leadId e organizationId corretos
  // -------------------------------------------------------------------------
  it('passa leadId e organizationId corretos para o repositório', async () => {
    mockGetMaskedAnalysisHistory.mockResolvedValue([]);

    const OTHER_ORG = 'eeeeeeee-0000-0000-0000-000000000099';

    await app.inject({
      method: 'GET',
      url: `/internal/customers/${FIXTURE_LEAD_ID}/credit-analyses`,
      headers: { 'x-internal-token': VALID_TOKEN, 'x-organization-id': OTHER_ORG },
    });

    expect(mockGetMaskedAnalysisHistory).toHaveBeenCalledWith(FIXTURE_LEAD_ID, OTHER_ORG);
  });
});
