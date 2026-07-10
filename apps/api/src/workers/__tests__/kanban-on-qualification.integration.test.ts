// =============================================================================
// kanban-on-qualification.integration.test.ts — Testes de integração REAIS
// contra Postgres (F25-S08) da família 2 do DoD do slot:
//
//   "Worker de qualificação reflete no card sem pular para `simulacao`."
//
// Complementa kanban-on-qualification.test.ts (mocks completos de select/
// update/insert) — aqui handleLeadQualified roda contra SQL real:
//   - Card qualificado eleva priority (0 -> 1) mas permanece no MESMO stage
//     (canonical_role pre_atendimento) — nunca pula para simulacao.
//   - kanban_stage_history registra a transição com from_stage_id == to_stage_id
//     (nenhuma mudança de stage, só sinalização de prioridade).
//   - audit_logs grava a ação com actor null (ação de sistema/worker).
//   - Idempotência: reprocessar o mesmo evento (card já priority>0) é no-op —
//     sem nova linha de audit_logs nem de kanban_stage_history.
//
// Banco: mesmo padrão de sla-scan-integration.test.ts — probe
// pool.query('SELECT 1'); describe.runIf(dbAvailable) pula limpo sem DB.
// =============================================================================
import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db, pool } from '../../db/client.js';
import type { EventOutbox } from '../../db/schema/events.js';
import {
  auditLogs,
  cities,
  kanbanCards,
  kanbanStageHistory,
  kanbanStages,
  leads,
  organizations,
} from '../../db/schema/index.js';
import { handleLeadQualified } from '../kanban-on-qualification.js';

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

const ORG_ID = makeUuid('cb100001');
const CITY_ID = makeUuid('cb200001');
const STAGE_PRE_ID = makeUuid('cb300001');
const STAGE_SIM_ID = makeUuid('cb300002');

const LEAD_ID = makeUuid('cb400001');
const CARD_ID = makeUuid('cb500001');

function makeEvent(overrides: Partial<EventOutbox> = {}): EventOutbox {
  return {
    id: randomUUID(),
    organizationId: ORG_ID,
    eventName: 'leads.qualified',
    eventVersion: 1,
    aggregateType: 'lead',
    aggregateId: LEAD_ID,
    payload: {
      lead_id: LEAD_ID,
      organization_id: ORG_ID,
      canonical_role: 'pre_atendimento',
      stage_id: STAGE_PRE_ID,
      card_id: CARD_ID,
    },
    correlationId: null,
    idempotencyKey: 'leads.qualified:' + LEAD_ID,
    attempts: 0,
    lastError: null,
    processedAt: null,
    failedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

beforeAll(async () => {
  if (!dbAvailable) return;

  await db
    .insert(organizations)
    .values({ id: ORG_ID, slug: 'kanban-qual-int-' + RUN_SUFFIX, name: 'KQ IntOrg', settings: {} })
    .onConflictDoNothing();

  await db
    .insert(cities)
    .values({
      id: CITY_ID,
      organizationId: ORG_ID,
      ibgeCode: '9' + RUN_SUFFIX.slice(0, 5) + '1',
      name: 'KQ IntCity',
      nameNormalized: 'kq intcity',
      stateUf: 'RO',
      slug: 'kq-intcity-' + RUN_SUFFIX,
      aliases: [],
      isActive: true,
    })
    .onConflictDoNothing();

  await db
    .insert(kanbanStages)
    .values([
      {
        id: STAGE_PRE_ID,
        organizationId: ORG_ID,
        name: 'KQ IntStage Pre ' + RUN_SUFFIX,
        orderIndex: 0,
        canonicalRole: 'pre_atendimento',
      },
      {
        id: STAGE_SIM_ID,
        organizationId: ORG_ID,
        name: 'KQ IntStage Sim ' + RUN_SUFFIX,
        orderIndex: 1,
        canonicalRole: 'simulacao',
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(leads)
    .values({
      id: LEAD_ID,
      organizationId: ORG_ID,
      cityId: CITY_ID,
      phoneE164: '+5569' + RUN_SUFFIX.slice(0, 9),
      phoneNormalized: '5569' + RUN_SUFFIX.slice(0, 9),
      name: 'KQ IntLead ' + RUN_SUFFIX,
      source: 'whatsapp',
      status: 'qualifying',
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
    await db.delete(kanbanStageHistory).where(eq(kanbanStageHistory.cardId, CARD_ID));
    await db.delete(auditLogs).where(eq(auditLogs.organizationId, ORG_ID));
    await db.delete(kanbanCards).where(eq(kanbanCards.id, CARD_ID));
    await db.delete(leads).where(eq(leads.id, LEAD_ID));
    await db.delete(kanbanStages).where(eq(kanbanStages.id, STAGE_SIM_ID));
    await db.delete(kanbanStages).where(eq(kanbanStages.id, STAGE_PRE_ID));
    await db.delete(cities).where(eq(cities.id, CITY_ID));
    await db.delete(organizations).where(eq(organizations.id, ORG_ID));
  } finally {
    await pool.end();
  }
});

describe.runIf(dbAvailable)(
  '[INTEGRATION] handleLeadQualified — worker reflete qualificação (família 2)',
  () => {
    it('eleva priority do card para 1 SEM mover de stage (permanece pre_atendimento)', async () => {
      await handleLeadQualified(db, makeEvent());

      const [card] = await db
        .select()
        .from(kanbanCards)
        .where(eq(kanbanCards.id, CARD_ID))
        .limit(1);
      expect(card?.priority).toBe(1);
      // Nunca pula para o stage de simulação — doc 22 §6.1.
      expect(card?.stageId).toBe(STAGE_PRE_ID);
      expect(card?.stageId).not.toBe(STAGE_SIM_ID);
    });

    it('kanban_stage_history registra a sinalização sem mudança real de stage', async () => {
      const rows = await db
        .select()
        .from(kanbanStageHistory)
        .where(eq(kanbanStageHistory.cardId, CARD_ID));

      expect(rows).toHaveLength(1);
      expect(rows[0]?.fromStageId).toBe(STAGE_PRE_ID);
      expect(rows[0]?.toStageId).toBe(STAGE_PRE_ID);
      expect(rows[0]?.actorUserId).toBeNull();
    });

    it('audit_logs grava kanban.card_qualified_by_ai com actor de sistema (null)', async () => {
      const rows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.organizationId, ORG_ID),
            eq(auditLogs.action, 'kanban.card_qualified_by_ai'),
            eq(auditLogs.resourceId, CARD_ID),
          ),
        );

      expect(rows).toHaveLength(1);
      expect(rows[0]?.actorUserId).toBeNull();
    });

    it('idempotente: reprocessar o mesmo evento não duplica audit_logs nem histórico', async () => {
      await handleLeadQualified(db, makeEvent());

      const historyRows = await db
        .select()
        .from(kanbanStageHistory)
        .where(eq(kanbanStageHistory.cardId, CARD_ID));
      expect(historyRows).toHaveLength(1);

      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.organizationId, ORG_ID),
            eq(auditLogs.action, 'kanban.card_qualified_by_ai'),
            eq(auditLogs.resourceId, CARD_ID),
          ),
        );
      expect(auditRows).toHaveLength(1);

      const [card] = await db
        .select()
        .from(kanbanCards)
        .where(eq(kanbanCards.id, CARD_ID))
        .limit(1);
      expect(card?.priority).toBe(1);
    });
  },
);
