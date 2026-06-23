// =============================================================================
// supabase.test.ts — Testes unitários do driver Supabase Storage.
//
// Estratégia: mock global fetch via vi.stubGlobal — sem conexão real.
//
// Cenários cobertos:
//   1. putObject: verifica URL, headers (Authorization, Content-Type, x-upsert), body.
//   2. putObject: lança erro quando resposta não-ok.
//   3. getPublicUrl: verifica formato da URL gerada.
//   4. getSignedUrl: verifica montagem da URL completa a partir de signedURL parcial.
//   5. getSignedUrl: lança erro quando resposta não-ok.
//   6. headObject: resposta 200 → retorna contentType, contentLength, metadata.
//   7. headObject: resposta 404 → retorna null.
//   8. headObject: lança erro em resposta não-ok (não-404).
//   9. createSignedUploadUrl: verifica URL completa e publicUrl.
//  10. createSignedUploadUrl: lança erro quando resposta não-ok.
// =============================================================================
import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock env — configurado com Supabase
// ---------------------------------------------------------------------------
vi.mock('../../../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    STORAGE_PROVIDER: 'supabase',
    SUPABASE_STORAGE_URL: 'http://supabase-internal:8000',
    SUPABASE_STORAGE_PUBLIC_URL: 'https://storage.example.com',
    SUPABASE_SERVICE_KEY: 'service-key-secret',
    SUPABASE_STORAGE_BUCKET: 'elemento-media',
  },
}));

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------
vi.mock('../../../lib/logger.js', () => ({
  logger: {
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    }),
  },
}));

// ---------------------------------------------------------------------------
// Import do módulo APÓS os mocks
// ---------------------------------------------------------------------------
import {
  createSignedUploadUrl,
  getPublicUrl,
  getSignedUrl,
  headObject,
  putObject,
} from '../supabase.js';

// ---------------------------------------------------------------------------
// Helpers de mock de fetch
// ---------------------------------------------------------------------------

function mockFetchOk(body: unknown, status = 200): void {
  const mockResponse = {
    ok: true,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));
}

