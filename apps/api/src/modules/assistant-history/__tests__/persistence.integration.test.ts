// =============================================================================
// modules/assistant-history/__tests__/persistence.integration.test.ts — F6-S25
//
// Testes de integração REAIS contra Postgres do DoD do slot:
//
//   - Flag `assistant.history.enabled` OFF (ausente do catálogo) ->
//     persistAssistantTurn é NO-OP puro: zero linhas em
//     assistant_conversations/assistant_turns. Endpoints CRUD OFF -> lista
//     vazia (nunca 500) / 404 nas operações por id.
//   - Flag ON -> turno persistido sem PII: `blocks` gravado só tem
//     `{ type, ref }` — a chave `value` (dado hidratado) nunca chega ao
//     banco (defendido em profundidade pelo CHECK chk_assistant_turns_blocks_no_value).
//   - Título gerado por intenção — nunca o nome de um titular, mesmo com um
//     nome "vazando" na pergunta bruta.
//   - Escopo privado (owner-scoped): usuário B nunca vê/abre conversa do
//     usuário A na mesma organização — 404, nunca 403.
//   - CRUD: create/rename/soft-delete.
//
// Banco: mesmo padrão de assistant-escalation.integration.test.ts — probe
// pool.query('SELECT 1'); describe.runIf(dbAvailable) pula limpo sem DB.
// =============================================================================
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db, pool } from '../../../db/client.js';
import {
  assistantConversations,
  assistantTurns,
  featureFlags,
  organizations,
  users,
} from '../../../db/schema/index.js';
import { NotFoundError } from '../../../shared/errors.js';
import { invalidateFlagCache } from '../../featureFlags/service.js';
import type { Block } from '../../internal-assistant/schemas.js';
import { DEFAULT_CONVERSATION_TITLE } from '../sanitize.js';
import {
  ASSISTANT_HISTORY_FLAG_KEY,
  createConversationForUser,
  deleteConversationForUser,
  getConversationDetail,
  listConversationsForUser,
  persistAssistantTurn,
  renameConversationForUser,
} from '../service.js';
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

const ORG_ID = makeUuid('ah100001');
const USER_OWNER_ID = makeUuid('ah600001');
const USER_OTHER_ID = makeUuid('ah600002');

const PII_SENTINEL = 'SEGREDO_LEAD_VALUE_HIDRATADO_' + RUN_SUFFIX;
const NAME_SENTINEL_QUESTION = 'Quantos leads o João Pedro da Silva tem no funil?';

// permissions/cityScopeIds globais — a hidratação (F6-S27) em si é testada
// à parte, em hydration.integration.test.ts; aqui só precisam satisfazer o
// tipo (nenhum bloco com ref de lead é persistido nestes cenários).
const OWNER_ACTOR: AssistantHistoryActorContext = {
  userId: USER_OWNER_ID,
  organizationId: ORG_ID,
  permissions: ['ai_assistant:use'],
  cityScopeIds: null,
};

const OTHER_ACTOR: AssistantHistoryActorContext = {
  userId: USER_OTHER_ID,
  organizationId: ORG_ID,
  permissions: ['ai_assistant:use'],
  cityScopeIds: null,
};

function blockWithValue(): Block {
  return {
    type: 'lead_summary',
    ref: { kind: 'lead', lead_id: null },
    value: { nome: PII_SENTINEL, cpf: '123.456.789-01' },
  };
}

async function enableHistoryFlag(): Promise<void> {
  await db
    .insert(featureFlags)
    .values({
      key: ASSISTANT_HISTORY_FLAG_KEY,
      status: 'enabled',
      visible: true,
      uiLabel: 'Histórico do copiloto (teste)',
      description: 'Seed de teste — F6-S25 integration test',
      audience: {},
    })
    .onConflictDoUpdate({ target: featureFlags.key, set: { status: 'enabled' } });
  invalidateFlagCache();
}

async function disableHistoryFlag(): Promise<void> {
  await db.delete(featureFlags).where(eq(featureFlags.key, ASSISTANT_HISTORY_FLAG_KEY));
  invalidateFlagCache();
}

