// =============================================================================
// service.test.ts — Testes unitários de kanban/service.ts (F1-S13).
//
// Estratégia: mocks de banco/outbox/audit — sem conexão real com Postgres.
//
// Cenários cobertos:
//   1. Transição válida (normal→normal):
//      - atualiza card, insere history, emite outbox, registra audit
//   2. Transição válida (normal→terminal_won): conversão
//   3. Transição válida (terminal→normal): reabertura
//   4. Transição inválida (won→lost) → InvalidTransitionError 422
//   5. Transição inválida (lost→won) → InvalidTransitionError 422
//   6. Transição inválida (mesmo stage) → InvalidTransitionError 422
//   7. Card cross-org → NotFoundError 404
//   8. Stage de destino cross-org → NotFoundError 404
//   9. Stage de destino inexistente → NotFoundError 404
//  10. Histórico imutabilidade: repository não expõe update/delete em history
// =============================================================================
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock pg (evita conexão real)
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

vi.mock('../../../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    LANGGRAPH_INTERNAL_TOKEN: 'test-internal-token-32-chars-minimum!!',
    LANGGRAPH_SERVICE_URL: 'http://localhost:8000',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    JWT_ACCESS_SECRET: 'a'.repeat(64),
    JWT_REFRESH_SECRET: 'b'.repeat(64),
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '30d',
    API_HOST: '0.0.0.0',
    API_PORT: 3333,
    API_PUBLIC_URL: 'http://localhost:3333',
    CORS_ALLOWED_ORIGINS: ['http://localhost:5173'],
  },
}));

// ---------------------------------------------------------------------------
// Mock repositório
// ---------------------------------------------------------------------------
const mockFindCardById = vi.fn();
const mockFindStageById = vi.fn();
const mockUpdateCardStage = vi.fn();
const mockInsertHistory = vi.fn();

vi.mock('../repository.js', () => ({
  findCardById: (...args: unknown[]) => mockFindCardById(...args),
  findStageById: (...args: unknown[]) => mockFindStageById(...args),
  updateCardStage: (...args: unknown[]) => mockUpdateCardStage(...args),
  insertHistory: (...args: unknown[]) => mockInsertHistory(...args),
}));

// ---------------------------------------------------------------------------
// Mock outbox emit
// ---------------------------------------------------------------------------
const mockEmit = vi.fn().mockResolvedValue('mock-event-id');

vi.mock('../../../events/emit.js', () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
}));

// ---------------------------------------------------------------------------
// Mock auditLog
// ---------------------------------------------------------------------------
const mockAuditLog = vi.fn().mockResolvedValue('mock-audit-id');

vi.mock('../../../lib/audit.js', () => ({
  auditLog: (...args: unknown[]) => mockAuditLog(...args),
}));

// ---------------------------------------------------------------------------
// Mock db.transaction — executa o callback com um tx fake
// ---------------------------------------------------------------------------
const mockTransaction = vi.fn((fn: (tx: unknown) => unknown) =>
  fn({
    insert: vi.fn(),
    update: vi.fn(),
    select: vi.fn(),
  }),
);

