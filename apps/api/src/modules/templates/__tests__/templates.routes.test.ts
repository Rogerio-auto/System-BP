// =============================================================================
// __tests__/templates.routes.test.ts — Testes de integração das rotas de templates.
//
// Contexto: F5-S09, F5-S12.
//
// Estratégia:
//   - Fastify sobe com templatesRoutes + plugin multipart.
//   - authenticate e authorize mockados para controlar acesso.
//   - Services mockados para isolar da DB.
//   - Cobre: CRUD + RBAC + validação Zod (DLP) + header de mídia + feature gate.
// =============================================================================
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks devem vir antes dos imports dos módulos que os usam
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

const mockListService = vi.fn();
const mockGetService = vi.fn();
const mockCreateService = vi.fn();
const mockUpdateService = vi.fn();
const mockDeleteService = vi.fn();
const mockSyncService = vi.fn();
const mockSyncAllService = vi.fn();

vi.mock('../service.js', () => ({
  listTemplatesService: (...args: unknown[]) => mockListService(...args),
  getTemplateService: (...args: unknown[]) => mockGetService(...args),
  createTemplateService: (...args: unknown[]) => mockCreateService(...args),
  updateTemplateService: (...args: unknown[]) => mockUpdateService(...args),
  deleteTemplateService: (...args: unknown[]) => mockDeleteService(...args),
  syncTemplateService: (...args: unknown[]) => mockSyncService(...args),
  syncAllService: (...args: unknown[]) => mockSyncAllService(...args),
}));

// Mock authenticate — injeta user no request
vi.mock('../../auth/middlewares/authenticate.js', () => ({
  authenticate: () => async (request: { user?: unknown }, _reply: unknown) => {
    request.user = {
      id: 'user-uuid',
      organizationId: 'org-uuid',
      permissions: ['templates:read', 'templates:write', 'templates:sync', 'templates:delete'],
      cityScopeIds: null,
    };
  },
}));

// Mock authorize — permite tudo por padrão
vi.mock('../../auth/middlewares/authorize.js', () => ({
  authorize: () => async () => {
    // no-op: todos passam
  },
}));

vi.mock('../../../db/client.js', () => ({
  db: {},
  pool: { connect: vi.fn(), end: vi.fn(), on: vi.fn() },
}));

import { templatesRoutes } from '../routes.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // Registrar multipart (necessário para testes com sampleUpload)
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  await app.register(templatesRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEMPLATE_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '22222222-2222-4222-8222-222222222222';

/** Fixture base — header 'none' (padrão histórico). */
const TEMPLATE_RESPONSE = {
  id: TEMPLATE_ID,
  organizationId: ORG_ID,
  metaTemplateId: 'meta_123',
  name: 'followup_d1',
  category: 'utility',
  language: 'pt_BR',
  body: 'Olá {{1}}, sua proposta está em análise.',
  variables: ['nome_cliente'],
  status: 'pending',
  headerType: 'none',
  headerText: null,
  headerHandle: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/** Fixture — header de texto. */
const TEMPLATE_TEXT_HEADER_RESPONSE = {
  ...TEMPLATE_RESPONSE,
  name: 'followup_text_header',
  headerType: 'text',
  headerText: 'Banco do Povo — Crédito Rural',
  headerHandle: null,
};

/** Fixture — header de documento (handle não exposto na resposta pública — L-4). */
const TEMPLATE_DOCUMENT_HEADER_RESPONSE = {
  ...TEMPLATE_RESPONSE,
  name: 'cobranca_boleto',
  headerType: 'document',
  headerText: null,
  // headerHandle omitido: token opaco da Meta não exposto ao frontend (L-4)
};

// ---------------------------------------------------------------------------
// GET /api/templates
// ---------------------------------------------------------------------------

describe('GET /api/templates', () => {
  it('200 — retorna lista paginada', async () => {
    mockListService.mockResolvedValue({
      data: [TEMPLATE_RESPONSE],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });

    const response = await app.inject({ method: 'GET', url: '/api/templates' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: unknown[]; total: number };
    expect(body.data).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it('200 — filtra por status=approved', async () => {
    mockListService.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });

    const response = await app.inject({ method: 'GET', url: '/api/templates?status=approved' });

    expect(response.statusCode).toBe(200);
    expect(mockListService).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'approved' }),
    );
  });
});

// ---------------------------------------------------------------------------
// GET /api/templates/:id
// ---------------------------------------------------------------------------

