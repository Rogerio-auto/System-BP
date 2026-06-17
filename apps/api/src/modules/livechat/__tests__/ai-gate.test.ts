// =============================================================================
// ai-gate.test.ts — Testes do gate da IA para o livechat (F16-S28).
//
// Cenarios:
//   1. Flag off → shouldAiRespond = false (independente de allowlist/tipo)
//   2. Flag on + allowlist vazia + texto → shouldAiRespond = true
//   3. Flag on + allowlist com numero + numero na lista + texto → true
//   4. Flag on + allowlist com numero + numero FORA da lista + texto → false
//   5. Flag on + allowlist vazia + messageType != 'text' → false
//   6. Flag on + isFlagEnabled lanca erro → false (seguro por defeito)
//   7. Normalizacao: numero com + na allowlist eh normalizado para digitos
// =============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../../../db/client.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockIsFlagEnabled = vi.fn();

vi.mock('../../featureFlags/service.js', () => ({
  isFlagEnabled: mockIsFlagEnabled,
}));

// Env mockado — controlamos AI_LIVECHAT_ALLOWLIST por teste
const mockEnv = {
  AI_LIVECHAT_ALLOWLIST: [] as string[],
};

vi.mock('../../../config/env.js', () => ({
  get env() {
    return mockEnv;
  },
}));

vi.mock('../../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const mockDb = {} as unknown as Database;

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('shouldAiRespond — gate da IA no livechat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset allowlist para vazia antes de cada teste
    mockEnv.AI_LIVECHAT_ALLOWLIST = [];
  });

  it('1. flag off → false (independente de allowlist ou tipo)', async () => {
    mockIsFlagEnabled.mockResolvedValue({ enabled: false, status: 'disabled' });

    const { shouldAiRespond } = await import('../ai-gate.js');

    const result = await shouldAiRespond({
      db: mockDb,
      organizationId: 'org-1',
      contactRemoteId: '5569999990000',
      messageType: 'text',
    });

    expect(result).toBe(false);
    expect(mockIsFlagEnabled).toHaveBeenCalledWith(mockDb, 'ai.livechat_agent.enabled');
  });

  it('2. flag on + allowlist vazia + texto → true', async () => {
    mockIsFlagEnabled.mockResolvedValue({ enabled: true, status: 'enabled' });
    mockEnv.AI_LIVECHAT_ALLOWLIST = [];

    const { shouldAiRespond } = await import('../ai-gate.js');

    const result = await shouldAiRespond({
      db: mockDb,
      organizationId: 'org-1',
      contactRemoteId: '5569999990000',
      messageType: 'text',
    });

    expect(result).toBe(true);
  });

  it('3. flag on + allowlist com numero + numero NA lista → true', async () => {
    mockIsFlagEnabled.mockResolvedValue({ enabled: true, status: 'enabled' });
    mockEnv.AI_LIVECHAT_ALLOWLIST = ['5569999990000', '5569988887777'];

    const { shouldAiRespond } = await import('../ai-gate.js');

    const result = await shouldAiRespond({
      db: mockDb,
      organizationId: 'org-1',
      contactRemoteId: '5569999990000',
      messageType: 'text',
    });

    expect(result).toBe(true);
  });

  it('4. flag on + allowlist com numero + numero FORA da lista → false', async () => {
    mockIsFlagEnabled.mockResolvedValue({ enabled: true, status: 'enabled' });
    mockEnv.AI_LIVECHAT_ALLOWLIST = ['5569999990000'];

    const { shouldAiRespond } = await import('../ai-gate.js');

    const result = await shouldAiRespond({
      db: mockDb,
      organizationId: 'org-1',
      contactRemoteId: '5569911110000', // numero diferente
      messageType: 'text',
    });

    expect(result).toBe(false);
  });

  it('5. flag on + allowlist vazia + messageType != text → false', async () => {
    mockIsFlagEnabled.mockResolvedValue({ enabled: true, status: 'enabled' });
    mockEnv.AI_LIVECHAT_ALLOWLIST = [];

    const { shouldAiRespond } = await import('../ai-gate.js');

    const result = await shouldAiRespond({
      db: mockDb,
      organizationId: 'org-1',
      contactRemoteId: '5569999990000',
      messageType: 'image', // nao eh texto
    });

    expect(result).toBe(false);
    // Deve retornar false antes de chamar isFlagEnabled (short-circuit por tipo)
    expect(mockIsFlagEnabled).not.toHaveBeenCalled();
  });

  it('6. isFlagEnabled lanca erro → false (seguro por defeito)', async () => {
    mockIsFlagEnabled.mockRejectedValue(new Error('DB connection failed'));

    const { shouldAiRespond } = await import('../ai-gate.js');

    const result = await shouldAiRespond({
      db: mockDb,
      organizationId: 'org-1',
      contactRemoteId: '5569999990000',
      messageType: 'text',
    });

    expect(result).toBe(false);
  });

  it('7. normalizacao: contactRemoteId com chars nao-numericos e normalizado', async () => {
    mockIsFlagEnabled.mockResolvedValue({ enabled: true, status: 'enabled' });
    // Allowlist com numero limpo
    mockEnv.AI_LIVECHAT_ALLOWLIST = ['5569999990000'];

    const { shouldAiRespond } = await import('../ai-gate.js');

    // contactRemoteId com + na frente (E.164) deve ser normalizado
    const result = await shouldAiRespond({
      db: mockDb,
      organizationId: 'org-1',
      contactRemoteId: '+5569999990000', // tem + que sera removido
      messageType: 'text',
    });

    expect(result).toBe(true);
  });
});