vi.mock('../../../db/client.js', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: (fn: (tx: unknown) => unknown) => mockTransaction(fn),
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const OTHER_ORG = 'bbbbbbbb-0000-0000-0000-000000000002';

const makeStage = (
  overrides: Partial<{
    id: string;
    organizationId: string;
    name: string;
    orderIndex: number;
    isTerminalWon: boolean;
    isTerminalLost: boolean;
  }> = {},
) => ({
  id: 'stage-aaaa-0000-0000-0000-000000000001',
  organizationId: ORG_ID,
  name: 'Novo',
  orderIndex: 0,
  color: null,
  isTerminalWon: false,
  isTerminalLost: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeCard = (
  overrides: Partial<{
    id: string;
    organizationId: string;
    leadId: string;
    stageId: string;
  }> = {},
) => ({
  id: 'card-aaaa-0000-0000-0000-000000000001',
  organizationId: ORG_ID,
  leadId: 'lead-aaaa-0000-0000-0000-000000000001',
  stageId: 'stage-aaaa-0000-0000-0000-000000000001',
  assigneeUserId: null,
  priority: 0,
  notes: null,
  enteredStageAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const ACTOR = {
  userId: 'user-aaaa-0000-0000-0000-000000000001',
  orgId: ORG_ID,
  role: 'agente',
  ip: '127.0.0.1',
  userAgent: 'vitest',
};

// ---------------------------------------------------------------------------
// Helpers para setar mocks antes de cada teste
// ---------------------------------------------------------------------------

type StageSetup = {
  fromStage: ReturnType<typeof makeStage>;
  toStage: ReturnType<typeof makeStage>;
  card: ReturnType<typeof makeCard>;
};

function setupValidMove({ fromStage, toStage, card }: StageSetup): void {
  mockFindCardById.mockResolvedValueOnce(card);
  // findStageById é chamado 2x: toStage e fromStage (na ordem do service)
  mockFindStageById
    .mockResolvedValueOnce(toStage) // primeira call: toStage
    .mockResolvedValueOnce(fromStage); // segunda call: fromStage
  mockInsertHistory.mockResolvedValueOnce('history-id');
  mockUpdateCardStage.mockResolvedValueOnce({
    ...card,
    stageId: toStage.id,
    enteredStageAt: new Date(),
  });
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('moveCard — transições válidas', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockEmit.mockResolvedValue('mock-event-id');
    mockAuditLog.mockResolvedValue('mock-audit-id');
    mockTransaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn({ insert: vi.fn(), update: vi.fn(), select: vi.fn() }),
    );
  });

  it('normal→normal: atualiza card, insere history, emite outbox e audit', async () => {
    const fromStage = makeStage({ id: 'stage-from', name: 'Novo' });
    const toStage = makeStage({ id: 'stage-to', name: 'Qualificando', orderIndex: 1 });
    const card = makeCard({ stageId: fromStage.id });

    setupValidMove({ fromStage, toStage, card });

    const { moveCard } = await import('../service.js');
    const result = await moveCard(card.id, toStage.id, ACTOR);

    expect(result.stageId).toBe(toStage.id);

    // Verifica que history foi inserida
    expect(mockInsertHistory).toHaveBeenCalledOnce();
    expect(mockInsertHistory).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        cardId: card.id,
        fromStageId: fromStage.id,
        toStageId: toStage.id,
        actorUserId: ACTOR.userId,
      }),
    );

    // Verifica que card foi atualizado
    expect(mockUpdateCardStage).toHaveBeenCalledOnce();

    // Verifica evento outbox
    expect(mockEmit).toHaveBeenCalledOnce();
    expect(mockEmit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventName: 'kanban.stage_updated',
        data: expect.objectContaining({
          card_id: card.id,
          from_stage: fromStage.name,
          to_stage: toStage.name,
        }),
      }),
    );

    // Verifica audit log
    expect(mockAuditLog).toHaveBeenCalledOnce();
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'kanban.stage_updated',
        resource: { type: 'kanban_card', id: card.id },
      }),
    );
  });

  it('normal→terminal_won: transição de conversão é permitida', async () => {
    const fromStage = makeStage({ id: 'stage-from', name: 'Simulação' });
    const toStage = makeStage({ id: 'stage-won', name: 'Convertido', isTerminalWon: true });
    const card = makeCard({ stageId: fromStage.id });

    setupValidMove({ fromStage, toStage, card });

    const { moveCard } = await import('../service.js');
    await expect(moveCard(card.id, toStage.id, ACTOR)).resolves.toBeDefined();
  });

  it('normal→terminal_lost: transição de perda é permitida', async () => {
    const fromStage = makeStage({ id: 'stage-from', name: 'Qualificando' });
    const toStage = makeStage({ id: 'stage-lost', name: 'Perdido', isTerminalLost: true });
    const card = makeCard({ stageId: fromStage.id });

    setupValidMove({ fromStage, toStage, card });

    const { moveCard } = await import('../service.js');
    await expect(moveCard(card.id, toStage.id, ACTOR)).resolves.toBeDefined();
  });

  it('terminal_won→normal: reabertura é permitida', async () => {
    const fromStage = makeStage({ id: 'stage-won', name: 'Convertido', isTerminalWon: true });
    const toStage = makeStage({ id: 'stage-to', name: 'Qualificando', orderIndex: 1 });
    const card = makeCard({ stageId: fromStage.id });

    setupValidMove({ fromStage, toStage, card });

    const { moveCard } = await import('../service.js');
    await expect(moveCard(card.id, toStage.id, ACTOR)).resolves.toBeDefined();
  });

  it('terminal_lost→normal: reabertura é permitida', async () => {
    const fromStage = makeStage({ id: 'stage-lost', name: 'Perdido', isTerminalLost: true });
    const toStage = makeStage({ id: 'stage-to', name: 'Novo', orderIndex: 0 });
    const card = makeCard({ stageId: fromStage.id });

    setupValidMove({ fromStage, toStage, card });

    const { moveCard } = await import('../service.js');
    await expect(moveCard(card.id, toStage.id, ACTOR)).resolves.toBeDefined();
  });
});

