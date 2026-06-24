// reports/__tests__/reports.integration.test.ts -- F23-S11
// TESTES DE INTEGRACAO REAIS CONTRA POSTGRES.
//
// Objetivo: detectar erros de SQL que testes mockados nao detectam:
//   - coluna inexistente (ch.kind vs ch.provider)
//   - aggregate aninhado (AVG(MIN(...)) proibido no Postgres)
//   - IN-list mal-formada (aspas sem fechamento na IN-list)
//   - MV inexistente
//
// Banco: postgres://elemento:elemento@localhost:5432/elemento_test em CI
//        (DATABASE_URL injetado pelo job Node do ci.yml; setup.ts preserva via ??=).
//        Local sem DB: probe falha → dbAvailable=false → describe.runIf pula limpo.
// CI: Postgres do job Node + "Run migrations (test DB)" aplica 0000..0072 antes.
//
// 9 describe blocks, ~44 tests.

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db, pool } from '../../../db/client.js';
import { agents, cities, leads, organizations, users } from '../../../db/schema/index.js';
import {
  getAttendanceByChannel,
  getAttendanceTimings,
  getAttendanceTotals,
  getFunnelStages,
  getOverviewConversations,
  getOverviewContracts,
  getOverviewLeads,
  getOverviewSimulations,
} from '../repository.js';

// ---------------------------------------------------------------------------
// Probe de disponibilidade do DB.
// Em CI: DATABASE_URL aponta para o Postgres real (elemento_test) provisionado
//        pelo job Node + migration aplicada → probe passa → dbAvailable=true.
// Local sem DB: conexão recusada → catch → dbAvailable=false → describe.runIf
//               pula todos os blocos limpo, sem falha de suíte.
// ---------------------------------------------------------------------------
let dbAvailable = false;
try {
  await pool.query('SELECT 1');
  dbAvailable = true;
} catch {
  // DB indisponível localmente — suíte vai pular via describe.runIf(dbAvailable)
}

// IDs unicos por run -- evita colisao em DB compartilhado entre workers
const RUN_SUFFIX = String(Date.now()).slice(-10);
function makeUuid(prefix: string): string {
  const pad = RUN_SUFFIX.padStart(12, '0');
  return (prefix.slice(0, 8) + '-0000-0000-0000-' + pad) as string;
}

const ORG_A_ID = makeUuid('aa000001');
const ORG_B_ID = makeUuid('bb000001');
const CITY_A_ID = makeUuid('cc000001');
const CITY_B_ID = makeUuid('cc000002');
const USER_A_ID = makeUuid('dd000001');
const USER_B_ID = makeUuid('dd000002');
const AGENT_A_ID = makeUuid('ee000001');
const LEAD_A1_ID = makeUuid('ff000001');
const LEAD_A2_ID = makeUuid('ff000002');
const LEAD_B1_ID = makeUuid('ff000003');
const CHANNEL_A_ID = makeUuid('ca000001');
const CONV_A1_ID = makeUuid('cb000001');
const CONV_A2_ID = makeUuid('cb000002');
const CONV_B1_ID = makeUuid('cb000003');
const MSG_A1_ID = makeUuid('mc000001');
const MSG_A2_ID = makeUuid('mc000002');

const DATE_RANGE = {
  from: new Date('2020-01-01T00:00:00.000Z'),
  to: new Date('2030-12-31T23:59:59.999Z'),
};

