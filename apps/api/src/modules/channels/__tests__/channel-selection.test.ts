// =============================================================================
// channels/__tests__/channel-selection.test.ts — Testes unitários (F20-S02).
//
// Cobre os 4 cenários do DoD:
//   1. Canal explícito (explicit channelId) → retorna credenciais decifradas
//   2. Fallback is_default → retorna canal marcado como default
//   3. Fallback first-active → sem default, retorna primeiro canal ativo
//   4. Sem canal ativo → lança ExternalServiceError
//   5. Canal sem secrets → lança ExternalServiceError
//   6. Canal sem phoneNumberId → lança ExternalServiceError
//   7. LGPD: accessToken NUNCA aparece nos logs
// =============================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock db/client (sem acesso real ao banco)
// ---------------------------------------------------------------------------
vi.mock('../../../db/client.js', () => ({
  db: {},
  pool: { end: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mock crypto/pii — decryptPii retorna plaintext previsível nos testes
// ---------------------------------------------------------------------------
const { mockDecryptPii } = vi.hoisted(() => ({
  mockDecryptPii: vi.fn<(cipher: Buffer) => Promise<string>>(),
}));

vi.mock('../../../lib/crypto/pii.js', () => ({
  // `as Buffer` justificado: o driver node-postgres devolve Buffer (subclasse de Uint8Array)
  decryptPii: (cipher: unknown) => mockDecryptPii(cipher as Buffer),
}));

// ---------------------------------------------------------------------------
// Mock logger — verificar que accessToken NUNCA é passado
// ---------------------------------------------------------------------------
const { mockLoggerDebug, mockLoggerWarn, mockLoggerError } = vi.hoisted(() => ({
  mockLoggerDebug: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('../../../lib/logger.js', () => ({
  logger: {
    debug: (...args: unknown[]) => mockLoggerDebug(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
  },
}));

// ---------------------------------------------------------------------------
// Mock repository
// ---------------------------------------------------------------------------
const mockFindActiveChannelForOrg = vi.fn();
const mockFindChannelSecrets = vi.fn();

vi.mock('../channel-selection.repository.js', () => ({
  findActiveChannelForOrg: (...args: unknown[]) => mockFindActiveChannelForOrg(...args),
  findChannelSecrets: (...args: unknown[]) => mockFindChannelSecrets(...args),
}));

// ---------------------------------------------------------------------------
// Import SUT (após mocks)
// ---------------------------------------------------------------------------
import { ExternalServiceError } from '../../../shared/errors.js';
import { resolveChannelForSend } from '../channel-selection.service.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const CHANNEL_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const ACCESS_TOKEN_ENC = Buffer.from('encrypted-token-bytes');
const ACCESS_TOKEN_PLAIN = 'EAAxxxxxxxxxxxx';

const CHANNEL_ROW = {
  id: CHANNEL_ID,
  organizationId: ORG_ID,
  name: 'WhatsApp BDP',
  phoneNumberId: '100987654321',
  wabaId: '200123456789',
  metaAppId: '300111222333',
  isDefault: true,
} as const;

const CHANNEL_SECRETS = {
  channelId: CHANNEL_ID,
  accessTokenEnc: ACCESS_TOKEN_ENC,
  appSecretEnc: null,
  apiKeyEnc: null,
} as const;

// `as unknown as Parameters<typeof resolveChannelForSend>[0]` seria mais preciso, mas
// a db nunca é usada diretamente nos testes unitários — o repository é mocado.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = {} as any;

// ---------------------------------------------------------------------------
// beforeEach: reset mocks
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockDecryptPii.mockResolvedValue(ACCESS_TOKEN_PLAIN);
});

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('resolveChannelForSend', () => {
  describe('cenário 1: channelId explícito fornecido', () => {
    it('retorna ResolvedChannel com credenciais decifradas', async () => {
      mockFindActiveChannelForOrg.mockResolvedValue(CHANNEL_ROW);
      mockFindChannelSecrets.mockResolvedValue(CHANNEL_SECRETS);

      const result = await resolveChannelForSend(mockDb, ORG_ID, CHANNEL_ID);

      expect(result).toEqual({
        channelId: CHANNEL_ID,
        accessToken: ACCESS_TOKEN_PLAIN,
        phoneNumberId: CHANNEL_ROW.phoneNumberId,
        wabaId: CHANNEL_ROW.wabaId,
        metaAppId: CHANNEL_ROW.metaAppId,
        channelName: CHANNEL_ROW.name,
      });

      // Confirma que repository foi chamado com o channelId explícito
      expect(mockFindActiveChannelForOrg).toHaveBeenCalledWith(mockDb, ORG_ID, CHANNEL_ID);
      // Confirma que decryptPii foi chamado com o buffer cifrado
      expect(mockDecryptPii).toHaveBeenCalledWith(ACCESS_TOKEN_ENC);
    });
  });

  describe('cenário 2: sem channelId explícito — fallback is_default', () => {
    it('retorna canal is_default quando nenhum channelId fornecido', async () => {
      const defaultChannel = { ...CHANNEL_ROW, isDefault: true };
      mockFindActiveChannelForOrg.mockResolvedValue(defaultChannel);
      mockFindChannelSecrets.mockResolvedValue(CHANNEL_SECRETS);

      const result = await resolveChannelForSend(mockDb, ORG_ID);

      expect(result.channelId).toBe(CHANNEL_ID);
      expect(result.accessToken).toBe(ACCESS_TOKEN_PLAIN);
      // Confirma chamada sem channelId (repository decide o fallback)
      expect(mockFindActiveChannelForOrg).toHaveBeenCalledWith(mockDb, ORG_ID, undefined);
    });
  });

  describe('cenário 3: sem channelId explícito — fallback first-active', () => {
    it('retorna o primeiro canal ativo quando não há default', async () => {
      const firstActiveChannel = { ...CHANNEL_ROW, isDefault: false };
      mockFindActiveChannelForOrg.mockResolvedValue(firstActiveChannel);
      mockFindChannelSecrets.mockResolvedValue(CHANNEL_SECRETS);

      const result = await resolveChannelForSend(mockDb, ORG_ID, null);

      expect(result.channelId).toBe(CHANNEL_ID);
      expect(mockFindActiveChannelForOrg).toHaveBeenCalledWith(mockDb, ORG_ID, null);
    });
  });

  describe('cenário 4: nenhum canal ativo → ExternalServiceError', () => {
    it('lança ExternalServiceError com mensagem acionável quando org sem canais', async () => {
      mockFindActiveChannelForOrg.mockResolvedValue(null);

      await expect(resolveChannelForSend(mockDb, ORG_ID)).rejects.toThrow(ExternalServiceError);
      await expect(resolveChannelForSend(mockDb, ORG_ID)).rejects.toThrow(
        'Nenhum canal WhatsApp ativo configurado para esta organização',
      );
    });

    it('lança ExternalServiceError com channelId na mensagem quando explícito não encontrado', async () => {
      mockFindActiveChannelForOrg.mockResolvedValue(null);

      await expect(resolveChannelForSend(mockDb, ORG_ID, CHANNEL_ID)).rejects.toThrow(
        ExternalServiceError,
      );
      await expect(resolveChannelForSend(mockDb, ORG_ID, CHANNEL_ID)).rejects.toThrow(CHANNEL_ID);
    });

    it('emite log.warn (não error) quando canal não encontrado', async () => {
      mockFindActiveChannelForOrg.mockResolvedValue(null);

      await resolveChannelForSend(mockDb, ORG_ID).catch(() => {
        // captura o erro esperado
      });

      expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
      expect(mockLoggerError).not.toHaveBeenCalled();
    });
  });

  describe('cenário 5: canal sem secrets → ExternalServiceError', () => {
    it('lança ExternalServiceError quando channel_secrets ausente', async () => {
      mockFindActiveChannelForOrg.mockResolvedValue(CHANNEL_ROW);
      mockFindChannelSecrets.mockResolvedValue(null);

      await expect(resolveChannelForSend(mockDb, ORG_ID)).rejects.toThrow(ExternalServiceError);
    });

    it('emite log.error quando secrets ausentes (inconsistência de dados)', async () => {
      mockFindActiveChannelForOrg.mockResolvedValue(CHANNEL_ROW);
      mockFindChannelSecrets.mockResolvedValue(null);

      await resolveChannelForSend(mockDb, ORG_ID).catch(() => {});

      expect(mockLoggerError).toHaveBeenCalledTimes(1);
      // Confirma que error log inclui channelId mas NÃO accessToken
      const logCall = mockLoggerError.mock.calls[0];
      const logContext = logCall?.[0] as Record<string, unknown>;
      expect(logContext).toHaveProperty('channelId');
      expect(logContext).not.toHaveProperty('accessToken');
    });
  });

  describe('cenário 6: canal sem phoneNumberId → ExternalServiceError', () => {
    it('lança ExternalServiceError quando phoneNumberId é null', async () => {
      const channelNoPhone = { ...CHANNEL_ROW, phoneNumberId: null };
      mockFindActiveChannelForOrg.mockResolvedValue(channelNoPhone);
      mockFindChannelSecrets.mockResolvedValue(CHANNEL_SECRETS);

      await expect(resolveChannelForSend(mockDb, ORG_ID)).rejects.toThrow(ExternalServiceError);
    });
  });

  describe('LGPD: accessToken nunca aparece nos logs', () => {
    it('log.debug de resolução bem-sucedida não contém accessToken', async () => {
      mockFindActiveChannelForOrg.mockResolvedValue(CHANNEL_ROW);
      mockFindChannelSecrets.mockResolvedValue(CHANNEL_SECRETS);

      await resolveChannelForSend(mockDb, ORG_ID);

      expect(mockLoggerDebug).toHaveBeenCalledTimes(1);
      const debugCall = mockLoggerDebug.mock.calls[0];
      const debugContext = debugCall?.[0] as Record<string, unknown>;

      // channelId e channelName devem estar presentes
      expect(debugContext).toHaveProperty('channelId', CHANNEL_ID);
      expect(debugContext).toHaveProperty('channelName', CHANNEL_ROW.name);

      // accessToken NUNCA pode aparecer no contexto de log
      expect(debugContext).not.toHaveProperty('accessToken');

      // Verificar também que ACCESS_TOKEN_PLAIN não vaza em nenhum argumento do log
      const allDebugArgs = JSON.stringify(mockLoggerDebug.mock.calls);
      expect(allDebugArgs).not.toContain(ACCESS_TOKEN_PLAIN);
    });
  });
});
