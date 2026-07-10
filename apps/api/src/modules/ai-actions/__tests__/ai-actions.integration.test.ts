// =============================================================================
// ai-actions.integration.test.ts — Testes de integração REAIS contra Postgres
// (F25-S08) das famílias 4, 5 e 7 do DoD do slot:
//
//   Família 4 — Reversão:
//     - POST /api/ai-actions/:id/revert (via service revertAiAction) reabre o
//       lead, preserva o histórico (lead_history append-only, nunca apagado),
//       e grava audit_logs com o ATOR HUMANO (não a IA) que reverteu.
//     - Idempotente: 2ª chamada retorna o mesmo resultado sem duplicar
//       lead_history/audit_logs/outbox.
//
//   Família 5 — Escopo de cidade:
//     - gestor_regional/agente (cityScopeIds restrito) só vê/reverte ações de
//       leads da própria cidade via getAiActionsList/revertAiAction.
//     - Ação de outra cidade -> NotFoundError (404), NUNCA ForbiddenError
//       (403) — não vaza existência do recurso fora do escopo (doc 10 §3.5).
//
//   Família 7 — LGPD:
//     - GET /api/ai-actions (getAiActionsList) NUNCA expõe o nome completo do
//       lead — apenas lead_name_masked (ex.: "M. Souza").
//
// Complementa ai-actions.test.ts (mocks completos de repository/db/emit/audit)
// — aqui getAiActionsList/revertAiAction rodam contra SQL real, usando
// qualifyLead() (F25-S03) real para produzir a audit_log original a reverter.
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
  leadHistory,
  leads,
  organizations,
  users,
} from '../../../db/schema/index.js';
import { NotFoundError } from '../../../shared/errors.js';
import { qualifyLead } from '../../leads/service.js';
import { getAiActionsList, revertAiAction } from '../service.js';
import type { AiActionsActorContext } from '../service.js';

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

const ORG_ID = makeUuid('ed100001');
const CITY_A_ID = makeUuid('ed200001');
const CITY_B_ID = makeUuid('ed200002');
const STAGE_PRE_ID = makeUuid('ed300001');

const LEAD_A_ID = makeUuid('ed400001'); // cidade A — reversor tem escopo aqui
const LEAD_B_ID = makeUuid('ed400002'); // cidade B — FORA do escopo do reversor

// Sufixo embutido no PRIMEIRO nome (não no último) — maskLeadName() usa
// primeira inicial + ÚLTIMA palavra ("M. Souza"); manter "Souza"/"Lima"
// intactos como último token para a asserção de máscara ser determinística.
const LEAD_A_NAME = 'Maria' + RUN_SUFFIX + ' da Silva Souza';
const LEAD_B_NAME = 'Joao' + RUN_SUFFIX + ' Pedro Lima';

const CARD_A_ID = makeUuid('ed500001');
const CARD_B_ID = makeUuid('ed500002');

const HUMAN_USER_ID = makeUuid('ed600001'); // gestor_regional/agente que reverte

async function findLeadStatus(leadId: string): Promise<string | undefined> {
  const [row] = await db.select({ status: leads.status }).from(leads).where(eq(leads.id, leadId));
  return row?.status;
}

async function findQualifyActionId(leadId: string): Promise<string> {
  const [row] = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.organizationId, ORG_ID),
        eq(auditLogs.action, 'leads.qualified'),
        eq(auditLogs.resourceId, leadId),
      ),
    );
  if (!row) throw new Error('[ai-actions.integration] audit_log de qualify não encontrado');
  return row.id;
}

