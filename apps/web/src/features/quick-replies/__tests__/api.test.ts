// =============================================================================
// features/quick-replies/__tests__/api.test.ts — Testes do cliente HTTP
// (F28-S05).
//
// Cobre: construção da querystring de listagem, os métodos/paths corretos
// por endpoint (doc 25 §2/§7/§10), e que erros do transporte (ApiError, ex.:
// 409 de atalho duplicado) NÃO são engolidos por api.ts — sobem intactos
// para queries.ts tratar (doc 25 §4.1).
//
// Nota sobre `as`: `api.get/post/patch/delete as ReturnType<typeof vi.fn>` é
// seguro — `../../../lib/api` é mockado acima com `vi.fn()` em cada método;
// o cast só recupera a API de mock (`.mock.calls`, `.mockResolvedValue`) que
// o TypeScript não infere automaticamente do tipo mockado. Pelo mesmo motivo,
// `mock.calls[0]?.[0] as string` recupera o path (string) do primeiro
// argumento da 1ª chamada — sem o cast o tipo seria `unknown`.
// =============================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  },
}));

// Os mocks de api.ts são módulo-level (persistem entre `it`s) — limpa o
// histórico de chamadas antes de cada teste para que `mock.calls[0]` sempre
// se refira à chamada do teste corrente, não de um teste anterior.
beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchQuickReplies — construção da querystring', () => {
  it('GET /api/quick-replies sem params', async () => {
    const { api } = await import('../../../lib/api');
    const mockGet = api.get as ReturnType<typeof vi.fn>;
    mockGet.mockResolvedValue({ data: [], nextCursor: null });

    const { fetchQuickReplies } = await import('../api');
    await fetchQuickReplies();

    expect(mockGet).toHaveBeenCalledWith('/api/quick-replies');
  });

  it('inclui search, visibility, category, isActive, cursor e limit quando informados', async () => {
    const { api } = await import('../../../lib/api');
    const mockGet = api.get as ReturnType<typeof vi.fn>;
    mockGet.mockResolvedValue({ data: [], nextCursor: null });

    const { fetchQuickReplies } = await import('../api');
    await fetchQuickReplies({
      search: 'orientação',
      visibility: 'personal',
      category: 'Documentos',
      isActive: true,
      cursor: '11111111-1111-1111-1111-111111111111',
      limit: 50,
    });

    const calledPath = mockGet.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain('/api/quick-replies?');
    expect(calledPath).toContain('search=');
    expect(calledPath).toContain('visibility=personal');
    expect(calledPath).toContain('isActive=true');
    expect(calledPath).toContain('limit=50');
  });

  it('isActive=false é enviado explicitamente (não confundir com ausente)', async () => {
    const { api } = await import('../../../lib/api');
    const mockGet = api.get as ReturnType<typeof vi.fn>;
    mockGet.mockResolvedValue({ data: [], nextCursor: null });

    const { fetchQuickReplies } = await import('../api');
    await fetchQuickReplies({ isActive: false });

    const calledPath = mockGet.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain('isActive=false');
  });
});

describe('fetchQuickReply — detalhe', () => {
  it('GET /api/quick-replies/:id com o id url-encoded', async () => {
    const { api } = await import('../../../lib/api');
    const mockGet = api.get as ReturnType<typeof vi.fn>;
    mockGet.mockResolvedValue({});

    const { fetchQuickReply } = await import('../api');
    await fetchQuickReply('abc 123');

    expect(mockGet).toHaveBeenCalledWith('/api/quick-replies/abc%20123');
  });
});

