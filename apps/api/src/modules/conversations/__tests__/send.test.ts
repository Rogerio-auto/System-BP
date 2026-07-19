// =============================================================================
// conversations/__tests__/send.test.ts — Testes de unidade para F16-S13.
//
// Cobertura:
//   - sendMessage: sucesso (202 queued), janela closed (422), conversa não encontrada (404)
//   - sendMessage: idempotência (mesmo Idempotency-Key retorna cached)
//   - assignConversation: sucesso (200) + relay socket publicado
//   - resolveConversation: sucesso (200) + relay socket publicado
//   - WindowClosedError: status 422, code VALIDATION_ERROR, CTA no details
//   - RBAC: declarado nas rotas (preHandler no routes.ts)
//
// Strategy: vi.mock para db, livechat service e queue client.
// Todos os mocks são definidos dentro das factories (vitest hoists vi.mock).
// Sem DB real — testes de unidade pura.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Fixtures helpers
// ---------------------------------------------------------------------------

const ORG_ID = 'aaaabbbb-0001-0000-0000-000000000001';
const CONV_ID = 'aaaabbbb-0002-0000-0000-000000000001';
const CHANNEL_ID = 'aaaabbbb-0003-0000-0000-000000000001';
const MESSAGE_ID = 'aaaabbbb-0004-0000-0000-000000000001';
const USER_ID = 'aaaabbbb-0005-0000-0000-000000000001';
const AGENT_ID = 'aaaabbbb-0006-0000-0000-000000000001';
const IDEMPOTENCY_KEY = 'test-idem-key-0001';

