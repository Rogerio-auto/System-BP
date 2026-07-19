// =============================================================================
// notifications/__tests__/notifications-severity-integration.test.ts — Testes
// de integração REAIS contra Postgres para a coluna `severity` (F26-S03).
//
// Contexto (doc 23 §13, gap G6): `severity` hoje só viajava no payload do
// socket (realtime.ts) — a linha `notifications` não tinha a coluna, então
// a central REST (GET /api/notifications) não sabia diferenciar
// crítico/aviso/informativo e a severidade sumia no reload.
//
// Cobre:
//   1. createNotification persiste a severidade recebida (não-default).
//   2. createNotification sem severity explícita cai no default 'info'
//      (retrocompat com callers que ainda não passam o campo).
//   3. listNotifications (GET /api/notifications) retorna `severity` no
//      shape mapeado — não fica preso apenas ao payload do socket.
//
// Banco: mesmo padrão de preferences-integration.test.ts — probe
// pool.query('SELECT 1'); describe.runIf(dbAvailable) pula limpo sem DB.
// =============================================================================
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db, pool } from '../../../db/client.js';
import { organizations, users } from '../../../db/schema/index.js';
import { createNotification, listNotifications } from '../repository.js';

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
// IDs determinísticos por execução — prefixos apenas [0-9a-f].
// ---------------------------------------------------------------------------
const RUN_SUFFIX = String(Date.now()).slice(-10);
function makeUuid(prefix: string): string {
  const pad = RUN_SUFFIX.padStart(12, '0');
  return `${prefix.slice(0, 8)}-0000-0000-0000-${pad}`;
}

const ORG_ID = makeUuid('e1000001');
const USER_ID = makeUuid('e2000001');
const USER_EMAIL = 'severity-int-user-' + RUN_SUFFIX + '@test.local';

beforeAll(async () => {
  if (!dbAvailable) return;
  await db
    .insert(organizations)
    .values({
      id: ORG_ID,
      slug: 'severity-int-' + RUN_SUFFIX,
      name: 'Severity IntOrg',
      settings: {},
    })
    .onConflictDoNothing();
  await db
    .insert(users)
    .values({
      id: USER_ID,
      organizationId: ORG_ID,
      email: USER_EMAIL,
      passwordHash: 'x',
      fullName: 'Severity IntUser',
      status: 'active',
    })
    .onConflictDoNothing();
}, 30_000);

afterAll(async () => {
  if (!dbAvailable) return;
  try {
    await db.execute(sql`DELETE FROM notifications WHERE user_id = ${USER_ID}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${USER_ID}`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${ORG_ID}`);
  } finally {
    await pool.end();
  }
});

describe.runIf(dbAvailable)('[INTEGRATION] notifications.severity — SQL real', () => {
  it('createNotification persiste a severidade recebida (critical)', async () => {
    const notification = await createNotification(db, {
      organizationId: ORG_ID,
      userId: USER_ID,
      channel: 'in_app',
      type: 'in_app:payment.overdue',
      title: 'Parcela em atraso',
      body: 'A parcela venceu há 5 dias.',
      severity: 'critical',
    });

    expect(notification.severity).toBe('critical');

    const row = await db.execute(
      sql`SELECT severity FROM notifications WHERE id = ${notification.id}`,
    );
    expect(row.rows[0]).toMatchObject({ severity: 'critical' });
  });

  it('createNotification sem severity explícita cai no default "info"', async () => {
    const notification = await createNotification(db, {
      organizationId: ORG_ID,
      userId: USER_ID,
      channel: 'in_app',
      type: 'in_app:task.created',
      title: 'Nova tarefa',
      body: 'Uma tarefa foi criada.',
    });

    expect(notification.severity).toBe('info');
  });

  it('listNotifications (GET /api/notifications) retorna severity no shape mapeado', async () => {
    await createNotification(db, {
      organizationId: ORG_ID,
      userId: USER_ID,
      channel: 'in_app',
      type: 'in_app:lead.stalled',
      title: 'Lead parado',
      body: 'Sem atividade há 3 dias.',
      severity: 'warning',
    });

    const result = await listNotifications(db, ORG_ID, USER_ID, { page: 1, per_page: 50 });

    const warningItem = result.data.find((n) => n.title === 'Lead parado');
    expect(warningItem?.severity).toBe('warning');
    // Todas as linhas do fixture têm severity válida — nunca undefined.
    expect(result.data.every((n) => ['info', 'warning', 'critical'].includes(n.severity))).toBe(
      true,
    );
  });
});