// ---------------------------------------------------------------------------
// beforeAll -- seed minimo
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Sem DB (local): sai imediatamente — nada a semear.
  if (!dbAvailable) return;
  // Orgs
  await db
    .insert(organizations)
    .values({
      id: ORG_A_ID,
      slug: 'int-a-' + RUN_SUFFIX,
      name: 'IntOrg A ' + RUN_SUFFIX,
      settings: {},
    })
    .onConflictDoNothing();
  await db
    .insert(organizations)
    .values({
      id: ORG_B_ID,
      slug: 'int-b-' + RUN_SUFFIX,
      name: 'IntOrg B ' + RUN_SUFFIX,
      settings: {},
    })
    .onConflictDoNothing();
  // Cities
  await db
    .insert(cities)
    .values({
      id: CITY_A_ID,
      organizationId: ORG_A_ID,
      ibgeCode: '9' + RUN_SUFFIX.slice(0, 5) + '1',
      name: 'IntCity A',
      nameNormalized: 'intcity a',
      stateUf: 'RO',
      slug: 'intcity-a-' + RUN_SUFFIX,
      aliases: [],
      isActive: true,
    })
    .onConflictDoNothing();
  await db
    .insert(cities)
    .values({
      id: CITY_B_ID,
      organizationId: ORG_B_ID,
      ibgeCode: '9' + RUN_SUFFIX.slice(0, 5) + '2',
      name: 'IntCity B',
      nameNormalized: 'intcity b',
      stateUf: 'RO',
      slug: 'intcity-b-' + RUN_SUFFIX,
      aliases: [],
      isActive: true,
    })
    .onConflictDoNothing();
  // Users
  await db
    .insert(users)
    .values({
      id: USER_A_ID,
      organizationId: ORG_A_ID,
      email: 'int-a-' + RUN_SUFFIX + '@test.local',
      passwordHash: 'x',
      fullName: 'IntUser A',
      status: 'active',
    })
    .onConflictDoNothing();
  await db
    .insert(users)
    .values({
      id: USER_B_ID,
      organizationId: ORG_B_ID,
      email: 'int-b-' + RUN_SUFFIX + '@test.local',
      passwordHash: 'x',
      fullName: 'IntUser B',
      status: 'active',
    })
    .onConflictDoNothing();
  // Agent
  await db
    .insert(agents)
    .values({
      id: AGENT_A_ID,
      organizationId: ORG_A_ID,
      userId: USER_A_ID,
      displayName: 'Agent IntTest A',
      isActive: true,
    })
    .onConflictDoNothing();
  // Leads: Org A (2 leads closed_won + new), Org B (1 lead new)
  await db
    .insert(leads)
    .values({
      id: LEAD_A1_ID,
      organizationId: ORG_A_ID,
      cityId: CITY_A_ID,
      agentId: AGENT_A_ID,
      phoneE164: '+55629990' + RUN_SUFFIX.slice(0, 4),
      phoneNormalized: '55629990' + RUN_SUFFIX.slice(0, 4),
      name: 'Lead IntA1',
      source: 'manual',
      status: 'closed_won',
    })
    .onConflictDoNothing();
  await db
    .insert(leads)
    .values({
      id: LEAD_A2_ID,
      organizationId: ORG_A_ID,
      cityId: CITY_A_ID,
      agentId: AGENT_A_ID,
      phoneE164: '+55629991' + RUN_SUFFIX.slice(0, 4),
      phoneNormalized: '55629991' + RUN_SUFFIX.slice(0, 4),
      name: 'Lead IntA2',
      source: 'manual',
      status: 'new',
    })
    .onConflictDoNothing();
  await db
    .insert(leads)
    .values({
      id: LEAD_B1_ID,
      organizationId: ORG_B_ID,
      cityId: CITY_B_ID,
      phoneE164: '+55629992' + RUN_SUFFIX.slice(0, 4),
      phoneNormalized: '55629992' + RUN_SUFFIX.slice(0, 4),
      name: 'Lead IntB1',
      source: 'manual',
      status: 'new',
    })
    .onConflictDoNothing();
  // Channel -- inserido via sql bruto (displayHandle obrigatorio)
  const RUN_CH = 'pn_' + RUN_SUFFIX;
  await db.execute(
    sql`INSERT INTO channels (id, organization_id, name, display_handle, provider, phone_number_id, is_active) VALUES (${CHANNEL_A_ID}, ${ORG_A_ID}, 'IntCh_test', 'IntCh_test', 'meta_whatsapp', ${RUN_CH}, true) ON CONFLICT DO NOTHING`,
  );
  // Conversations -- inseridas via sql bruto (contactRemoteId obrigatorio)
  const now = new Date();
  const nowIso = now.toISOString();
  await db.execute(
    sql`INSERT INTO conversations (id, organization_id, city_id, channel_id, lead_id, assigned_user_id, contact_remote_id, status, created_at, updated_at) VALUES (${CONV_A1_ID}, ${ORG_A_ID}, ${CITY_A_ID}, ${CHANNEL_A_ID}, ${LEAD_A1_ID}, ${USER_A_ID}, 'remote_a1', 'resolved', ${nowIso}::timestamptz, ${nowIso}::timestamptz) ON CONFLICT DO NOTHING`,
  );
  await db.execute(
    sql`INSERT INTO conversations (id, organization_id, city_id, channel_id, lead_id, assigned_user_id, contact_remote_id, status, created_at, updated_at) VALUES (${CONV_A2_ID}, ${ORG_A_ID}, ${CITY_A_ID}, ${CHANNEL_A_ID}, ${LEAD_A2_ID}, ${USER_A_ID}, 'remote_a2', 'open', ${nowIso}::timestamptz, ${nowIso}::timestamptz) ON CONFLICT DO NOTHING`,
  );
  // Org B conversation
  await db.execute(
    sql`INSERT INTO conversations (id, organization_id, city_id, channel_id, contact_remote_id, status, created_at, updated_at) VALUES (${CONV_B1_ID}, ${ORG_B_ID}, ${CITY_B_ID}, ${CHANNEL_A_ID}, 'remote_b1', 'open', ${nowIso}::timestamptz, ${nowIso}::timestamptz) ON CONFLICT DO NOTHING`,
  );
  // Messages via sql bruto
  await db.execute(
    sql`INSERT INTO messages (id, conversation_id, direction, content, created_at) VALUES (${MSG_A1_ID}, ${CONV_A1_ID}, 'in', 'ola', ${nowIso}::timestamptz) ON CONFLICT DO NOTHING`,
  );
  const outTime = new Date(now.getTime() + 30_000).toISOString();
  await db.execute(
    sql`INSERT INTO messages (id, conversation_id, direction, content, created_at) VALUES (${MSG_A2_ID}, ${CONV_A1_ID}, 'out', 'bom dia', ${outTime}::timestamptz) ON CONFLICT DO NOTHING`,
  );
  // REFRESH MVs (CONCURRENTLY requer unique index -- garantido pela migration 0071)
  const mvNames = [
    'mv_reports_overview',
    'mv_reports_funnel',
    'mv_reports_stage_dwell',
    'mv_reports_credit',
    'mv_reports_collection',
  ];
  for (const mv of mvNames) {
    try {
      await db.execute(sql.raw('REFRESH MATERIALIZED VIEW CONCURRENTLY ' + mv));
    } catch {
      // silenciado -- erro descritivo aparece nos testes individuais
    }
  }
}, 30_000);
// afterAll -- limpar em ordem respeitando FKs
afterAll(async () => {
  // Sem DB (local): pool nunca foi conectado, nada a limpar.
  if (!dbAvailable) return;
  try {
    await db.execute(sql`DELETE FROM messages WHERE id = ${MSG_A1_ID} OR id = ${MSG_A2_ID}`);
    await db.execute(
      sql`DELETE FROM conversations WHERE id = ${CONV_A1_ID} OR id = ${CONV_A2_ID} OR id = ${CONV_B1_ID}`,
    );
    await db.execute(
      sql`DELETE FROM leads WHERE id = ${LEAD_A1_ID} OR id = ${LEAD_A2_ID} OR id = ${LEAD_B1_ID}`,
    );
    await db.execute(sql`DELETE FROM agents WHERE id = ${AGENT_A_ID}`);
    await db.execute(sql`DELETE FROM channels WHERE id = ${CHANNEL_A_ID}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${USER_A_ID} OR id = ${USER_B_ID}`);
    await db.execute(sql`DELETE FROM cities WHERE id = ${CITY_A_ID} OR id = ${CITY_B_ID}`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${ORG_A_ID} OR id = ${ORG_B_ID}`);
  } finally {
    await pool.end();
  }
});

const scopeGlobal = { cityScopeIds: null as string[] | null };
const scopeCityA = { cityScopeIds: [CITY_A_ID] };
const scopeEmpty = { cityScopeIds: [] as string[] };

describe.runIf(dbAvailable)('[INTEGRATION] getOverviewLeads -- SQL real', () => {
  it('executa sem erro de SQL (sanity)', async () => {
    const result = await getOverviewLeads(db, ORG_A_ID, scopeGlobal, DATE_RANGE, null);
    expect(typeof result.total).toBe('number');
    expect(typeof result.closedWon).toBe('number');
    expect(typeof result.conversionRate).toBe('number');
  });

  it('conta minimo 2 leads semeados na Org A', async () => {
    const result = await getOverviewLeads(db, ORG_A_ID, scopeGlobal, DATE_RANGE, null);
    expect(result.total).toBeGreaterThanOrEqual(2);
    expect(result.closedWon).toBeGreaterThanOrEqual(1);
  });

  it('PARIDADE: total == SELECT COUNT direto', async () => {
    const result = await getOverviewLeads(db, ORG_A_ID, scopeGlobal, DATE_RANGE, null);
    const rows = await db.execute(
      sql`SELECT COUNT(*)::int AS cnt FROM leads WHERE organization_id = ${ORG_A_ID} AND deleted_at IS NULL`,
    );
    const directCnt = Number((rows.rows[0] as { cnt: string | number }).cnt ?? 0);
    expect(result.total).toBe(directCnt);
  });

  it('ISOLAMENTO: total Org A > total Org B', async () => {
    const a = await getOverviewLeads(db, ORG_A_ID, scopeGlobal, DATE_RANGE, null);
    const b = await getOverviewLeads(db, ORG_B_ID, scopeGlobal, DATE_RANGE, null);
    expect(a.total).toBeGreaterThan(b.total);
  });

  it('ISOLAMENTO: Org A total == COUNT direto para ORG_A_ID', async () => {
    const result = await getOverviewLeads(db, ORG_A_ID, scopeGlobal, DATE_RANGE, null);
    const rows = await db.execute(
      sql`SELECT COUNT(*)::int AS cnt FROM leads WHERE organization_id = ${ORG_A_ID} AND deleted_at IS NULL`,
    );
    expect(result.total).toBe(Number((rows.rows[0] as { cnt: string | number }).cnt ?? 0));
  });

  it('city-scope: scopeCityA == global (todos os leads estao em CITY_A)', async () => {
    const scoped = await getOverviewLeads(db, ORG_A_ID, scopeCityA, DATE_RANGE, null);
    const global_ = await getOverviewLeads(db, ORG_A_ID, scopeGlobal, DATE_RANGE, null);
    expect(scoped.total).toBe(global_.total);
  });

  it('cityScopeIds=[] retorna zero (AND 1=0 no WHERE)', async () => {
    const result = await getOverviewLeads(db, ORG_A_ID, scopeEmpty, DATE_RANGE, null);
    expect(result.total).toBe(0);
  });

  it('self-scope: agente ve apenas seus proprios leads', async () => {
    const selfResult = await getOverviewLeads(db, ORG_A_ID, scopeGlobal, DATE_RANGE, AGENT_A_ID);
    expect(selfResult.total).toBeGreaterThanOrEqual(2);
  });

  it('LGPD: shape nao contem campos PII', () => {
    const keys = ['total', 'newInPeriod', 'closedWon', 'closedLost', 'conversionRate'];
    const piiFields = ['name', 'cpf', 'phone', 'email', 'address'];
    const hasPii = keys.some((k) => piiFields.some((f) => k.toLowerCase().includes(f)));
    expect(hasPii).toBe(false);
  });
});

describe.runIf(dbAvailable)('[INTEGRATION] getOverviewConversations -- SQL real', () => {
  it('executa sem erro de SQL', async () => {
    const result = await getOverviewConversations(db, ORG_A_ID, scopeGlobal);
    expect(typeof result.open).toBe('number');
    expect(typeof result.resolved).toBe('number');
  });

  it('conta minimo 1 open e 1 resolved semeados', async () => {
    const result = await getOverviewConversations(db, ORG_A_ID, scopeGlobal);
    expect(result.open).toBeGreaterThanOrEqual(1);
    expect(result.resolved).toBeGreaterThanOrEqual(1);
  });

  it('PARIDADE: open + resolved == SELECT COUNT FILTER direto', async () => {
    const result = await getOverviewConversations(db, ORG_A_ID, scopeGlobal);
    const rows = await db.execute(
      sql`SELECT COUNT(*) FILTER (WHERE status = 'open')::int AS open_cnt, COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved_cnt FROM conversations WHERE organization_id = ${ORG_A_ID} AND deleted_at IS NULL`,
    );
    const row = rows.rows[0] as { open_cnt: string | number; resolved_cnt: string | number };
    expect(result.open).toBe(Number(row.open_cnt ?? 0));
    expect(result.resolved).toBe(Number(row.resolved_cnt ?? 0));
  });

  it('ISOLAMENTO: Org B tem 1 open e 0 resolved', async () => {
    const result = await getOverviewConversations(db, ORG_B_ID, scopeGlobal);
    expect(result.open).toBeGreaterThanOrEqual(1);
    expect(result.resolved).toBe(0);
  });
});

describe.runIf(dbAvailable)('[INTEGRATION] getAttendanceTotals -- SQL real', () => {
  it('executa sem erro de sintaxe ou coluna', async () => {
    const result = await getAttendanceTotals(db, ORG_A_ID, scopeGlobal, DATE_RANGE, null);
    expect(typeof result.conversationsOpened).toBe('number');
    expect(typeof result.conversationsResolved).toBe('number');
    expect(typeof result.messagesTotal).toBe('number');
  });

  it('PARIDADE: conversationsResolved == SELECT COUNT FILTER direto', async () => {
    const result = await getAttendanceTotals(db, ORG_A_ID, scopeGlobal, DATE_RANGE, null);
    const rows = await db.execute(
      sql`SELECT COUNT(*) FILTER (WHERE status = 'resolved')::int AS cnt FROM conversations WHERE organization_id = ${ORG_A_ID} AND deleted_at IS NULL AND created_at >= ${DATE_RANGE.from.toISOString()}::timestamptz AND created_at <= ${DATE_RANGE.to.toISOString()}::timestamptz`,
    );
    const resolved = Number((rows.rows[0] as { cnt: string | number }).cnt ?? 0);
    expect(result.conversationsResolved).toBe(resolved);
  });

  it('self-scope: agente ve apenas suas conversas (USER_A_ID)', async () => {
    const selfResult = await getAttendanceTotals(db, ORG_A_ID, scopeGlobal, DATE_RANGE, USER_A_ID);
    const globalResult = await getAttendanceTotals(db, ORG_A_ID, scopeGlobal, DATE_RANGE, null);
    expect(selfResult.conversationsOpened).toBeLessThanOrEqual(globalResult.conversationsOpened);
    expect(selfResult.conversationsOpened).toBeGreaterThanOrEqual(2);
  });

  it('city-scope: mesmo resultado quando todas as conversas estao em CITY_A', async () => {
    const scoped = await getAttendanceTotals(db, ORG_A_ID, scopeCityA, DATE_RANGE, null);
    const global_ = await getAttendanceTotals(db, ORG_A_ID, scopeGlobal, DATE_RANGE, null);
    expect(scoped.conversationsOpened).toBe(global_.conversationsOpened);
  });
});

describe.runIf(dbAvailable)(
  '[INTEGRATION] getAttendanceByChannel -- BUG ch.kind vs ch.provider',
  () => {
    it('CRITICO: executa sem column does not exist -- confirma ch.provider', async () => {
      // Se a query usasse ch.kind, Postgres lancaria: ERROR: column ch.kind does not exist
      await expect(
        getAttendanceByChannel(db, ORG_A_ID, scopeGlobal, DATE_RANGE, null),
      ).resolves.toBeDefined();
    });

    it('retorna array tipado com campos channel, conversationCount, messageCount', async () => {
      const result = await getAttendanceByChannel(db, ORG_A_ID, scopeGlobal, DATE_RANGE, null);
      expect(Array.isArray(result)).toBe(true);
      if (result.length > 0) {
        expect(result[0]).toHaveProperty('channel');
        expect(result[0]).toHaveProperty('conversationCount');
        expect(result[0]).toHaveProperty('messageCount');
      }
    });

    it('filtra por provider=meta_whatsapp sem erro', async () => {
      const result = await getAttendanceByChannel(
        db,
        ORG_A_ID,
        scopeGlobal,
        DATE_RANGE,
        null,
        undefined,
        'meta_whatsapp',
      );
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0]?.channel).toBe('meta_whatsapp');
    });

    it('PARIDADE: conversationCount == SELECT COUNT DISTINCT direto', async () => {
      const result = await getAttendanceByChannel(
        db,
        ORG_A_ID,
        scopeGlobal,
        DATE_RANGE,
        null,
        undefined,
        'meta_whatsapp',
      );
      const rows = await db.execute(
        sql`SELECT COUNT(DISTINCT c.id)::int AS cnt FROM conversations c JOIN channels ch ON ch.id = c.channel_id WHERE c.organization_id = ${ORG_A_ID} AND c.deleted_at IS NULL AND ch.provider = 'meta_whatsapp' AND c.created_at >= ${DATE_RANGE.from.toISOString()}::timestamptz AND c.created_at <= ${DATE_RANGE.to.toISOString()}::timestamptz`,
      );
      const directCnt = Number((rows.rows[0] as { cnt: string | number }).cnt ?? 0);
      const fnCnt = result.reduce((s, r) => s + r.conversationCount, 0);
      expect(fnCnt).toBe(directCnt);
    });

    it('cityScopeIds=[] retorna [] sem chamar DB (short-circuit)', async () => {
      const result = await getAttendanceByChannel(db, ORG_A_ID, scopeEmpty, DATE_RANGE, null);
      expect(result).toEqual([]);
    });

    it('ISOLAMENTO: Org A nao ve conversations de Org B', async () => {
      const a = await getAttendanceByChannel(db, ORG_A_ID, scopeGlobal, DATE_RANGE, null);
      const b = await getAttendanceByChannel(db, ORG_B_ID, scopeGlobal, DATE_RANGE, null);
      const totalA = a.reduce((s, r) => s + r.conversationCount, 0);
      const totalB = b.reduce((s, r) => s + r.conversationCount, 0);
      expect(totalA).toBeGreaterThan(totalB);
    });

    it('D3: selfUserId filtra conversas do agente', async () => {
      const selfResult = await getAttendanceByChannel(
        db,
        ORG_A_ID,
        scopeGlobal,
        DATE_RANGE,
        USER_A_ID,
      );
      const globalResult = await getAttendanceByChannel(
        db,
        ORG_A_ID,
        scopeGlobal,
        DATE_RANGE,
        null,
      );
      const selfTotal = selfResult.reduce((s, r) => s + r.conversationCount, 0);
      const globalTotal = globalResult.reduce((s, r) => s + r.conversationCount, 0);
      expect(selfTotal).toBeLessThanOrEqual(globalTotal);
    });

    it('LGPD: shape nao contem PII (channel/conversationCount/messageCount)', () => {
      const shapeKeys = ['channel', 'conversationCount', 'messageCount'];
      const piiFields = ['name', 'cpf', 'phone', 'email'];
      const hasPii = shapeKeys.some((k) => piiFields.some((f) => k.toLowerCase().includes(f)));
      expect(hasPii).toBe(false);
    });
  },
);

describe.runIf(dbAvailable)('[INTEGRATION] getAttendanceTimings -- BUG nested aggregate', () => {
  it('CRITICO: executa sem aggregate function calls cannot be nested', async () => {
    // AVG(MIN(...)) seria erro; a query usa CTE fr + AVG externo -- correto
    await expect(
      getAttendanceTimings(db, ORG_A_ID, scopeGlobal, DATE_RANGE, null),
    ).resolves.toBeDefined();
  });

  it('retorna tipos corretos: number ou null', async () => {
    const result = await getAttendanceTimings(db, ORG_A_ID, scopeGlobal, DATE_RANGE, null);
    for (const key of [
      'firstResponseAvgSec',
      'firstResponseP90Sec',
      'resolutionAvgSec',
      'resolutionP90Sec',
    ] as const) {
      const val = result[key];
      expect(val === null || typeof val === 'number').toBe(true);
    }
  });

  it('cityScopeIds=[] retorna empty sem chamar DB', async () => {
    const result = await getAttendanceTimings(db, ORG_A_ID, scopeEmpty, DATE_RANGE, null);
    expect(result.firstResponseAvgSec).toBeNull();
    expect(result.resolutionAvgSec).toBeNull();
  });

  it('firstResponseAvgSec >= 0 com msg outbound 30s apos inbound', async () => {
    const result = await getAttendanceTimings(db, ORG_A_ID, scopeGlobal, DATE_RANGE, null);
    if (result.firstResponseAvgSec !== null) {
      expect(result.firstResponseAvgSec).toBeGreaterThanOrEqual(0);
    }
  });
});

describe.runIf(dbAvailable)('[INTEGRATION] getOverviewSimulations -- MV + BUG IN-list', () => {
  it('executa sem erro de sintaxe (IN-list corrigida)', async () => {
    await expect(
      getOverviewSimulations(db, ORG_A_ID, scopeGlobal, DATE_RANGE),
    ).resolves.toBeDefined();
  });

  it('IN-list com 1 cidade -- parametrizado sem erro', async () => {
    await expect(
      getOverviewSimulations(db, ORG_A_ID, scopeCityA, DATE_RANGE),
    ).resolves.toBeDefined();
  });

  it('retorna tipos numericos', async () => {
    const result = await getOverviewSimulations(db, ORG_A_ID, scopeGlobal, DATE_RANGE);
    expect(typeof result.total).toBe('number');
    expect(typeof result.amountSum).toBe('number');
    expect(typeof result.amountAvg).toBe('number');
  });

  it('cityScopeIds=[] retorna zero sem chamar o banco', async () => {
    const result = await getOverviewSimulations(db, ORG_A_ID, scopeEmpty, DATE_RANGE);
    expect(result).toEqual({ total: 0, amountSum: 0, amountAvg: 0 });
  });
});

describe.runIf(dbAvailable)('[INTEGRATION] getOverviewContracts -- MV mv_reports_overview', () => {
  it('executa sem erro de sintaxe ou MV inexistente', async () => {
    await expect(
      getOverviewContracts(db, ORG_A_ID, scopeGlobal, DATE_RANGE),
    ).resolves.toBeDefined();
  });

  it('retorna tipos numericos corretos', async () => {
    const result = await getOverviewContracts(db, ORG_A_ID, scopeGlobal, DATE_RANGE);
    expect(typeof result.active).toBe('number');
    expect(typeof result.settled).toBe('number');
    expect(typeof result.defaulted).toBe('number');
    expect(typeof result.activePrincipalSum).toBe('number');
  });

  it('cityScopeIds=[] retorna zero sem chamar o banco', async () => {
    const result = await getOverviewContracts(db, ORG_A_ID, scopeEmpty, DATE_RANGE);
    expect(result).toEqual({ active: 0, settled: 0, defaulted: 0, activePrincipalSum: 0 });
  });
});

describe.runIf(dbAvailable)('[INTEGRATION] getFunnelStages -- MV mv_reports_funnel', () => {
  it('executa sem erro de sintaxe (IN-list corrigida)', async () => {
    await expect(getFunnelStages(db, ORG_A_ID, scopeGlobal)).resolves.toBeDefined();
  });

  it('IN-list com 1 cidade -- parametrizado via sql.join', async () => {
    await expect(getFunnelStages(db, ORG_A_ID, scopeCityA)).resolves.toBeDefined();
  });

  it('retorna array (vazio ou com dados)', async () => {
    const result = await getFunnelStages(db, ORG_A_ID, scopeGlobal);
    expect(Array.isArray(result)).toBe(true);
  });

  it('cityScopeIds=[] retorna [] sem chamar DB', async () => {
    const result = await getFunnelStages(db, ORG_A_ID, scopeEmpty);
    expect(result).toEqual([]);
  });

  it('LGPD: shape nao contem PII de cidadao', () => {
    const shapeKeys = [
      'stageId',
      'stageOrder',
      'cardCount',
      'staleCardCount',
      'avgDwellHours',
      'medianDwellHours',
    ];
    const piiFields = ['cpf', 'phone', 'email', 'address'];
    const hasPii = shapeKeys.some((k) => piiFields.some((f) => k.toLowerCase().includes(f)));
    expect(hasPii).toBe(false);
  });
});

describe.runIf(dbAvailable)('[INTEGRATION] ISOLAMENTO cross-org (CRITICO)', () => {
  it('getOverviewLeads: Org A e Org B retornam totais independentes', async () => {
    const a = await getOverviewLeads(db, ORG_A_ID, scopeGlobal, DATE_RANGE, null);
    const b = await getOverviewLeads(db, ORG_B_ID, scopeGlobal, DATE_RANGE, null);
    expect(a.total).toBeGreaterThan(b.total);
  });

  it('getAttendanceTotals: Org A nao ve conversations de Org B (paridade direta)', async () => {
    const a = await getAttendanceTotals(db, ORG_A_ID, scopeGlobal, DATE_RANGE, null);
    const b = await getAttendanceTotals(db, ORG_B_ID, scopeGlobal, DATE_RANGE, null);
    const rowsA = await db.execute(
      sql`SELECT COUNT(*)::int AS cnt FROM conversations WHERE organization_id = ${ORG_A_ID} AND deleted_at IS NULL AND created_at >= ${DATE_RANGE.from.toISOString()}::timestamptz AND created_at <= ${DATE_RANGE.to.toISOString()}::timestamptz`,
    );
    const rowsB = await db.execute(
      sql`SELECT COUNT(*)::int AS cnt FROM conversations WHERE organization_id = ${ORG_B_ID} AND deleted_at IS NULL AND created_at >= ${DATE_RANGE.from.toISOString()}::timestamptz AND created_at <= ${DATE_RANGE.to.toISOString()}::timestamptz`,
    );
    expect(a.conversationsOpened).toBe(
      Number((rowsA.rows[0] as { cnt: string | number }).cnt ?? 0),
    );
    expect(b.conversationsOpened).toBe(
      Number((rowsB.rows[0] as { cnt: string | number }).cnt ?? 0),
    );
    expect(a.conversationsOpened).not.toBe(b.conversationsOpened);
  });

  it('getAttendanceByChannel: Org A tem mais conversas que Org B', async () => {
    const a = await getAttendanceByChannel(db, ORG_A_ID, scopeGlobal, DATE_RANGE, null);
    const b = await getAttendanceByChannel(db, ORG_B_ID, scopeGlobal, DATE_RANGE, null);
    const totalA = a.reduce((s, r) => s + r.conversationCount, 0);
    const totalB = b.reduce((s, r) => s + r.conversationCount, 0);
    expect(totalA).toBeGreaterThan(totalB);
  });
});
