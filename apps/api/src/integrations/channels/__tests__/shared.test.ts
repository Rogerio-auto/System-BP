// =============================================================================
// __tests__/shared.test.ts — Testes da camada compartilhada de canais (F16-S04).
//
// Cobre:
//   verifyMetaSignature / verifyMetaSignatureOrThrow (hmac.ts):
//     1. Secret correto → true
//     2. Secret errado → false
//     3. Header ausente → false
//     4. Header com formato inválido → false
//     5. Hex com comprimento errado → false
//     6. resolveSecret lança → false
//     7. resolveSecret retorna vazio → false
//     8. verifyMetaSignatureOrThrow: header ausente → SignatureError(missing_header)
//     9. verifyMetaSignatureOrThrow: formato inválido → SignatureError(invalid_format)
//    10. verifyMetaSignatureOrThrow: HMAC errado → SignatureError(hmac_mismatch)
//    11. verifyMetaSignatureOrThrow: secret indisponível → SignatureError(secret_unavailable)
//    12. Timing-safe: secret correto e errado têm comportamento idêntico (não vaza via exceção)
//    13. sha256Hex: produz hex de 64 chars
//
//   GraphClient (graphClient.ts):
//    14. POST sucesso → retorna resposta parseada
//    15. GET sucesso → retorna resposta parseada
//    16. 429 → retry com backoff e sucesso no segundo attempt
//    17. 429 persistente → esgota tentativas e lança ProviderError
//    18. 5xx → retry com backoff
//    19. 4xx (exceto 429) → sem retry, lança imediatamente
//    20. Timeout → lança ProviderError com upstreamStatus=0
//    21. downloadBytes: URL fora do allowlist → ProviderError sem fetch
//    22. downloadBytes: URL no allowlist → sucesso com bytes e mimeType
//    23. downloadBytes: 5xx → retry
//    24. accessToken vazio → lança ProviderError no construtor
//    25. Retry-After header: respeita delay mínimo
//    26. postForm: upload multipart → sucesso
//
//   errors.ts:
//    27. ChannelError: instanceof AppError, tem channelCode
//    28. SignatureError: statusCode=403, reason correto
//    29. ProviderError: isRetryable=true para 429/5xx/0; false para 400
//    30. UnsupportedMessageTypeError: statusCode=422, tem messageType e provider
//    31. Type guards: isChannelError, isSignatureError, isProviderError, isUnsupportedMessageTypeError
//
//   registry.ts:
//    32. getAdapter: lança ChannelError quando provider não registrado
//    33. registerAdapter + getAdapter: retorna adapter correto
//    34. unregisterAdapter: remove adapter
//    35. clearAdapterRegistry: limpa todos
//    36. getRegisteredProviders: lista providers registrados
// =============================================================================
import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../../shared/errors.js';
import type { IChannelAdapter } from '../adapter.types.js';
import {
  clearAdapterRegistry,
  getAdapter,
  getRegisteredProviders,
  registerAdapter,
  unregisterAdapter,
} from '../registry.js';
import {
  ChannelError,
  ProviderError,
  SignatureError,
  UnsupportedMessageTypeError,
  isChannelError,
  isProviderError,
  isSignatureError,
  isUnsupportedMessageTypeError,
} from '../shared/errors.js';
import { createGraphClient } from '../shared/graphClient.js';
import { sha256Hex, verifyMetaSignature, verifyMetaSignatureOrThrow } from '../shared/hmac.js';

// ---------------------------------------------------------------------------
// Helpers de teste
// ---------------------------------------------------------------------------

/** Gera o header `X-Hub-Signature-256` para um rawBody e secret. */
function makeSignatureHeader(rawBody: Buffer, secret: string): string {
  const hex = createHmac('sha256', secret).update(rawBody).digest('hex');
  return `sha256=${hex}`;
}

/** Resolve o secret imediatamente (simula busca no DB). */
function resolveSecretOk(secret: string): () => Promise<string> {
  return () => Promise.resolve(secret);
}

/** Resolve lançando um erro (simula canal não encontrado). */
function resolveSecretThrows(): () => Promise<string> {
  return () => Promise.reject(new Error('canal não encontrado'));
}

/** Resolve com string vazia (simula canal sem app_secret). */
function resolveSecretEmpty(): () => Promise<string> {
  return () => Promise.resolve('');
}

// ---------------------------------------------------------------------------
// Seção 1: verifyMetaSignature
// ---------------------------------------------------------------------------

