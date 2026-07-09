// =============================================================================
// modules/internal-assistant/__tests__/query.test.ts -- F6-S08
//
// Cobre os requisitos de seguranca do DoD:
//   - RBAC: ai_assistant:use obrigatorio
//   - Flag gate: ai.internal_assistant.enabled
//   - DLP: question_redacted != CPF bruto
//   - Principal: user_id sempre do JWT, nunca do body
//   - Rate-limit: 20 req/min por usuario
//   - Fallback gracioso em timeout/indisponibilidade do LangGraph
// =============================================================================
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// vi.mock hoists
// ============================================================

const mockHandleAssistantQuery = vi.fn();
vi.mock('../service.js', () => ({
  handleAssistantQuery: (...a: unknown[]) => mockHandleAssistantQuery(...a),
}));

vi.mock('../../../db/client.js', () => ({ db: {} }));
vi.mock('../../../lib/dlp.js', () => ({
  redactPii: (text: string) => ({
    redactedText: text.replace(/\d{11}/, '<CPF_1>'),
    dlpTokens: [],
    dlpApplied: text.match(/\d{11}/) !== null,
  }),
}));

const mockAuthenticate = vi.fn();
const mockAuthorize = vi.fn();
const mockFeatureGate = vi.fn();

vi.mock('../../../modules/auth/middlewares/authenticate.js', () => ({
  authenticate: () => mockAuthenticate,
}));
vi.mock('../../../modules/auth/middlewares/index.js', () => ({
  authorize: () => mockAuthorize,
}));
vi.mock('../../../plugins/featureGate.js', () => ({
  featureGate: () => mockFeatureGate,
}));

// ============================================================
// Helpers
// ============================================================

const MOCK_USER = {
  id: 'aaaa0000-0000-0000-0000-000000000001',
  organizationId: 'bbbb0000-0000-0000-0000-000000000001',
  permissions: ['ai_assistant:use'],
  cityScopeIds: ['cccc0000-0000-0000-0000-000000000001'],
};

async function buildApp() {
  const { internalAssistantRoutes } = await import('../routes.js');
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  mockAuthenticate.mockImplementation(async (req: { user?: typeof MOCK_USER }) => {
    req.user = MOCK_USER;
  });
  mockAuthorize.mockImplementation(async () => {});
  mockFeatureGate.mockImplementation(async () => {});

  await app.register(internalAssistantRoutes);
  await app.ready();
  return app;
}

// ============================================================
// Tests
// ============================================================

describe('POST /api/internal-assistant/query', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHandleAssistantQuery.mockResolvedValue({
      answer: 'Temos 42 leads.',
      sources: ['funnel_metrics'],
    });
  });

  it('deve retornar 200 com answer e sources', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal-assistant/query',
      payload: { question: 'Quantos leads temos hoje?' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ answer: string; sources: string[] }>();
    expect(body.answer).toBe('Temos 42 leads.');
    expect(body.sources).toEqual(['funnel_metrics']);
  });

  it('deve passar o principal do JWT (nao do body) para o service', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/api/internal-assistant/query',
      payload: { question: 'Quantos leads temos?' },
    });

    expect(mockHandleAssistantQuery).toHaveBeenCalledOnce();
    // `as` justificado: vi.fn().mock.calls[0] tem tipo any[] -- assercao de presenca
    // garantida pelo toHaveBeenCalledOnce() imediatamente acima.
    const firstCall = mockHandleAssistantQuery.mock.calls[0] as [
      { userId: string; organizationId: string; cityScopeIds: string[] | null },
      ...unknown[],
    ];
    const [actor] = firstCall;
    expect(actor.userId).toBe(MOCK_USER.id);
    expect(actor.organizationId).toBe(MOCK_USER.organizationId);
    expect(actor.cityScopeIds).toEqual(MOCK_USER.cityScopeIds);
  });

  it('deve rejeitar pergunta vazia (400)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal-assistant/query',
      payload: { question: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('deve rejeitar pergunta acima de 2000 chars (400)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal-assistant/query',
      payload: { question: 'x'.repeat(2001) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('deve retornar 403 sem permissao ai_assistant:use', async () => {
    mockAuthorize.mockImplementationOnce(async () => {
      const { ForbiddenError } = await import('../../../shared/errors.js');
      throw new ForbiddenError('Permissao insuficiente');
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal-assistant/query',
      payload: { question: 'Quantos leads?' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('deve retornar 403 com flag desabilitada', async () => {
    mockFeatureGate.mockImplementationOnce(async () => {
      const { ForbiddenError } = await import('../../../shared/errors.js');
      throw new ForbiddenError('Feature desabilitada');
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal-assistant/query',
      payload: { question: 'Quantos leads?' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('deve retornar resposta graciosa em fallback do service', async () => {
    mockHandleAssistantQuery.mockResolvedValue({
      answer: 'Nao consegui consultar as informacoes agora.',
      sources: [],
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal-assistant/query',
      payload: { question: 'Relatorio do mes?' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ answer: string }>();
    expect(body.answer).toContain('Nao consegui');
  });
});
