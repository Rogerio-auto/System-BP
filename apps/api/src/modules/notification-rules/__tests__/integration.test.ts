// =============================================================================
// notification-rules/__tests__/integration.test.ts — Testes de integração
// REAIS contra Postgres (F24-S14).
//
// Complementa notification-rules.test.ts (mocks DB + service inteiro) —
// aqui o service e o repositório rodam contra SQL real, provando:
//   - CRUD via createRuleService/getRuleService/updateRuleService/
//     deleteRuleService/listRulesService com Postgres real.
//   - Isolamento de organização: regra de uma org nunca é visível/editável/
//     removível por actor de outra org (404 — não vaza existência).
//   - city_scope: roundtrip API (array) ↔ filters jsonb (DB).
//   - resolveRuleRecipients (by_role_city / assignee / managers) com
//     usuários, roles e user_city_scopes reais — isolamento de org também
//     nesta camada.
//   - CHECK constraint chk_notification_rules_threshold_hours: DB rejeita
//     stage_inactivity sem threshold_hours mesmo se o service for
//     contornado (defesa em profundidade).
//
// Banco: mesmo padrão de reports.integration.test.ts — probe
// pool.query('SELECT 1'); describe.runIf(dbAvailable) pula limpo sem DB.
//
// roles NÃO são semeadas por migration (só por scripts/seed.ts, que não
// roda no job de CI antes destes testes) — este arquivo semeia via
// onConflictDoNothing({ target: roles.key }), mesmo padrão do seed script.
// =============================================================================
import type { NotificationRuleCreate } from '@elemento/shared-schemas';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db, pool } from '../../../db/client.js';
import {
  cities,
  kanbanCards,
  kanbanStages,
  leads,
  notificationRules,
  organizations,
  roles,
  userCityScopes,
  userRoles,
  users,
} from '../../../db/schema/index.js';
import { NotFoundError } from '../../../shared/errors.js';
import { resolveRuleRecipients } from '../recipients.js';
import type { ActorContext } from '../service.js';
import {
  createRuleService,
  deleteRuleService,
  getRuleService,
  listRulesService,
  NotificationRuleTriggerNotFoundError,
  updateRuleService,
} from '../service.js';

// ---------------------------------------------------------------------------
// Probe de disponibilidade do DB (mesmo padrão de reports.integration.test.ts)
// ---------------------------------------------------------------------------
let dbAvailable = false;
try {
  await pool.query('SELECT 1');
  dbAvailable = true;
} catch {
  // Sem DB local — describe.runIf pula a suíte inteira, limpo.
}

// ---------------------------------------------------------------------------
// IDs determinísticos por execução — evita colisão em DB compartilhado
// ---------------------------------------------------------------------------
const RUN_SUFFIX = String(Date.now()).slice(-10);
function makeUuid(prefix: string): string {
  const pad = RUN_SUFFIX.padStart(12, '0');
  return `${prefix.slice(0, 8)}-0000-0000-0000-${pad}`;
}

// Prefixos usam apenas [0-9a-f] — Postgres `uuid` rejeita caracteres fora do
// alfabeto hex (ex: 'n', 'r', 'z' fariam o INSERT falhar com
// "invalid input syntax for type uuid").
const ORG_A_ID = makeUuid('a1000001');
const ORG_B_ID = makeUuid('a1000002');
const CITY_A_ID = makeUuid('a2000001');
const CITY_B_ID = makeUuid('a2000002');
const USER_A_ADMIN_ID = makeUuid('a3000001');
const USER_A_AGENT_ID = makeUuid('a3000002');
const USER_B_ADMIN_ID = makeUuid('a3000003');
const LEAD_A1_ID = makeUuid('a4000001');
const STAGE_A_ID = makeUuid('a5000001');
const CARD_A_ID = makeUuid('a6000001');

const roleIdByKey = new Map<string, string>();

