// =============================================================================
// account/__tests__/avatar.routes.test.ts — Testes de integração (avatar).
//
// Estratégia: sobe Fastify com accountRoutes, mocka authenticate e service
// para controlar contexto e dados. Espelha account.routes.test.ts.
//
// Testes cobertos:
//   1.  POST /api/account/avatar/signed-url (sucesso)        → 200 + key formato correto
//   2.  POST /api/account/avatar/signed-url mime inválido    → 400 (Zod)
//   3.  POST /api/account/avatar/signed-url size > 2 MB      → 400 (Zod)
//   4.  POST /api/account/avatar/signed-url sem fileName     → 400 (Zod)
//   5.  PUT  /api/account/avatar (sucesso)                   → 200 retorna perfil com avatarUrl
//   6.  PUT  /api/account/avatar URL fora do R2              → 400 (service ValidationError)
//   7.  PUT  /api/account/avatar avatarUrl ausente           → 400 (Zod)
//   8.  DELETE /api/account/avatar (sucesso)                 → 200 retorna perfil sem avatar
//   9.  POST /api/account/avatar/signed-url sem auth         → não retorna 200
//   10. PUT  /api/account/avatar sem auth                    → não retorna 200
// =============================================================================
import { AVATAR_MAX_BYTES } from '@elemento/shared-schemas';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { isAppError } from '../../../shared/errors.js';
import { accountRoutes } from '../routes.js';

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
// Mock authenticate
// ---------------------------------------------------------------------------
vi.mock('../../auth/middlewares/authenticate.js', () => ({
  authenticate: () => async () => {
    // no-op: request.user injetado pelo hook global no buildTestApp
  },
}));

// ---------------------------------------------------------------------------
// Mock db/client
// ---------------------------------------------------------------------------
vi.mock('../../../db/client.js', () => ({
  db: {},
  pool: { end: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mock service
// ---------------------------------------------------------------------------
const mockCreateAvatarSignedUrl = vi.fn();
const mockSetAvatar = vi.fn();
const mockRemoveAvatar = vi.fn();

vi.mock('../service.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createAvatarSignedUrl: (...args: unknown[]) => mockCreateAvatarSignedUrl(...args),
    setAvatar: (...args: unknown[]) => mockSetAvatar(...args),
    removeAvatar: (...args: unknown[]) => mockRemoveAvatar(...args),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_USER_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const FIXTURE_R2_BASE = 'https://cdn.example.com';

/** URL pública de avatar válida (pertence ao FIXTURE_R2_BASE). */
const FIXTURE_AVATAR_URL = `${FIXTURE_R2_BASE}/avatars/${FIXTURE_ORG_ID}/${FIXTURE_USER_ID}/test-uuid.jpg`;

/** Perfil com avatar preenchido (resposta de PUT /api/account/avatar). */
const FIXTURE_PROFILE_WITH_AVATAR = {
  id: FIXTURE_USER_ID,
  email: 'agente@bdp.ro.gov.br',
  fullName: 'Agente Teste',
  organizationId: FIXTURE_ORG_ID,
  requiresPersonalEmail: false,
  personalEmail: null as string | null,
  avatarUrl: FIXTURE_AVATAR_URL,
};

/** Perfil sem avatar (resposta de DELETE /api/account/avatar). */
const FIXTURE_PROFILE_NO_AVATAR = {
  ...FIXTURE_PROFILE_WITH_AVATAR,
  avatarUrl: null as string | null,
};

/** Resposta do serviço de signed URL. */
const FIXTURE_SIGNED_URL_RESPONSE = {
  uploadUrl: 'https://upload.r2.cloudflarestorage.com/bucket/key?X-Amz-Signature=abc',
  publicUrl: FIXTURE_AVATAR_URL,
  key: `avatars/${FIXTURE_ORG_ID}/${FIXTURE_USER_ID}/test-uuid.jpg`,
};

// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------

async function buildTestApp(injectUser = true): Promise<FastifyInstance> {
  const app = Fastify({ logger: false }).withTypeProvider();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  if (injectUser) {
    app.addHook('preHandler', async (request) => {
      request.user = {
        id: FIXTURE_USER_ID,
        organizationId: FIXTURE_ORG_ID,
        permissions: [],
        cityScopeIds: null,
      };
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      const body: Record<string, unknown> = {
        error: error.code,
        message: error.message,
      };
      if (error.details !== undefined) body['details'] = error.details;
      return reply.status(error.statusCode).send(body);
    }
    if (
      error !== null &&
      typeof error === 'object' &&
      'validation' in error &&
      (error as Record<string, unknown>)['validation'] !== undefined
    ) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: (error as Record<string, unknown>)['validation'],
      });
    }
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
  });

  await app.register(accountRoutes);
  return app;
}

// ---------------------------------------------------------------------------
// Shared app instances
// ---------------------------------------------------------------------------

let app: FastifyInstance;
let appNoUser: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp(true);
  appNoUser = await buildTestApp(false);
}, 30_000);

