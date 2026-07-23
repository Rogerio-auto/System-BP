// =============================================================================
// quick-replies/__tests__/service.test.ts — Testes unitários do service (F28-S03).
//
// Estratégia: mocka repository/audit/queue/storage; usa a implementação REAL
// de @elemento/shared-schemas (Zod + interpolateQuickReply) e lib/dlp.ts
// (redactPii) — são funções puras centrais à regra de negócio testada.
//
// Cobre:
//   1.  createQuickReplyService — visibility='organization' exige manage (403 sem)
//   2.  createQuickReplyService — visibility='personal' exige write (403 sem)
//   3.  createQuickReplyService — força ownerUserId=actor mesmo com valor injetado no body
//   4.  createQuickReplyService — 409 QUICK_REPLY_SHORTCUT_CONFLICT em conflito pré-check
//   5.  createQuickReplyService — 409 em race condition (unique violation do banco)
//   6.  createQuickReplyService — 422 QUICK_REPLY_MISSING_FALLBACK sem fallback em {{contato.nome}}
//   7.  createQuickReplyService — 422 QUICK_REPLY_UNKNOWN_VARIABLE fora do catálogo
//   8.  createQuickReplyService — 422 QUICK_REPLY_PII_IN_BODY com CPF no corpo
//   9.  createQuickReplyService — 400 mediaUrl fora do prefixo da organização
//   10. createQuickReplyService — 422 quando interpolação real deixa {{...}} cru
//   11. createQuickReplyService — audit log sem `body` no payload
//   12. createQuickReplyService — publica quick_reply:changed na room certa (org e pessoal)
//   13. getQuickReplyService — 404 quando não visível (resposta pessoal de outro operador)
//   14. updateQuickReplyService — editar registro org-wide exige manage
//   15. updateQuickReplyService — editar a própria resposta pessoal exige write
//   16. updateQuickReplyService — 422 corpo/mídia ausentes após merge com estado atual
//   17. updateQuickReplyService — 404 quando registro não visível ao ator
//   18. deleteQuickReplyService — remove com write (pessoal) e manage (org)
//   19. reorderQuickRepliesService — exige manage; 404 se id não pertence à org/for pessoal
//   20. Isolamento entre organizações — findVisibleQuickReplyById espelhado no service
// =============================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../../../db/client.js';
import { READ_PERMISSION, WRITE_PERMISSION, MANAGE_PERMISSION } from '../service.js';

// ---------------------------------------------------------------------------
// Mock repository
// ---------------------------------------------------------------------------
const mockFindQuickReplies = vi.fn();
const mockFindShortcutConflict = vi.fn();
const mockFindVisibleQuickReplyById = vi.fn();
const mockInsertQuickReply = vi.fn();
const mockUpdateQuickReplyById = vi.fn();
const mockSoftDeleteQuickReplyById = vi.fn();
const mockReorderQuickReplies = vi.fn();
const mockFindActorDisplayNames = vi.fn();

vi.mock('../repository.js', () => ({
  findQuickReplies: (...args: unknown[]) => mockFindQuickReplies(...args),
  findShortcutConflict: (...args: unknown[]) => mockFindShortcutConflict(...args),
  findVisibleQuickReplyById: (...args: unknown[]) => mockFindVisibleQuickReplyById(...args),
  insertQuickReply: (...args: unknown[]) => mockInsertQuickReply(...args),
  updateQuickReplyById: (...args: unknown[]) => mockUpdateQuickReplyById(...args),
  softDeleteQuickReplyById: (...args: unknown[]) => mockSoftDeleteQuickReplyById(...args),
  reorderQuickReplies: (...args: unknown[]) => mockReorderQuickReplies(...args),
  findActorDisplayNames: (...args: unknown[]) => mockFindActorDisplayNames(...args),
}));

