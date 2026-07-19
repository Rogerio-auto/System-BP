// =============================================================================
// modules/assistant-history/__tests__/retention.integration.test.ts — F6-S26
//
// Testes de integração REAIS contra Postgres do DoD do slot:
//
//   - Conversa ATIVA (deleted_at IS NULL) com updated_at > 90 dias -> purgada
//     fisicamente (deletedStale), turno cascade-deletado junto (FK).
//   - Conversa ATIVA dentro da janela (updated_at recente) -> PRESERVADA.
//   - Conversa soft-deletada pelo dono (deleted_at IS NOT NULL) -> purgada
//     fisicamente de IMEDIATO, mesmo com updated_at recente (mais protetivo
//     ao titular — não espera os 90 dias).
//   - dryRun=true -> apenas conta, não deleta nada.
//   - Tabela vazia (proxy de flag `assistant.history.enabled` OFF: sem
//     persistência, não há linha para o job varrer) -> job roda inócuo,
//     contagens 0, sem lançar.
//   - Gancho de exclusão por usuário (purgeAssistantHistoryForUser):
//     remove TODAS as conversas de um usuário, independentemente de idade
//     ou de estarem soft-deletadas; não afeta conversas de outro usuário.
//
// Banco: mesmo padrão de persistence.integration.test.ts — probe
// pool.query('SELECT 1'); describe.runIf(dbAvailable) pula limpo sem DB.
// =============================================================================
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { db, pool } from '../../../db/client.js';
import {
  assistantConversations,
  assistantTurns,
  organizations,
  users,
} from '../../../db/schema/index.js';
import {
  ASSISTANT_HISTORY_RETENTION_DAYS,
  purgeAssistantHistoryForUser,
  purgeExpiredAssistantHistory,
} from '../retention.js';

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
// alfabeto hexadecimal (ex.: 'rt...'/'cv...' com letras fora de a-f falham com
// "invalid input syntax for type uuid").
const ORG_ID = makeUuid('c7100001');
const USER_A_ID = makeUuid('c7600001');
const USER_B_ID = makeUuid('c7600002');

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function insertConversation(opts: {
  id: string;
  userId: string;
  updatedAt: Date;
  deletedAt?: Date | null;
}): Promise<void> {
  await db.insert(assistantConversations).values({
    id: opts.id,
    organizationId: ORG_ID,
    userId: opts.userId,
    title: 'Conversa de teste (retenção)',
    updatedAt: opts.updatedAt,
    deletedAt: opts.deletedAt ?? null,
  });
}

async function insertTurn(conversationId: string): Promise<string> {
  const rows = await db
    .insert(assistantTurns)
    .values({
      conversationId,
      questionSanitized: 'Pergunta de teste sanitizada',
      narrative: 'Narrativa de teste sem PII',
      blocks: [],
      sources: [],
    })
    .returning({ id: assistantTurns.id });
  const id = rows[0]?.id;
  if (!id) throw new Error('falha ao inserir turno de teste');
  return id;
}