function mockFetchError(status: number, bodyText = 'error'): void {
  const mockResponse = {
    ok: false,
    status,
    json: vi.fn().mockResolvedValue({}),
    text: vi.fn().mockResolvedValue(bodyText),
  };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('supabase storage driver', () => {
  // -------------------------------------------------------------------------
  // putObject
  // -------------------------------------------------------------------------
  describe('putObject', () => {
    it('1. POST com URL correta, Authorization, Content-Type e x-upsert', async () => {
      mockFetchOk({ Key: 'elemento-media/org/uuid.jpg' });

      const body = Buffer.from('fake-bytes');
      await putObject('org/uuid.jpg', body, 'image/jpeg');

      const fetchMock = vi.mocked(fetch);
      expect(fetchMock).toHaveBeenCalledOnce();

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

      // URL: POST /storage/v1/object/{bucket}/{key}
      // A chave usa barras literais como separadores de path (hierarquia de diretórios)
      expect(url).toBe(
        'http://supabase-internal:8000/storage/v1/object/elemento-media/org/uuid.jpg',
      );

      expect(init.method).toBe('POST');

      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer service-key-secret');
      expect(headers['Content-Type']).toBe('image/jpeg');
      expect(headers['x-upsert']).toBe('true');

      // Body é o Buffer passado
      expect(init.body).toBe(body);
    });

    it('2. lança erro quando resposta não-ok', async () => {
      mockFetchError(413, 'Payload Too Large');

      await expect(putObject('org/uuid.jpg', Buffer.from('x'), 'image/jpeg')).rejects.toThrow(
        'Supabase Storage putObject falhou: 413',
      );
    });
  });

  // -------------------------------------------------------------------------
  // getPublicUrl
  // -------------------------------------------------------------------------
  describe('getPublicUrl', () => {
    it('3. monta URL pública corretamente', () => {
      const url = getPublicUrl('org/2026/06/23/uuid.jpg');
      // Barras na key são separadores de path — não codificadas
      expect(url).toBe(
        'https://storage.example.com/storage/v1/object/public/elemento-media/org/2026/06/23/uuid.jpg',
      );
    });

    it('3b. key sem subpastas também funciona', () => {
      const url = getPublicUrl('uuid-simple.png');
      expect(url).toBe(
        'https://storage.example.com/storage/v1/object/public/elemento-media/uuid-simple.png',
      );
    });
  });

  // -------------------------------------------------------------------------
  // getSignedUrl
  // -------------------------------------------------------------------------
  describe('getSignedUrl', () => {
    it('4. retorna URL completa baseada em PUBLIC_BASE + signedURL parcial', async () => {
      mockFetchOk({ signedURL: '/object/sign/elemento-media/org%2Fuuid.jpg?token=abc123' });

      const url = await getSignedUrl('org/uuid.jpg', 3600);

      // URL final = PUBLIC_BASE + /storage/v1 + signedURL
      expect(url).toBe(
        'https://storage.example.com/storage/v1/object/sign/elemento-media/org%2Fuuid.jpg?token=abc123',
      );

      const fetchMock = vi.mocked(fetch);
      const [fetchUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];

      // Verifica que chamou o endpoint correto — barras na key são path separators
      expect(fetchUrl).toBe(
        'http://supabase-internal:8000/storage/v1/object/sign/elemento-media/org/uuid.jpg',
      );
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({ expiresIn: 3600 });
    });

    it('5. lança erro quando resposta não-ok', async () => {
      mockFetchError(403, 'Forbidden');

      await expect(getSignedUrl('org/uuid.jpg')).rejects.toThrow(
        'Supabase Storage getSignedUrl falhou: 403',
      );
    });
  });

  // -------------------------------------------------------------------------
  // headObject
  // -------------------------------------------------------------------------
  describe('headObject', () => {
    it('6. resposta 200 → retorna contentType, contentLength, metadata', async () => {
      mockFetchOk({
        size: 102400,
        contentType: 'image/jpeg',
        metadata: { 'x-message-id': 'msg-uuid' },
      });

      const result = await headObject('org/uuid.jpg');

      expect(result).toEqual({
        contentType: 'image/jpeg',
        contentLength: 102400,
        metadata: { 'x-message-id': 'msg-uuid' },
      });
    });

    it('6b. campo mimetype (variante da API) também mapeado para contentType', async () => {
      mockFetchOk({ size: 512, mimetype: 'audio/mpeg' });

      const result = await headObject('org/audio.mp3');

      expect(result).toEqual({ contentType: 'audio/mpeg', contentLength: 512 });
    });

    it('7. resposta 404 → retorna null', async () => {
      mockFetchError(404, 'Not Found');

      const result = await headObject('org/nonexistent.jpg');

      expect(result).toBeNull();
    });

    it('8. lança erro em resposta não-ok (não-404)', async () => {
      mockFetchError(500, 'Internal Server Error');

      await expect(headObject('org/uuid.jpg')).rejects.toThrow(
        'Supabase Storage headObject falhou: 500',
      );
    });
  });

  // -------------------------------------------------------------------------
  // createSignedUploadUrl
  // -------------------------------------------------------------------------
  describe('createSignedUploadUrl', () => {
    it('9. retorna uploadUrl completa e publicUrl correta', async () => {
      mockFetchOk({
        url: '/object/upload/sign/elemento-media/outbound%2Forg%2Fuuid.jpg?token=tok123',
      });

      const result = await createSignedUploadUrl('outbound/org/uuid.jpg', 'image/jpeg');

      // uploadUrl = PUBLIC_BASE + /storage/v1 + url
      expect(result.uploadUrl).toBe(
        'https://storage.example.com/storage/v1/object/upload/sign/elemento-media/outbound%2Forg%2Fuuid.jpg?token=tok123',
      );

      // publicUrl = URL pública sem token — barras na key são path separators
      expect(result.publicUrl).toBe(
        'https://storage.example.com/storage/v1/object/public/elemento-media/outbound/org/uuid.jpg',
      );

      const fetchMock = vi.mocked(fetch);
      const [fetchUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];

      // Endpoint correto — barras na key são path separators
      expect(fetchUrl).toBe(
        'http://supabase-internal:8000/storage/v1/object/upload/sign/elemento-media/outbound/org/uuid.jpg',
      );
      // Body DEVE ser '{}' — corpo vazio causa erro na API
      expect(init.body).toBe('{}');
    });

    it('10. lança erro quando resposta não-ok', async () => {
      mockFetchError(401, 'Unauthorized');

      await expect(createSignedUploadUrl('org/uuid.jpg', 'image/jpeg')).rejects.toThrow(
        'Supabase Storage createSignedUploadUrl falhou: 401',
      );
    });
  });
});