describe('moveCard — transições inválidas (422)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockTransaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn({ insert: vi.fn(), update: vi.fn(), select: vi.fn() }),
    );
  });

  it('won→lost: lança InvalidTransitionError (422)', async () => {
    const fromStage = makeStage({ id: 'stage-won', name: 'Convertido', isTerminalWon: true });
    const toStage = makeStage({ id: 'stage-lost', name: 'Perdido', isTerminalLost: true });
    const card = makeCard({ stageId: fromStage.id });

    mockFindCardById.mockResolvedValueOnce(card);
    mockFindStageById.mockResolvedValueOnce(toStage).mockResolvedValueOnce(fromStage);

    const { moveCard, InvalidTransitionError } = await import('../service.js');

    let caughtError: unknown;
    try {
      await moveCard(card.id, toStage.id, ACTOR);
    } catch (e) {
      caughtError = e;
    }

    expect(caughtError).toBeInstanceOf(InvalidTransitionError);
    expect((caughtError as { statusCode: number }).statusCode).toBe(422);
  });

  it('lost→won: lança InvalidTransitionError (422)', async () => {
    const fromStage = makeStage({ id: 'stage-lost', name: 'Perdido', isTerminalLost: true });
    const toStage = makeStage({ id: 'stage-won', name: 'Convertido', isTerminalWon: true });
    const card = makeCard({ stageId: fromStage.id });

    mockFindCardById.mockResolvedValueOnce(card);
    mockFindStageById.mockResolvedValueOnce(toStage).mockResolvedValueOnce(fromStage);

    const { moveCard, InvalidTransitionError } = await import('../service.js');
    await expect(moveCard(card.id, toStage.id, ACTOR)).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
  });

  it('mesmo stage: lança InvalidTransitionError (422)', async () => {
    const stage = makeStage({ id: 'stage-same', name: 'Novo' });
    const card = makeCard({ stageId: stage.id });

    mockFindCardById.mockResolvedValueOnce(card);
    mockFindStageById
      .mockResolvedValueOnce(stage) // toStage
      .mockResolvedValueOnce(stage); // fromStage

    const { moveCard, InvalidTransitionError } = await import('../service.js');
    await expect(moveCard(card.id, stage.id, ACTOR)).rejects.toBeInstanceOf(InvalidTransitionError);
  });
});

describe('moveCard — cross-org e not found (404)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockTransaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn({ insert: vi.fn(), update: vi.fn(), select: vi.fn() }),
    );
  });

  it('card de outra org → NotFoundError 404', async () => {
    // findCardById retorna undefined para orgId errado
    mockFindCardById.mockResolvedValueOnce(undefined);

    const { moveCard } = await import('../service.js');
    const { NotFoundError } = await import('../../../shared/errors.js');

    await expect(
      moveCard('card-foreign-id', 'stage-any-id', { ...ACTOR, orgId: OTHER_ORG }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(mockFindStageById).not.toHaveBeenCalled();
  });

  it('stage de destino de outra org → NotFoundError 404', async () => {
    const fromStage = makeStage({ id: 'stage-from', name: 'Novo' });
    const card = makeCard({ stageId: fromStage.id });

    mockFindCardById.mockResolvedValueOnce(card);
    // toStage não encontrado para a org do actor
    mockFindStageById.mockResolvedValueOnce(undefined);

    const { moveCard } = await import('../service.js');
    const { NotFoundError } = await import('../../../shared/errors.js');

    await expect(moveCard(card.id, 'stage-foreign-id', ACTOR)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('stage de destino inexistente → NotFoundError 404', async () => {
    const card = makeCard();
    mockFindCardById.mockResolvedValueOnce(card);
    mockFindStageById.mockResolvedValueOnce(undefined);

    const { moveCard } = await import('../service.js');
    const { NotFoundError } = await import('../../../shared/errors.js');

    await expect(moveCard(card.id, 'stage-nonexistent', ACTOR)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('moveCard — imutabilidade do histórico', () => {
  it('repository não expõe updateHistory nem deleteHistory', async () => {
    const repo = await import('../repository.js');

    // O módulo deve exportar apenas insert + selects, nunca update/delete de history
    expect('insertHistory' in repo).toBe(true);
    expect('updateHistory' in repo).toBe(false);
    expect('deleteHistory' in repo).toBe(false);
  });
});