const actorA: ActorContext = { userId: USER_A_ADMIN_ID, organizationId: ORG_A_ID, role: 'admin' };
const actorB: ActorContext = { userId: USER_B_ADMIN_ID, organizationId: ORG_B_ID, role: 'admin' };

// ---------------------------------------------------------------------------
// beforeAll — seed mínimo
// ---------------------------------------------------------------------------
beforeAll(async () => {
  if (!dbAvailable) return;

  await db
    .insert(organizations)
    .values([
      { id: ORG_A_ID, slug: 'nr-int-a-' + RUN_SUFFIX, name: 'NR IntOrg A', settings: {} },
      { id: ORG_B_ID, slug: 'nr-int-b-' + RUN_SUFFIX, name: 'NR IntOrg B', settings: {} },
    ])
    .onConflictDoNothing();

  await db
    .insert(cities)
    .values([
      {
        id: CITY_A_ID,
        organizationId: ORG_A_ID,
        ibgeCode: '8' + RUN_SUFFIX.slice(0, 5) + '1',
        name: 'NR IntCity A',
        nameNormalized: 'nr intcity a',
        stateUf: 'RO',
        slug: 'nr-intcity-a-' + RUN_SUFFIX,
        aliases: [],
        isActive: true,
      },
      {
        id: CITY_B_ID,
        organizationId: ORG_B_ID,
        ibgeCode: '8' + RUN_SUFFIX.slice(0, 5) + '2',
        name: 'NR IntCity B',
        nameNormalized: 'nr intcity b',
        stateUf: 'RO',
        slug: 'nr-intcity-b-' + RUN_SUFFIX,
        aliases: [],
        isActive: true,
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(users)
    .values([
      {
        id: USER_A_ADMIN_ID,
        organizationId: ORG_A_ID,
        email: 'nr-int-a-admin-' + RUN_SUFFIX + '@test.local',
        passwordHash: 'x',
        fullName: 'NR IntUser A Admin',
        status: 'active',
      },
      {
        id: USER_A_AGENT_ID,
        organizationId: ORG_A_ID,
        email: 'nr-int-a-agent-' + RUN_SUFFIX + '@test.local',
        passwordHash: 'x',
        fullName: 'NR IntUser A Agent',
        status: 'active',
      },
      {
        id: USER_B_ADMIN_ID,
        organizationId: ORG_B_ID,
        email: 'nr-int-b-admin-' + RUN_SUFFIX + '@test.local',
        passwordHash: 'x',
        fullName: 'NR IntUser B Admin',
        status: 'active',
      },
    ])
    .onConflictDoNothing();

  // roles: não semeadas por migration — apenas por scripts/seed.ts (não roda
  // no job de CI antes destes testes). Idempotente via onConflictDoNothing.
  const ROLE_SEED: Array<{ key: string; label: string; scope: 'global' | 'city' }> = [
    { key: 'admin', label: 'admin', scope: 'global' },
    { key: 'gestor_geral', label: 'gestor_geral', scope: 'global' },
    { key: 'agente', label: 'agente', scope: 'city' },
  ];
  await db.insert(roles).values(ROLE_SEED).onConflictDoNothing({ target: roles.key });

  const roleRows = await db
    .select({ id: roles.id, key: roles.key })
    .from(roles)
    .where(sql`${roles.key} IN ('admin','gestor_geral','agente')`);
  for (const row of roleRows) roleIdByKey.set(row.key, row.id);

  const adminRoleId = roleIdByKey.get('admin');
  const agenteRoleId = roleIdByKey.get('agente');
  if (adminRoleId === undefined || agenteRoleId === undefined) {
    throw new Error('[integration.test] roles admin/agente não resolvidas após seed');
  }

  await db
    .insert(userRoles)
    .values([
      { userId: USER_A_ADMIN_ID, roleId: adminRoleId },
      { userId: USER_A_AGENT_ID, roleId: agenteRoleId },
      { userId: USER_B_ADMIN_ID, roleId: adminRoleId },
    ])
    .onConflictDoNothing();

  await db
    .insert(userCityScopes)
    .values([
      { userId: USER_A_ADMIN_ID, cityId: CITY_A_ID, isPrimary: true },
      { userId: USER_A_AGENT_ID, cityId: CITY_A_ID, isPrimary: true },
      { userId: USER_B_ADMIN_ID, cityId: CITY_B_ID, isPrimary: true },
    ])
    .onConflictDoNothing();

  // Lead + kanban stage + card para o teste de recipient_mode='assignee'.
  await db
    .insert(leads)
    .values({
      id: LEAD_A1_ID,
      organizationId: ORG_A_ID,
      cityId: CITY_A_ID,
      phoneE164: '+55699' + RUN_SUFFIX.slice(0, 8),
      phoneNormalized: '55699' + RUN_SUFFIX.slice(0, 8),
      name: 'NR IntLead A1',
      source: 'manual',
      status: 'new',
    })
    .onConflictDoNothing();

  await db
    .insert(kanbanStages)
    .values({
      id: STAGE_A_ID,
      organizationId: ORG_A_ID,
      name: 'NR IntStage A ' + RUN_SUFFIX,
      orderIndex: 0,
    })
    .onConflictDoNothing();

  await db
    .insert(kanbanCards)
    .values({
      id: CARD_A_ID,
      organizationId: ORG_A_ID,
      leadId: LEAD_A1_ID,
      stageId: STAGE_A_ID,
      assigneeUserId: USER_A_AGENT_ID,
    })
    .onConflictDoNothing();
}, 30_000);

afterAll(async () => {
  if (!dbAvailable) return;
  try {
    await db.execute(
      sql`DELETE FROM notification_rules WHERE organization_id IN (${ORG_A_ID}, ${ORG_B_ID})`,
    );
    await db.execute(sql`DELETE FROM kanban_cards WHERE id = ${CARD_A_ID}`);
    await db.execute(sql`DELETE FROM kanban_stages WHERE id = ${STAGE_A_ID}`);
    await db.execute(sql`DELETE FROM leads WHERE id = ${LEAD_A1_ID}`);
    await db.execute(
      sql`DELETE FROM user_city_scopes WHERE user_id IN (${USER_A_ADMIN_ID}, ${USER_A_AGENT_ID}, ${USER_B_ADMIN_ID})`,
    );
    await db.execute(
      sql`DELETE FROM user_roles WHERE user_id IN (${USER_A_ADMIN_ID}, ${USER_A_AGENT_ID}, ${USER_B_ADMIN_ID})`,
    );
    await db.execute(
      sql`DELETE FROM users WHERE id IN (${USER_A_ADMIN_ID}, ${USER_A_AGENT_ID}, ${USER_B_ADMIN_ID})`,
    );
    await db.execute(sql`DELETE FROM cities WHERE id IN (${CITY_A_ID}, ${CITY_B_ID})`);
    // audit_logs.organization_id tem FK para organizations — sem esta linha o DELETE
    // de organizations abaixo falha com fk_audit_logs_organization quando o fluxo
    // testado grava auditoria (ex.: notification-rules criadas via POST /test).
    await db.execute(
      sql`DELETE FROM audit_logs WHERE organization_id IN (${ORG_A_ID}, ${ORG_B_ID})`,
    );
    await db.execute(sql`DELETE FROM organizations WHERE id IN (${ORG_A_ID}, ${ORG_B_ID})`);
  } finally {
    await pool.end();
  }
});

// ---------------------------------------------------------------------------
// Helper de payload de criação válido
// ---------------------------------------------------------------------------
function buildCreateBody(overrides: Partial<NotificationRuleCreate> = {}): NotificationRuleCreate {
  return {
    name: 'Handoff parado ' + RUN_SUFFIX,
    trigger_key: 'chatwoot.handoff_requested',
    recipient_mode: 'by_role_city',
    recipient_roles: ['agente'],
    severity: 'warning',
    channels: ['in_app'],
    title_template: 'Handoff {{lead_id}}',
    body_template: 'Motivo: {{reason}}',
    cooldown_hours: 0,
    enabled: false,
    ...overrides,
  };
}

describe.runIf(dbAvailable)('[INTEGRATION] notification-rules CRUD — SQL real', () => {
  it('createRuleService cria regra e deriva category do TRIGGER_CATALOG', async () => {
    const created = await createRuleService(db, actorA, buildCreateBody(), undefined);
    expect(created.organization_id).toBe(ORG_A_ID);
    expect(created.category).toBe('handoff');
    expect(created.trigger_kind).toBe('event');
    expect(created.enabled).toBe(false);

    const [row] = await db
      .select()
      .from(notificationRules)
      .where(eq(notificationRules.id, created.id));
    expect(row?.organizationId).toBe(ORG_A_ID);
  });

  it('createRuleService rejeita trigger_key fora do TRIGGER_CATALOG (422)', async () => {
    const call = createRuleService(
      db,
      actorA,
      buildCreateBody({ trigger_key: 'nao.existe.no.catalogo' }),
      undefined,
    );
    await expect(call).rejects.toBeInstanceOf(NotificationRuleTriggerNotFoundError);
    await expect(call).rejects.toMatchObject({ statusCode: 422 });
  });

  it('createRuleService idempotente: mesma Idempotency-Key não duplica linha', async () => {
    const idemKey = 'idem-' + RUN_SUFFIX;
    const first = await createRuleService(
      db,
      actorA,
      buildCreateBody({ name: 'Idem ' + RUN_SUFFIX }),
      idemKey,
    );
    const second = await createRuleService(
      db,
      actorA,
      buildCreateBody({ name: 'Idem ' + RUN_SUFFIX }),
      idemKey,
    );
    expect(second.id).toBe(first.id);

    const rows = await db
      .select({ id: notificationRules.id })
      .from(notificationRules)
      .where(
        and(
          eq(notificationRules.organizationId, ORG_A_ID),
          eq(notificationRules.name, 'Idem ' + RUN_SUFFIX),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it('city_scope: roundtrip API (array) ↔ filters jsonb', async () => {
    const created = await createRuleService(
      db,
      actorA,
      buildCreateBody({ name: 'CityScope ' + RUN_SUFFIX, city_scope: [CITY_A_ID] }),
      undefined,
    );
    const fetched = await getRuleService(db, actorA, created.id);
    expect(fetched.city_scope).toEqual([CITY_A_ID]);
  });

  it('ISOLAMENTO: getRuleService de outra org lança NotFoundError (não vaza existência)', async () => {
    const created = await createRuleService(
      db,
      actorA,
      buildCreateBody({ name: 'Isolamento GET ' + RUN_SUFFIX }),
      undefined,
    );
    await expect(getRuleService(db, actorB, created.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('ISOLAMENTO: listRulesService de org B nunca retorna regras da org A', async () => {
    await createRuleService(
      db,
      actorA,
      buildCreateBody({ name: 'Isolamento LIST ' + RUN_SUFFIX }),
      undefined,
    );
    const listB = await listRulesService(db, actorB, { page: 1, per_page: 50 });
    const leaked = listB.data.some((r) => r.organization_id === ORG_A_ID);
    expect(leaked).toBe(false);
  });

  it('ISOLAMENTO: updateRuleService de outra org lança NotFoundError e não altera a linha', async () => {
    const created = await createRuleService(
      db,
      actorA,
      buildCreateBody({ name: 'Isolamento UPDATE ' + RUN_SUFFIX }),
      undefined,
    );
    await expect(
      updateRuleService(db, actorB, created.id, { enabled: true }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const [row] = await db
      .select()
      .from(notificationRules)
      .where(eq(notificationRules.id, created.id));
    expect(row?.enabled).toBe(false);
  });

  it('updateRuleService (mesma org) persiste enabled=true', async () => {
    const created = await createRuleService(
      db,
      actorA,
      buildCreateBody({ name: 'Update OK ' + RUN_SUFFIX }),
      undefined,
    );
    const updated = await updateRuleService(db, actorA, created.id, { enabled: true });
    expect(updated.enabled).toBe(true);
  });

  it('ISOLAMENTO: deleteRuleService de outra org lança NotFoundError e não remove a linha', async () => {
    const created = await createRuleService(
      db,
      actorA,
      buildCreateBody({ name: 'Isolamento DELETE ' + RUN_SUFFIX }),
      undefined,
    );
    await expect(deleteRuleService(db, actorB, created.id)).rejects.toBeInstanceOf(NotFoundError);

    const [row] = await db
      .select()
      .from(notificationRules)
      .where(eq(notificationRules.id, created.id));
    expect(row).toBeDefined();
  });

  it('deleteRuleService (mesma org) remove a linha — GET subsequente 404', async () => {
    const created = await createRuleService(
      db,
      actorA,
      buildCreateBody({ name: 'Delete OK ' + RUN_SUFFIX }),
      undefined,
    );
    await deleteRuleService(db, actorA, created.id);
    await expect(getRuleService(db, actorA, created.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('CHECK chk_notification_rules_threshold_hours rejeita stage_inactivity sem threshold_hours', async () => {
    await expect(
      db.insert(notificationRules).values({
        organizationId: ORG_A_ID,
        name: 'Constraint violation ' + RUN_SUFFIX,
        triggerKind: 'stage_inactivity',
        triggerKey: 'kanban_stage:*',
        category: 'lifecycle_stalled',
        recipientMode: 'managers',
        recipientRoles: [],
        severity: 'info',
        channels: ['in_app'],
        titleTemplate: 'x',
        bodyTemplate: 'y',
        thresholdHours: null,
        cooldownHours: 0,
        enabled: false,
      }),
    ).rejects.toThrow();
  });
});

describe.runIf(dbAvailable)('[INTEGRATION] resolveRuleRecipients — SQL real', () => {
  it('by_role_city: retorna apenas usuários com o role na cidade certa (isolamento de org)', async () => {
    const recipients = await resolveRuleRecipients(db, {
      organizationId: ORG_A_ID,
      recipientMode: 'by_role_city',
      recipientRoles: ['agente'],
      channels: ['in_app'],
      cityId: CITY_A_ID,
      leadId: null,
    });
    const ids = recipients.map((r) => r.userId);
    expect(ids).toContain(USER_A_AGENT_ID);
    expect(ids).not.toContain(USER_A_ADMIN_ID);
    expect(ids).not.toContain(USER_B_ADMIN_ID);
  });

  it('managers: retorna admins da org, nunca de outra org', async () => {
    const recipients = await resolveRuleRecipients(db, {
      organizationId: ORG_A_ID,
      recipientMode: 'managers',
      recipientRoles: [],
      channels: ['in_app'],
      cityId: null,
      leadId: null,
    });
    const ids = recipients.map((r) => r.userId);
    expect(ids).toContain(USER_A_ADMIN_ID);
    expect(ids).not.toContain(USER_B_ADMIN_ID);
  });

  it('assignee: resolve o agente responsável pelo kanban_card real do lead', async () => {
    const recipients = await resolveRuleRecipients(db, {
      organizationId: ORG_A_ID,
      recipientMode: 'assignee',
      recipientRoles: [],
      channels: ['in_app'],
      cityId: null,
      leadId: LEAD_A1_ID,
    });
    expect(recipients).toHaveLength(1);
    expect(recipients[0]?.userId).toBe(USER_A_AGENT_ID);
  });

  it('assignee: leadId de outra org não resolve destinatário (card não encontrado no escopo)', async () => {
    const recipients = await resolveRuleRecipients(db, {
      organizationId: ORG_B_ID,
      recipientMode: 'assignee',
      recipientRoles: [],
      channels: ['in_app'],
      cityId: null,
      leadId: LEAD_A1_ID,
    });
    expect(recipients).toHaveLength(0);
  });
});