// ---------------------------------------------------------------------------
// Mock auditLog
// ---------------------------------------------------------------------------
const mockAuditLog = vi.fn().mockResolvedValue('audit-uuid');
vi.mock('../../../lib/audit.js', () => ({
  auditLog: (...args: unknown[]) => mockAuditLog(...args),
}));

// ---------------------------------------------------------------------------
// Mock queue (realtime — doc 25 §9)
// ---------------------------------------------------------------------------
const mockPublish = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/queue/index.js', () => ({
  publish: (...args: unknown[]) => mockPublish(...args),
  makeEnvelope: (queue: string, organizationId: string, payload: unknown) => ({
    queue,
    organizationId,
    payload,
  }),
}));
vi.mock('../../../lib/queue/topology.js', () => ({
  QUEUES: { socketRelay: 'hm.q.socket.relay' },
}));

// ---------------------------------------------------------------------------
// Mock storage (security review nota 2 — mediaUrl restrito ao prefixo da org)
// ---------------------------------------------------------------------------
vi.mock('../../../lib/storage/index.js', () => ({
  getPublicUrl: (key: string) => `https://cdn.example.com/${key}`,
}));

// ---------------------------------------------------------------------------
// db.transaction stub — executa o callback contra um tx "passthrough"
// (repository já é mockado; o tx em si não precisa simular chains SQL).
// ---------------------------------------------------------------------------
const mockDb = {
  transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const OTHER_ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000099';
const USER_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const OTHER_USER_ID = 'bbbbbbbb-0000-0000-0000-000000000099';
const QUICK_REPLY_ID = 'cccccccc-0000-0000-0000-000000000001';

function makeActor(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId: USER_ID,
    organizationId: ORG_ID,
    permissions: [READ_PERMISSION, WRITE_PERMISSION, MANAGE_PERMISSION],
    cityScopeIds: null,
    ip: '127.0.0.1',
    userAgent: 'vitest',
    ...overrides,
  };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-07-01T12:00:00.000Z');
  return {
    id: QUICK_REPLY_ID,
    organizationId: ORG_ID,
    ownerUserId: null,
    visibility: 'organization',
    shortcut: 'saudacao',
    title: 'Saudação padrão',
    body: 'Olá! Como posso ajudar?',
    category: null,
    mediaUrl: null,
    mediaMime: null,
    mediaKind: null,
    mediaSizeBytes: null,
    mediaFileName: null,
    cityIds: [],
    isActive: true,
    sortOrder: 0,
    usageCount: 0,
    lastUsedAt: null,
    createdBy: USER_ID,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

const VALID_CREATE_BODY = {
  visibility: 'organization' as const,
  shortcut: 'saudacao',
  title: 'Saudação padrão',
  body: 'Olá {{atendente.primeiro_nome|equipe}}, tudo bem?',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({}));
  mockFindShortcutConflict.mockResolvedValue(false);
  mockFindActorDisplayNames.mockResolvedValue({
    agentName: 'Ana Clara Operadora',
    organizationName: 'SEDEC Rondônia',
  });
  mockInsertQuickReply.mockImplementation(async (_db: unknown, input: Record<string, unknown>) =>
    makeRow(input),
  );
  mockUpdateQuickReplyById.mockImplementation(
    async (_db: unknown, _orgId: string, id: string, input: Record<string, unknown>) =>
      makeRow({ id, ...input }),
  );
  mockSoftDeleteQuickReplyById.mockImplementation(
    async (_db: unknown, _orgId: string, id: string) =>
      makeRow({ id, deletedAt: new Date('2026-07-02T00:00:00.000Z') }),
  );
});

// ---------------------------------------------------------------------------
// createQuickReplyService
// ---------------------------------------------------------------------------

