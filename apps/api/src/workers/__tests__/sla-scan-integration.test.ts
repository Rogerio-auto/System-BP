// =============================================================================
// workers/__tests__/sla-scan-integration.test.ts — Testes de integração REAIS
// contra Postgres do worker de estagnação (F24-S14).
//
// Complementa notification-sla-scan.test.ts (mocks findSlaSources/recipients/
// senders inteiros) — aqui runSlaScanTick roda contra SQL real, cobrindo mais
// de um eixo do TRIGGER_CATALOG (F24-S16 estendeu de 1 para 7 eixos):
//   - kanban_stage:*        — kanban_cards.entered_stage_at
//   - handoff:requested     — chatwoot_handoffs.created_at
//
// Cobre:
//   - entityId da entrega é a PK da tabela-fonte (kanban_cards.id /
//     chatwoot_handoffs.id) — NUNCA leads.id (F24-S16 §contexto).
//   - threshold_hours: entidade recente (abaixo do threshold) não é elegível.
//   - cooldown/dedup: 2 ticks consecutivos na mesma janela não duplicam
//     entrega (bucket determinístico por hora/cooldown).
//   - Fail-closed de city_scope (F24-S16 hardening): regra com city_scope
//     configurado + entidade sem cidade resolvível (handoff sem lead
//     vinculado, leadId=null) → SUPRIME a notificação. Regra idêntica ainda
//     dispara normalmente para uma entidade com cidade resolvível.
//   - trigger_key inválido em uma regra não interrompe o processamento das
//     demais regras (isolamento por regra — captura via logger.error).
//
// runSlaScanTick varre TODAS as orgs com regras stage_inactivity habilitadas
// (sem filtro de organização na query top-level) — por isso todas as
// asserções aqui são escopadas à ENTIDADE + REGRA específicas deste arquivo,
// nunca a contagens globais do tick (evita flakiness por dados de outros
// arquivos/execuções concorrentes no mesmo Postgres).
//
// Banco: mesmo padrão de reports.integration.test.ts — probe
// pool.query('SELECT 1'); describe.runIf(dbAvailable) pula limpo sem DB.
// =============================================================================
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db, pool } from '../../db/client.js';
import {
  chatwootHandoffs,
  cities,
  kanbanCards,
  kanbanStages,
  leads,
  notificationRuleDeliveries,
  notificationRules,
  organizations,
  roles,
  userCityScopes,
  userRoles,
  users,
} from '../../db/schema/index.js';
import type { SlaScanLogger } from '../notification-sla-scan.js';
import { runSlaScanTick } from '../notification-sla-scan.js';

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
// IDs determinísticos por execução — prefixos apenas [0-9a-f] (Postgres
// `uuid` rejeita caracteres fora do alfabeto hex).
// ---------------------------------------------------------------------------
const RUN_SUFFIX = String(Date.now()).slice(-10);
function makeUuid(prefix: string): string {
  const pad = RUN_SUFFIX.padStart(12, '0');
  return `${prefix.slice(0, 8)}-0000-0000-0000-${pad}`;
}

const ORG_ID = makeUuid('c1000001');
const CITY_ID = makeUuid('c2000001');
const USER_AGENT_ID = makeUuid('c3000001');

const LEAD_STALE_ID = makeUuid('c4000001');
const LEAD_FRESH_ID = makeUuid('c4000002');
const LEAD_HANDOFF_ID = makeUuid('c4000003');
const STAGE_ID = makeUuid('c5000001');
const CARD_STALE_ID = makeUuid('c6000001'); // entered_stage_at há 100h — elegível
const CARD_FRESH_ID = makeUuid('c6000002'); // entered_stage_at agora — NÃO elegível

const HANDOFF_WITH_LEAD_ID = makeUuid('c7000001'); // leadId resolvível → cityId=CITY_ID
const HANDOFF_NO_LEAD_ID = makeUuid('c7000002'); // leadId=null → cityId=null (fail-closed)

const RULE_KANBAN_ID = makeUuid('c8000001');
const RULE_HANDOFF_OPEN_ID = makeUuid('c8000002'); // sem city_scope
const RULE_HANDOFF_SCOPED_ID = makeUuid('c8000003'); // city_scope=[CITY_ID]
const RULE_BROKEN_ID = makeUuid('c8000004'); // trigger_key inválido

const THRESHOLD_HOURS = 1;
const COOLDOWN_HOURS = 24;