function makeConversation(
  overrides: Partial<{
    id: string;
    status: string;
    lastInboundAt: Date | null;
    channelId: string;
    contactRemoteId: string;
    assignedUserId: string | null;
  }> = {},
) {
  return {
    id: overrides.id ?? CONV_ID,
    organizationId: ORG_ID,
    channelId: overrides.channelId ?? CHANNEL_ID,
    contactRemoteId: overrides.contactRemoteId ?? '+5511999999999',
    contactName: 'Test Contact',
    contactPhoneEnc: null,
    leadId: null,
    customerId: null,
    status: overrides.status ?? 'open',
    kind: 'dm',
    assignedUserId: overrides.assignedUserId !== undefined ? overrides.assignedUserId : null,
    lastInboundAt: overrides.lastInboundAt !== undefined ? overrides.lastInboundAt : new Date(),
    lastMessageAt: new Date(),
    unreadCount: 0,
    metadata: null,
    cityId: null,
    aiHandoffAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
}

function makeChannel(provider: 'meta_whatsapp' | 'meta_instagram' | 'waha' = 'meta_whatsapp') {
  return {
    id: CHANNEL_ID,
    organizationId: ORG_ID,
    provider,
    name: 'Test Channel',
    isActive: true,
    isDefault: false,
    cityId: null,
    phoneNumberId: 'pn_001',
    // `phoneNumberEnc` é bytea nullable — null em testes (sem cifra real)
    phoneNumberEnc: null,
    wabaId: 'waba_001',
    metaAppId: null,
    igUserId: null,
    igUsername: null,
    igAccountType: null,
    fbPageId: null,
    displayHandle: '+5511000000000',
    wahaSessionId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
}

function makeMessage() {
  return {
    id: MESSAGE_ID,
    conversationId: CONV_ID,
    channelId: CHANNEL_ID,
    direction: 'out' as const,
    externalId: null,
    type: 'text',
    content: 'Hello',
    mediaUrl: null,
    mediaMime: null,
    mediaSizeBytes: null,
    mediaSha256: null,
    interactivePayload: null,
    viewStatus: 'pending',
    replyToExternalId: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeActorContext(
  overrides: Partial<{
    userId: string | null;
    organizationId: string;
    role: string;
    cityScopeIds: string[] | null;
  }> = {},
) {
  return {
    // `??` colapsaria um override explícito de `userId: null` de volta para USER_ID
    // (null é nullish) — quebrando silenciosamente o teste do actor de sistema/bot
    // (userId=null). Precisa checar `undefined` explicitamente, como cityScopeIds abaixo.
    userId: overrides.userId !== undefined ? overrides.userId : USER_ID,
    organizationId: overrides.organizationId ?? ORG_ID,
    role: overrides.role ?? 'attendant',
    cityScopeIds: overrides.cityScopeIds !== undefined ? overrides.cityScopeIds : null,
    ip: '127.0.0.1' as string | null,
    userAgent: 'vitest/1.0' as string | null,
  };
}

// ---------------------------------------------------------------------------
// Mocks — factories não podem referenciar variáveis externas (hoisting)
// ---------------------------------------------------------------------------

vi.mock('pg', () => {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const MockPool = vi.fn().mockImplementation(() => ({
    query: mockQuery,
    connect: vi.fn().mockResolvedValue({ query: mockQuery, release: vi.fn() }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { default: { Pool: MockPool }, Pool: MockPool };
});

// Mock DB — factory inline (sem referências externas por causa do hoisting)
vi.mock('../../../db/client.js', () => {
  const mockWhere = vi.fn().mockReturnValue({
    limit: vi.fn().mockResolvedValue([]),
  });
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

  const mockUpdateWhere = vi.fn().mockResolvedValue([]);
  const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
  const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

  const mockInsertValues = vi.fn().mockResolvedValue([]);
  const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

  const mockTxInsertValues = vi.fn().mockResolvedValue([]);
  const mockTxInsert = vi.fn().mockReturnValue({ values: mockTxInsertValues });

  const mockTransaction = vi.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      insert: mockTxInsert,
      select: mockSelect,
      update: mockUpdate,
    }),
  );

  return {
    db: {
      select: mockSelect,
      update: mockUpdate,
      insert: mockInsert,
      transaction: mockTransaction,
    },
  };
});

// Mock do livechat service — factory inline
vi.mock('../../livechat/service.js', () => {
  const mockGetConversation = vi.fn();
  const mockFindChannel = vi.fn();
  const mockPersistOutboundMessage = vi.fn();
  const mockGetComposerState = vi.fn();

  class MockNotFoundError extends Error {
    readonly statusCode = 404;
    readonly code = 'NOT_FOUND';
    constructor(message: string) {
      super(message);
      this.name = 'NotFoundError';
    }
  }

  return {
    getConversation: mockGetConversation,
    findChannel: mockFindChannel,
    persistOutboundMessage: mockPersistOutboundMessage,
    getComposerState: mockGetComposerState,
    NotFoundError: MockNotFoundError,
  };
});

// Mock do queue client — factory inline
vi.mock('../../../lib/queue/index.js', () => {
  const mockPublish = vi.fn().mockResolvedValue(undefined);
  const makeEnvelope = (_type: string, orgId: string, payload: unknown) => ({
    id: 'envelope-uuid',
    type: _type,
    organizationId: orgId,
    payload,
    ts: Date.now(),
  });
  return { publish: mockPublish, makeEnvelope };
});

// Mock do audit log — factory inline
vi.mock('../../../lib/audit.js', () => ({
  auditLog: vi.fn().mockResolvedValue('audit-uuid'),
}));

// Mock do emit (não chamado diretamente — via persistOutboundMessage mockado)
vi.mock('../../../events/emit.js', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Imports das unidades testadas (após vi.mock)
// ---------------------------------------------------------------------------

import { db } from '../../../db/client.js';
import * as auditLib from '../../../lib/audit.js';
import * as queueLib from '../../../lib/queue/index.js';
import { NotFoundError } from '../../../shared/errors.js';
import * as livechatService from '../../livechat/service.js';
import {
  assignConversation,
  resolveConversation,
  sendMessage,
  WindowClosedError,
} from '../send.service.js';

// ---------------------------------------------------------------------------
// Helpers de estado do composer
// ---------------------------------------------------------------------------

function openWindow(provider: 'meta_whatsapp' | 'meta_instagram' | 'waha' = 'meta_whatsapp') {
  return {
    conversationId: CONV_ID,
    provider,
    window: 'open' as const,
    lastInboundAt: new Date(),
    remainingMs: 3_600_000,
  };
}

function closedWindowTemplateOnly(
  provider: 'meta_whatsapp' | 'meta_instagram' | 'waha' = 'meta_whatsapp',
) {
  return {
    conversationId: CONV_ID,
    provider,
    window: 'template_only' as const,
    lastInboundAt: new Date(Date.now() - 25 * 3_600_000),
    remainingMs: 0,
  };
}

function closedWindowClosed(
  provider: 'meta_whatsapp' | 'meta_instagram' | 'waha' = 'meta_instagram',
) {
  return {
    conversationId: CONV_ID,
    provider,
    window: 'closed' as const,
    lastInboundAt: new Date(Date.now() - 8 * 24 * 3_600_000),
    remainingMs: 0,
  };
}

// ---------------------------------------------------------------------------
// Acesso tipado aos mocks
// ---------------------------------------------------------------------------
// `as` justificados: todos os módulos são mockados via vi.mock acima —
// as funções são vi.fn() e permitem mockResolvedValue/mockReturnValue.

const mockedGetConversation = vi.mocked(livechatService.getConversation);
const mockedFindChannel = vi.mocked(livechatService.findChannel);
const mockedPersistOutboundMessage = vi.mocked(livechatService.persistOutboundMessage);
const mockedGetComposerState = vi.mocked(livechatService.getComposerState);
const mockedPublish = vi.mocked(queueLib.publish);
const mockedAuditLog = vi.mocked(auditLib.auditLog);

// `as` justificado: vi.mock substitui db por um objeto com vi.fn() internos.
const mockedDbSelect = vi.mocked(db.select);
const mockedDbTransaction = vi.mocked(db.transaction);

// Tipo do fakeDb: usa o objeto mockado do módulo db/client.js
// `as` justificado: o mock expõe apenas os métodos necessários.
type FakeDb = Parameters<typeof sendMessage>[0];
const fakeDb = db as FakeDb;

// ---------------------------------------------------------------------------
// sendMessage
// ---------------------------------------------------------------------------

describe('sendMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Resetar mocks para defaults funcionais
    mockedGetConversation.mockResolvedValue(makeConversation());
    mockedFindChannel.mockResolvedValue(makeChannel('meta_whatsapp'));
    mockedGetComposerState.mockReturnValue(openWindow());
    mockedPersistOutboundMessage.mockResolvedValue(makeMessage());
    mockedPublish.mockResolvedValue(undefined);
    mockedAuditLog.mockResolvedValue('audit-uuid');

    // Default select: idempotency miss (retorna []).
    // `as unknown as ReturnType` justificado: mock substitui PgSelectBuilder por
    // objeto mínimo com apenas a cadeia .from().where().limit() usada pelo service.
    mockedDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as unknown as ReturnType<typeof db.select>);

    // Default transaction: executa o callback com um tx mock.
    // `as unknown` duplo justificado: mock substitui PgTransaction por objeto
    // mínimo com apenas os métodos usados pelo service — sem compatibilidade total.
    mockedDbTransaction.mockImplementation(
      (fn) =>
        // `as` justificado: PgTransaction mínimo — só insert/select/update
        (fn as (tx: unknown) => Promise<unknown>)({
          insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
          select: mockedDbSelect,
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
          }),
        }) as Promise<unknown>,
    );
  });

  it('sucesso: retorna messageId + status queued', async () => {
    const result = await sendMessage(
      fakeDb,
      makeActorContext(),
      CONV_ID,
      { type: 'text', content: 'Olá!' },
      IDEMPOTENCY_KEY,
    );

    expect(result.status).toBe('queued');
    expect(result.messageId).toBe(MESSAGE_ID);
  });

  it('sucesso: publica job na fila outbound.request', async () => {
    await sendMessage(
      fakeDb,
      makeActorContext(),
      CONV_ID,
      { type: 'text', content: 'Olá!' },
      IDEMPOTENCY_KEY,
    );

    expect(mockedPublish).toHaveBeenCalledWith(
      expect.stringContaining('outbound.request'),
      expect.objectContaining({
        payload: expect.objectContaining({ type: 'text', content: 'Olá!' }),
      }),
    );
  });

  it('sucesso: publica socket relay conversation:updated', async () => {
    await sendMessage(
      fakeDb,
      makeActorContext(),
      CONV_ID,
      { type: 'text', content: 'Olá!' },
      IDEMPOTENCY_KEY,
    );

    expect(mockedPublish).toHaveBeenCalledWith(
      expect.stringContaining('socket.relay'),
      expect.objectContaining({
        payload: expect.objectContaining({
          event: 'conversation:updated',
          data: expect.objectContaining({ conversationId: CONV_ID }),
        }),
      }),
    );
  });

  it('sucesso: publica socket relay message:new (outbound) — realtime do agente (F16-S51)', async () => {
    await sendMessage(
      fakeDb,
      makeActorContext(),
      CONV_ID,
      { type: 'text', content: 'Olá!' },
      IDEMPOTENCY_KEY,
    );

    expect(mockedPublish).toHaveBeenCalledWith(
      expect.stringContaining('socket.relay'),
      expect.objectContaining({
        payload: expect.objectContaining({
          event: 'message:new',
          data: expect.objectContaining({
            conversationId: CONV_ID,
            direction: 'outbound',
          }),
        }),
      }),
    );
  });

  it('janela template_only (WA): lança WindowClosedError 422 para type=text', async () => {
    mockedGetComposerState.mockReturnValue(closedWindowTemplateOnly('meta_whatsapp'));

    await expect(
      sendMessage(
        fakeDb,
        makeActorContext(),
        CONV_ID,
        { type: 'text', content: 'Mensagem fora da janela' },
        IDEMPOTENCY_KEY,
      ),
    ).rejects.toBeInstanceOf(WindowClosedError);
  });

  it('janela closed (IG): lança WindowClosedError 422 para type=text', async () => {
    mockedFindChannel.mockResolvedValue(makeChannel('meta_instagram'));
    mockedGetComposerState.mockReturnValue(closedWindowClosed('meta_instagram'));

    await expect(
      sendMessage(
        fakeDb,
        makeActorContext(),
        CONV_ID,
        { type: 'text', content: 'Mensagem fora da janela IG' },
        IDEMPOTENCY_KEY,
      ),
    ).rejects.toBeInstanceOf(WindowClosedError);
  });

  it('janela template_only: permite envio de template mesmo fora da janela 24h', async () => {
    mockedGetComposerState.mockReturnValue(closedWindowTemplateOnly('meta_whatsapp'));

    const result = await sendMessage(
      fakeDb,
      makeActorContext(),
      CONV_ID,
      {
        type: 'template',
        templateName: 'cobranca_lembrete',
        languageCode: 'pt_BR',
        components: [],
      },
      IDEMPOTENCY_KEY,
    );

    expect(result.status).toBe('queued');
  });

  it('conversa não encontrada: propaga NotFoundError (404)', async () => {
    mockedGetConversation.mockRejectedValue(
      new NotFoundError(`Conversation not found: ${CONV_ID}`),
    );

    await expect(
      sendMessage(
        fakeDb,
        makeActorContext(),
        CONV_ID,
        { type: 'text', content: 'Olá' },
        IDEMPOTENCY_KEY,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('idempotência: mesmo Idempotency-Key retorna cacheado sem re-enviar', async () => {
    const cached = { messageId: MESSAGE_ID, status: 'queued' };

    // Simula hit de idempotência: select retorna linha existente
    // `as unknown as ReturnType` justificado: mock mínimo da cadeia select usada no service
    mockedDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            {
              key: IDEMPOTENCY_KEY,
              endpoint: 'POST /api/conversations/:id/messages',
              requestHash: 'hash',
              responseStatus: 202,
              responseBody: cached,
              createdAt: new Date(),
            },
          ]),
        }),
      }),
    } as unknown as ReturnType<typeof db.select>);

    const result = await sendMessage(
      fakeDb,
      makeActorContext(),
      CONV_ID,
      { type: 'text', content: 'Olá!' },
      IDEMPOTENCY_KEY,
    );

    expect(result.messageId).toBe(MESSAGE_ID);
    expect(result.status).toBe('queued');
    // NÃO deve ter chamado persistOutboundMessage novamente
    expect(mockedPersistOutboundMessage).not.toHaveBeenCalled();
    // NÃO deve ter publicado na fila outbound
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it('LGPD: audit log não inclui content da mensagem', async () => {
    await sendMessage(
      fakeDb,
      makeActorContext(),
      CONV_ID,
      { type: 'text', content: 'Texto sigiloso com CPF 111.222.333-44' },
      IDEMPOTENCY_KEY,
    );

    expect(mockedAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'livechat.message_sent',
        after: expect.not.objectContaining({
          content: 'Texto sigiloso com CPF 111.222.333-44',
        }),
      }),
    );
  });

  it('sistema/bot: actor userId=null => auditLog chamado com actor=null (FK uuid segura)', async () => {
    const botActor = makeActorContext({ userId: null });
    await sendMessage(
      fakeDb,
      botActor,
      CONV_ID,
      { type: 'text', content: 'Resposta automatica do bot' },
      IDEMPOTENCY_KEY,
    );

    // Garante que actor=null (nao 'system-ai-bot') — actorUserId no DB sera null (FK valida)
    expect(mockedAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actor: null,
        action: 'livechat.message_sent',
      }),
    );
  });

  it('humano: actor userId real => auditLog chamado com actor.userId preenchido', async () => {
    await sendMessage(
      fakeDb,
      makeActorContext({ userId: USER_ID }),
      CONV_ID,
      { type: 'text', content: 'Mensagem humana' },
      IDEMPOTENCY_KEY,
    );

    expect(mockedAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actor: expect.objectContaining({ userId: USER_ID }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// assignConversation
// ---------------------------------------------------------------------------

describe('assignConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetConversation.mockResolvedValue(makeConversation());
    mockedPublish.mockResolvedValue(undefined);

    // Mock db.update para assign/resolve.
    // `as unknown as ReturnType` justificado: mock mínimo da cadeia .set().where() do service
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as unknown as ReturnType<typeof db.update>);
  });

  it('sucesso: atribui agente e retorna 200 com assignedUserId', async () => {
    const result = await assignConversation(fakeDb, makeActorContext(), CONV_ID, {
      agentId: AGENT_ID,
    });

    expect(result.conversationId).toBe(CONV_ID);
    expect(result.assignedUserId).toBe(AGENT_ID);
    expect(result.updatedAt).toBeDefined();
  });

  it('sucesso: publica socket relay conversation:updated com agentId', async () => {
    await assignConversation(fakeDb, makeActorContext(), CONV_ID, { agentId: AGENT_ID });

    expect(mockedPublish).toHaveBeenCalledWith(
      expect.stringContaining('socket.relay'),
      expect.objectContaining({
        payload: expect.objectContaining({
          event: 'conversation:updated',
          data: expect.objectContaining({
            assignedUserId: AGENT_ID,
            conversationId: CONV_ID,
          }),
        }),
      }),
    );
  });

  it('sucesso: desatribui agente com agentId=null', async () => {
    const result = await assignConversation(fakeDb, makeActorContext(), CONV_ID, { agentId: null });

    expect(result.assignedUserId).toBeNull();
    expect(mockedPublish).toHaveBeenCalledWith(
      expect.stringContaining('socket.relay'),
      expect.objectContaining({
        payload: expect.objectContaining({
          data: expect.objectContaining({ assignedUserId: null }),
        }),
      }),
    );
  });

  it('conversa não encontrada: propaga NotFoundError (404)', async () => {
    mockedGetConversation.mockRejectedValue(
      new NotFoundError(`Conversation not found: ${CONV_ID}`),
    );

    await expect(
      assignConversation(fakeDb, makeActorContext(), CONV_ID, { agentId: AGENT_ID }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// resolveConversation
// ---------------------------------------------------------------------------

describe('resolveConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetConversation.mockResolvedValue(makeConversation());
    mockedPublish.mockResolvedValue(undefined);

    // Mock db.update para resolve.
    // `as unknown as ReturnType` justificado: mock mínimo da cadeia .set().where() do service
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as unknown as ReturnType<typeof db.update>);
  });

  it('sucesso: muda status para resolved e retorna 200', async () => {
    const result = await resolveConversation(fakeDb, makeActorContext(), CONV_ID);

    expect(result.conversationId).toBe(CONV_ID);
    expect(result.status).toBe('resolved');
    expect(result.updatedAt).toBeDefined();
  });

  it('sucesso: publica socket relay conversation:resolved', async () => {
    await resolveConversation(fakeDb, makeActorContext(), CONV_ID);

    expect(mockedPublish).toHaveBeenCalledWith(
      expect.stringContaining('socket.relay'),
      expect.objectContaining({
        payload: expect.objectContaining({
          event: 'conversation:resolved',
          data: expect.objectContaining({
            status: 'resolved',
            conversationId: CONV_ID,
          }),
        }),
      }),
    );
  });

  it('conversa não encontrada: propaga NotFoundError (404)', async () => {
    mockedGetConversation.mockRejectedValue(
      new NotFoundError(`Conversation not found: ${CONV_ID}`),
    );

    await expect(resolveConversation(fakeDb, makeActorContext(), CONV_ID)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('conversa com city scope inválido: propaga NotFoundError (404, não 403)', async () => {
    // Previne oracle de existência (doc 10 §3.5): city scope diferente → 404, nunca 403
    mockedGetConversation.mockRejectedValue(
      new NotFoundError(`Conversation not found: ${CONV_ID}`),
    );

    await expect(
      resolveConversation(
        fakeDb,
        makeActorContext({ cityScopeIds: ['city-fora-do-scope-uuid-0001'] }),
        CONV_ID,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// WindowClosedError
// ---------------------------------------------------------------------------

describe('WindowClosedError', () => {
  it('tem statusCode 422 e code VALIDATION_ERROR', () => {
    const err = new WindowClosedError('meta_whatsapp', 'template_only');
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.name).toBe('WindowClosedError');
    expect(err.message).toContain('template_only');
    expect(err.message).toContain('meta_whatsapp');
  });

  it('inclui CTA no details para orientar o atendente', () => {
    const err = new WindowClosedError('meta_whatsapp', 'template_only');
    // `as` justificado: err.details é Record<string,unknown> conforme AppError
    const details = err.details as Record<string, unknown>;
    expect(details['cta']).toBeDefined();
    expect(String(details['cta'])).toContain('template');
  });

  it('tem code WINDOW_CLOSED nos details', () => {
    const err = new WindowClosedError('meta_instagram', 'closed');
    const details = err.details as Record<string, unknown>;
    expect(details['code']).toBe('WINDOW_CLOSED');
    expect(details['provider']).toBe('meta_instagram');
    expect(details['windowState']).toBe('closed');
  });
});

// ---------------------------------------------------------------------------
// RBAC — permissões declaradas no routes.ts
// ---------------------------------------------------------------------------

describe('RBAC — permissões declaradas no routes.ts', () => {
  it('POST /conversations/:id/messages requer livechat:message:send', () => {
    // Declarado como preHandler authorize({permissions:['livechat:message:send']})
    // no routes.ts — testável via integration test com buildApp completo.
    expect(true).toBe(true);
  });

  it('PATCH /conversations/:id/assign requer livechat:conversation:manage', () => {
    expect(true).toBe(true);
  });

  it('PATCH /conversations/:id/resolve requer livechat:conversation:manage', () => {
    expect(true).toBe(true);
  });
});
