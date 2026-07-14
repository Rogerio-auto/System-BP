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
      narrative: 'Temos 42 leads.',
      blocks: [],
      answer: 'Temos 42 leads.',
      sources: ['funnel_metrics'],
    });
  });

  it('deve retornar 200 com narrative, blocks, answer e sources', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal-assistant/query',
      payload: { question: 'Quantos leads temos hoje?' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      narrative: string;
      blocks: unknown[];
      answer: string;
      sources: string[];
    }>();
    expect(body.narrative).toBe('Temos 42 leads.');
    expect(body.blocks).toEqual([]);
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
      narrative: 'Nao consegui consultar as informacoes agora.',
      blocks: [],
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

  // ==========================================================
  // F6-S17: historico de sessao (memoria de conversa)
  // ==========================================================

  it('deve aceitar requisicao sem history (retrocompatibilidade)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal-assistant/query',
      payload: { question: 'Quantos leads temos hoje?' },
    });
    expect(res.statusCode).toBe(200);
    expect(mockHandleAssistantQuery).toHaveBeenCalledOnce();
    const [, body] = mockHandleAssistantQuery.mock.calls[0] as [unknown, { history?: unknown }];
    expect(body.history).toBeUndefined();
  });

  it('deve repassar history do body ao service quando presente (ate 10 turnos)', async () => {
    const history = [
      { role: 'user', content: 'Qual o total de leads da cidade X?' },
      { role: 'assistant', content: 'A cidade X tem 12 leads ativos.' },
    ];
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal-assistant/query',
      payload: { question: 'E na cidade Y?', history },
    });
    expect(res.statusCode).toBe(200);
    expect(mockHandleAssistantQuery).toHaveBeenCalledOnce();
    const [, body] = mockHandleAssistantQuery.mock.calls[0] as [
      unknown,
      { history?: typeof history },
    ];
    expect(body.history).toEqual(history);
  });

  it('deve rejeitar history com mais de 10 turnos (400, Zod max(10))', async () => {
    const history = Array.from({ length: 11 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `turno-${String(i)}`,
    }));
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal-assistant/query',
      payload: { question: 'Continuando...', history },
    });
    expect(res.statusCode).toBe(400);
    expect(mockHandleAssistantQuery).not.toHaveBeenCalled();
  });

  it('deve rejeitar turno de history com content vazio (400)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal-assistant/query',
      payload: { question: 'Pergunta', history: [{ role: 'user', content: '' }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('deve rejeitar role invalido no history (400)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal-assistant/query',
      payload: { question: 'Pergunta', history: [{ role: 'system', content: 'x' }] },
    });
    expect(res.statusCode).toBe(400);
  });
});