describe('GET /api/templates/:id', () => {
  it('200 — retorna template', async () => {
    mockGetService.mockResolvedValue(TEMPLATE_RESPONSE);

    const response = await app.inject({
      method: 'GET',
      url: `/api/templates/${TEMPLATE_ID}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { id: string };
    expect(body.id).toBe(TEMPLATE_ID);
  });
});

// ---------------------------------------------------------------------------
// POST /api/templates — JSON (header none)
// ---------------------------------------------------------------------------

describe('POST /api/templates (JSON)', () => {
  it('201 — cria template sem header (padrão)', async () => {
    mockCreateService.mockResolvedValue(TEMPLATE_RESPONSE);

    const response = await app.inject({
      method: 'POST',
      url: '/api/templates',
      payload: {
        name: 'followup_d1',
        category: 'utility',
        language: 'pt_BR',
        body: 'Olá {{1}}, sua proposta está em análise.',
        variables: ['nome_cliente'],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mockCreateService).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'followup_d1', headerType: 'none' }),
      expect.any(String),
      undefined,
      undefined,
    );
  });

  it('201 — cria template com headerType=text e headerText válido', async () => {
    mockCreateService.mockResolvedValue(TEMPLATE_TEXT_HEADER_RESPONSE);

    const response = await app.inject({
      method: 'POST',
      url: '/api/templates',
      payload: {
        name: 'followup_text_header',
        category: 'utility',
        language: 'pt_BR',
        body: 'Olá {{1}}, sua proposta está em análise.',
        variables: ['nome_cliente'],
        headerType: 'text',
        headerText: 'Banco do Povo — Crédito Rural',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mockCreateService).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ headerType: 'text', headerText: 'Banco do Povo — Crédito Rural' }),
      expect.any(String),
      undefined,
      undefined,
    );
  });

  it('400 — headerType=text sem headerText é rejeitado', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/templates',
      payload: {
        name: 'test_text_no_header_text',
        category: 'utility',
        language: 'pt_BR',
        body: 'Olá {{1}}, proposta em análise.',
        variables: [],
        headerType: 'text',
        // headerText ausente → deve falhar
      },
    });

    expect(response.statusCode).toBe(400);
    expect(mockCreateService).not.toHaveBeenCalled();
  });

  it('400 — DLP: body com CPF hardcoded é rejeitado', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/templates',
      payload: {
        name: 'test_cpf',
        category: 'utility',
        language: 'pt_BR',
        body: 'Seu CPF é 123.456.789-00 e seu crédito foi aprovado.',
        variables: [],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(mockCreateService).not.toHaveBeenCalled();
  });

  it('400 — DLP: body com e-mail hardcoded é rejeitado', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/templates',
      payload: {
        name: 'test_email',
        category: 'utility',
        language: 'pt_BR',
        body: 'Acesse seu portal em usuario@banco.gov.br para mais informações.',
        variables: [],
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('400 — DLP: headerText com CPF hardcoded é rejeitado', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/templates',
      payload: {
        name: 'test_header_cpf',
        category: 'utility',
        language: 'pt_BR',
        body: 'Olá {{1}}, sua proposta está em análise.',
        variables: [],
        headerType: 'text',
        headerText: 'CPF: 123.456.789-00 — Banco do Povo',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(mockCreateService).not.toHaveBeenCalled();
  });

  it('400 — body com name inválido (caracteres especiais)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/templates',
      payload: {
        name: 'NOME INVÁLIDO com espaços',
        category: 'utility',
        language: 'pt_BR',
        body: 'Template válido {{1}}',
        variables: ['nome'],
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('400 — headerText presente quando headerType≠text é rejeitado', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/templates',
      payload: {
        name: 'test_bad_header',
        category: 'utility',
        language: 'pt_BR',
        body: 'Olá {{1}}, proposta em análise.',
        variables: [],
        headerType: 'none',
        headerText: 'Texto indevido',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(mockCreateService).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /api/templates — multipart (header de mídia)
// ---------------------------------------------------------------------------

describe('POST /api/templates (multipart — header de mídia)', () => {
  it('201 — cria template de documento com sampleUpload (mock service)', async () => {
    mockCreateService.mockResolvedValue(TEMPLATE_DOCUMENT_HEADER_RESPONSE);

    // Construir multipart manualmente usando boundary
    const boundary = '----TestBoundary123';
    const jsonData = JSON.stringify({
      name: 'cobranca_boleto',
      category: 'utility',
      language: 'pt_BR',
      body: 'Segue seu boleto {{1}}.',
      variables: ['nome_cliente'],
      headerType: 'document',
    });
    const pdfSample = Buffer.from('%PDF-1.4 sample');

    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="data"',
      '',
      jsonData,
      `--${boundary}`,
      'Content-Disposition: form-data; name="sampleUpload"; filename="sample.pdf"',
      'Content-Type: application/pdf',
      '',
      pdfSample.toString('binary'),
      `--${boundary}--`,
    ].join('\r\n');

    const response = await app.inject({
      method: 'POST',
      url: '/api/templates',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(response.statusCode).toBe(201);
    // Verifica que createService foi chamado com buffer de amostra e mimeType
    expect(mockCreateService).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ headerType: 'document' }),
      expect.any(String),
      expect.any(Buffer),
      'application/pdf',
    );
  });

  // L-2 / M-1: data JSON realista (>100 bytes) deve passar sem truncamento.
  // Antes da correção M-1, o fieldSize default de 100 bytes do @fastify/multipart
  // truncava o JSON silenciosamente, causando falha de parse.
  it('201 — data JSON realista >100 bytes não é truncado (M-1)', async () => {
    mockCreateService.mockResolvedValue(TEMPLATE_DOCUMENT_HEADER_RESPONSE);

    const boundary = '----TestBoundaryRealSize';
    // JSON com body de 50+ chars garante >100 bytes no campo 'data'
    const jsonData = JSON.stringify({
      name: 'cobranca_boleto_realista',
      category: 'utility',
      language: 'pt_BR',
      body: 'Olá {{1}}, segue o boleto ref. ao contrato {{2}} vencendo em {{3}}. Banco do Povo.',
      variables: ['nome_cliente', 'contrato', 'vencimento'],
      headerType: 'document',
    });
    // Confirmar que o JSON supera 100 bytes (requisito do teste)
    expect(Buffer.byteLength(jsonData)).toBeGreaterThan(100);

    const pdfSample = Buffer.from('%PDF-1.4 test-sample');

    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="data"',
      '',
      jsonData,
      `--${boundary}`,
      'Content-Disposition: form-data; name="sampleUpload"; filename="sample.pdf"',
      'Content-Type: application/pdf',
      '',
      pdfSample.toString('binary'),
      `--${boundary}--`,
    ].join('\r\n');

    const response = await app.inject({
      method: 'POST',
      url: '/api/templates',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(response.statusCode).toBe(201);
    expect(mockCreateService).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: 'cobranca_boleto_realista',
        headerType: 'document',
        body: 'Olá {{1}}, segue o boleto ref. ao contrato {{2}} vencendo em {{3}}. Banco do Povo.',
      }),
      expect.any(String),
      expect.any(Buffer),
      'application/pdf',
    );
  });

  // L-2: upload acima do limite de tamanho → 413.
  it('413 — sampleUpload acima de 10 MB retorna 413', async () => {
    const boundary = '----TestBoundaryOversize';
    const jsonData = JSON.stringify({
      name: 'cobranca_boleto',
      category: 'utility',
      language: 'pt_BR',
      body: 'Segue seu boleto {{1}}.',
      variables: ['nome_cliente'],
      headerType: 'document',
    });

    // Criar buffer de 10 MB + 1 byte para garantir que ultrapassa o limite
    const oversizedFile = Buffer.alloc(10 * 1024 * 1024 + 1, 'x');

    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="data"',
      '',
      jsonData,
      `--${boundary}`,
      'Content-Disposition: form-data; name="sampleUpload"; filename="big.pdf"',
      'Content-Type: application/pdf',
      '',
      oversizedFile.toString('binary'),
      `--${boundary}--`,
    ].join('\r\n');

    const response = await app.inject({
      method: 'POST',
      url: '/api/templates',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(response.statusCode).toBe(413);
    expect(mockCreateService).not.toHaveBeenCalled();
  });

  // L-2: DLP no path multipart — data JSON com headerText contendo CPF → rejeitado.
  it('400 — DLP: data JSON com headerText contendo CPF é rejeitado no multipart', async () => {
    const boundary = '----TestBoundaryDlpMultipart';
    const jsonData = JSON.stringify({
      name: 'test_dlp_multipart',
      category: 'utility',
      language: 'pt_BR',
      body: 'Olá {{1}}, seu crédito foi aprovado.',
      variables: ['nome_cliente'],
      headerType: 'text',
      headerText: 'CPF: 123.456.789-00 — Banco do Povo',
    });

    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="data"',
      '',
      jsonData,
      `--${boundary}--`,
    ].join('\r\n');

    const response = await app.inject({
      method: 'POST',
      url: '/api/templates',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(response.statusCode).toBe(400);
    expect(mockCreateService).not.toHaveBeenCalled();
  });

  it('400 — multipart sem campo data é rejeitado', async () => {
    const boundary = '----TestBoundary456';
    const pdfSample = Buffer.from('%PDF-1.4 sample');

    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="sampleUpload"; filename="sample.pdf"',
      'Content-Type: application/pdf',
      '',
      pdfSample.toString('binary'),
      `--${boundary}--`,
    ].join('\r\n');

    const response = await app.inject({
      method: 'POST',
      url: '/api/templates',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(response.statusCode).toBe(400);
    expect(mockCreateService).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /api/templates — gate templates.media.enabled
// ---------------------------------------------------------------------------

describe('POST /api/templates — gate templates.media.enabled', () => {
  it('403 — service lança FeatureDisabledError quando flag off', async () => {
    const { FeatureDisabledError } = await import('../../../shared/errors.js');
    mockCreateService.mockRejectedValue(new FeatureDisabledError('templates.media.enabled'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/templates',
      payload: {
        name: 'test_media_gate',
        category: 'utility',
        language: 'pt_BR',
        body: 'Segue seu boleto {{1}}.',
        variables: ['nome_cliente'],
        headerType: 'document',
      },
    });

    // FeatureDisabledError → 403
    expect(response.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/templates/:id
// ---------------------------------------------------------------------------

describe('PATCH /api/templates/:id', () => {
  it('200 — edita body do template', async () => {
    mockUpdateService.mockResolvedValue({ ...TEMPLATE_RESPONSE, body: 'Novo body {{1}}' });

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/templates/${TEMPLATE_ID}`,
      payload: { body: 'Novo body {{1}}' },
    });

    expect(response.statusCode).toBe(200);
  });

  it('200 — edita headerType para text com headerText válido', async () => {
    mockUpdateService.mockResolvedValue(TEMPLATE_TEXT_HEADER_RESPONSE);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/templates/${TEMPLATE_ID}`,
      payload: { headerType: 'text', headerText: 'Banco do Povo — Crédito Rural' },
    });

    expect(response.statusCode).toBe(200);
    expect(mockUpdateService).toHaveBeenCalledWith(
      expect.anything(),
      TEMPLATE_ID,
      expect.objectContaining({ headerType: 'text', headerText: 'Banco do Povo — Crédito Rural' }),
      undefined,
      undefined,
    );
  });

  it('400 — PATCH com headerType=text sem headerText é rejeitado', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/templates/${TEMPLATE_ID}`,
      payload: { headerType: 'text' },
    });

    expect(response.statusCode).toBe(400);
    expect(mockUpdateService).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/templates/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/templates/:id', () => {
  it('200 — soft delete retorna template com status paused', async () => {
    mockDeleteService.mockResolvedValue({ ...TEMPLATE_RESPONSE, status: 'paused' });

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/templates/${TEMPLATE_ID}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { status: string };
    expect(body.status).toBe('paused');
  });
});

// ---------------------------------------------------------------------------
// POST /api/templates/:id/sync
// ---------------------------------------------------------------------------

describe('POST /api/templates/:id/sync', () => {
  it('200 — retorna template sincronizado', async () => {
    mockSyncService.mockResolvedValue({ ...TEMPLATE_RESPONSE, status: 'approved' });

    const response = await app.inject({
      method: 'POST',
      url: `/api/templates/${TEMPLATE_ID}/sync`,
      headers: { 'idempotency-key': 'test-key-123' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { status: string };
    expect(body.status).toBe('approved');
  });
});

// ---------------------------------------------------------------------------
// POST /api/templates/sync-all
// ---------------------------------------------------------------------------

describe('POST /api/templates/sync-all', () => {
  it('200 — retorna contagem de sync', async () => {
    mockSyncAllService.mockResolvedValue({ synced: 3, unchanged: 2, errors: 0 });

    const response = await app.inject({
      method: 'POST',
      url: '/api/templates/sync-all',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { synced: number; unchanged: number; errors: number };
    expect(body.synced).toBe(3);
    expect(body.unchanged).toBe(2);
    expect(body.errors).toBe(0);
  });
});
