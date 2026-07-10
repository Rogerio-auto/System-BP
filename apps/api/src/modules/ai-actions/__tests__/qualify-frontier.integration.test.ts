// =============================================================================
// qualify-frontier.integration.test.ts — Testes de integração REAIS contra
// Postgres (F25-S08) da fronteira IA↔humano — família 1 do DoD do slot.
//
// Cobre docs/22-agente-interno-acoes.md §6.1/§8.A/§9 com `qualifyLead()`
// (F25-S03, apps/api/src/modules/leads/service.ts) rodando contra SQL real:
//
//   1. qualify idempotente: 2ª chamada é no-op (não regride/duplica estado).
//   2. Evento `leads.qualified` emitido exatamente UMA vez no outbox mesmo
//      chamando qualifyLead() duas vezes (idempotencyKey determinística +
//      onConflictDoNothing).
//   3. audit_logs grava `actor_type='ai'` — comportamento REAL confirmado:
//      qualifyLead() insere audit_logs DIRETAMENTE (não via helper auditLog()),
//      setando actorType:'ai' explicitamente — diferente do gap documentado
//      em ai-actions/repository.ts (funnel-housekeeping usa o helper auditLog()
//      que não expõe actor_type, então cai em 'user' default). Aqui o
//      actor_type real É 'ai', sem gap.
//   4. LGPD §8.5: nem audit_logs.before/after nem event_outbox.payload.data
//      desta ação carregam nome/telefone brutos do lead — apenas status e IDs.
//
// Banco: mesmo padrão de sla-scan-integration.test.ts — probe
// pool.query('SELECT 1'); describe.runIf(dbAvailable) pula limpo sem DB.
// =============================================================================
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db, pool } from '../../../db/client.js';
import {
  auditLogs,
  cities,
  eventOutbox,
  kanbanCards,
  kanbanStages,
  leads,
  organizations,
} from '../../../db/schema/index.js';
import { qualifyLead } from '../../leads/service.js';

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

const ORG_ID = makeUuid('af100001');
const CITY_ID = makeUuid('af200001');
const STAGE_PRE_ID = makeUuid('af300001');

const LEAD_ID = makeUuid('af400001');
const LEAD_NAME = 'Fabiana Qualify IntTest ' + RUN_SUFFIX;
const LEAD_PHONE_DIGITS = '5569' + RUN_SUFFIX.slice(0, 9);

const CARD_ID = makeUuid('af500001');

beforeAll(async () => {
  if (!dbAvailable) return;

  await db
    .insert(organizations)
    .values({ id: ORG_ID, slug: 'qualify-int-' + RUN_SUFFIX, name: 'Qualify IntOrg', settings: {} })
    .onConflictDoNothing();

  await db
    .insert(cities)
    .values({
      id: CITY_ID,
      organizationId: ORG_ID,
      ibgeCode: '8' + RUN_SUFFIX.slice(0, 5) + '1',
      name: 'Qualify IntCity',
      nameNormalized: 'qualify intcity',
      stateUf: 'RO',
      slug: 'qualify-intcity-' + RUN_SUFFIX,
      aliases: [],
      isActive: true,
    })
    .onConflictDoNothing();

  await db
    .insert(kanbanStages)
    .values({
      id: STAGE_PRE_ID,
      organizationId: ORG_ID,
      name: 'Qualify IntStage Pre ' + RUN_SUFFIX,
      orderIndex: 0,
      canonicalRole: 'pre_atendimento',
    })
    .onConflictDoNothing();

  await db
    .insert(leads)
    .values({
      id: LEAD_ID,
      organizationId: ORG_ID,
      cityId: CITY_ID,
      phoneE164: '+' + LEAD_PHONE_DIGITS,
      phoneNormalized: LEAD_PHONE_DIGITS,
      name: LEAD_NAME,
      source: 'whatsapp',
      status: 'new',
    })
    .onConflictDoNothing();

  await db
    .insert(kanbanCards)
    .values({
      id: CARD_ID,
      organizationId: ORG_ID,
      leadId: LEAD_ID,
      stageId: STAGE_PRE_ID,
      priority: 0,
    })
    .onConflictDoNothing();
}, 30_000);