describe('createQuickReplyService', () => {
  it('1. visibility=organization exige manage — 403 sem a permissão', async () => {
    const { createQuickReplyService } = await import('../service.js');
    const actor = makeActor({ permissions: [READ_PERMISSION, WRITE_PERMISSION] });

    await expect(
      createQuickReplyService(mockDb as unknown as Database, actor, VALID_CREATE_BODY),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockInsertQuickReply).not.toHaveBeenCalled();
  });

  it('2. visibility=personal exige write — 403 sem a permissão', async () => {
    const { createQuickReplyService } = await import('../service.js');
    const actor = makeActor({ permissions: [READ_PERMISSION, MANAGE_PERMISSION] });

    await expect(
      createQuickReplyService(mockDb as unknown as Database, actor, {
        ...VALID_CREATE_BODY,
        visibility: 'personal',
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockInsertQuickReply).not.toHaveBeenCalled();
  });

  it('3. força ownerUserId=actor.userId mesmo com valor injetado no body', async () => {
    const { createQuickReplyService } = await import('../service.js');
    const actor = makeActor();

    const result = await createQuickReplyService(mockDb as unknown as Database, actor, {
      ...VALID_CREATE_BODY,
      visibility: 'personal',
      // Campo arbitrário injetado no payload — não faz parte do contrato Zod
      // (quickReplyCreateSchema não expõe ownerUserId) e por isso é
      // simplesmente descartado no parse — nunca chega ao repository.
      ownerUserId: OTHER_USER_ID,
    });

    expect(result.ownerUserId).toBe(USER_ID);
    expect(mockInsertQuickReply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ownerUserId: USER_ID }),
    );
  });

  it('4. 409 QUICK_REPLY_SHORTCUT_CONFLICT quando o pré-check encontra conflito', async () => {
    mockFindShortcutConflict.mockResolvedValueOnce(true);
    const { createQuickReplyService } = await import('../service.js');
    const actor = makeActor();

    await expect(
      createQuickReplyService(mockDb as unknown as Database, actor, VALID_CREATE_BODY),
    ).rejects.toMatchObject({
      statusCode: 409,
      details: expect.objectContaining({ code: 'QUICK_REPLY_SHORTCUT_CONFLICT' }),
    });
    expect(mockInsertQuickReply).not.toHaveBeenCalled();
  });

  it('5. 409 em race condition — unique violation (23505) do banco', async () => {
    mockInsertQuickReply.mockRejectedValueOnce({ code: '23505' });
    const { createQuickReplyService } = await import('../service.js');
    const actor = makeActor();

    await expect(
      createQuickReplyService(mockDb as unknown as Database, actor, VALID_CREATE_BODY),
    ).rejects.toMatchObject({
      statusCode: 409,
      details: expect.objectContaining({ code: 'QUICK_REPLY_SHORTCUT_CONFLICT' }),
    });
  });

  it('6. 422 QUICK_REPLY_MISSING_FALLBACK — {{contato.nome}} sem fallback', async () => {
    const { createQuickReplyService } = await import('../service.js');
    const actor = makeActor();

    await expect(
      createQuickReplyService(mockDb as unknown as Database, actor, {
        ...VALID_CREATE_BODY,
        body: 'Olá {{contato.nome}}, tudo bem?',
      }),
    ).rejects.toMatchObject({
      statusCode: 422,
      details: expect.objectContaining({ code: 'QUICK_REPLY_MISSING_FALLBACK' }),
    });
  });

  it('7. 422 QUICK_REPLY_UNKNOWN_VARIABLE — variável fora do catálogo fechado', async () => {
    const { createQuickReplyService } = await import('../service.js');
    const actor = makeActor();

    await expect(
      createQuickReplyService(mockDb as unknown as Database, actor, {
        ...VALID_CREATE_BODY,
        body: 'Olá {{cidade.nome}}!',
      }),
    ).rejects.toMatchObject({
      statusCode: 422,
      details: expect.objectContaining({ code: 'QUICK_REPLY_UNKNOWN_VARIABLE' }),
    });
  });

  it('8. 422 QUICK_REPLY_PII_IN_BODY — corpo com CPF do cidadão', async () => {
    const { createQuickReplyService } = await import('../service.js');
    const actor = makeActor();

    await expect(
      createQuickReplyService(mockDb as unknown as Database, actor, {
        ...VALID_CREATE_BODY,
        body: 'Seu CPF 123.456.789-01 foi confirmado.',
      }),
    ).rejects.toMatchObject({
      statusCode: 422,
      details: expect.objectContaining({ code: 'QUICK_REPLY_PII_IN_BODY' }),
    });
    expect(mockInsertQuickReply).not.toHaveBeenCalled();
  });

  it('9. 400 quando mediaUrl não pertence ao prefixo de storage da organização', async () => {
    const { createQuickReplyService } = await import('../service.js');
    const actor = makeActor();

    await expect(
      createQuickReplyService(mockDb as unknown as Database, actor, {
        visibility: 'organization',
        shortcut: 'boleto',
        title: 'Boleto',
        mediaUrl: 'https://attacker.example.com/evil.pdf',
        mediaMime: 'application/pdf',
        mediaKind: 'document',
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      details: expect.objectContaining({ code: 'QUICK_REPLY_MEDIA_URL_UNTRUSTED' }),
    });
    expect(mockInsertQuickReply).not.toHaveBeenCalled();
  });

  it('9b. aceita mediaUrl dentro do prefixo de storage da organização', async () => {
    const { createQuickReplyService } = await import('../service.js');
    const actor = makeActor();

    await expect(
      createQuickReplyService(mockDb as unknown as Database, actor, {
        visibility: 'organization',
        shortcut: 'boleto',
        title: 'Boleto',
        mediaUrl: `https://cdn.example.com/quick-replies/${ORG_ID}/uuid.pdf`,
        mediaMime: 'application/pdf',
        mediaKind: 'document',
      }),
    ).resolves.toBeDefined();
  });

  it('9c. 400 quando mediaUrl usa ../ para escapar do prefixo da própria org (path traversal cross-org)', async () => {
    const { createQuickReplyService } = await import('../service.js');
    const actor = makeActor();
    const otherOrg = '99999999-9999-9999-9999-999999999999';

    await expect(
      createQuickReplyService(mockDb as unknown as Database, actor, {
        visibility: 'organization',
        shortcut: 'boleto',
        title: 'Boleto',
        // começa com o prefixo de ORG_ID, mas `../` resolve para outra org
        mediaUrl: `https://cdn.example.com/quick-replies/${ORG_ID}/../${otherOrg}/evil.pdf`,
        mediaMime: 'application/pdf',
        mediaKind: 'document',
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      details: expect.objectContaining({ code: 'QUICK_REPLY_MEDIA_URL_UNTRUSTED' }),
    });
    expect(mockInsertQuickReply).not.toHaveBeenCalled();
  });

  it('9d. 400 quando o host difere mas o prefixo de path coincide (userinfo/@ e host externo)', async () => {
    const { createQuickReplyService } = await import('../service.js');
    const actor = makeActor();

    await expect(
      createQuickReplyService(mockDb as unknown as Database, actor, {
        visibility: 'organization',
        shortcut: 'boleto',
        title: 'Boleto',
        // host real é attacker.example.com; cdn.example.com é só userinfo
        mediaUrl: `https://cdn.example.com@attacker.example.com/quick-replies/${ORG_ID}/x.pdf`,
        mediaMime: 'application/pdf',
        mediaKind: 'document',
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      details: expect.objectContaining({ code: 'QUICK_REPLY_MEDIA_URL_UNTRUSTED' }),
    });
    expect(mockInsertQuickReply).not.toHaveBeenCalled();
  });

  it('9e. 400 quando o segmento da org é apenas um prefixo textual de outra org', async () => {
    const { createQuickReplyService } = await import('../service.js');
    const actor = makeActor();

    await expect(
      createQuickReplyService(mockDb as unknown as Database, actor, {
        visibility: 'organization',
        shortcut: 'boleto',
        title: 'Boleto',
        // `${ORG_ID}extra` NÃO pode passar como se fosse o segmento `${ORG_ID}`
        mediaUrl: `https://cdn.example.com/quick-replies/${ORG_ID}extra/x.pdf`,
        mediaMime: 'application/pdf',
        mediaKind: 'document',
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      details: expect.objectContaining({ code: 'QUICK_REPLY_MEDIA_URL_UNTRUSTED' }),
    });
    expect(mockInsertQuickReply).not.toHaveBeenCalled();
  });

  it('10. 422 QUICK_REPLY_UNRESOLVED_VARIABLE — interpolação real deixa {{...}} cru', async () => {
    // Nome do ator vazio — simula o cenário defensivo (nota 1 do security review):
    // mesmo variável sem fallback obrigatório no catálogo (atendente.nome), a
    // guarda pós-interpolação bloqueia se o dado real não resolver.
    mockFindActorDisplayNames.mockResolvedValueOnce({ agentName: '', organizationName: '' });
    const { createQuickReplyService } = await import('../service.js');
    const actor = makeActor();

    await expect(
      createQuickReplyService(mockDb as unknown as Database, actor, {
        ...VALID_CREATE_BODY,
        body: 'Aqui é {{atendente.nome}}, da equipe.',
      }),
    ).rejects.toMatchObject({
      statusCode: 422,
      details: expect.objectContaining({ code: 'QUICK_REPLY_UNRESOLVED_VARIABLE' }),
    });
  });

  it('10b. 422 mesmo quando o token cru tem quebra de linha dentro das chaves', async () => {
    // Regressão do MÉDIO do security review: um regex ad-hoc /\{\{.*\}\}/ sem
    // flag `s` não casaria o token multi-linha e deixaria vazar. O parser
    // canônico do pacote compartilhado casa.
    mockFindActorDisplayNames.mockResolvedValueOnce({ agentName: '', organizationName: '' });
    const { createQuickReplyService } = await import('../service.js');
    const actor = makeActor();

    await expect(
      createQuickReplyService(mockDb as unknown as Database, actor, {
        ...VALID_CREATE_BODY,
        body: 'Aqui é {{atendente.nome\n}}, da equipe.',
      }),
    ).rejects.toMatchObject({
      statusCode: 422,
      details: expect.objectContaining({ code: 'QUICK_REPLY_UNRESOLVED_VARIABLE' }),
    });
  });

  it('11. audit log nunca inclui `body` no payload', async () => {
    const { createQuickReplyService } = await import('../service.js');
    const actor = makeActor();

    await createQuickReplyService(mockDb as unknown as Database, actor, VALID_CREATE_BODY);

    expect(mockAuditLog).toHaveBeenCalledTimes(1);
    const auditCall = mockAuditLog.mock.calls[0]?.[1] as { after: Record<string, unknown> };
    expect(auditCall.after).not.toHaveProperty('body');
    expect(auditCall.after).toMatchObject({ shortcut: 'saudacao', visibility: 'organization' });
  });

  it('12a. publica quick_reply:changed na room workspace:{orgId} para visibility=organization', async () => {
    const { createQuickReplyService } = await import('../service.js');
    const actor = makeActor();

    await createQuickReplyService(mockDb as unknown as Database, actor, VALID_CREATE_BODY);

    expect(mockPublish).toHaveBeenCalledTimes(1);
    const envelope = mockPublish.mock.calls[0]?.[1] as { payload: Record<string, unknown> };
    expect(envelope.payload).toMatchObject({
      room: `workspace:${ORG_ID}`,
      event: 'quick_reply:changed',
    });
    const data = envelope.payload['data'] as Record<string, unknown>;
    expect(data).not.toHaveProperty('body');
    expect(data).not.toHaveProperty('title');
  });

  it('12b. publica quick_reply:changed na room user:{ownerId} para visibility=personal', async () => {
    const { createQuickReplyService } = await import('../service.js');
    const actor = makeActor();

    await createQuickReplyService(mockDb as unknown as Database, actor, {
      ...VALID_CREATE_BODY,
      visibility: 'personal',
    });

    const envelope = mockPublish.mock.calls[0]?.[1] as { payload: Record<string, unknown> };
    expect(envelope.payload).toMatchObject({ room: `user:${USER_ID}` });
  });
});

// ---------------------------------------------------------------------------
// getQuickReplyService
// ---------------------------------------------------------------------------

describe('getQuickReplyService', () => {
  it('13. 404 quando a resposta é pessoal de outro operador (não visível)', async () => {
    // findVisibleQuickReplyById já filtra por visibilidade — simula o
    // repository retornando null (nenhuma linha visível ao ator).
    mockFindVisibleQuickReplyById.mockResolvedValueOnce(null);
    const { getQuickReplyService } = await import('../service.js');
    const actor = makeActor();

    await expect(
      getQuickReplyService(mockDb as unknown as Database, actor, QUICK_REPLY_ID),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(mockFindVisibleQuickReplyById).toHaveBeenCalledWith(
      mockDb,
      actor.organizationId,
      actor.userId,
      QUICK_REPLY_ID,
    );
  });

  it('20. isolamento entre organizações — busca sempre com organizationId do ator', async () => {
    mockFindVisibleQuickReplyById.mockResolvedValueOnce(null);
    const { getQuickReplyService } = await import('../service.js');
    const actor = makeActor({ organizationId: OTHER_ORG_ID });

    await expect(
      getQuickReplyService(mockDb as unknown as Database, actor, QUICK_REPLY_ID),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mockFindVisibleQuickReplyById).toHaveBeenCalledWith(
      mockDb,
      OTHER_ORG_ID,
      actor.userId,
      QUICK_REPLY_ID,
    );
  });
});

// ---------------------------------------------------------------------------
// updateQuickReplyService
// ---------------------------------------------------------------------------

describe('updateQuickReplyService', () => {
  it('14. editar registro org-wide exige manage — 403 só com write', async () => {
    mockFindVisibleQuickReplyById.mockResolvedValueOnce(makeRow({ visibility: 'organization' }));
    const { updateQuickReplyService } = await import('../service.js');
    const actor = makeActor({ permissions: [READ_PERMISSION, WRITE_PERMISSION] });

    await expect(
      updateQuickReplyService(mockDb as unknown as Database, actor, QUICK_REPLY_ID, {
        title: 'Novo título',
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockUpdateQuickReplyById).not.toHaveBeenCalled();
  });

  it('15. editar a própria resposta pessoal exige write — 403 só com manage de outra org', async () => {
    mockFindVisibleQuickReplyById.mockResolvedValueOnce(
      makeRow({ visibility: 'personal', ownerUserId: USER_ID }),
    );
    const { updateQuickReplyService } = await import('../service.js');
    const actor = makeActor({ permissions: [READ_PERMISSION] });

    await expect(
      updateQuickReplyService(mockDb as unknown as Database, actor, QUICK_REPLY_ID, {
        title: 'Novo título',
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('15b. editar a própria resposta pessoal com write funciona', async () => {
    mockFindVisibleQuickReplyById.mockResolvedValueOnce(
      makeRow({ visibility: 'personal', ownerUserId: USER_ID }),
    );
    const { updateQuickReplyService } = await import('../service.js');
    const actor = makeActor({ permissions: [READ_PERMISSION, WRITE_PERMISSION] });

    await expect(
      updateQuickReplyService(mockDb as unknown as Database, actor, QUICK_REPLY_ID, {
        title: 'Novo título',
      }),
    ).resolves.toBeDefined();
  });

  it('16. 422 quando corpo/mídia ficam ausentes após merge com o estado atual', async () => {
    mockFindVisibleQuickReplyById.mockResolvedValueOnce(
      makeRow({ body: 'Texto existente', mediaUrl: null }),
    );
    const { updateQuickReplyService } = await import('../service.js');
    const actor = makeActor();

    await expect(
      updateQuickReplyService(mockDb as unknown as Database, actor, QUICK_REPLY_ID, {
        body: null,
      }),
    ).rejects.toMatchObject({
      statusCode: 422,
      details: expect.objectContaining({ code: 'QUICK_REPLY_BODY_OR_MEDIA_REQUIRED' }),
    });
  });

  it('17. 404 quando o registro não é visível ao ator', async () => {
    mockFindVisibleQuickReplyById.mockResolvedValueOnce(null);
    const { updateQuickReplyService } = await import('../service.js');
    const actor = makeActor();

    await expect(
      updateQuickReplyService(mockDb as unknown as Database, actor, QUICK_REPLY_ID, {
        title: 'x',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mockUpdateQuickReplyById).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// deleteQuickReplyService
// ---------------------------------------------------------------------------

describe('deleteQuickReplyService', () => {
  it('18a. remove resposta pessoal com write', async () => {
    mockFindVisibleQuickReplyById.mockResolvedValueOnce(
      makeRow({ visibility: 'personal', ownerUserId: USER_ID }),
    );
    const { deleteQuickReplyService } = await import('../service.js');
    const actor = makeActor({ permissions: [READ_PERMISSION, WRITE_PERMISSION] });

    await expect(
      deleteQuickReplyService(mockDb as unknown as Database, actor, QUICK_REPLY_ID),
    ).resolves.toBeUndefined();
    expect(mockSoftDeleteQuickReplyById).toHaveBeenCalledWith(
      expect.anything(),
      actor.organizationId,
      QUICK_REPLY_ID,
    );
  });

  it('18b. remove resposta org-wide exige manage — 403 só com write', async () => {
    mockFindVisibleQuickReplyById.mockResolvedValueOnce(makeRow({ visibility: 'organization' }));
    const { deleteQuickReplyService } = await import('../service.js');
    const actor = makeActor({ permissions: [READ_PERMISSION, WRITE_PERMISSION] });

    await expect(
      deleteQuickReplyService(mockDb as unknown as Database, actor, QUICK_REPLY_ID),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockSoftDeleteQuickReplyById).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// reorderQuickRepliesService
// ---------------------------------------------------------------------------

describe('reorderQuickRepliesService', () => {
  it('19a. exige manage — 403 sem a permissão', async () => {
    const { reorderQuickRepliesService } = await import('../service.js');
    const actor = makeActor({ permissions: [READ_PERMISSION, WRITE_PERMISSION] });

    await expect(
      reorderQuickRepliesService(mockDb as unknown as Database, actor, [
        { id: QUICK_REPLY_ID, sortOrder: 1 },
      ]),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockReorderQuickReplies).not.toHaveBeenCalled();
  });

  it('19b. 404 quando algum id não pertence à organização (ou não é org-wide)', async () => {
    mockReorderQuickReplies.mockResolvedValueOnce([QUICK_REPLY_ID]);
    const { reorderQuickRepliesService } = await import('../service.js');
    const actor = makeActor();
    const otherId = 'dddddddd-0000-0000-0000-000000000001';

    await expect(
      reorderQuickRepliesService(mockDb as unknown as Database, actor, [
        { id: QUICK_REPLY_ID, sortOrder: 1 },
        { id: otherId, sortOrder: 2 },
      ]),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('19c. sucesso — publica quick_reply:changed para cada id reordenado', async () => {
    mockReorderQuickReplies.mockResolvedValueOnce([QUICK_REPLY_ID]);
    const { reorderQuickRepliesService } = await import('../service.js');
    const actor = makeActor();

    const result = await reorderQuickRepliesService(mockDb as unknown as Database, actor, [
      { id: QUICK_REPLY_ID, sortOrder: 5 },
    ]);

    expect(result).toEqual({ updated: 1 });
    expect(mockPublish).toHaveBeenCalledTimes(1);
  });
});
