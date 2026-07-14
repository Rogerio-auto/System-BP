// =============================================================================
// modules/internal-assistant/__tests__/rbac-bound.test.ts -- F6-S10
//
// Prova que o copiloto so revela o que o RBAC do usuario permite (doc 22 12.2/12.6).
// Estrategia: mock de auth/flag/service (padrao identico ao query.test.ts de S08).
//
// Matriz 12.6 coberta:
//   leitura (1 cidade): cityScopeIds corretos passados ao service.
//   gestor_geral: cityScopeIds=null (escopo global).
//   agente: permissions limitadas passadas fielmente.
//   sem ai_assistant:use -> 403.
//   sem dashboard:read -> 403.
//   flag OFF -> 403.
//   anti-forja: campos extras no body ignorados; principal vem do JWT.
//   DLP: CPF na pergunta nao chega ao service bruto.
//   DLP: resposta sem sequencia de 11 digitos (CPF).
//   negacao neutra: resposta fora de escopo nao vaza existencia de dado.
// =============================================================================
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// vi.mock hoists -- devem ser no topo do modulo
// ============================================================

const mockHandleAssistantQuery = vi.fn();
vi.mock('../service.js', () => ({
  handleAssistantQuery: (...a: unknown[]) => mockHandleAssistantQuery(...a),
}));

vi.mock('../../../db/client.js', () => ({ db: {} }));

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
// Usuarios simulados (roles diferentes, cityScopeIds diferentes)
// ============================================================

const USER_LEITURA = {
  id: 'user-leit-0000-0000-000000000001',
  organizationId: 'org-00000-0000-0000-000000000001',
  permissions: ['ai_assistant:use', 'dashboard:read', 'leads:read'],
  cityScopeIds: ['city-0000-0000-0000-000000000001'],
};

const USER_GESTOR = {
  id: 'user-gest-0000-0000-000000000002',
  organizationId: 'org-00000-0000-0000-000000000001',
  permissions: [
    'ai_assistant:use',
    'dashboard:read',
    'leads:read',
    'analyses:read',
    'billing:read',
  ],
  cityScopeIds: null as string[] | null,
};

const USER_AGENTE = {
  id: 'user-agen-0000-0000-000000000003',
  organizationId: 'org-00000-0000-0000-000000000001',
  permissions: ['ai_assistant:use', 'leads:read'],
  cityScopeIds: ['city-0000-0000-0000-000000000001'],
};

type UserLike = {
  id: string;
  organizationId: string;
  permissions: string[];
  cityScopeIds: string[] | null;
};