afterAll(async () => {
  await app.close();
  await appNoUser.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// POST /api/account/avatar/signed-url
// ---------------------------------------------------------------------------

describe('POST /api/account/avatar/signed-url', () => {
  it('1. retorna uploadUrl + publicUrl + key com formato correto → 200', async () => {
    mockCreateAvatarSignedUrl.mockResolvedValueOnce(FIXTURE_SIGNED_URL_RESPONSE);

    const res = await app.inject({
      method: 'POST',
      url: '/api/account/avatar/signed-url',
      headers: { 'content-type': 'application/json' },
      payload: {
        fileName: 'foto.jpg',
        mime: 'image/jpeg',
        sizeBytes: 512_000,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<typeof FIXTURE_SIGNED_URL_RESPONSE>();
    expect(body.uploadUrl).toBeTruthy();
    expect(body.publicUrl).toBeTruthy();

    // Key deve seguir o padrão: avatars/{orgId}/{userId}/{uuid}.{ext}
    expect(body.key).toMatch(/^avatars\/[^/]+\/[^/]+\/.+\.(png|jpg|webp)$/);

    // Garantia self-service: actor.userId vem de request.user, não do body
    expect(mockCreateAvatarSignedUrl).toHaveBeenCalledOnce();
    const [_db, actor] = mockCreateAvatarSignedUrl.mock.calls[0]!;
    expect(actor.userId).toBe(FIXTURE_USER_ID);
    expect(actor.organizationId).toBe(FIXTURE_ORG_ID);
  });

  it('2. mime inválido (text/plain) → 400 (Zod — schema rejeita antes do service)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/account/avatar/signed-url',
      headers: { 'content-type': 'application/json' },
      payload: {
        fileName: 'doc.txt',
        mime: 'text/plain',
        sizeBytes: 1024,
      },
    });

    expect(res.statusCode).toBe(400);
    // Schema Zod rejeita antes do service — service nunca é chamado
    expect(mockCreateAvatarSignedUrl).not.toHaveBeenCalled();
  });

  it('3. size > 2 MB → 400 (Zod — AVATAR_MAX_BYTES)', async () => {
    // Um byte além do limite
    const overLimit = AVATAR_MAX_BYTES + 1;

    const res = await app.inject({
      method: 'POST',
      url: '/api/account/avatar/signed-url',
      headers: { 'content-type': 'application/json' },
      payload: {
        fileName: 'enorme.jpg',
        mime: 'image/jpeg',
        sizeBytes: overLimit,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(mockCreateAvatarSignedUrl).not.toHaveBeenCalled();
  });

  it('4. fileName ausente → 400 (Zod)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/account/avatar/signed-url',
      headers: { 'content-type': 'application/json' },
      payload: {
        mime: 'image/png',
        sizeBytes: 1024,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(mockCreateAvatarSignedUrl).not.toHaveBeenCalled();
  });

  it('9. sem autenticação → não retorna 200', async () => {
    const res = await appNoUser.inject({
      method: 'POST',
      url: '/api/account/avatar/signed-url',
      headers: { 'content-type': 'application/json' },
      payload: {
        fileName: 'foto.jpg',
        mime: 'image/jpeg',
        sizeBytes: 512_000,
      },
    });

    expect(res.statusCode).not.toBe(200);
    expect(mockCreateAvatarSignedUrl).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PUT /api/account/avatar
// ---------------------------------------------------------------------------

describe('PUT /api/account/avatar', () => {
  it('5. persiste avatar com sucesso → 200 retorna perfil com avatarUrl', async () => {
    mockSetAvatar.mockResolvedValueOnce(FIXTURE_PROFILE_WITH_AVATAR);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/account/avatar',
      headers: { 'content-type': 'application/json' },
      payload: { avatarUrl: FIXTURE_AVATAR_URL },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<typeof FIXTURE_PROFILE_WITH_AVATAR>();
    expect(body.avatarUrl).toBe(FIXTURE_AVATAR_URL);
    expect(body.id).toBe(FIXTURE_USER_ID);

    // Garantia self-service: service recebeu userId do request.user — não do body
    expect(mockSetAvatar).toHaveBeenCalledOnce();
    const [_db, actor, bodyArg] = mockSetAvatar.mock.calls[0]!;
    expect(actor.userId).toBe(FIXTURE_USER_ID);
    expect((bodyArg as { avatarUrl: string }).avatarUrl).toBe(FIXTURE_AVATAR_URL);
  });

  it('6. URL fora do R2_PUBLIC_URL → 400 (service lança ValidationError)', async () => {
    const { ValidationError } = await import('../../../shared/errors.js');
    mockSetAvatar.mockRejectedValueOnce(
      new ValidationError(
        [],
        'URL de avatar inválida: deve pertencer ao domínio de storage configurado.',
      ),
    );

    const res = await app.inject({
      method: 'PUT',
      url: '/api/account/avatar',
      headers: { 'content-type': 'application/json' },
      // URL de servidor externo arbitrário — anti-SSRF
      payload: { avatarUrl: 'https://attacker.example.com/evil.jpg' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string; message: string }>();
    expect(body.error).toBe('VALIDATION_ERROR');
  });

  it('7. avatarUrl ausente no body → 400 (Zod)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/account/avatar',
      headers: { 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(mockSetAvatar).not.toHaveBeenCalled();
  });

  it('10. sem autenticação → não retorna 200', async () => {
    const res = await appNoUser.inject({
      method: 'PUT',
      url: '/api/account/avatar',
      headers: { 'content-type': 'application/json' },
      payload: { avatarUrl: FIXTURE_AVATAR_URL },
    });

    expect(res.statusCode).not.toBe(200);
    expect(mockSetAvatar).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/account/avatar
// ---------------------------------------------------------------------------

describe('DELETE /api/account/avatar', () => {
  it('8. remove avatar com sucesso → 200 retorna perfil com avatarUrl null', async () => {
    mockRemoveAvatar.mockResolvedValueOnce(FIXTURE_PROFILE_NO_AVATAR);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/account/avatar',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<typeof FIXTURE_PROFILE_NO_AVATAR>();
    // avatarUrl deve ser null após remoção
    expect(body.avatarUrl).toBeNull();
    expect(body.id).toBe(FIXTURE_USER_ID);

    // Garantia self-service: service recebeu userId do request.user
    expect(mockRemoveAvatar).toHaveBeenCalledOnce();
    const [_db, actor] = mockRemoveAvatar.mock.calls[0]!;
    expect(actor.userId).toBe(FIXTURE_USER_ID);
  });
});
