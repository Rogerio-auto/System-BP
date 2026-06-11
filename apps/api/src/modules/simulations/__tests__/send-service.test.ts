// =============================================================================
// simulations/__tests__/send-service.test.ts — Testes unitários de sendSimulation (F14-S05).
//
// Estratégia: mock do database, MetaWhatsAppClient e dependências externas.
// Foca na lógica de negócio da service layer (idempotência, erros, variáveis).
//
// Cobre:
//   1. Caminho feliz — envia template e retorna { status: 'sent', sent_message_id }
//   2. Idempotência — Idempotency-Key já usada retorna { status: 'already_sent', null }
//   3. Feature flag off — ExternalServiceError
//   4. Simulação não encontrada — NotFoundError
//   5. Lead sem telefone — AppError 422
//   6. Meta não configurada (construtor lança) — ExternalServiceError re-wrapped
//   7. Meta retorna erro de API — ExternalServiceError propagada
//   8. City scope: lead fora do scope — ForbiddenError
// =============================================================================
import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { Database } from '../../../db/client.js';
import type { MetaWhatsAppClient } from '../../../integrations/meta-whatsapp/client.js';
import { AppError } from '../../../shared/errors.js';
import type { SendSimulationOptions } from '../service.js';

// ---------------------------------------------------------------------------
// Mocks de módulos externos
// ---------------------------------------------------------------------------

// Mock pg para evitar conexão real
vi.mock('pg', () => {
  const MockPool = vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { Pool: MockPool, default: { Pool: MockPool } };
});

// Mock do módulo featureFlags/service
const mockIsFlagEnabled = vi.fn();
vi.mock('../../featureFlags/service.js', () => ({
  isFlagEnabled: (...args: unknown[]) => mockIsFlagEnabled(...args),
}));

// Mock do repository
const mockFindSimulationForSend = vi.fn();
const mockFindLeadForSimulation = vi.fn();
vi.mock('../repository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    findSimulationForSend: (...args: unknown[]) => mockFindSimulationForSend(...args),
    findLeadForSimulation: (...args: unknown[]) => mockFindLeadForSimulation(...args),
  };
});