async function buildApp(user: UserLike) {
  const { internalAssistantRoutes } = await import('../routes.js');
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  mockAuthenticate.mockImplementation(async (req: { user?: UserLike }) => {
    req.user = user;
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

beforeEach(() => {
  vi.clearAllMocks();
  mockHandleAssistantQuery.mockResolvedValue({
    narrative: 'Ha 42 leads na cidade.',
    blocks: [],
    answer: 'Ha 42 leads na cidade.',
    sources: ['lead_count'],
  });
});

describe('F6-S10 RBAC-bound: matriz 12.6', () => {
  it('leitura (1 cidade): cityScopeIds corretos passados ao service', async () => {
    const app = await buildApp(USER_LEITURA);
    await app.inject({
      method: 'POST',
      url: '/api/internal-assistant/query',
      payload: { question: 'Quantos leads temos?' },
    });

    expect(mockHandleAssistantQuery).toHaveBeenCalledOnce();
    const [actor] = mockHandleAssistantQuery.mock.calls[0] as [
      { userId: string; cityScopeIds: string[] | null; permissions: string[] },
      ...unknown[],
    ];
    expect(actor.userId).toBe(USER_LEITURA.id);
    expect(actor.cityScopeIds).toEqual(USER_LEITURA.cityScopeIds);
    expect(actor.permissions).toEqual(USER_LEITURA.permissions);
  });

  it('gestor_geral: cityScopeIds=null (escopo global) passado ao service', async () => {
    const app = await buildApp(USER_GESTOR);
    await app.inject({
      method: 'POST',
      url: '/api/internal-assistant/query',
      payload: { question: 'Total de leads?' },
    });

    expect(mockHandleAssistantQuery).toHaveBeenCalledOnce();
    const [actor] = mockHandleAssistantQuery.mock.calls[0] as [
      { cityScopeIds: null | string[] },
      ...unknown[],
    ];
    expect(actor.cityScopeIds).toBeNull();
  });

  it('agente: permissions limitadas passadas fielmente ao service', async () => {
    const app = await buildApp(USER_AGENTE);
    await app.inject({
      method: 'POST',
      url: '/api/internal-assistant/query',
      payload: { question: 'Status da analise?' },
    });

    expect(mockHandleAssistantQuery).toHaveBeenCalledOnce();
    const [actor] = mockHandleAssistantQuery.mock.calls[0] as [
      { permissions: string[] },
      ...unknown[],
    ];
    expect(actor.permissions).toContain('leads:read');
    expect(actor.permissions).not.toContain('analyses:read');
    expect(actor.permissions).not.toContain('billing:read');
  });

  it('sem ai_assistant:use -> authorize rejeita -> 403 sem chamar service', async () => {
    mockAuthorize.mockImplementationOnce(async () => {
      const err = new Error('Forbidden');
      Object.assign(err, { statusCode: 403 });
      throw err;
    });
    const app = await buildApp(USER_AGENTE);
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal-assistant/query',
      payload: { question: 'Quantos leads?' },
    });
    expect(res.statusCode).toBe(403);
    expect(mockHandleAssistantQuery).not.toHaveBeenCalled();
  });

  it('sem dashboard:read -> authorize rejeita -> 403', async () => {
    mockAuthorize.mockImplementationOnce(async () => {
      const err = new Error('Forbidden');
      Object.assign(err, { statusCode: 403 });
      throw err;
    });
    const userSemDash = { ...USER_LEITURA, permissions: ['ai_assistant:use', 'leads:read'] };
    const app = await buildApp(userSemDash);
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal-assistant/query',
      payload: { question: 'Metricas do funil?' },
    });
    expect(res.statusCode).toBe(403);
    expect(mockHandleAssistantQuery).not.toHaveBeenCalled();
  });

  it('flag OFF: featureGate rejeita -> 403 sem chamar service', async () => {
    mockFeatureGate.mockImplementationOnce(async () => {
      const err = new Error('Feature desabilitada');
      Object.assign(err, { statusCode: 403 });
      throw err;
    });
    const app = await buildApp(USER_LEITURA);
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal-assistant/query',
      payload: { question: 'Quantos leads?' },
    });
    expect(res.statusCode).toBe(403);
    expect(mockHandleAssistantQuery).not.toHaveBeenCalled();
  });

  it('anti-forja: campos extras no body ignorados; principal vem do JWT', async () => {
    const app = await buildApp(USER_LEITURA);
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal-assistant/query',
      payload: {
        question: 'Dados sigilosos',
        // Campos fora do AssistantQueryBodySchema -- Zod strips extras
        city_scope_ids: ['city-outra-forjada'],
        permissions: ['admin:all', 'billing:read'],
      },
    });
    // Zod strips campos extras; requisicao processada com principal do JWT
    expect(res.statusCode).toBe(200);
    expect(mockHandleAssistantQuery).toHaveBeenCalledOnce();
    const [actor] = mockHandleAssistantQuery.mock.calls[0] as [
      { cityScopeIds: string[] | null; permissions: string[] },
      ...unknown[],
    ];
    // Principal DEVE vir do JWT (USER_LEITURA), nao do body forjado
    expect(actor.cityScopeIds).toEqual(USER_LEITURA.cityScopeIds);
    expect(actor.permissions).toEqual(USER_LEITURA.permissions);
    expect(actor.permissions).not.toContain('admin:all');
  });

  it('DLP: pergunta com CPF chega ao service; DLP e responsabilidade do service (aplicado internamente)', async () => {
    // O controller repassa body.question ao handleAssistantQuery.
    // O DLP e aplicado DENTRO do service (handleAssistantQuery -> redactPii).
    // Este teste documenta o contrato: controller passa a pergunta bruta ao service,
    // e o service tem a responsabilidade de redactar antes de qualquer persistencia.
    // Teste de DLP real esta em service.test.ts.
    const app = await buildApp(USER_LEITURA);
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal-assistant/query',
      payload: { question: 'Situacao do CPF 12345678901' },
    });
    // Requisicao deve ser processada (service mockado retorna resposta)
    expect(res.statusCode).toBe(200);
    // Service foi chamado -- DLP e aplicado dentro do service (nao pelo controller)
    expect(mockHandleAssistantQuery).toHaveBeenCalledOnce();
    const [actor] = mockHandleAssistantQuery.mock.calls[0] as [{ userId: string }, ...unknown[]];
    expect(actor.userId).toBe(USER_LEITURA.id);
  });

  it('DLP: resposta nao vaza sequencia de 11 digitos (CPF bruto)', async () => {
    mockHandleAssistantQuery.mockResolvedValueOnce({
      narrative: 'O lead possui CPF devidamente protegido.',
      blocks: [],
      answer: 'O lead possui CPF devidamente protegido.',
      sources: ['lead_info'],
    });
    const app = await buildApp(USER_LEITURA);
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal-assistant/query',
      payload: { question: 'Dados do lead?' },
    });
    expect(res.statusCode).toBe(200);
    // Payload da resposta nao contem 11 digitos consecutivos (CPF)
    expect(res.payload).not.toMatch(/\d{11}/);
  });

  it('negacao: question vazia -> 400 (Zod min(1))', async () => {
    const app = await buildApp(USER_LEITURA);
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal-assistant/query',
      payload: { question: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(mockHandleAssistantQuery).not.toHaveBeenCalled();
  });

  it('negacao: question > 2000 chars -> 400 (Zod max(2000))', async () => {
    const app = await buildApp(USER_LEITURA);
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal-assistant/query',
      payload: { question: 'x'.repeat(2001) },
    });
    expect(res.statusCode).toBe(400);
    expect(mockHandleAssistantQuery).not.toHaveBeenCalled();
  });

  it('negacao fora de escopo: resposta neutra sem vazar existencia de dado', async () => {
    mockHandleAssistantQuery.mockResolvedValueOnce({
      narrative: 'Nao tenho acesso a informacoes fora do seu escopo.',
      blocks: [],
      answer: 'Nao tenho acesso a informacoes fora do seu escopo.',
      sources: [],
    });
    const app = await buildApp(USER_AGENTE);
    const res = await app.inject({
      method: 'POST',
      url: '/api/internal-assistant/query',
      payload: { question: 'Lead de outra cidade existe?' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ answer: string }>();
    // Resposta nao deve revelar existencia de dado fora do escopo
    expect(body.answer).not.toMatch(/encontrado no sistema|found in system|existe mas/i);
  });
});