beforeAll(async () => {
  if (!dbAvailable) return;

  await db
    .insert(organizations)
    .values({ id: ORG_ID, slug: 'ai-actions-int-' + RUN_SUFFIX, name: 'AA IntOrg', settings: {} })
    .onConflictDoNothing();

  await db
    .insert(cities)
    .values([
      {
        id: CITY_A_ID,
        organizationId: ORG_ID,
        ibgeCode: 'b' + RUN_SUFFIX.slice(0, 5) + '1',
        name: 'AA IntCity A',
        nameNormalized: 'aa intcity a',
        stateUf: 'RO',
        slug: 'aa-intcity-a-' + RUN_SUFFIX,
        aliases: [],
        isActive: true,
      },
      {
        id: CITY_B_ID,
        organizationId: ORG_ID,
        ibgeCode: 'b' + RUN_SUFFIX.slice(0, 5) + '2',
        name: 'AA IntCity B',
        nameNormalized: 'aa intcity b',
        stateUf: 'RO',
        slug: 'aa-intcity-b-' + RUN_SUFFIX,
        aliases: [],
        isActive: true,
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(kanbanStages)
    .values({
      id: STAGE_PRE_ID,
      organizationId: ORG_ID,
      name: 'AA IntStage Pre ' + RUN_SUFFIX,
      orderIndex: 0,
      canonicalRole: 'pre_atendimento',
    })
    .onConflictDoNothing();

  await db
    .insert(leads)
    .values([
      {
        id: LEAD_A_ID,
        organizationId: ORG_ID,
        cityId: CITY_A_ID,
        phoneE164: '+5569' + RUN_SUFFIX.slice(0, 9),
        phoneNormalized: '5569' + RUN_SUFFIX.slice(0, 9),
        name: LEAD_A_NAME,
        source: 'whatsapp',
        status: 'new',
      },
      {
        id: LEAD_B_ID,
        organizationId: ORG_ID,
        cityId: CITY_B_ID,
        phoneE164: '+5569' + RUN_SUFFIX.slice(1, 10),
        phoneNormalized: '5569' + RUN_SUFFIX.slice(1, 10),
        name: LEAD_B_NAME,
        source: 'whatsapp',
        status: 'new',
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(kanbanCards)
    .values([
      { id: CARD_A_ID, organizationId: ORG_ID, leadId: LEAD_A_ID, stageId: STAGE_PRE_ID },
      { id: CARD_B_ID, organizationId: ORG_ID, leadId: LEAD_B_ID, stageId: STAGE_PRE_ID },
    ])
    .onConflictDoNothing();

  // Usuário humano que reverte — FK real de lead_history.actor_user_id e
  // audit_logs.actor_user_id -> users(id).
  await db
    .insert(users)
    .values({
      id: HUMAN_USER_ID,
      organizationId: ORG_ID,
      email: 'ai-actions-int-' + RUN_SUFFIX + '@test.local',
      passwordHash: 'x',
      fullName: 'AA IntUser Reversor',
      status: 'active',
    })
    .onConflictDoNothing();

  // Ambos os leads são qualificados pela IA (F25-S03) — cada um gera uma
  // audit_log 'leads.qualified' real, que servirá de alvo de reversão.
  await qualifyLead(db, LEAD_A_ID, ORG_ID);
  await qualifyLead(db, LEAD_B_ID, ORG_ID);
}, 30_000);

afterAll(async () => {
  if (!dbAvailable) return;
  try {
    await db.delete(eventOutbox).where(eq(eventOutbox.organizationId, ORG_ID));
    await db.delete(auditLogs).where(eq(auditLogs.organizationId, ORG_ID));
    await db.delete(leadHistory).where(eq(leadHistory.leadId, LEAD_A_ID));
    await db.delete(leadHistory).where(eq(leadHistory.leadId, LEAD_B_ID));
    await db.delete(kanbanCards).where(eq(kanbanCards.id, CARD_A_ID));
    await db.delete(kanbanCards).where(eq(kanbanCards.id, CARD_B_ID));
    await db.delete(kanbanStages).where(eq(kanbanStages.id, STAGE_PRE_ID));
    await db.delete(leads).where(eq(leads.id, LEAD_A_ID));
    await db.delete(leads).where(eq(leads.id, LEAD_B_ID));
    await db.delete(users).where(eq(users.id, HUMAN_USER_ID));
    await db.delete(cities).where(eq(cities.id, CITY_A_ID));
    await db.delete(cities).where(eq(cities.id, CITY_B_ID));
    await db.delete(organizations).where(eq(organizations.id, ORG_ID));
  } finally {
    await pool.end();
  }
});

describe.runIf(dbAvailable)(
  '[INTEGRATION] ai-actions — fronteira IA↔humano (famílias 4/5/7)',
  () => {
    // Ator humano com escopo restrito à cidade A (gestor_regional/agente).
    const actorScopedToA: AiActionsActorContext = {
      userId: HUMAN_USER_ID,
      organizationId: ORG_ID,
      cityScopeIds: [CITY_A_ID],
    };

    it('família 5: listagem só mostra ações da própria cidade (escopo)', async () => {
      const result = await getAiActionsList(db, actorScopedToA, {
        window: '24h',
        page: 1,
        limit: 20,
      });

      const leadIds = result.data.map((item) => item.lead_id);
      expect(leadIds).toContain(LEAD_A_ID);
      expect(leadIds).not.toContain(LEAD_B_ID);
    });

    it('família 7 (LGPD): nome do lead sai sempre mascarado, nunca em texto puro', async () => {
      const result = await getAiActionsList(db, actorScopedToA, {
        window: '24h',
        page: 1,
        limit: 20,
      });

      const itemA = result.data.find((item) => item.lead_id === LEAD_A_ID);
      expect(itemA?.lead_name_masked).toBe('M. Souza');

      const serialized = JSON.stringify(result.data);
      expect(serialized).not.toContain(LEAD_A_NAME);
      expect(serialized).not.toContain(LEAD_B_NAME);
    });

    it('família 4: reverte leads.qualified da própria cidade — reabre lead, preserva histórico', async () => {
      const actionIdA = await findQualifyActionId(LEAD_A_ID);
      expect(await findLeadStatus(LEAD_A_ID)).toBe('qualifying');

      const result = await revertAiAction(db, actorScopedToA, actionIdA);

      expect(result.reverted).toBe(true);
      expect(result.previous_status).toBe('qualifying');
      expect(result.current_status).toBe('new');
      expect(await findLeadStatus(LEAD_A_ID)).toBe('new');

      // lead_history append-only: a linha ORIGINAL da IA (qualified_by_ai)
      // continua lá, e uma NOVA linha de reversão foi acrescentada — nada foi
      // apagado (doc 22 §2 princípio 8: reversível, histórico preservado).
      const historyRows = await db
        .select()
        .from(leadHistory)
        .where(eq(leadHistory.leadId, LEAD_A_ID));
      const actions = historyRows.map((r) => r.action);
      expect(actions).toContain('qualified_by_ai');
      expect(actions).toContain('reverted_by_user');

      const revertHistoryRow = historyRows.find((r) => r.action === 'reverted_by_user');
      expect(revertHistoryRow?.actorUserId).toBe(HUMAN_USER_ID);

      // audit_logs da reversão: ator é o USUÁRIO HUMANO que reverteu, nunca a IA
      // (contraste direto com o audit_log original de qualify, que é actor_type='ai').
      const revertAuditRows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.organizationId, ORG_ID),
            eq(auditLogs.action, 'ai_actions.reverted'),
            eq(auditLogs.resourceId, LEAD_A_ID),
          ),
        );
      expect(revertAuditRows).toHaveLength(1);
      expect(revertAuditRows[0]?.actorUserId).toBe(HUMAN_USER_ID);
      expect(revertAuditRows[0]?.actorType).not.toBe('ai');
    });

    it('família 4: reversão é idempotente — 2ª chamada não duplica histórico/audit/outbox', async () => {
      const actionIdA = await findQualifyActionId(LEAD_A_ID);

      const result = await revertAiAction(db, actorScopedToA, actionIdA);
      expect(result.reverted).toBe(true);
      expect(result.previous_status).toBe('qualifying');
      expect(result.current_status).toBe('new');

      const historyRows = await db
        .select()
        .from(leadHistory)
        .where(and(eq(leadHistory.leadId, LEAD_A_ID), eq(leadHistory.action, 'reverted_by_user')));
      expect(historyRows).toHaveLength(1);

      const revertAuditRows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.organizationId, ORG_ID),
            eq(auditLogs.action, 'ai_actions.reverted'),
            eq(auditLogs.resourceId, LEAD_A_ID),
          ),
        );
      expect(revertAuditRows).toHaveLength(1);

      const revertEvents = await db
        .select({ id: eventOutbox.id })
        .from(eventOutbox)
        .where(
          and(
            eq(eventOutbox.organizationId, ORG_ID),
            eq(eventOutbox.idempotencyKey, `ai_actions.revert:${actionIdA}`),
          ),
        );
      expect(revertEvents).toHaveLength(1);
    });

    it(
      'família 5: reverter ação de lead FORA do escopo de cidade -> 404 ' +
        '(NUNCA 403 — não vaza existência do recurso, doc 10 §3.5)',
      async () => {
        const actionIdB = await findQualifyActionId(LEAD_B_ID);

        await expect(revertAiAction(db, actorScopedToA, actionIdB)).rejects.toBeInstanceOf(
          NotFoundError,
        );

        // Nada mudou no lead B: reversão fora de escopo não tem efeito colateral.
        expect(await findLeadStatus(LEAD_B_ID)).toBe('qualifying');
        const revertAuditRowsB = await db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.organizationId, ORG_ID),
              eq(auditLogs.action, 'ai_actions.reverted'),
              eq(auditLogs.resourceId, LEAD_B_ID),
            ),
          );
        expect(revertAuditRowsB).toHaveLength(0);
      },
    );

    it('família 5: usuário com escopo global (cityScopeIds=null) reverte ação de qualquer cidade', async () => {
      const actorGlobal: AiActionsActorContext = {
        userId: HUMAN_USER_ID,
        organizationId: ORG_ID,
        cityScopeIds: null,
      };
      const actionIdB = await findQualifyActionId(LEAD_B_ID);

      const result = await revertAiAction(db, actorGlobal, actionIdB);
      expect(result.reverted).toBe(true);
      expect(await findLeadStatus(LEAD_B_ID)).toBe('new');
    });
  },
);