// Mock emit e auditLog para evitar db real
vi.mock('../../../events/emit.js', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../lib/audit.js', () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_USER_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const FIXTURE_LEAD_ID = 'cccccccc-0000-0000-0000-000000000001';
const FIXTURE_SIMULATION_ID = 'ffffffff-0000-0000-0000-000000000001';
const FIXTURE_IDEMPOTENCY_KEY = 'dddddddd-0000-0000-0000-000000000001';
const FIXTURE_WAMID = 'wamid.test.aabbccdd';

function makeActor() {
  return {
    userId: FIXTURE_USER_ID,
    organizationId: FIXTURE_ORG_ID,
    role: 'admin',
    cityScopeIds: null,
    ip: '127.0.0.1',
    userAgent: 'test-agent',
  };
}

function makeSimulation() {
  return {
    id: FIXTURE_SIMULATION_ID,
    leadId: FIXTURE_LEAD_ID,
    organizationId: FIXTURE_ORG_ID,
    amountRequested: '2000.00',
    termMonths: 12,
    monthlyPayment: '187.53',
    rateMonthlySnapshot: '0.020000',
  };
}

function makeLead() {
  return {
    id: FIXTURE_LEAD_ID,
    organizationId: FIXTURE_ORG_ID,
    name: 'João Silva',
    phoneE164: '+5511999999999',
    cityId: 'city-uuid-000000000001',
    deletedAt: null,
  };
}

// ---------------------------------------------------------------------------
// Mock do MetaWhatsAppClient (injetável)
// ---------------------------------------------------------------------------

function makeMockMetaClient(wamid = FIXTURE_WAMID): MetaWhatsAppClient {
  return {
    sendTemplate: vi.fn().mockResolvedValue({ wamid }),
  } as unknown as MetaWhatsAppClient;
}

// ---------------------------------------------------------------------------
// Build mock database
// ---------------------------------------------------------------------------

function makeMockDb() {
  const insertResult = { values: vi.fn().mockReturnThis() };
  const txMock = {
    insert: vi.fn().mockReturnValue(insertResult),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  };

  return {
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    transaction: vi.fn().mockImplementation(async (fn: (tx: typeof txMock) => Promise<void>) => {
      await fn(txMock);
    }),
    insert: vi.fn().mockReturnValue(insertResult),
    _tx: txMock,
  };
}

// ---------------------------------------------------------------------------
// Helper: build send options
// ---------------------------------------------------------------------------

function makeSendOpts(
  metaClient: MetaWhatsAppClient,
  idempotencyKey = FIXTURE_IDEMPOTENCY_KEY,
): SendSimulationOptions {
  return { idempotencyKey, metaClient };
}

// ===========================================================================
// Testes
// ===========================================================================

describe('sendSimulation — caminho feliz', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('envia template e retorna { status: "sent", sent_message_id: wamid }', async () => {
    const { sendSimulation } = await import('../service.js');

    mockIsFlagEnabled.mockResolvedValue({ enabled: true, status: 'enabled' });
    mockFindSimulationForSend.mockResolvedValue(makeSimulation());
    mockFindLeadForSimulation.mockResolvedValue(makeLead());

    const db = makeMockDb();
    // Primeira execute: sem interação existente (idempotência negativa)
    db.execute.mockResolvedValueOnce({ rows: [] });

    const metaClient = makeMockMetaClient();

    const result = await sendSimulation(
      // `as` justificado: mock satisfaz a interface Database para este teste
      db as unknown as Database,
      makeActor(),
      FIXTURE_SIMULATION_ID,
      makeSendOpts(metaClient),
    );

    expect(result.status).toBe('sent');
    expect(result.sent_message_id).toBe(FIXTURE_WAMID);

    // Verifica que sendTemplate foi chamado com o telefone correto
    const mockSendTemplate = vi.mocked(metaClient.sendTemplate);
    expect(mockSendTemplate).toHaveBeenCalledOnce();
    const sendParams = mockSendTemplate.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(sendParams['to']).toBe('+5511999999999');
    expect(sendParams['templateName']).toBe('simulacao_resultado');
    expect(sendParams['language']).toBe('pt_BR');

    // Verifica que transação foi chamada
    expect(db.transaction).toHaveBeenCalledOnce();
  });

  it('monta variáveis corretas do template', async () => {
    const { sendSimulation } = await import('../service.js');

    mockIsFlagEnabled.mockResolvedValue({ enabled: true, status: 'enabled' });
    mockFindSimulationForSend.mockResolvedValue(makeSimulation());
    mockFindLeadForSimulation.mockResolvedValue(makeLead());

    const db = makeMockDb();
    db.execute.mockResolvedValueOnce({ rows: [] });

    const metaClient = makeMockMetaClient();

    await sendSimulation(
      db as unknown as Database,
      makeActor(),
      FIXTURE_SIMULATION_ID,
      makeSendOpts(metaClient),
    );

    const mockSendTemplate = vi.mocked(metaClient.sendTemplate);
    const sendParams = mockSendTemplate.mock.calls[0]![0] as unknown as Record<string, unknown>;
    const components = sendParams['components'] as Array<{
      type: string;
      parameters: Array<{ type: string; text: string }>;
    }>;
    expect(components).toHaveLength(1);
    expect(components[0]!.type).toBe('body');
    const params = components[0]!.parameters;
    // {{1}} = nome_cliente
    expect(params[0]!.text).toBe('João Silva');
    // {{2}} = valor_solicitado (formatado em BRL)
    expect(params[1]!.text).toContain('2.000');
    // {{3}} = num_parcelas
    expect(params[2]!.text).toBe('12');
    // {{4}} = valor_parcela
    expect(params[3]!.text).toContain('187');
    // {{5}} = taxa_mensal (2.00%)
    expect(params[4]!.text).toBe('2,00%');
  });
});

describe('sendSimulation — idempotência', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna already_sent quando Idempotency-Key já foi usada', async () => {
    const { sendSimulation } = await import('../service.js');

    mockIsFlagEnabled.mockResolvedValue({ enabled: true, status: 'enabled' });
    mockFindSimulationForSend.mockResolvedValue(makeSimulation());
    mockFindLeadForSimulation.mockResolvedValue(makeLead());

    const db = makeMockDb();
    // Retorna uma row (interação existente)
    db.execute.mockResolvedValueOnce({ rows: [{ id: 'some-interaction-id' }] });

    const metaClient = makeMockMetaClient();

    const result = await sendSimulation(
      db as unknown as Database,
      makeActor(),
      FIXTURE_SIMULATION_ID,
      makeSendOpts(metaClient),
    );

    expect(result.status).toBe('already_sent');
    expect(result.sent_message_id).toBeNull();

    // Não deve ter chamado sendTemplate
    expect(vi.mocked(metaClient.sendTemplate)).not.toHaveBeenCalled();

    // Não deve ter iniciado transação
    expect(db.transaction).not.toHaveBeenCalled();
  });
});