// ---------------------------------------------------------------------------
// beforeAll — seed mínimo (1 org, 2 usuários; flag ausente = OFF)
// ---------------------------------------------------------------------------
beforeAll(async () => {
  if (!dbAvailable) return;

  await disableHistoryFlag();

  await db
    .insert(organizations)
    .values({ id: ORG_ID, slug: 'ah-int-' + RUN_SUFFIX, name: 'AH IntOrg', settings: {} })
    .onConflictDoNothing();

  await db
    .insert(users)
    .values([
      {
        id: USER_OWNER_ID,
        organizationId: ORG_ID,
        email: 'ah-int-owner-' + RUN_SUFFIX + '@test.local',
        passwordHash: 'x',
        fullName: 'AH IntUser Owner',
        status: 'active',
      },
      {
        id: USER_OTHER_ID,
        organizationId: ORG_ID,
        email: 'ah-int-other-' + RUN_SUFFIX + '@test.local',
        passwordHash: 'x',
        fullName: 'AH IntUser Other',
        status: 'active',
      },
    ])
    .onConflictDoNothing();
}, 30_000);

afterAll(async () => {
  if (!dbAvailable) return;
  try {
    // Turnos são apagados em cascata ao apagar as conversas (FK ON DELETE CASCADE).
    await db
      .delete(assistantConversations)
      .where(eq(assistantConversations.organizationId, ORG_ID));
    await db.delete(users).where(inArray(users.id, [USER_OWNER_ID, USER_OTHER_ID]));
    await db.delete(organizations).where(eq(organizations.id, ORG_ID));
    await disableHistoryFlag();
  } finally {
    await pool.end();
  }
});