describe('mutações — método e path corretos', () => {
  it('createQuickReply → POST /api/quick-replies', async () => {
    const { api } = await import('../../../lib/api');
    const mockPost = api.post as ReturnType<typeof vi.fn>;
    mockPost.mockResolvedValue({ id: '1' });

    const { createQuickReply } = await import('../api');
    await createQuickReply({
      visibility: 'organization',
      shortcut: 'orientacao',
      title: 'Orientação',
      body: 'Olá',
      cityIds: [],
      isActive: true,
      sortOrder: 0,
    });

    expect(mockPost).toHaveBeenCalledWith(
      '/api/quick-replies',
      expect.objectContaining({ shortcut: 'orientacao' }),
    );
  });

  it('updateQuickReply → PATCH /api/quick-replies/:id', async () => {
    const { api } = await import('../../../lib/api');
    const mockPatch = api.patch as ReturnType<typeof vi.fn>;
    mockPatch.mockResolvedValue({ id: '1' });

    const { updateQuickReply } = await import('../api');
    await updateQuickReply('id-1', { title: 'Novo título' });

    expect(mockPatch).toHaveBeenCalledWith('/api/quick-replies/id-1', { title: 'Novo título' });
  });

  it('deleteQuickReply → DELETE /api/quick-replies/:id', async () => {
    const { api } = await import('../../../lib/api');
    const mockDelete = api.delete as ReturnType<typeof vi.fn>;
    mockDelete.mockResolvedValue(undefined);

    const { deleteQuickReply } = await import('../api');
    await deleteQuickReply('id-1');

    expect(mockDelete).toHaveBeenCalledWith('/api/quick-replies/id-1');
  });

  it('reorderQuickReplies → PATCH /api/quick-replies/reorder com { items }', async () => {
    const { api } = await import('../../../lib/api');
    const mockPatch = api.patch as ReturnType<typeof vi.fn>;
    mockPatch.mockResolvedValue(undefined);

    const { reorderQuickReplies } = await import('../api');
    await reorderQuickReplies([
      { id: 'a', sortOrder: 0 },
      { id: 'b', sortOrder: 1 },
    ]);

    expect(mockPatch).toHaveBeenCalledWith('/api/quick-replies/reorder', {
      items: [
        { id: 'a', sortOrder: 0 },
        { id: 'b', sortOrder: 1 },
      ],
    });
  });

  it('markQuickReplyUsed → POST /api/quick-replies/:id/used sem corpo relevante', async () => {
    const { api } = await import('../../../lib/api');
    const mockPost = api.post as ReturnType<typeof vi.fn>;
    mockPost.mockResolvedValue(undefined);

    const { markQuickReplyUsed } = await import('../api');
    await markQuickReplyUsed('id-1');

    expect(mockPost).toHaveBeenCalledWith('/api/quick-replies/id-1/used', {});
  });

  it('requestQuickReplyUploadSignedUrl → POST /api/quick-replies/uploads/signed-url', async () => {
    const { api } = await import('../../../lib/api');
    const mockPost = api.post as ReturnType<typeof vi.fn>;
    mockPost.mockResolvedValue({
      uploadUrl: 'https://storage/upload',
      publicMediaUrl: 'https://storage/public',
      expiresAt: '2026-01-01T00:00:00.000Z',
    });

    const { requestQuickReplyUploadSignedUrl } = await import('../api');
    await requestQuickReplyUploadSignedUrl({ fileName: 'a.png', mime: 'image/png', sizeBytes: 10 });

    expect(mockPost).toHaveBeenCalledWith('/api/quick-replies/uploads/signed-url', {
      fileName: 'a.png',
      mime: 'image/png',
      sizeBytes: 10,
    });
  });
});

describe('propagação de erro (doc 25 §4.1 — 409 de atalho duplicado)', () => {
  it('createQuickReply propaga ApiError sem transformar/engolir', async () => {
    const { api, ApiError } = await import('../../../lib/api');
    const mockPost = api.post as ReturnType<typeof vi.fn>;
    const conflict = new ApiError(409, 'QUICK_REPLY_SHORTCUT_CONFLICT', 'Atalho já existe');
    mockPost.mockRejectedValueOnce(conflict);

    const { createQuickReply } = await import('../api');

    await expect(
      createQuickReply({
        visibility: 'organization',
        shortcut: 'ja-existe',
        title: 'Título',
        body: 'Olá',
        cityIds: [],
        isActive: true,
        sortOrder: 0,
      }),
    ).rejects.toBe(conflict);
  });

  it('updateQuickReply propaga ApiError sem transformar/engolir', async () => {
    const { api, ApiError } = await import('../../../lib/api');
    const mockPatch = api.patch as ReturnType<typeof vi.fn>;
    const conflict = new ApiError(409, 'QUICK_REPLY_SHORTCUT_CONFLICT', 'Atalho já existe');
    mockPatch.mockRejectedValueOnce(conflict);

    const { updateQuickReply } = await import('../api');

    await expect(updateQuickReply('id-1', { shortcut: 'ja-existe' })).rejects.toBe(conflict);
  });
});