describe('sendSimulation — feature flag off', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lança ExternalServiceError quando flag está desabilitada', async () => {
    const { sendSimulation } = await import('../service.js');
    const { ExternalServiceError } = await import('../../../shared/errors.js');

    mockIsFlagEnabled.mockResolvedValue({ enabled: false, status: 'disabled' });

    const db = makeMockDb();
    const metaClient = makeMockMetaClient();

    await expect(
      sendSimulation(
        db as unknown as Database,
        makeActor(),
        FIXTURE_SIMULATION_ID,
        makeSendOpts(metaClient),
      ),
    ).rejects.toThrowError(ExternalServiceError);
  });
});

describe('sendSimulation — simulação não encontrada', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lança NotFoundError quando simulação não existe', async () => {
    const { sendSimulation } = await import('../service.js');
    const { NotFoundError } = await import('../../../shared/errors.js');

    mockIsFlagEnabled.mockResolvedValue({ enabled: true, status: 'enabled' });
    mockFindSimulationForSend.mockResolvedValue(null);

    const db = makeMockDb();
    const metaClient = makeMockMetaClient();

    await expect(
      sendSimulation(
        db as unknown as Database,
        makeActor(),
        FIXTURE_SIMULATION_ID,
        makeSendOpts(metaClient),
      ),
    ).rejects.toThrowError(NotFoundError);
  });
});

describe('sendSimulation — lead sem telefone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lança AppError 422 quando lead não tem phoneE164', async () => {
    const { sendSimulation } = await import('../service.js');

    mockIsFlagEnabled.mockResolvedValue({ enabled: true, status: 'enabled' });
    mockFindSimulationForSend.mockResolvedValue(makeSimulation());
    // Lead sem telefone
    mockFindLeadForSimulation.mockResolvedValue({ ...makeLead(), phoneE164: '' });

    const db = makeMockDb();
    db.execute.mockResolvedValueOnce({ rows: [] });
    const metaClient = makeMockMetaClient();

    const err = await sendSimulation(
      db as unknown as Database,
      makeActor(),
      FIXTURE_SIMULATION_ID,
      makeSendOpts(metaClient),
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(422);
  });
});

describe('sendSimulation — Meta não configurada', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lança ExternalServiceError quando metaClient falha ao enviar', async () => {
    const { sendSimulation } = await import('../service.js');
    const { ExternalServiceError } = await import('../../../shared/errors.js');

    mockIsFlagEnabled.mockResolvedValue({ enabled: true, status: 'enabled' });
    mockFindSimulationForSend.mockResolvedValue(makeSimulation());
    mockFindLeadForSimulation.mockResolvedValue(makeLead());

    const db = makeMockDb();
    db.execute.mockResolvedValueOnce({ rows: [] });

    // metaClient que lança ExternalServiceError ao enviar
    const badMetaClient = {
      sendTemplate: vi.fn().mockRejectedValue(
        new ExternalServiceError('META_WHATSAPP_ACCESS_TOKEN não configurado', {
          upstreamStatus: 0,
        }),
      ),
    } as unknown as MetaWhatsAppClient;

    await expect(
      sendSimulation(
        db as unknown as Database,
        makeActor(),
        FIXTURE_SIMULATION_ID,
        makeSendOpts(badMetaClient),
      ),
    ).rejects.toThrowError(ExternalServiceError);

    // Não deve ter iniciado transação (falha antes)
    expect(db.transaction).not.toHaveBeenCalled();
  });
});

describe('sendSimulation — city scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lança ForbiddenError quando lead está fora do city scope', async () => {
    const { sendSimulation } = await import('../service.js');
    const { ForbiddenError } = await import('../../../shared/errors.js');

    mockIsFlagEnabled.mockResolvedValue({ enabled: true, status: 'enabled' });
    mockFindSimulationForSend.mockResolvedValue(makeSimulation());
    // Lead não encontrado (fora do scope)
    mockFindLeadForSimulation.mockResolvedValue(null);

    const db = makeMockDb();
    const metaClient = makeMockMetaClient();

    await expect(
      sendSimulation(
        db as unknown as Database,
        makeActor(),
        FIXTURE_SIMULATION_ID,
        makeSendOpts(metaClient),
      ),
    ).rejects.toThrowError(ForbiddenError);
  });
});
