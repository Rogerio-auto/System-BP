// =============================================================================
// modules/internal-assistant/__tests__/history.test.ts -- F6-S17
//
// Cobre a memoria de sessao do copiloto (historico de turnos):
//   - Sem history no body -> compat retroativa, payload ao LangGraph sem history.
//   - Com history -> repassado integralmente (ate 10) ao payload do LangGraph.
//   - > 10 turnos -> truncado para os ultimos 10 antes de enviar ao LangGraph.
//   - `content` do history nunca aparece em nenhuma chamada ao logger.
//   - `history` nunca e persistido em assistant_queries.
// =============================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock env (deve ser o primeiro mock)
// ---------------------------------------------------------------------------
vi.mock('../../../config/env.js', () => ({
  env: {
    LANGGRAPH_INTERNAL_TOKEN: 'a'.repeat(33),
    LANGGRAPH_SERVICE_URL: 'http://langgraph.test.local',
    LANGGRAPH_AI_TIMEOUT_MS: 25_000,
  },
}));

// ---------------------------------------------------------------------------
// Mock pino -- captura tudo que e logado, para provar que `content` nunca vaza
// ---------------------------------------------------------------------------
const loggedCalls: unknown[] = [];
vi.mock('pino', () => ({
  default: () => ({
    info: (...args: unknown[]) => loggedCalls.push(args),
    error: (...args: unknown[]) => loggedCalls.push(args),
    warn: (...args: unknown[]) => loggedCalls.push(args),
  }),
}));

// ---------------------------------------------------------------------------
// Mock db -- captura o insert em assistant_queries (para provar que history
// nunca e persistido)
// ---------------------------------------------------------------------------
const insertedRows: unknown[] = [];
const mockValues = vi.fn((row: unknown) => {
  insertedRows.push(row);
  return Promise.resolve();
});
vi.mock('../../../db/client.js', () => ({
  db: { insert: () => ({ values: mockValues }) },
}));
vi.mock('../../../db/schema/assistantQueries.js', () => ({ assistantQueries: {} }));

// ---------------------------------------------------------------------------
// Mock DLP -- pass-through (o teste ja cobre DLP em outro slot)
// ---------------------------------------------------------------------------
vi.mock('../../../lib/dlp.js', () => ({
  redactPii: (text: string) => ({ redactedText: text, dlpTokens: [], dlpApplied: false }),
}));

// ---------------------------------------------------------------------------
// Mock fetch (global) -- captura o payload enviado ao LangGraph
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Import do modulo sob teste (apos os mocks)
// ---------------------------------------------------------------------------
import type { AssistantQueryBody } from '../schemas.js';
import { handleAssistantQuery } from '../service.js';
import type { AssistantActorContext } from '../service.js';

const ACTOR: AssistantActorContext = {
  userId: 'aaaa0000-0000-0000-0000-000000000001',
  organizationId: 'bbbb0000-0000-0000-0000-000000000001',
  permissions: ['ai_assistant:use'],
  cityScopeIds: ['cccc0000-0000-0000-0000-000000000001'],
  ip: '127.0.0.1',
  userAgent: 'vitest',
};

const CORRELATION_ID = 'dddd0000-0000-0000-0000-000000000001';

/** Um turno de historico com conteudo sentinela, para rastrear vazamentos. */
function turn(role: 'user' | 'assistant', content: string) {
  return { role, content };
}

function mockLangGraphOk() {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        narrative: 'Resposta do copiloto.',
        blocks: [],
        answer: 'Resposta do copiloto.',
        sources: ['funnel_metrics'],
        tools_called: [],
        metadata: {},
        error: null,
      }),
  });
}

function lastFetchBody(): { history?: unknown[] } {
  const call = mockFetch.mock.calls.at(-1) as [string, { body: string }];
  return JSON.parse(call[1].body) as { history?: unknown[] };
}

describe('F6-S17: historico de sessao do copiloto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loggedCalls.length = 0;
    insertedRows.length = 0;
    mockLangGraphOk();
  });

  it('sem history no body: payload ao LangGraph nao inclui a chave history (compat)', async () => {
    const body: AssistantQueryBody = { question: 'Quantos leads temos hoje?' };
    await handleAssistantQuery(ACTOR, body, CORRELATION_ID);

    const sentBody = lastFetchBody();
    expect(sentBody.history).toBeUndefined();
  });

  it('com history (<=10): repassado integralmente ao payload do LangGraph', async () => {
    const history = [
      turn('user', 'Qual o total de leads da cidade X?'),
      turn('assistant', 'A cidade X tem 12 leads ativos.'),
    ];
    const body: AssistantQueryBody = { question: 'E na cidade Y?', history };
    await handleAssistantQuery(ACTOR, body, CORRELATION_ID);

    const sentBody = lastFetchBody();
    expect(sentBody.history).toEqual(history);
  });

  it('com >10 turnos: trunca para os ultimos 10 antes de enviar ao LangGraph', async () => {
    const history = Array.from({ length: 14 }, (_, i) =>
      turn(i % 2 === 0 ? 'user' : 'assistant', `turno-${String(i)}`),
    );
    const body: AssistantQueryBody = { question: 'Continuando...', history };
    await handleAssistantQuery(ACTOR, body, CORRELATION_ID);

    const sentBody = lastFetchBody();
    expect(sentBody.history).toHaveLength(10);
    // Mantém a cauda (os 10 mais recentes), não a cabeça.
    expect(sentBody.history).toEqual(history.slice(-10));
  });

  it('content do history nunca aparece em nenhuma chamada ao logger', async () => {
    const sentinel = 'SENTINELA_PII_NAO_PODE_VAZAR_NO_LOG_11122233344';
    const history = [turn('user', sentinel), turn('assistant', 'ok, entendido.')];
    const body: AssistantQueryBody = { question: 'Pergunta de acompanhamento', history };
    await handleAssistantQuery(ACTOR, body, CORRELATION_ID);

    const serializedLogs = JSON.stringify(loggedCalls);
    expect(serializedLogs).not.toContain(sentinel);
  });

  it('history nunca e persistido em assistant_queries', async () => {
    const history = [turn('user', 'pergunta anterior'), turn('assistant', 'resposta anterior')];
    const body: AssistantQueryBody = { question: 'Nova pergunta', history };
    await handleAssistantQuery(ACTOR, body, CORRELATION_ID);

    expect(insertedRows).toHaveLength(1);
    const row = insertedRows[0] as Record<string, unknown>;
    expect(row.history).toBeUndefined();
    expect(JSON.stringify(row)).not.toContain('pergunta anterior');
    expect(JSON.stringify(row)).not.toContain('resposta anterior');
  });
});
