// =============================================================================
// modules/internal-assistant/__tests__/structured-response.test.ts -- F6-S21
//
// Cobre o contrato de resposta estruturada (narrativa + blocos) repassado do
// LangGraph (F6-S20):
//   - Resposta do service expoe narrative + blocks + sources + answer (legado).
//   - `answer` legado e o mesmo valor ja derivado pelo LangGraph (repassado,
//     nao recalculado no Node).
//   - `blocks[].value` (e o objeto `blocks`/`narrative`) nunca aparece em
//     nenhuma chamada ao logger -- pode conter PII de cliente.
//   - Bloco com `type` desconhecido (forward-compat) nao quebra o parse Zod
//     nem a resposta do service.
//   - Nenhuma persistencia de narrative/blocks em assistant_queries (Fase 2).
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
// Mock pino -- captura tudo que e logado, para provar que `value`/`blocks`/
// `narrative` nunca vazam em nenhuma chamada ao logger.
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
// Mock db -- captura o insert em assistant_queries (para provar que blocks
// nunca sao persistidos -- Fase 2, atras do DPO)
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
// Mock DLP -- pass-through (DLP ja coberto em outro slot)
// ---------------------------------------------------------------------------
vi.mock('../../../lib/dlp.js', () => ({
  redactPii: (text: string) => ({ redactedText: text, dlpTokens: [], dlpApplied: false }),
}));

// ---------------------------------------------------------------------------
// Mock fetch (global)
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

const PII_SENTINEL = 'SENTINELA_PII_LEAD_JOAO_DA_SILVA_11122233344';

function mockLangGraphResponse(body: Record<string, unknown>) {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
}

describe('F6-S21: contrato de resposta estruturada (narrativa + blocos)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loggedCalls.length = 0;
    insertedRows.length = 0;
  });

  it('repassa narrative + blocks + sources + answer (legado) do LangGraph', async () => {
    mockLangGraphResponse({
      narrative: 'A cidade X tem 12 leads ativos.',
      blocks: [
        {
          type: 'lead_count',
          ref: { kind: 'none', lead_id: null },
          value: { count: 12 },
        },
      ],
      answer: 'A cidade X tem 12 leads ativos.\n[lead_count] count: 12',
      sources: ['funnel_metrics'],
      tools_called: [],
      metadata: {},
      error: null,
    });

    const body: AssistantQueryBody = { question: 'Quantos leads tem a cidade X?' };
    const result = await handleAssistantQuery(ACTOR, body, CORRELATION_ID);

    expect(result.narrative).toBe('A cidade X tem 12 leads ativos.');
    expect(result.blocks).toEqual([
      { type: 'lead_count', ref: { kind: 'none', lead_id: null }, value: { count: 12 } },
    ]);
    expect(result.sources).toEqual(['funnel_metrics']);
    // `answer` legado e o mesmo texto ja derivado pelo LangGraph -- repassado,
    // nao recalculado no Node.
    expect(result.answer).toBe('A cidade X tem 12 leads ativos.\n[lead_count] count: 12');
  });

  it('`answer` legado permanece derivavel mesmo quando ha multiplos blocos', async () => {
    mockLangGraphResponse({
      narrative: 'Resumo do lead.',
      blocks: [
        { type: 'lead_summary', ref: { kind: 'lead', lead_id: null }, value: { status: 'novo' } },
        { type: 'analysis_status', ref: { kind: 'none', lead_id: null }, value: 'pendente' },
      ],
      answer: 'Resumo do lead.\n[lead_summary] status: novo\n[analysis_status] pendente',
      sources: ['lead_summary', 'analysis_status'],
      tools_called: [],
      metadata: {},
      error: null,
    });

    const body: AssistantQueryBody = { question: 'Status do lead?' };
    const result = await handleAssistantQuery(ACTOR, body, CORRELATION_ID);

    expect(result.answer.length).toBeGreaterThan(0);
    expect(result.answer).toContain('Resumo do lead.');
  });

  it('bloco com `type` desconhecido (forward-compat) nao quebra o parse nem a resposta', async () => {
    mockLangGraphResponse({
      narrative: 'Novo tipo de dado.',
      blocks: [
        {
          type: 'tipo_totalmente_novo_do_futuro',
          ref: { kind: 'none', lead_id: null },
          value: { qualquer: 'coisa' },
        },
      ],
      answer: 'Novo tipo de dado.',
      sources: [],
      tools_called: [],
      metadata: {},
      error: null,
    });

    const body: AssistantQueryBody = { question: 'Pergunta qualquer' };
    const result = await handleAssistantQuery(ACTOR, body, CORRELATION_ID);

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]?.type).toBe('tipo_totalmente_novo_do_futuro');
    // Nao caiu no fallback gracioso (que zeraria os blocks) -- prova que o
    // parse Zod tolerou o tipo desconhecido.
    expect(result.narrative).toBe('Novo tipo de dado.');
  });

  it('`blocks[].value` (PII de cliente) nunca aparece em nenhuma chamada ao logger', async () => {
    mockLangGraphResponse({
      narrative: 'Dados do lead encontrados.',
      blocks: [
        {
          type: 'lead_summary',
          ref: { kind: 'lead', lead_id: 'eeee0000-0000-0000-0000-000000000001' },
          value: { nome: PII_SENTINEL },
        },
      ],
      answer: `Dados do lead encontrados.\n[lead_summary] nome: ${PII_SENTINEL}`,
      sources: ['lead_summary'],
      tools_called: [],
      metadata: {},
      error: null,
    });

    const body: AssistantQueryBody = { question: 'Dados do lead?' };
    await handleAssistantQuery(ACTOR, body, CORRELATION_ID);

    const serializedLogs = JSON.stringify(loggedCalls);
    expect(serializedLogs).not.toContain(PII_SENTINEL);
  });

  it('narrative/blocks nunca sao persistidos em assistant_queries (Fase 2 ainda nao liberada)', async () => {
    mockLangGraphResponse({
      narrative: 'Narrativa que nao deve ser persistida como tal.',
      blocks: [
        {
          type: 'lead_summary',
          ref: { kind: 'lead', lead_id: 'eeee0000-0000-0000-0000-000000000001' },
          value: { nome: PII_SENTINEL },
        },
      ],
      answer: 'Narrativa que nao deve ser persistida como tal.',
      sources: ['lead_summary'],
      tools_called: [],
      metadata: {},
      error: null,
    });

    const body: AssistantQueryBody = { question: 'Dados do lead?' };
    await handleAssistantQuery(ACTOR, body, CORRELATION_ID);

    expect(insertedRows).toHaveLength(1);
    const row = insertedRows[0] as Record<string, unknown>;
    expect(row.blocks).toBeUndefined();
    expect(row.narrative).toBeUndefined();
    expect(JSON.stringify(row)).not.toContain(PII_SENTINEL);
  });

  it('fallback gracioso (LangGraph indisponivel) tambem expõe narrative + blocks vazios', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));

    const body: AssistantQueryBody = { question: 'Pergunta qualquer' };
    const result = await handleAssistantQuery(ACTOR, body, CORRELATION_ID);

    expect(result.blocks).toEqual([]);
    expect(result.narrative.length).toBeGreaterThan(0);
    expect(result.answer).toBe(result.narrative);
  });
});