afterAll(async () => {
  if (!dbAvailable) return;
  try {
    await db.delete(eventOutbox).where(eq(eventOutbox.organizationId, ORG_ID));
    await db.delete(auditLogs).where(eq(auditLogs.organizationId, ORG_ID));
    await db.delete(kanbanCards).where(eq(kanbanCards.id, CARD_ID));
    await db.delete(kanbanStages).where(eq(kanbanStages.id, STAGE_PRE_ID));
    await db.delete(leads).where(eq(leads.id, LEAD_ID));
    await db.delete(cities).where(eq(cities.id, CITY_ID));
    await db.delete(organizations).where(eq(organizations.id, ORG_ID));
  } finally {
    await pool.end();
  }
});

describe.runIf(dbAvailable)('[INTEGRATION] qualifyLead — fronteira IA↔humano (família 1)', () => {
  it('qualifica o lead: new -> qualifying', async () => {
    const result = await qualifyLead(db, LEAD_ID, ORG_ID);

    expect(result.previous_status).toBe('new');
    expect(result.current_status).toBe('qualifying');

    const [row] = await db.select().from(leads).where(eq(leads.id, LEAD_ID)).limit(1);
    expect(row?.status).toBe('qualifying');
  });

  it('audit_logs grava actor_type=ai (comportamento real, sem gap) para leads.qualified', async () => {
    const rows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, ORG_ID),
          eq(auditLogs.action, 'leads.qualified'),
          eq(auditLogs.resourceId, LEAD_ID),
        ),
      );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorType).toBe('ai');
    expect(rows[0]?.actorUserId).toBeNull();
  });

  it('evento leads.qualified emitido uma única vez no outbox', async () => {
    const rows = await db
      .select()
      .from(eventOutbox)
      .where(
        and(eq(eventOutbox.organizationId, ORG_ID), eq(eventOutbox.eventName, 'leads.qualified')),
      );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.idempotencyKey).toBe(`leads.qualified:${LEAD_ID}`);
  });

  it('2ª chamada é idempotente: no-op, sem duplicar audit_logs nem outbox', async () => {
    const result = await qualifyLead(db, LEAD_ID, ORG_ID);

    // Idempotência de negócio: já estava qualifying -> retorna o estado atual,
    // sem regressão nem nova transição.
    expect(result.previous_status).toBe('qualifying');
    expect(result.current_status).toBe('qualifying');

    const auditRows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, ORG_ID),
          eq(auditLogs.action, 'leads.qualified'),
          eq(auditLogs.resourceId, LEAD_ID),
        ),
      );
    expect(auditRows).toHaveLength(1);

    const eventRows = await db
      .select()
      .from(eventOutbox)
      .where(
        and(eq(eventOutbox.organizationId, ORG_ID), eq(eventOutbox.eventName, 'leads.qualified')),
      );
    expect(eventRows).toHaveLength(1);
  });

  it('LGPD §8.5: nenhum PII bruto (nome/telefone) no audit_log nem no payload do outbox', async () => {
    const [auditRow] = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, ORG_ID),
          eq(auditLogs.action, 'leads.qualified'),
          eq(auditLogs.resourceId, LEAD_ID),
        ),
      )
      .limit(1);

    expect(auditRow).toBeDefined();
    const auditSerialized = JSON.stringify([auditRow?.before, auditRow?.after]);
    expect(auditSerialized).not.toContain(LEAD_NAME);
    expect(auditSerialized).not.toContain(LEAD_PHONE_DIGITS);
    // before/after só devem carregar o campo `status` (sem PII estrutural extra).
    expect(Object.keys(auditRow?.before as Record<string, unknown>)).toEqual(['status']);
    expect(Object.keys(auditRow?.after as Record<string, unknown>)).toEqual(['status']);

    const [eventRow] = await db
      .select()
      .from(eventOutbox)
      .where(
        and(eq(eventOutbox.organizationId, ORG_ID), eq(eventOutbox.eventName, 'leads.qualified')),
      )
      .limit(1);

    expect(eventRow).toBeDefined();
    const payloadSerialized = JSON.stringify(eventRow?.payload);
    expect(payloadSerialized).not.toContain(LEAD_NAME);
    expect(payloadSerialized).not.toContain(LEAD_PHONE_DIGITS);
  });
});