async function existingConversationIds(ids: string[]): Promise<string[]> {
  const rows = await db
    .select({ id: assistantConversations.id })
    .from(assistantConversations)
    .where(inArray(assistantConversations.id, ids));
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// beforeAll — seed mínimo (1 org, 2 usuários)
// ---------------------------------------------------------------------------
beforeAll(async () => {
  if (!dbAvailable) return;

  await db
    .insert(organizations)
    .values({ id: ORG_ID, slug: 'rt-int-' + RUN_SUFFIX, name: 'RT IntOrg', settings: {} })
    .onConflictDoNothing();

  await db
    .insert(users)
    .values([
      {
        id: USER_A_ID,
        organizationId: ORG_ID,
        email: 'rt-int-a-' + RUN_SUFFIX + '@test.local',
        passwordHash: 'x',
        fullName: 'RT IntUser A',
        status: 'active',
      },
      {
        id: USER_B_ID,
        organizationId: ORG_ID,
        email: 'rt-int-b-' + RUN_SUFFIX + '@test.local',
        passwordHash: 'x',
        fullName: 'RT IntUser B',
        status: 'active',
      },
    ])
    .onConflictDoNothing();
}, 30_000);

beforeEach(async () => {
  if (!dbAvailable) return;
  // Turnos são apagados em cascata ao apagar as conversas (FK ON DELETE CASCADE).
  await db.delete(assistantConversations).where(eq(assistantConversations.organizationId, ORG_ID));
});

afterAll(async () => {
  if (!dbAvailable) return;
  try {
    await db
      .delete(assistantConversations)
      .where(eq(assistantConversations.organizationId, ORG_ID));
    await db.delete(users).where(inArray(users.id, [USER_A_ID, USER_B_ID]));
    await db.delete(organizations).where(eq(organizations.id, ORG_ID));
  } finally {
    await pool.end();
  }
});

describe.runIf(dbAvailable)('[INTEGRATION] F6-S26 — retenção e exclusão do histórico', () => {
  it('purga conversa ativa além dos 90 dias (deletedStale) — turno cascade junto', async () => {
    const staleId = makeUuid('ca100001');
    await insertConversation({
      id: staleId,
      userId: USER_A_ID,
      updatedAt: daysAgo(ASSISTANT_HISTORY_RETENTION_DAYS + 1),
    });
    const turnId = await insertTurn(staleId);

    const result = await purgeExpiredAssistantHistory(db);

    expect(result.deletedStale).toBeGreaterThanOrEqual(1);
    expect(await existingConversationIds([staleId])).toHaveLength(0);

    const turns = await db.select().from(assistantTurns).where(eq(assistantTurns.id, turnId));
    expect(turns).toHaveLength(0);
  });

  it('preserva conversa ativa dentro da janela de 90 dias', async () => {
    const freshId = makeUuid('ca100002');
    await insertConversation({ id: freshId, userId: USER_A_ID, updatedAt: daysAgo(1) });

    await purgeExpiredAssistantHistory(db);

    expect(await existingConversationIds([freshId])).toEqual([freshId]);
  });

  it('purga soft-deletada de IMEDIATO, mesmo com updated_at recente (dentro da janela)', async () => {
    const softId = makeUuid('ca100003');
    await insertConversation({
      id: softId,
      userId: USER_A_ID,
      updatedAt: daysAgo(1),
      deletedAt: new Date(),
    });

    const result = await purgeExpiredAssistantHistory(db);

    expect(result.deletedSoft).toBeGreaterThanOrEqual(1);
    expect(await existingConversationIds([softId])).toHaveLength(0);
  });

  it('dryRun=true apenas conta — nenhuma linha é deletada', async () => {
    const staleId = makeUuid('ca100004');
    await insertConversation({
      id: staleId,
      userId: USER_A_ID,
      updatedAt: daysAgo(ASSISTANT_HISTORY_RETENTION_DAYS + 5),
    });
    const softId = makeUuid('ca100005');
    await insertConversation({
      id: softId,
      userId: USER_A_ID,
      updatedAt: daysAgo(1),
      deletedAt: new Date(),
    });

    const result = await purgeExpiredAssistantHistory(db, { dryRun: true });

    expect(result.deletedStale).toBeGreaterThanOrEqual(1);
    expect(result.deletedSoft).toBeGreaterThanOrEqual(1);
    expect(await existingConversationIds([staleId, softId])).toEqual(
      expect.arrayContaining([staleId, softId]),
    );
  });

  it('tabela vazia (proxy de flag OFF) -> job roda inócuo, contagens 0', async () => {
    const result = await purgeExpiredAssistantHistory(db);
    expect(result).toEqual({ deletedSoft: 0, deletedStale: 0 });
  });

  it('gancho de exclusão por usuário: remove TODAS as conversas do usuário, ativas e soft-deletadas', async () => {
    const c1 = makeUuid('ca100006');
    const c2 = makeUuid('ca100007');
    const otherUserConv = makeUuid('ca100008');
    await insertConversation({ id: c1, userId: USER_A_ID, updatedAt: daysAgo(1) });
    await insertConversation({
      id: c2,
      userId: USER_A_ID,
      updatedAt: daysAgo(200),
      deletedAt: new Date(),
    });
    await insertConversation({ id: otherUserConv, userId: USER_B_ID, updatedAt: daysAgo(1) });

    const deleted = await purgeAssistantHistoryForUser(db, ORG_ID, USER_A_ID);

    expect(deleted).toBe(2);
    expect(await existingConversationIds([c1, c2])).toHaveLength(0);
    expect(await existingConversationIds([otherUserConv])).toEqual([otherUserConv]);
  });
});
