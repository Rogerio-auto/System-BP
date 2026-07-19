// =============================================================================
// hydration.integration.test.ts — Testes de integração REAIS contra Postgres
// (F6-S27) do DoD do slot:
//
//   - Hidratação por `ref` via endpoints RBAC-bound (internal/assistant/
//     service.ts), com a permissão + escopo de cidade ATUAIS do ator.
//   - Sem permissão suficiente -> bloco `value: null` (unavailable), nunca
//     vaza o dado anterior.
//   - Lead fora do escopo de cidade atual -> idem (nunca vaza).
//   - Lead removido (soft-delete) -> idem.
//   - Bloco sem entidade referenciada (`ref.kind === 'none'`, ex.:
//     funnel_metrics) e `type` desconhecido/sem hidratador mapeado -> nunca
//     fabricam um valor, ficam `value: null`.
//
// Banco: mesmo padrão de persistence.integration.test.ts — probe
// pool.query('SELECT 1'); describe.runIf(dbAvailable) pula limpo sem DB.
// =============================================================================
import { eq, inArray } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db, pool } from '../../../db/client.js';
import {
  assistantConversations,
  channels,
  cities,
  conversations,
  creditAnalyses,
  featureFlags,
  leads,
  messages,
  organizations,
  users,
} from '../../../db/schema/index.js';
import {
  acquireGlobalFlagTestLock,
  releaseGlobalFlagTestLock,
} from '../../../test/globalFlagTestLock.js';
import { invalidateFlagCache } from '../../featureFlags/service.js';
import type {
  AnalysisStatusResponse,
  LeadConversationResponse,
} from '../../internal/assistant/schemas.js';
import { maskLeadName } from '../../internal/assistant/service.js';
import { insertConversation, insertTurnAndTouchConversation } from '../repository.js';
import { ASSISTANT_HISTORY_FLAG_KEY, getConversationDetail } from '../service.js';
import type { AssistantHistoryActorContext } from '../service.js';

// ---------------------------------------------------------------------------
// Probe de disponibilidade do DB
// ---------------------------------------------------------------------------
let dbAvailable = false;
try {
  await pool.query('SELECT 1');
  dbAvailable = true;
} catch {
  // Sem DB local — describe.runIf pula a suíte inteira, limpo.
}

// ---------------------------------------------------------------------------
// IDs determinísticos por execução
// ---------------------------------------------------------------------------
const RUN_SUFFIX = String(Date.now()).slice(-10);
function makeUuid(prefix: string): string {
  const pad = RUN_SUFFIX.padStart(12, '0');
  return `${prefix.slice(0, 8)}-0000-0000-0000-${pad}`;
}

// Prefixos usam apenas [0-9a-f] — Postgres `uuid` rejeita caracteres fora do
// alfabeto hexadecimal (ex.: 'hy...' falha com "invalid input syntax for type uuid").
const ORG_ID = makeUuid('da100001');
const CITY_LEAD_ID = makeUuid('da200001'); // cidade real do lead
const CITY_OTHER_ID = makeUuid('da200002'); // cidade fora do escopo do ator restrito
const LEAD_ID = makeUuid('da300001');
const ANALYSIS_ID = makeUuid('da400001');
const CHANNEL_ID = makeUuid('da500001');
const CONVERSATION_ID = makeUuid('da600001');
const OWNER_USER_ID = makeUuid('da700001');

const LEAD_NAME_SENTINEL = 'Fulano De Tal Hidratacao';
const MESSAGE_CONTENT_SENTINEL = 'SEGREDO_MENSAGEM_' + RUN_SUFFIX;

const ACTOR_FULL: AssistantHistoryActorContext = {
  userId: OWNER_USER_ID,
  organizationId: ORG_ID,
  permissions: ['ai_assistant:use', 'analyses:read', 'livechat:conversation:read'],
  cityScopeIds: null,
};

const ACTOR_NO_PERMISSION: AssistantHistoryActorContext = {
  userId: OWNER_USER_ID,
  organizationId: ORG_ID,
  permissions: ['ai_assistant:use'],
  cityScopeIds: null,
};

const ACTOR_WRONG_CITY_SCOPE: AssistantHistoryActorContext = {
  userId: OWNER_USER_ID,
  organizationId: ORG_ID,
  permissions: ['ai_assistant:use', 'analyses:read', 'livechat:conversation:read'],
  cityScopeIds: [CITY_OTHER_ID],
};

async function enableHistoryFlag(): Promise<void> {
  await db
    .insert(featureFlags)
    .values({
      key: ASSISTANT_HISTORY_FLAG_KEY,
      status: 'enabled',
      visible: true,
      uiLabel: 'Histórico do copiloto (teste hidratação)',
      description: 'Seed de teste — F6-S27 integration test',
      audience: {},
    })
    .onConflictDoUpdate({ target: featureFlags.key, set: { status: 'enabled' } });
  invalidateFlagCache();
}

async function disableHistoryFlag(): Promise<void> {
  await db.delete(featureFlags).where(eq(featureFlags.key, ASSISTANT_HISTORY_FLAG_KEY));
  invalidateFlagCache();
}