/** Logger de teste que captura chamadas de warn/error para assertar isolamento. */
function buildCapturingLogger(): SlaScanLogger & {
  errors: Array<{ obj: object; msg: string | undefined }>;
  warns: Array<{ obj: object; msg: string | undefined }>;
} {
  const errors: Array<{ obj: object; msg: string | undefined }> = [];
  const warns: Array<{ obj: object; msg: string | undefined }> = [];
  return {
    errors,
    warns,
    error: (obj: object, msg?: string) => {
      errors.push({ obj, msg });
    },
    warn: (obj: object, msg?: string) => {
      warns.push({ obj, msg });
    },
  };
}

async function countDeliveries(ruleId: string, entityId: string): Promise<number> {
  const rows = await db
    .select({ id: notificationRuleDeliveries.id })
    .from(notificationRuleDeliveries)
    .where(
      and(
        eq(notificationRuleDeliveries.ruleId, ruleId),
        eq(notificationRuleDeliveries.entityId, entityId),
      ),
    );
  return rows.length;
}

// ---------------------------------------------------------------------------
// beforeAll — seed
// ---------------------------------------------------------------------------
beforeAll(async () => {
  if (!dbAvailable) return;

  await db
    .insert(organizations)
    .values({ id: ORG_ID, slug: 'sla-int-' + RUN_SUFFIX, name: 'SLA IntOrg', settings: {} })
    .onConflictDoNothing();

  await db
    .insert(cities)
    .values({
      id: CITY_ID,
      organizationId: ORG_ID,
      ibgeCode: '6' + RUN_SUFFIX.slice(0, 5) + '1',
      name: 'SLA IntCity',
      nameNormalized: 'sla intcity',
      stateUf: 'RO',
      slug: 'sla-intcity-' + RUN_SUFFIX,
      aliases: [],
      isActive: true,
    })
    .onConflictDoNothing();

  await db
    .insert(users)
    .values({
      id: USER_AGENT_ID,
      organizationId: ORG_ID,
      email: 'sla-int-agent-' + RUN_SUFFIX + '@test.local',
      passwordHash: 'x',
      fullName: 'SLA IntUser Agent',
      status: 'active',
    })
    .onConflictDoNothing();

  await db
    .insert(roles)
    .values({ key: 'agente', label: 'agente', scope: 'city' })
    .onConflictDoNothing({ target: roles.key });
  const [agenteRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, 'agente'));
  if (agenteRole === undefined) throw new Error('[sla-scan-integration] role agente ausente');

  await db
    .insert(userRoles)
    .values({ userId: USER_AGENT_ID, roleId: agenteRole.id })
    .onConflictDoNothing();
  await db
    .insert(userCityScopes)
    .values({ userId: USER_AGENT_ID, cityId: CITY_ID, isPrimary: true })
    .onConflictDoNothing();

  await db
    .insert(leads)
    .values([
      {
        id: LEAD_STALE_ID,
        organizationId: ORG_ID,
        cityId: CITY_ID,
        phoneE164: '+55698' + RUN_SUFFIX.slice(0, 8),
        phoneNormalized: '55698' + RUN_SUFFIX.slice(0, 8),
        name: 'SLA IntLead Stale',
        source: 'manual',
        status: 'new',
      },
      {
        id: LEAD_FRESH_ID,
        organizationId: ORG_ID,
        cityId: CITY_ID,
        phoneE164: '+55697' + RUN_SUFFIX.slice(0, 8),
        phoneNormalized: '55697' + RUN_SUFFIX.slice(0, 8),
        name: 'SLA IntLead Fresh',
        source: 'manual',
        status: 'new',
      },
      {
        id: LEAD_HANDOFF_ID,
        organizationId: ORG_ID,
        cityId: CITY_ID,
        phoneE164: '+55696' + RUN_SUFFIX.slice(0, 8),
        phoneNormalized: '55696' + RUN_SUFFIX.slice(0, 8),
        name: 'SLA IntLead Handoff',
        source: 'manual',
        status: 'new',
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(kanbanStages)
    .values({
      id: STAGE_ID,
      organizationId: ORG_ID,
      name: 'SLA IntStage ' + RUN_SUFFIX,
      orderIndex: 0,
    })
    .onConflictDoNothing();

  const hundredHoursAgo = new Date(Date.now() - 100 * 60 * 60 * 1_000);
  await db
    .insert(kanbanCards)
    .values([
      {
        id: CARD_STALE_ID,
        organizationId: ORG_ID,
        leadId: LEAD_STALE_ID,
        stageId: STAGE_ID,
        assigneeUserId: USER_AGENT_ID,
        enteredStageAt: hundredHoursAgo,
      },
      {
        id: CARD_FRESH_ID,
        organizationId: ORG_ID,
        leadId: LEAD_FRESH_ID,
        stageId: STAGE_ID,
        assigneeUserId: USER_AGENT_ID,
        // default agora (entered_stage_at defaultNow()) — dentro do threshold.
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(chatwootHandoffs)
    .values([
      {
        id: HANDOFF_WITH_LEAD_ID,
        organizationId: ORG_ID,
        leadId: LEAD_HANDOFF_ID,
        chatwootConversationId: 'cw-sla-with-lead-' + RUN_SUFFIX,
        reason: 'cliente_solicitou_atendente',
        status: 'requested',
        idempotencyKey: 'sla-with-lead-' + RUN_SUFFIX,
        createdAt: hundredHoursAgo,
      },
      {
        id: HANDOFF_NO_LEAD_ID,
        organizationId: ORG_ID,
        leadId: null,
        chatwootConversationId: 'cw-sla-no-lead-' + RUN_SUFFIX,
        reason: 'ai_unavailable',
        status: 'requested',
        idempotencyKey: 'sla-no-lead-' + RUN_SUFFIX,
        createdAt: hundredHoursAgo,
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(notificationRules)
    .values([
      {
        id: RULE_KANBAN_ID,
        organizationId: ORG_ID,
        name: 'SLA rule kanban ' + RUN_SUFFIX,
        triggerKind: 'stage_inactivity',
        triggerKey: 'kanban_stage:*',
        category: 'lifecycle_stalled',
        recipientMode: 'by_role_city',
        recipientRoles: ['agente'],
        severity: 'warning',
        channels: ['in_app'],
        titleTemplate: 'Parado {{hours_stalled}}h',
        bodyTemplate: 'Card {{entity_id}}',
        thresholdHours: THRESHOLD_HOURS,
        cooldownHours: COOLDOWN_HOURS,
        enabled: true,
        filters: {},
      },
      {
        id: RULE_HANDOFF_OPEN_ID,
        organizationId: ORG_ID,
        name: 'SLA rule handoff open ' + RUN_SUFFIX,
        triggerKind: 'stage_inactivity',
        triggerKey: 'handoff:requested',
        category: 'handoff',
        recipientMode: 'by_role_city',
        recipientRoles: ['agente'],
        severity: 'critical',
        channels: ['in_app'],
        titleTemplate: 'Handoff parado {{hours_stalled}}h',
        bodyTemplate: 'Handoff {{entity_id}}',
        thresholdHours: THRESHOLD_HOURS,
        cooldownHours: COOLDOWN_HOURS,
        enabled: true,
        filters: {},
      },
      {
        id: RULE_HANDOFF_SCOPED_ID,
        organizationId: ORG_ID,
        name: 'SLA rule handoff scoped ' + RUN_SUFFIX,
        triggerKind: 'stage_inactivity',
        triggerKey: 'handoff:requested',
        category: 'handoff',
        recipientMode: 'by_role_city',
        recipientRoles: ['agente'],
        severity: 'critical',
        channels: ['in_app'],
        titleTemplate: 'Handoff (city-scoped) {{hours_stalled}}h',
        bodyTemplate: 'Handoff {{entity_id}}',
        thresholdHours: THRESHOLD_HOURS,
        cooldownHours: COOLDOWN_HOURS,
        enabled: true,
        filters: { city_scope: [CITY_ID] },
      },
      {
        id: RULE_BROKEN_ID,
        organizationId: ORG_ID,
        name: 'SLA rule broken trigger_key ' + RUN_SUFFIX,
        triggerKind: 'stage_inactivity',
        triggerKey: 'eixo:inexistente',
        category: 'system',
        recipientMode: 'managers',
        recipientRoles: [],
        severity: 'info',
        channels: ['in_app'],
        titleTemplate: 'x',
        bodyTemplate: 'y',
        thresholdHours: THRESHOLD_HOURS,
        cooldownHours: COOLDOWN_HOURS,
        enabled: true,
        filters: {},
      },
    ])
    .onConflictDoNothing();
}, 30_000);

afterAll(async () => {
  if (!dbAvailable) return;
  try {
    await db.execute(
      sql`DELETE FROM notification_rule_deliveries WHERE organization_id = ${ORG_ID}`,
    );
    await db.execute(
      sql`DELETE FROM notification_rules WHERE id IN (${RULE_KANBAN_ID}, ${RULE_HANDOFF_OPEN_ID}, ${RULE_HANDOFF_SCOPED_ID}, ${RULE_BROKEN_ID})`,
    );
    await db.execute(
      sql`DELETE FROM chatwoot_handoffs WHERE id IN (${HANDOFF_WITH_LEAD_ID}, ${HANDOFF_NO_LEAD_ID})`,
    );
    await db.execute(
      sql`DELETE FROM kanban_cards WHERE id IN (${CARD_STALE_ID}, ${CARD_FRESH_ID})`,
    );
    await db.execute(sql`DELETE FROM kanban_stages WHERE id = ${STAGE_ID}`);
    await db.execute(
      sql`DELETE FROM leads WHERE id IN (${LEAD_STALE_ID}, ${LEAD_FRESH_ID}, ${LEAD_HANDOFF_ID})`,
    );
    await db.execute(sql`DELETE FROM user_city_scopes WHERE user_id = ${USER_AGENT_ID}`);
    await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${USER_AGENT_ID}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${USER_AGENT_ID}`);
    await db.execute(sql`DELETE FROM cities WHERE id = ${CITY_ID}`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${ORG_ID}`);
  } finally {
    await pool.end();
  }
});

describe.runIf(dbAvailable)('[INTEGRATION] runSlaScanTick — SQL real', () => {
  it('eixo kanban_stage:*: cria entrega com entityId = kanban_cards.id (nunca leads.id)', async () => {
    const logger = buildCapturingLogger();
    await runSlaScanTick(db, logger);

    expect(await countDeliveries(RULE_KANBAN_ID, CARD_STALE_ID)).toBe(1);
    expect(await countDeliveries(RULE_KANBAN_ID, LEAD_STALE_ID)).toBe(0);
  });

  it('threshold_hours: card recente (entered_stage_at agora) não é elegível', async () => {
    expect(await countDeliveries(RULE_KANBAN_ID, CARD_FRESH_ID)).toBe(0);
  });

  it('cooldown/dedup: 2 ticks na mesma janela não duplicam entrega', async () => {
    const logger = buildCapturingLogger();
    await runSlaScanTick(db, logger);
    await runSlaScanTick(db, logger);

    expect(await countDeliveries(RULE_KANBAN_ID, CARD_STALE_ID)).toBe(1);
  });

  it('eixo handoff:requested: cria entrega com entityId = chatwoot_handoffs.id', async () => {
    expect(await countDeliveries(RULE_HANDOFF_OPEN_ID, HANDOFF_WITH_LEAD_ID)).toBe(1);
  });

  it(
    'SEGURANÇA fail-closed: regra com city_scope + handoff sem lead vinculado ' +
      '(cityId=null) NÃO gera entrega (nunca broadcast pra org inteira)',
    async () => {
      expect(await countDeliveries(RULE_HANDOFF_SCOPED_ID, HANDOFF_NO_LEAD_ID)).toBe(0);
    },
  );

  it('a mesma regra city-scoped dispara normalmente para handoff com cidade resolvível', async () => {
    expect(await countDeliveries(RULE_HANDOFF_SCOPED_ID, HANDOFF_WITH_LEAD_ID)).toBe(1);
  });

  it('trigger_key inválido: loga erro e não interrompe as outras regras (isolamento)', async () => {
    const logger = buildCapturingLogger();
    await expect(runSlaScanTick(db, logger)).resolves.toBeDefined();

    const brokenRuleErrors = logger.errors.filter(
      (e) => (e.obj as { rule_id?: string }).rule_id === RULE_BROKEN_ID,
    );
    expect(brokenRuleErrors.length).toBeGreaterThan(0);

    // A regra kanban (processada na mesma chamada) segue íntegra — cooldown
    // ainda vigente, sem nova entrega, mas sem erro registrado para ela.
    const kanbanRuleErrors = logger.errors.filter(
      (e) => (e.obj as { rule_id?: string }).rule_id === RULE_KANBAN_ID,
    );
    expect(kanbanRuleErrors.length).toBe(0);
  });
});