// ---------------------------------------------------------------------------
// Suite A — flag OFF: no-op puro
// ---------------------------------------------------------------------------
describe.runIf(dbAvailable)('[INTEGRATION] F6-S25 — flag assistant.history.enabled OFF', () => {
  it('persistAssistantTurn não grava NENHUMA linha (conversas/turnos)', async () => {
    await persistAssistantTurn(db, OWNER_ACTOR, {
      question: NAME_SENTINEL_QUESTION,
      narrative: 'Há 42 leads ativos.',
      blocks: [blockWithValue()],
      sources: ['funnel_metrics'],
    });

    const conversationRows = await db
      .select()
      .from(assistantConversations)
      .where(eq(assistantConversations.organizationId, ORG_ID));
    expect(conversationRows).toHaveLength(0);
  });

  it('GET conversations (lista) retorna vazio — nunca lança', async () => {
    const result = await listConversationsForUser(db, OWNER_ACTOR);
    expect(result).toEqual({ data: [] });
  });

  it('GET conversa por id -> NotFoundError (404), não 500', async () => {
    await expect(
      getConversationDetail(db, OWNER_ACTOR, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('POST conversa (criar) -> NotFoundError enquanto a flag estiver off', async () => {
    await expect(createConversationForUser(db, OWNER_ACTOR, undefined)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

// ---------------------------------------------------------------------------
// Suite B — flag ON: persistência sem PII + escopo privado + CRUD
// ---------------------------------------------------------------------------
describe.runIf(dbAvailable)('[INTEGRATION] F6-S25 — flag assistant.history.enabled ON', () => {
  beforeAll(async () => {
    if (!dbAvailable) return;
    await enableHistoryFlag();
  });

  it('persiste o turno: blocks gravado só tem { type, ref } — nunca `value`', async () => {
    await persistAssistantTurn(db, OWNER_ACTOR, {
      question: NAME_SENTINEL_QUESTION,
      narrative: 'Há 42 leads ativos no funil.',
      blocks: [blockWithValue()],
      sources: ['funnel_metrics'],
    });

    const [conversation] = await db
      .select()
      .from(assistantConversations)
      .where(
        and(
          eq(assistantConversations.organizationId, ORG_ID),
          eq(assistantConversations.userId, USER_OWNER_ID),
        ),
      );
    expect(conversation).toBeDefined();
    if (!conversation) throw new Error('conversation not found');

    const turns = await db
      .select()
      .from(assistantTurns)
      .where(eq(assistantTurns.conversationId, conversation.id));
    expect(turns).toHaveLength(1);

    const turn = turns[0];
    if (!turn) throw new Error('turn not found');

    const serializedBlocks = JSON.stringify(turn.blocks);
    expect(serializedBlocks).not.toContain('"value"');
    expect(serializedBlocks).not.toContain(PII_SENTINEL);
    expect(turn.blocks).toEqual([{ type: 'lead_summary', ref: { kind: 'lead', lead_id: null } }]);
  });

  it('título gerado por intenção — nunca o nome de um titular', async () => {
    const [conversation] = await db
      .select()
      .from(assistantConversations)
      .where(
        and(
          eq(assistantConversations.organizationId, ORG_ID),
          eq(assistantConversations.userId, USER_OWNER_ID),
        ),
      );
    expect(conversation).toBeDefined();
    // A pergunta continha "João Pedro da Silva" + "funil" -> a regra de
    // intenção de funil vence, e o título nunca interpola o nome.
    expect(conversation?.title).toBe('Análise do funil');
    expect(conversation?.title).not.toContain('João');
    expect(conversation?.title).not.toContain('Silva');
  });

  it('pergunta persistida está higienizada (sem o nome bruto)', async () => {
    const [conversation] = await db
      .select()
      .from(assistantConversations)
      .where(
        and(
          eq(assistantConversations.organizationId, ORG_ID),
          eq(assistantConversations.userId, USER_OWNER_ID),
        ),
      );
    if (!conversation) throw new Error('conversation not found');

    const [turn] = await db
      .select()
      .from(assistantTurns)
      .where(eq(assistantTurns.conversationId, conversation.id));
    expect(turn?.questionSanitized).not.toContain('João Pedro da Silva');
    expect(turn?.questionSanitized).toContain('<NOME>');
  });

  it('escopo privado: outro usuário NUNCA vê a conversa (lista vazia + 404, nunca 403)', async () => {
    const [conversation] = await db
      .select()
      .from(assistantConversations)
      .where(
        and(
          eq(assistantConversations.organizationId, ORG_ID),
          eq(assistantConversations.userId, USER_OWNER_ID),
        ),
      );
    if (!conversation) throw new Error('conversation not found');

    const otherList = await listConversationsForUser(db, OTHER_ACTOR);
    expect(otherList.data.find((c) => c.id === conversation.id)).toBeUndefined();

    await expect(getConversationDetail(db, OTHER_ACTOR, conversation.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );

    // Dono consegue abrir normalmente.
    const detail = await getConversationDetail(db, OWNER_ACTOR, conversation.id);
    expect(detail.id).toBe(conversation.id);
    expect(detail.turns).toHaveLength(1);
  });

  it('CRUD: cria conversa vazia sem título -> título padrão', async () => {
    const created = await createConversationForUser(db, OWNER_ACTOR, undefined);
    expect(created.title).toBe(DEFAULT_CONVERSATION_TITLE);
  });

  it('CRUD: cria conversa com título fornecido pelo usuário -> higienizado', async () => {
    const created = await createConversationForUser(db, OWNER_ACTOR, 'Conversa sobre João Silva');
    expect(created.title).not.toContain('João Silva');
    expect(created.title).toContain('<NOME>');
  });

  it('CRUD: renomeia a própria conversa', async () => {
    const created = await createConversationForUser(db, OWNER_ACTOR, undefined);
    const renamed = await renameConversationForUser(
      db,
      OWNER_ACTOR,
      created.id,
      'Cobranças em atraso',
    );
    expect(renamed.title).toBe('Cobranças em atraso');
  });

  it('CRUD: outro usuário não pode renomear conversa alheia -> 404', async () => {
    const created = await createConversationForUser(db, OWNER_ACTOR, undefined);
    await expect(
      renameConversationForUser(db, OTHER_ACTOR, created.id, 'Tentativa indevida'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('CRUD: soft-delete remove a conversa da listagem e bloqueia leitura futura', async () => {
    const created = await createConversationForUser(db, OWNER_ACTOR, undefined);
    const result = await deleteConversationForUser(db, OWNER_ACTOR, created.id);
    expect(result.deleted).toBe(true);

    await expect(getConversationDetail(db, OWNER_ACTOR, created.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const list = await listConversationsForUser(db, OWNER_ACTOR);
    expect(list.data.find((c) => c.id === created.id)).toBeUndefined();
  });

  it('CRUD: outro usuário não pode deletar conversa alheia -> 404', async () => {
    const created = await createConversationForUser(db, OWNER_ACTOR, undefined);
    await expect(deleteConversationForUser(db, OTHER_ACTOR, created.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