let conversationId = '';

// Advisory lock dedicado — serializa contra outros arquivos de integração que
// também fazem enable/disableHistoryFlag() na MESMA flag global
// `assistant.history.enabled` (ver test/globalFlagTestLock.ts).
let flagLockClient: pg.PoolClient | undefined;

// ---------------------------------------------------------------------------
// beforeAll — seed: org, cidades, lead, análise, canal, conversa+mensagens,
// usuário dono, conversa/turno do histórico com blocos referenciando o lead.
// ---------------------------------------------------------------------------
beforeAll(async () => {
  if (!dbAvailable) return;

  flagLockClient = await acquireGlobalFlagTestLock(pool);

  await enableHistoryFlag();

  await db
    .insert(organizations)
    .values({ id: ORG_ID, slug: 'hy-int-' + RUN_SUFFIX, name: 'HY IntOrg', settings: {} })
    .onConflictDoNothing();

  await db
    .insert(cities)
    .values([
      {
        id: CITY_LEAD_ID,
        organizationId: ORG_ID,
        ibgeCode: 'h' + RUN_SUFFIX.slice(0, 5) + '1',
        name: 'HY IntCity Lead',
        nameNormalized: 'hy intcity lead',
        stateUf: 'RO',
        slug: 'hy-intcity-lead-' + RUN_SUFFIX,
        aliases: [],
        isActive: true,
      },
      {
        id: CITY_OTHER_ID,
        organizationId: ORG_ID,
        ibgeCode: 'h' + RUN_SUFFIX.slice(0, 5) + '2',
        name: 'HY IntCity Other',
        nameNormalized: 'hy intcity other',
        stateUf: 'RO',
        slug: 'hy-intcity-other-' + RUN_SUFFIX,
        aliases: [],
        isActive: true,
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(users)
    .values({
      id: OWNER_USER_ID,
      organizationId: ORG_ID,
      email: 'hy-int-owner-' + RUN_SUFFIX + '@test.local',
      passwordHash: 'x',
      fullName: 'HY IntUser Owner',
      status: 'active',
    })
    .onConflictDoNothing();

  await db
    .insert(leads)
    .values({
      id: LEAD_ID,
      organizationId: ORG_ID,
      cityId: CITY_LEAD_ID,
      phoneE164: '+5569' + RUN_SUFFIX.slice(0, 9),
      phoneNormalized: '5569' + RUN_SUFFIX.slice(0, 9),
      name: LEAD_NAME_SENTINEL,
      source: 'manual',
      status: 'new',
    })
    .onConflictDoNothing();

  await db
    .insert(creditAnalyses)
    .values({
      id: ANALYSIS_ID,
      organizationId: ORG_ID,
      leadId: LEAD_ID,
      status: 'em_analise',
      origin: 'manual',
    })
    .onConflictDoNothing();

  await db
    .insert(channels)
    .values({
      id: CHANNEL_ID,
      organizationId: ORG_ID,
      cityId: CITY_LEAD_ID,
      provider: 'waha',
      name: 'HY IntChannel',
      displayHandle: 'hy-int-channel',
      wahaSessionId: 'hy-int-session-' + RUN_SUFFIX,
      isActive: true,
    })
    .onConflictDoNothing();

  await db
    .insert(conversations)
    .values({
      id: CONVERSATION_ID,
      organizationId: ORG_ID,
      cityId: CITY_LEAD_ID,
      channelId: CHANNEL_ID,
      contactRemoteId: '5569' + RUN_SUFFIX.slice(0, 9),
      leadId: LEAD_ID,
    })
    .onConflictDoNothing();

  await db.insert(messages).values([
    {
      conversationId: CONVERSATION_ID,
      channelId: CHANNEL_ID,
      direction: 'in',
      type: 'text',
      content: MESSAGE_CONTENT_SENTINEL + '_1',
      createdAt: new Date('2026-07-01T10:00:00Z'),
    },
    {
      conversationId: CONVERSATION_ID,
      channelId: CHANNEL_ID,
      direction: 'out',
      type: 'text',
      content: MESSAGE_CONTENT_SENTINEL + '_2',
      createdAt: new Date('2026-07-01T10:01:00Z'),
    },
  ]);

  // Conversa + turno do HISTÓRICO (assistant_conversations/assistant_turns) —
  // blocks só `{ type, ref }`, nunca `value` (invariante do CHECK do banco).
  const conversation = await insertConversation(db, ORG_ID, OWNER_USER_ID, 'Consulta sobre lead');
  conversationId = conversation.id;
  await insertTurnAndTouchConversation(db, conversationId, {
    questionSanitized: 'Qual o status da análise deste lead?',
    narrative: 'Análise em andamento.',
    blocks: [
      { type: 'analysis_status', ref: { kind: 'lead', lead_id: LEAD_ID } },
      { type: 'lead_summary', ref: { kind: 'lead', lead_id: LEAD_ID } },
      { type: 'funnel_metrics', ref: { kind: 'none', lead_id: null } },
      { type: 'future_block_type', ref: { kind: 'lead', lead_id: LEAD_ID } },
    ],
    sources: ['analysis_status', 'lead_summary', 'funnel_metrics'],
  });
}, 30_000);

afterAll(async () => {
  if (!dbAvailable) return;
  try {
    await db
      .delete(assistantConversations)
      .where(eq(assistantConversations.organizationId, ORG_ID));
    await db.delete(messages).where(eq(messages.conversationId, CONVERSATION_ID));
    await db.delete(conversations).where(eq(conversations.id, CONVERSATION_ID));
    await db.delete(channels).where(eq(channels.id, CHANNEL_ID));
    await db.delete(creditAnalyses).where(eq(creditAnalyses.id, ANALYSIS_ID));
    await db.delete(leads).where(eq(leads.id, LEAD_ID));
    await db.delete(users).where(eq(users.id, OWNER_USER_ID));
    await db.delete(cities).where(inArray(cities.id, [CITY_LEAD_ID, CITY_OTHER_ID]));
    await db.delete(organizations).where(eq(organizations.id, ORG_ID));
    await disableHistoryFlag();
    if (flagLockClient !== undefined) {
      await releaseGlobalFlagTestLock(flagLockClient);
    }
  } finally {
    await pool.end();
  }
});

function findBlock(
  turns: Awaited<ReturnType<typeof getConversationDetail>>['turns'],
  type: string,
) {
  const turn = turns[0];
  if (!turn) throw new Error('turn not found');
  const block = turn.blocks.find((b) => b.type === type);
  if (!block) throw new Error(`block not found: ${type}`);
  return block;
}

describe.runIf(dbAvailable)('[INTEGRATION] F6-S27 — hidratação viva do histórico', () => {
  it('com acesso: analysis_status hidratado com dado real (nome mascarado)', async () => {
    const detail = await getConversationDetail(db, ACTOR_FULL, conversationId);
    const block = findBlock(detail.turns, 'analysis_status');
    expect(block.ref).toEqual({ kind: 'lead', lead_id: LEAD_ID });
    const value = block.value as AnalysisStatusResponse;
    expect(value.source).toBe('assistant.analysis-status');
    expect(value.leadNameMasked).toBe(maskLeadName(LEAD_NAME_SENTINEL));
    expect(value.analyses).toHaveLength(1);
    expect(value.analyses[0]?.id).toBe(ANALYSIS_ID);
    expect(value.analyses[0]?.status).toBe('em_analise');
  });

  it('com acesso: lead_summary hidratado com as mensagens reais da conversa', async () => {
    const detail = await getConversationDetail(db, ACTOR_FULL, conversationId);
    const block = findBlock(detail.turns, 'lead_summary');
    const value = block.value as LeadConversationResponse;
    expect(value.source).toBe('assistant.lead-conversation');
    expect(value.lead_id).toBe(LEAD_ID);
    expect(value.messages).toHaveLength(2);
    expect(value.messages.map((m) => m.content)).toEqual([
      MESSAGE_CONTENT_SENTINEL + '_1',
      MESSAGE_CONTENT_SENTINEL + '_2',
    ]);
  });

  it('bloco sem entidade (ref.kind=none) nunca fabrica valor -> value null', async () => {
    const detail = await getConversationDetail(db, ACTOR_FULL, conversationId);
    const block = findBlock(detail.turns, 'funnel_metrics');
    expect(block.value).toBeNull();
  });

  it('type desconhecido referenciando lead -> value null (nunca fabrica forma incompatível)', async () => {
    const detail = await getConversationDetail(db, ACTOR_FULL, conversationId);
    const block = findBlock(detail.turns, 'future_block_type');
    expect(block.value).toBeNull();
  });

  it('sem permissão suficiente -> unavailable (value null), nunca vaza o dado', async () => {
    const detail = await getConversationDetail(db, ACTOR_NO_PERMISSION, conversationId);
    expect(findBlock(detail.turns, 'analysis_status').value).toBeNull();
    expect(findBlock(detail.turns, 'lead_summary').value).toBeNull();
  });

  it('lead fora do escopo de cidade ATUAL do ator -> unavailable (value null)', async () => {
    const detail = await getConversationDetail(db, ACTOR_WRONG_CITY_SCOPE, conversationId);
    expect(findBlock(detail.turns, 'analysis_status').value).toBeNull();
    expect(findBlock(detail.turns, 'lead_summary').value).toBeNull();
  });

  it('lead removido (soft-delete) -> unavailable (value null)', async () => {
    await db.update(leads).set({ deletedAt: new Date() }).where(eq(leads.id, LEAD_ID));
    try {
      const detail = await getConversationDetail(db, ACTOR_FULL, conversationId);
      // findLeadById (usado por getLeadConversation) filtra deleted_at IS NULL
      // por padrão -- lead removido some do escopo do ator, mesmo com acesso
      // total (permissão + cidade).
      expect(findBlock(detail.turns, 'lead_summary').value).toBeNull();
    } finally {
      await db.update(leads).set({ deletedAt: null }).where(eq(leads.id, LEAD_ID));
    }
  });
});