describe('verifyMetaSignature', () => {
  const rawBody = Buffer.from('{"entry":[{"id":"waba123"}]}');
  const correctSecret = 'test-app-secret-at-least-16chars';
  const wrongSecret = 'wrong-app-secret-at-least-16char';

  it('1. secret correto → true', async () => {
    const header = makeSignatureHeader(rawBody, correctSecret);
    const result = await verifyMetaSignature(rawBody, header, resolveSecretOk(correctSecret));
    expect(result).toBe(true);
  });

  it('2. secret errado → false', async () => {
    const header = makeSignatureHeader(rawBody, correctSecret);
    const result = await verifyMetaSignature(rawBody, header, resolveSecretOk(wrongSecret));
    expect(result).toBe(false);
  });

  it('3. header ausente (undefined) → false', async () => {
    const result = await verifyMetaSignature(rawBody, undefined, resolveSecretOk(correctSecret));
    expect(result).toBe(false);
  });

  it('3b. header vazio ("") → false', async () => {
    const result = await verifyMetaSignature(rawBody, '', resolveSecretOk(correctSecret));
    expect(result).toBe(false);
  });

  it('4. formato inválido (sem "sha256=") → false', async () => {
    const result = await verifyMetaSignature(rawBody, 'md5=abc123', resolveSecretOk(correctSecret));
    expect(result).toBe(false);
  });

  it('5. hex com comprimento errado → false', async () => {
    const result = await verifyMetaSignature(
      rawBody,
      'sha256=abc123', // muito curto
      resolveSecretOk(correctSecret),
    );
    expect(result).toBe(false);
  });

  it('6. resolveSecret lança → false (nunca propaga a exceção)', async () => {
    const header = makeSignatureHeader(rawBody, correctSecret);
    const result = await verifyMetaSignature(rawBody, header, resolveSecretThrows());
    expect(result).toBe(false);
  });

  it('7. resolveSecret retorna vazio → false', async () => {
    const header = makeSignatureHeader(rawBody, correctSecret);
    const result = await verifyMetaSignature(rawBody, header, resolveSecretEmpty());
    expect(result).toBe(false);
  });

  it('12. timing-safe: secret errado não lança (apenas retorna false)', async () => {
    const header = makeSignatureHeader(rawBody, correctSecret);
    // Deve retornar false sem lançar — timing-safe não diferencia "quase certo" de "errado"
    await expect(verifyMetaSignature(rawBody, header, resolveSecretOk(wrongSecret))).resolves.toBe(
      false,
    );
  });

  it('13. sha256Hex: produz hex de 64 chars', () => {
    const hash = sha256Hex(rawBody);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('13b. sha256Hex: deterministico para mesmo input', () => {
    const hash1 = sha256Hex(rawBody);
    const hash2 = sha256Hex(rawBody);
    expect(hash1).toBe(hash2);
  });
});

// ---------------------------------------------------------------------------
// Seção 2: verifyMetaSignatureOrThrow
// ---------------------------------------------------------------------------

describe('verifyMetaSignatureOrThrow', () => {
  const rawBody = Buffer.from('{"entry":[{"id":"waba123"}]}');
  const correctSecret = 'test-app-secret-at-least-16chars';

  it('8. header ausente → SignatureError(missing_header)', async () => {
    await expect(
      verifyMetaSignatureOrThrow(rawBody, undefined, resolveSecretOk(correctSecret)),
    ).rejects.toMatchObject({
      name: 'SignatureError',
      reason: 'missing_header',
      statusCode: 403,
    });
  });

  it('9. formato inválido → SignatureError(invalid_format)', async () => {
    await expect(
      verifyMetaSignatureOrThrow(rawBody, 'md5=abc', resolveSecretOk(correctSecret)),
    ).rejects.toMatchObject({
      name: 'SignatureError',
      reason: 'invalid_format',
      statusCode: 403,
    });
  });

  it('10. HMAC errado → SignatureError(hmac_mismatch)', async () => {
    const header = makeSignatureHeader(rawBody, 'wrong-secret-at-least-16chars!');
    await expect(
      verifyMetaSignatureOrThrow(rawBody, header, resolveSecretOk(correctSecret)),
    ).rejects.toMatchObject({
      name: 'SignatureError',
      reason: 'hmac_mismatch',
      statusCode: 403,
    });
  });

  it('11. resolveSecret lança → SignatureError(secret_unavailable)', async () => {
    const header = makeSignatureHeader(rawBody, correctSecret);
    await expect(
      verifyMetaSignatureOrThrow(rawBody, header, resolveSecretThrows()),
    ).rejects.toMatchObject({
      name: 'SignatureError',
      reason: 'secret_unavailable',
    });
  });

  it('sucesso: secret correto → não lança', async () => {
    const header = makeSignatureHeader(rawBody, correctSecret);
    await expect(
      verifyMetaSignatureOrThrow(rawBody, header, resolveSecretOk(correctSecret)),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Seção 3: GraphClient
// ---------------------------------------------------------------------------

describe('GraphClient', () => {
  // Mock fetch global para testes unitários
  const mockFetch = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mockFetch.mockReset();
  });

  /** Helper: cria cliente com sleepFn no-op (sem delay real em testes). */
  function makeClient(
    accessToken = 'test-access-token',
    maxAttempts = 3,
    baseUrl = 'https://graph.facebook.com/v23.0',
  ) {
    return createGraphClient({
      accessToken,
      maxAttempts,
      backoffBaseMs: 0, // sem backoff real em testes
      jitterMaxMs: 0,
      defaultTimeoutMs: 5_000,
      sleepFn: () => Promise.resolve(),
      baseUrl,
    });
  }

  /** Helper: resposta JSON de sucesso. */
  function mockJsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /** Helper: resposta de erro JSON. */
  function mockErrorResponse(status: number, code?: number): Response {
    return new Response(
      JSON.stringify({
        error: { message: 'Test error', code: code ?? status, title: 'Test Error' },
      }),
      {
        status,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  it('14. POST sucesso → retorna resposta parseada', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ messages: [{ id: 'wamid_123' }] }));

    const client = makeClient();
    const result = await client.post<{ messages: Array<{ id: string }> }>('/123456789/messages', {
      messaging_product: 'whatsapp',
      to: '+5511999999999',
      type: 'text',
    });

    expect(result.messages[0]?.id).toBe('wamid_123');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('15. GET sucesso → retorna resposta parseada', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ id: 'page_123', name: 'Test Page' }));

    const client = makeClient();
    const result = await client.get<{ id: string; name: string }>('/me');

    expect(result.id).toBe('page_123');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('16. 429 → retry e sucesso no segundo attempt', async () => {
    mockFetch
      .mockResolvedValueOnce(mockErrorResponse(429))
      .mockResolvedValueOnce(mockJsonResponse({ messages: [{ id: 'wamid_456' }] }));

    const client = makeClient();
    const result = await client.post<{ messages: Array<{ id: string }> }>(
      '/123456789/messages',
      {},
    );

    expect(result.messages[0]?.id).toBe('wamid_456');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('17. 429 persistente → esgota tentativas e lança ProviderError', async () => {
    mockFetch.mockResolvedValue(mockErrorResponse(429));

    const client = makeClient('test-token', 3);
    await expect(client.post('/test', {})).rejects.toMatchObject({
      name: 'ProviderError',
      upstreamStatus: 429,
    });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('18. 5xx → retry com backoff', async () => {
    mockFetch
      .mockResolvedValueOnce(mockErrorResponse(500))
      .mockResolvedValueOnce(mockJsonResponse({ ok: true }));

    const client = makeClient();
    const result = await client.post<{ ok: boolean }>('/test', {});

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('19. 4xx (exceto 429) → sem retry, lança imediatamente', async () => {
    mockFetch.mockResolvedValue(mockErrorResponse(400));

    const client = makeClient();
    await expect(client.post('/test', {})).rejects.toMatchObject({
      name: 'ProviderError',
      upstreamStatus: 400,
    });
    // Apenas 1 tentativa — sem retry em 4xx
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('20. Timeout → lança ProviderError com upstreamStatus=0', async () => {
    // Simular AbortError — usar maxAttempts=1 para não precisar de mocks adicionais
    // (ProviderError com status=0 é retentável, mas maxAttempts=1 encerra após 1 tentativa)
    mockFetch.mockRejectedValueOnce(
      Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
    );

    const client = createGraphClient({
      accessToken: 'test-access-token',
      maxAttempts: 1, // sem retry — queremos apenas verificar que AbortError → ProviderError(status=0)
      backoffBaseMs: 0,
      jitterMaxMs: 0,
      defaultTimeoutMs: 5_000,
      sleepFn: () => Promise.resolve(),
      baseUrl: 'https://graph.facebook.com/v23.0',
    });

    await expect(client.post('/test', {})).rejects.toMatchObject({
      name: 'ProviderError',
      upstreamStatus: 0,
    });
  });

  it('21. downloadBytes: URL fora do allowlist → ProviderError sem fetch', async () => {
    const client = makeClient();
    await expect(
      client.downloadBytes('https://evil.example.com/malware.jpg'),
    ).rejects.toMatchObject({
      name: 'ProviderError',
      upstreamStatus: 0,
    });
    // Fetch não deve ter sido chamado (proteção SSRF)
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('22. downloadBytes: URL no allowlist (graph.facebook.com) → sucesso', async () => {
    const imageBytes = Buffer.from('fake-image-bytes');
    mockFetch.mockResolvedValueOnce(
      new Response(imageBytes, {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      }),
    );

    const client = makeClient();
    const result = await client.downloadBytes(
      'https://graph.facebook.com/v23.0/media/123456?access_token=ignored',
    );

    expect(result.mimeType).toBe('image/jpeg');
    expect(result.bytes).toEqual(imageBytes);
  });

  it('23. downloadBytes: 5xx → retry', async () => {
    const imageBytes = Buffer.from('media-bytes');
    mockFetch
      .mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }))
      .mockResolvedValueOnce(
        new Response(imageBytes, {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        }),
      );

    const client = makeClient();
    const result = await client.downloadBytes('https://graph.facebook.com/v23.0/media/123');

    expect(result.mimeType).toBe('image/jpeg');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('24. accessToken vazio → ProviderError no construtor', () => {
    expect(() => createGraphClient({ accessToken: '' })).toThrow(ProviderError);
  });

  it('25. Retry-After header: respeita delay mínimo', async () => {
    const sleepFn = vi.fn(() => Promise.resolve());

    // 429 com Retry-After: 2 (segundos → 2000ms)
    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Rate limited', code: 429 } }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '2',
          },
        }),
      )
      .mockResolvedValueOnce(mockJsonResponse({ ok: true }));

    const client = createGraphClient({
      accessToken: 'test-token',
      maxAttempts: 2,
      backoffBaseMs: 0,
      jitterMaxMs: 0,
      sleepFn,
      baseUrl: 'https://graph.facebook.com/v23.0',
    });

    await client.post('/test', {});

    // Sleep deve ter sido chamado com delay ≥ 2000ms (Retry-After)
    expect(sleepFn).toHaveBeenCalledTimes(1);
    // `toHaveBeenCalledWith` verifica os argumentos com matcher — evita acesso direto
    // ao .mock.calls que tem tipagem vazia (vi.fn sem signature tipada explícita).
    expect(sleepFn).toHaveBeenCalledWith(expect.any(Number));
    // Verificar o valor exato via toHaveBeenCalledWith com matcher customizado
    expect(sleepFn.mock.lastCall).toBeDefined();
    // lastCall é number[] sem índice tipado — usar assertion segura:
    // `as` justificado: `lastCall` é o único argumento de sleepFn (ms: number).
    const delay = (sleepFn.mock.lastCall as unknown as [number] | undefined)?.[0] ?? 0;
    expect(delay).toBeGreaterThanOrEqual(2_000);
  });

  it('26. postForm: upload multipart → sucesso', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ id: 'media_id_789' }));

    const client = makeClient();
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');

    const result = await client.postForm<{ id: string }>('/123456789/media', form);

    expect(result.id).toBe('media_id_789');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Seção 4: errors.ts
// ---------------------------------------------------------------------------

describe('Channel Errors', () => {
  it('27. ChannelError: instanceof AppError, tem channelCode', () => {
    const err = new ChannelError('teste', 'CHANNEL_ERROR');
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(ChannelError);
    expect(err.channelCode).toBe('CHANNEL_ERROR');
    expect(err.name).toBe('ChannelError');
  });

  it('28. SignatureError: statusCode=403, reason correto', () => {
    const err = new SignatureError('sig inválida', 'hmac_mismatch');
    expect(err.statusCode).toBe(403);
    expect(err.reason).toBe('hmac_mismatch');
    expect(err.channelCode).toBe('CHANNEL_SIGNATURE_INVALID');
    expect(err).toBeInstanceOf(ChannelError);
    expect(err).toBeInstanceOf(AppError);
  });

  it('29. ProviderError: isRetryable para 429/5xx/0; não retentável para 400', () => {
    expect(new ProviderError('msg', 429).isRetryable).toBe(true);
    expect(new ProviderError('msg', 500).isRetryable).toBe(true);
    expect(new ProviderError('msg', 503).isRetryable).toBe(true);
    expect(new ProviderError('msg', 0).isRetryable).toBe(true); // erro de rede
    expect(new ProviderError('msg', 400).isRetryable).toBe(false);
    expect(new ProviderError('msg', 404).isRetryable).toBe(false);
    expect(new ProviderError('msg', 422).isRetryable).toBe(false);
  });

  it('30. UnsupportedMessageTypeError: statusCode=422, tem messageType e provider', () => {
    const err = new UnsupportedMessageTypeError('poll', 'meta_whatsapp');
    expect(err.statusCode).toBe(422);
    expect(err.messageType).toBe('poll');
    expect(err.provider).toBe('meta_whatsapp');
    expect(err.channelCode).toBe('CHANNEL_UNSUPPORTED_MESSAGE_TYPE');
    expect(err).toBeInstanceOf(ChannelError);
  });

  it('31. Type guards funcionam corretamente', () => {
    const channelErr = new ChannelError('test');
    const sigErr = new SignatureError('test');
    const provErr = new ProviderError('test', 429);
    const unsuppErr = new UnsupportedMessageTypeError('poll', 'meta_whatsapp');
    const otherErr = new Error('not a channel error');

    expect(isChannelError(channelErr)).toBe(true);
    expect(isChannelError(sigErr)).toBe(true); // SignatureError extends ChannelError
    expect(isChannelError(provErr)).toBe(true);
    expect(isChannelError(otherErr)).toBe(false);

    expect(isSignatureError(sigErr)).toBe(true);
    expect(isSignatureError(provErr)).toBe(false);

    expect(isProviderError(provErr)).toBe(true);
    expect(isProviderError(sigErr)).toBe(false);

    expect(isUnsupportedMessageTypeError(unsuppErr)).toBe(true);
    expect(isUnsupportedMessageTypeError(provErr)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Seção 5: registry.ts
// ---------------------------------------------------------------------------

describe('Channel Registry', () => {
  // Adapter mock mínimo para testes do registry
  function makeMockAdapter(
    provider: IChannelAdapter['provider'],
  ): IChannelAdapter<unknown, unknown> {
    return {
      provider,
      capabilities: {
        sendTemplate: true,
        sendInteractive: true,
        downloadMedia: true,
        markAsRead: true,
        sendTypingIndicator: true,
        sendAudioPtt: false,
        sendSticker: false,
        has24hWindow: true,
        sendReaction: false,
      },
      parseInbound: () => [],
      serializeOutbound: () => ({}),
      verifySignature: async () => false,
      buildGraphClient: () => {
        throw new ChannelError('not implemented');
      },
      sendText: async () => ({ messageId: 'mock' }),
      sendMedia: async () => ({ messageId: 'mock' }),
      sendTemplate: async () => ({ messageId: 'mock' }),
      sendInteractive: async () => ({ messageId: 'mock' }),
      downloadMedia: async () => ({ bytes: Buffer.from(''), mimeType: 'image/jpeg' }),
      markAsRead: async () => {},
      sendTypingIndicator: async () => {},
    };
  }

  afterEach(() => {
    clearAdapterRegistry();
  });

  it('32. getAdapter: lança ChannelError quando provider não registrado', () => {
    expect(() => getAdapter('meta_whatsapp')).toThrow(ChannelError);
    expect(() => getAdapter('meta_whatsapp')).toThrow(/meta_whatsapp/);
  });

  it('33. registerAdapter + getAdapter: retorna adapter correto', () => {
    const adapter = makeMockAdapter('meta_whatsapp');
    registerAdapter(adapter);

    const retrieved = getAdapter('meta_whatsapp');
    expect(retrieved).toBe(adapter);
    expect(retrieved.provider).toBe('meta_whatsapp');
  });

  it('34. unregisterAdapter: remove adapter', () => {
    const adapter = makeMockAdapter('meta_whatsapp');
    registerAdapter(adapter);
    unregisterAdapter('meta_whatsapp');

    expect(() => getAdapter('meta_whatsapp')).toThrow(ChannelError);
  });

  it('35. clearAdapterRegistry: limpa todos', () => {
    registerAdapter(makeMockAdapter('meta_whatsapp'));
    registerAdapter(makeMockAdapter('meta_instagram'));
    clearAdapterRegistry();

    expect(() => getAdapter('meta_whatsapp')).toThrow(ChannelError);
    expect(() => getAdapter('meta_instagram')).toThrow(ChannelError);
  });

  it('36. getRegisteredProviders: lista providers registrados', () => {
    expect(getRegisteredProviders()).toEqual([]);

    registerAdapter(makeMockAdapter('meta_whatsapp'));
    registerAdapter(makeMockAdapter('waha'));

    const providers = getRegisteredProviders();
    expect(providers).toContain('meta_whatsapp');
    expect(providers).toContain('waha');
    expect(providers).toHaveLength(2);
  });

  it('registerAdapter: segunda chamada sobrescreve (última vence)', () => {
    const adapter1 = makeMockAdapter('meta_whatsapp');
    const adapter2 = makeMockAdapter('meta_whatsapp');

    registerAdapter(adapter1);
    registerAdapter(adapter2);

    expect(getAdapter('meta_whatsapp')).toBe(adapter2);
  });
});
