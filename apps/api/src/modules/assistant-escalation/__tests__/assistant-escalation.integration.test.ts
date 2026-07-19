// =============================================================================
// assistant-escalation.integration.test.ts — Testes de integração REAIS contra
// Postgres (F6-S30) do DoD do slot:
//
//   - Config ausente -> fallback por permissão (credit_analyses:decide,
//     escopo global) — independe da cidade do lead.
//   - Config presente -> resolve exatamente a cidade/roles configurados em
//     organizations.settings.credit_escalation (matriz), ignora role fora
//     da cidade configurada.
//   - Lead fora do escopo de cidade do ator -> 404 (NUNCA 403, doc 10 §3.5).
//   - Zero destinatário resolvido -> 409.
//   - Idempotência: 2ª chamada dentro da janela de dedup não duplica
//     audit_log/event_outbox/notificação.
//   - LGPD §8.5: a nota do operador NUNCA aparece em audit_logs.after nem em
//     event_outbox.payload — só no corpo da notificação in-app (fora do outbox).
//
// roles NÃO são semeadas por migration (só por scripts/seed.ts, que não roda
// no job de CI antes destes testes) — este arquivo semeia via
// onConflictDoNothing({ target: roles.key }), mesmo padrão de
// notification-rules/__tests__/integration.test.ts. role_permissions
// (credit_analyses:decide -> gestor_regional) também é semeado aqui pela
// mesma razão — não é limpo no afterAll (fixture global, mesmo padrão).
//
// Banco: mesmo padrão de ai-actions.integration.test.ts — probe
// pool.query('SELECT 1'); describe.runIf(dbAvailable) pula limpo sem DB.
// =============================================================================
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db, pool } from '../../../db/client.js';
import {
  auditLogs,
  cities,
  eventOutbox,
  leads,
  notifications,
  organizations,
  permissions,
  rolePermissions,
  roles,
  userCityScopes,
  userRoles,
  users,
} from '../../../db/schema/index.js';
import { ConflictError, NotFoundError } from '../../../shared/errors.js';
import { escalateLeadToCredit } from '../service.js';
import type { AssistantEscalationActorContext } from '../service.js';

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

// Org sem organizations.settings.credit_escalation -> exercita o fallback
// por permissão (credit_analyses:decide, escopo global).
const ORG_FALLBACK_ID = makeUuid('ae100001');
// Org COM credit_escalation configurado -> resolve exatamente cidade+roles.
const ORG_CONFIGURED_ID = makeUuid('ae100002');
// Org cuja config aponta para um role sem ninguém na org -> 409.
const ORG_ZERO_ID = makeUuid('ae100003');

const CITY_FB_LEAD_ID = makeUuid('ae200001');
const CITY_CFG_LEAD_ID = makeUuid('ae200002'); // cidade do lead escalado — DIFERENTE da matriz
const CITY_MATRIZ_ID = makeUuid('ae200003'); // cidade configurada em credit_escalation
const CITY_OTHER_ID = makeUuid('ae200004'); // agente aqui NÃO deve ser notificado
const CITY_ZERO_LEAD_ID = makeUuid('ae200005');
// city_id "fantasma" na config do ORG_ZERO — não precisa existir em `cities`
// (credit_escalation.city_id não é FK, é jsonb livre validado só por formato).
const CITY_ZERO_PHANTOM_ID = makeUuid('ae200099');

const LEAD_FB_ID = makeUuid('ae400001');
const LEAD_CFG_ID = makeUuid('ae400002');
const LEAD_CFG_OUT_ID = makeUuid('ae400003'); // fora do escopo do ator restrito
const LEAD_ZERO_ID = makeUuid('ae400004');

const USER_OP_FB_ID = makeUuid('ae600001'); // operador humano que escala (org fallback)
const USER_OP_CFG_ID = makeUuid('ae600002'); // operador humano que escala (org configured)
const USER_OP_ZERO_ID = makeUuid('ae600003'); // operador humano que escala (org zero)
const USER_FALLBACK_ANALYST_ID = makeUuid('ae600004'); // gestor_regional — recebe via fallback
const USER_MATRIZ_AGENTE_ID = makeUuid('ae600005'); // agente na cidade matriz — recebe via config
const USER_OTHER_AGENTE_ID = makeUuid('ae600006'); // agente em outra cidade — NÃO deve receber

const roleIdByKey = new Map<string, string>();

const NOTE_MARKER = 'NOTE-MARKER-' + RUN_SUFFIX;

// ---------------------------------------------------------------------------
// beforeAll — seed mínimo
// ---------------------------------------------------------------------------
beforeAll(async () => {
  if (!dbAvailable) return;

  await db
    .insert(organizations)
    .values([
      { id: ORG_FALLBACK_ID, slug: 'ae-int-fb-' + RUN_SUFFIX, name: 'AE IntOrg FB', settings: {} },
      {
        id: ORG_CONFIGURED_ID,
        slug: 'ae-int-cfg-' + RUN_SUFFIX,
        name: 'AE IntOrg CFG',
        settings: { credit_escalation: { city_id: CITY_MATRIZ_ID, role_keys: ['agente'] } },
      },
      {
        id: ORG_ZERO_ID,
        slug: 'ae-int-zero-' + RUN_SUFFIX,
        name: 'AE IntOrg Zero',
        settings: { credit_escalation: { city_id: CITY_ZERO_PHANTOM_ID, role_keys: ['agente'] } },
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(cities)
    .values([
      {
        id: CITY_FB_LEAD_ID,
        organizationId: ORG_FALLBACK_ID,
        ibgeCode: 'c' + RUN_SUFFIX.slice(0, 5) + '1',
        name: 'AE IntCity FB Lead',
        nameNormalized: 'ae intcity fb lead',
        stateUf: 'RO',
        slug: 'ae-intcity-fb-lead-' + RUN_SUFFIX,
        aliases: [],
        isActive: true,
      },
      {
        id: CITY_CFG_LEAD_ID,
        organizationId: ORG_CONFIGURED_ID,
        ibgeCode: 'c' + RUN_SUFFIX.slice(0, 5) + '2',
        name: 'AE IntCity CFG Lead',
        nameNormalized: 'ae intcity cfg lead',
        stateUf: 'RO',
        slug: 'ae-intcity-cfg-lead-' + RUN_SUFFIX,
        aliases: [],
        isActive: true,
      },
      {
        id: CITY_MATRIZ_ID,
        organizationId: ORG_CONFIGURED_ID,
        ibgeCode: 'c' + RUN_SUFFIX.slice(0, 5) + '3',
        name: 'AE IntCity Matriz',
        nameNormalized: 'ae intcity matriz',
        stateUf: 'RO',
        slug: 'ae-intcity-matriz-' + RUN_SUFFIX,
        aliases: [],
        isActive: true,
      },
      {
        id: CITY_OTHER_ID,
        organizationId: ORG_CONFIGURED_ID,
        ibgeCode: 'c' + RUN_SUFFIX.slice(0, 5) + '4',
        name: 'AE IntCity Other',
        nameNormalized: 'ae intcity other',
        stateUf: 'RO',
        slug: 'ae-intcity-other-' + RUN_SUFFIX,
        aliases: [],
        isActive: true,
      },
      {
        id: CITY_ZERO_LEAD_ID,
        organizationId: ORG_ZERO_ID,
        ibgeCode: 'c' + RUN_SUFFIX.slice(0, 5) + '5',
        name: 'AE IntCity Zero Lead',
        nameNormalized: 'ae intcity zero lead',
        stateUf: 'RO',
        slug: 'ae-intcity-zero-lead-' + RUN_SUFFIX,
        aliases: [],
        isActive: true,
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(users)
    .values([
      {
        id: USER_OP_FB_ID,
        organizationId: ORG_FALLBACK_ID,
        email: 'ae-int-op-fb-' + RUN_SUFFIX + '@test.local',
        passwordHash: 'x',
        fullName: 'AE IntUser Operador FB',
        status: 'active',
      },
      {
        id: USER_OP_CFG_ID,
        organizationId: ORG_CONFIGURED_ID,
        email: 'ae-int-op-cfg-' + RUN_SUFFIX + '@test.local',
        passwordHash: 'x',
        fullName: 'AE IntUser Operador CFG',
        status: 'active',
      },
      {
        id: USER_OP_ZERO_ID,
        organizationId: ORG_ZERO_ID,
        email: 'ae-int-op-zero-' + RUN_SUFFIX + '@test.local',
        passwordHash: 'x',
        fullName: 'AE IntUser Operador Zero',
        status: 'active',
      },
      {
        id: USER_FALLBACK_ANALYST_ID,
        organizationId: ORG_FALLBACK_ID,
        email: 'ae-int-analyst-fb-' + RUN_SUFFIX + '@test.local',
        passwordHash: 'x',
        fullName: 'AE IntUser Analista Fallback',
        status: 'active',
      },
      {
        id: USER_MATRIZ_AGENTE_ID,
        organizationId: ORG_CONFIGURED_ID,
        email: 'ae-int-agente-matriz-' + RUN_SUFFIX + '@test.local',
        passwordHash: 'x',
        fullName: 'AE IntUser Agente Matriz',
        status: 'active',
      },
      {
        id: USER_OTHER_AGENTE_ID,
        organizationId: ORG_CONFIGURED_ID,
        email: 'ae-int-agente-other-' + RUN_SUFFIX + '@test.local',
        passwordHash: 'x',
        fullName: 'AE IntUser Agente Other',
        status: 'active',
      },
    ])
    .onConflictDoNothing();

  // roles: não semeadas por migration — apenas por scripts/seed.ts (não roda
  // no job de CI antes destes testes). Idempotente via onConflictDoNothing.
  await db
    .insert(roles)
    .values([
      { key: 'gestor_regional', label: 'gestor_regional', scope: 'city' },
      { key: 'agente', label: 'agente', scope: 'city' },
    ])
    .onConflictDoNothing({ target: roles.key });

  const roleRows = await db
    .select({ id: roles.id, key: roles.key })
    .from(roles)
    .where(sql`${roles.key} IN ('gestor_regional','agente')`);
  for (const row of roleRows) roleIdByKey.set(row.key, row.id);

  const gestorRegionalRoleId = roleIdByKey.get('gestor_regional');
  const agenteRoleId = roleIdByKey.get('agente');
  if (gestorRegionalRoleId === undefined || agenteRoleId === undefined) {
    throw new Error('[assistant-escalation.integration] roles não resolvidas após seed');
  }

  // credit_analyses:decide já existe (migration 0033 sempre roda). O GRANT a
  // gestor_regional pode não existir em DB CI-only-migrate (a migration 0033
  // rodou contra uma tabela roles vazia) — semeado aqui, idempotente, mesmo
  // padrão de notification-rules/__tests__/integration.test.ts.
  const [creditDecidePermission] = await db
    .select({ id: permissions.id })
    .from(permissions)
    .where(eq(permissions.key, 'credit_analyses:decide'));
  if (!creditDecidePermission) {
    throw new Error(
      '[assistant-escalation.integration] permissão credit_analyses:decide não encontrada ' +
        '— migration 0033 não rodou?',
    );
  }
  await db
    .insert(rolePermissions)
    .values({ roleId: gestorRegionalRoleId, permissionId: creditDecidePermission.id })
    .onConflictDoNothing();

  await db
    .insert(userRoles)
    .values([
      { userId: USER_FALLBACK_ANALYST_ID, roleId: gestorRegionalRoleId },
      { userId: USER_MATRIZ_AGENTE_ID, roleId: agenteRoleId },
      { userId: USER_OTHER_AGENTE_ID, roleId: agenteRoleId },
    ])
    .onConflictDoNothing();

  await db
    .insert(userCityScopes)
    .values([
      { userId: USER_MATRIZ_AGENTE_ID, cityId: CITY_MATRIZ_ID, isPrimary: true },
      { userId: USER_OTHER_AGENTE_ID, cityId: CITY_OTHER_ID, isPrimary: true },
    ])
    .onConflictDoNothing();

  await db
    .insert(leads)
    .values([
      {
        id: LEAD_FB_ID,
        organizationId: ORG_FALLBACK_ID,
        cityId: CITY_FB_LEAD_ID,
        phoneE164: '+5569' + RUN_SUFFIX.slice(0, 9),
        phoneNormalized: '5569' + RUN_SUFFIX.slice(0, 9),
        name: 'AE IntLead FB',
        source: 'manual',
        status: 'new',
      },
      {
        id: LEAD_CFG_ID,
        organizationId: ORG_CONFIGURED_ID,
        cityId: CITY_CFG_LEAD_ID,
        phoneE164: '+5569' + RUN_SUFFIX.slice(1, 10),
        phoneNormalized: '5569' + RUN_SUFFIX.slice(1, 10),
        name: 'AE IntLead CFG',
        source: 'manual',
        status: 'new',
      },
      {
        id: LEAD_CFG_OUT_ID,
        organizationId: ORG_CONFIGURED_ID,
        cityId: CITY_OTHER_ID,
        phoneE164: '+5569' + RUN_SUFFIX.slice(2, 10) + '1',
        phoneNormalized: '5569' + RUN_SUFFIX.slice(2, 10) + '1',
        name: 'AE IntLead CFG Out',
        source: 'manual',
        status: 'new',
      },
      {
        id: LEAD_ZERO_ID,
        organizationId: ORG_ZERO_ID,
        cityId: CITY_ZERO_LEAD_ID,
        phoneE164: '+5569' + RUN_SUFFIX.slice(3, 10) + '11',
        phoneNormalized: '5569' + RUN_SUFFIX.slice(3, 10) + '11',
        name: 'AE IntLead Zero',
        source: 'manual',
        status: 'new',
      },
    ])
    .onConflictDoNothing();
}, 30_000);

afterAll(async () => {
  if (!dbAvailable) return;
  try {
    const orgIds = [ORG_FALLBACK_ID, ORG_CONFIGURED_ID, ORG_ZERO_ID];
    const leadIds = [LEAD_FB_ID, LEAD_CFG_ID, LEAD_CFG_OUT_ID, LEAD_ZERO_ID];
    const cityIds = [
      CITY_FB_LEAD_ID,
      CITY_CFG_LEAD_ID,
      CITY_MATRIZ_ID,
      CITY_OTHER_ID,
      CITY_ZERO_LEAD_ID,
    ];
    const userIds = [
      USER_OP_FB_ID,
      USER_OP_CFG_ID,
      USER_OP_ZERO_ID,
      USER_FALLBACK_ANALYST_ID,
      USER_MATRIZ_AGENTE_ID,
      USER_OTHER_AGENTE_ID,
    ];

    await db.delete(notifications).where(inArray(notifications.organizationId, orgIds));
    await db.delete(eventOutbox).where(inArray(eventOutbox.organizationId, orgIds));
    await db.delete(auditLogs).where(inArray(auditLogs.organizationId, orgIds));
    await db.delete(leads).where(inArray(leads.id, leadIds));
    await db.delete(userCityScopes).where(inArray(userCityScopes.userId, userIds));
    await db.delete(userRoles).where(inArray(userRoles.userId, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
    await db.delete(cities).where(inArray(cities.id, cityIds));
    await db.delete(organizations).where(inArray(organizations.id, orgIds));
    // roles/permissions/role_permissions: fixtures globais, não removidas
    // (mesmo padrão de notification-rules/__tests__/integration.test.ts).
  } finally {
    await pool.end();
  }
});

describe.runIf(dbAvailable)(
  '[INTEGRATION] assistant-escalation — POST /api/assistant/escalate',
  () => {
    const actorFallback: AssistantEscalationActorContext = {
      userId: USER_OP_FB_ID,
      organizationId: ORG_FALLBACK_ID,
      cityScopeIds: null,
    };

    const actorConfigured: AssistantEscalationActorContext = {
      userId: USER_OP_CFG_ID,
      organizationId: ORG_CONFIGURED_ID,
      cityScopeIds: null,
    };

    const actorZero: AssistantEscalationActorContext = {
      userId: USER_OP_ZERO_ID,
      organizationId: ORG_ZERO_ID,
      cityScopeIds: null,
    };

    it('config ausente -> cai no fallback (credit_analyses:decide, escopo global)', async () => {
      const result = await escalateLeadToCredit(db, actorFallback, { leadId: LEAD_FB_ID });

      expect(result.already_escalated).toBe(false);
      expect(result.lead_id).toBe(LEAD_FB_ID);
      expect(result.recipient_count).toBe(1);

      const [auditRow] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.organizationId, ORG_FALLBACK_ID),
            eq(auditLogs.action, 'assistant.lead_escalated'),
            eq(auditLogs.resourceId, LEAD_FB_ID),
          ),
        );
      expect(auditRow?.actorUserId).toBe(USER_OP_FB_ID);
      expect(auditRow?.actorType).toBe('user');

      const [eventRow] = await db
        .select()
        .from(eventOutbox)
        .where(
          and(
            eq(eventOutbox.organizationId, ORG_FALLBACK_ID),
            eq(eventOutbox.eventName, 'assistant.escalation.created'),
            eq(eventOutbox.aggregateId, LEAD_FB_ID),
          ),
        );
      expect(eventRow).toBeDefined();

      const notificationRows = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.organizationId, ORG_FALLBACK_ID),
            eq(notifications.userId, USER_FALLBACK_ANALYST_ID),
            eq(notifications.entityId, LEAD_FB_ID),
          ),
        );
      expect(notificationRows).toHaveLength(1);

      // F26-S02: body enriquecido com cidade (dado público) + tempo no funil
      // (derivado de leads.created_at) — sem PII do lead.
      expect(notificationRows[0]?.body).toContain('AE IntCity FB Lead');
      expect(notificationRows[0]?.body).toContain('no funil há');
    });

    it(
      'config presente -> resolve exatamente cidade/roles configurados (matriz), ' +
        'ignora agente de outra cidade e independe da cidade do lead',
      async () => {
        const result = await escalateLeadToCredit(db, actorConfigured, { leadId: LEAD_CFG_ID });

        expect(result.already_escalated).toBe(false);
        expect(result.recipient_count).toBe(1);

        const notifiedMatriz = await db
          .select()
          .from(notifications)
          .where(
            and(
              eq(notifications.organizationId, ORG_CONFIGURED_ID),
              eq(notifications.userId, USER_MATRIZ_AGENTE_ID),
              eq(notifications.entityId, LEAD_CFG_ID),
            ),
          );
        expect(notifiedMatriz).toHaveLength(1);

        const notifiedOther = await db
          .select()
          .from(notifications)
          .where(
            and(
              eq(notifications.organizationId, ORG_CONFIGURED_ID),
              eq(notifications.userId, USER_OTHER_AGENTE_ID),
              eq(notifications.entityId, LEAD_CFG_ID),
            ),
          );
        expect(notifiedOther).toHaveLength(0);
      },
    );

    it(
      'lead fora do escopo de cidade do ator -> 404 (NUNCA 403 — não vaza ' +
        'existência do recurso, doc 10 §3.5)',
      async () => {
        const restrictedActor: AssistantEscalationActorContext = {
          userId: USER_OP_CFG_ID,
          organizationId: ORG_CONFIGURED_ID,
          cityScopeIds: [CITY_CFG_LEAD_ID],
        };

        await expect(
          escalateLeadToCredit(db, restrictedActor, { leadId: LEAD_CFG_OUT_ID }),
        ).rejects.toBeInstanceOf(NotFoundError);

        const auditRows = await db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.organizationId, ORG_CONFIGURED_ID),
              eq(auditLogs.action, 'assistant.lead_escalated'),
              eq(auditLogs.resourceId, LEAD_CFG_OUT_ID),
            ),
          );
        expect(auditRows).toHaveLength(0);
      },
    );

    it('zero destinatário resolvido (config aponta para role sem ninguém na org) -> 409', async () => {
      await expect(
        escalateLeadToCredit(db, actorZero, { leadId: LEAD_ZERO_ID }),
      ).rejects.toBeInstanceOf(ConflictError);

      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.organizationId, ORG_ZERO_ID),
            eq(auditLogs.action, 'assistant.lead_escalated'),
            eq(auditLogs.resourceId, LEAD_ZERO_ID),
          ),
        );
      expect(auditRows).toHaveLength(0);
    });

    it('idempotência: 2ª chamada dentro da janela não duplica audit_log/outbox/notificação', async () => {
      // LEAD_FB_ID já foi escalado no 1º teste — reusa a mesma janela de dedup.
      const result = await escalateLeadToCredit(db, actorFallback, { leadId: LEAD_FB_ID });

      expect(result.already_escalated).toBe(true);
      expect(result.recipient_count).toBe(1);

      const auditRows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.organizationId, ORG_FALLBACK_ID),
            eq(auditLogs.action, 'assistant.lead_escalated'),
            eq(auditLogs.resourceId, LEAD_FB_ID),
          ),
        );
      expect(auditRows).toHaveLength(1);

      const eventRows = await db
        .select()
        .from(eventOutbox)
        .where(
          and(
            eq(eventOutbox.organizationId, ORG_FALLBACK_ID),
            eq(eventOutbox.eventName, 'assistant.escalation.created'),
            eq(eventOutbox.aggregateId, LEAD_FB_ID),
          ),
        );
      expect(eventRows).toHaveLength(1);

      const notificationRows = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.organizationId, ORG_FALLBACK_ID),
            eq(notifications.userId, USER_FALLBACK_ANALYST_ID),
            eq(notifications.entityId, LEAD_FB_ID),
          ),
        );
      expect(notificationRows).toHaveLength(1);
    });

    it(
      'LGPD §8.5: a nota do operador nunca aparece em audit_logs.after nem em ' +
        'event_outbox.payload — só no corpo da notificação in-app',
      async () => {
        const result = await escalateLeadToCredit(db, actorConfigured, {
          leadId: LEAD_CFG_OUT_ID,
          note: NOTE_MARKER,
        });
        expect(result.already_escalated).toBe(false);

        const [auditRow] = await db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.organizationId, ORG_CONFIGURED_ID),
              eq(auditLogs.action, 'assistant.lead_escalated'),
              eq(auditLogs.resourceId, LEAD_CFG_OUT_ID),
            ),
          );
        expect(auditRow).toBeDefined();
        expect(JSON.stringify(auditRow?.after)).not.toContain(NOTE_MARKER);

        const [eventRow] = await db
          .select()
          .from(eventOutbox)
          .where(
            and(
              eq(eventOutbox.organizationId, ORG_CONFIGURED_ID),
              eq(eventOutbox.eventName, 'assistant.escalation.created'),
              eq(eventOutbox.aggregateId, LEAD_CFG_OUT_ID),
            ),
          );
        expect(eventRow).toBeDefined();
        expect(JSON.stringify(eventRow?.payload)).not.toContain(NOTE_MARKER);

        // A nota SÓ aparece no corpo da notificação in-app (fora do outbox) —
        // destinatário: agente da cidade CONFIGURADA (matriz), independente da
        // cidade do lead escalado (LEAD_CFG_OUT_ID está em CITY_OTHER_ID).
        const notificationRows = await db
          .select()
          .from(notifications)
          .where(
            and(
              eq(notifications.organizationId, ORG_CONFIGURED_ID),
              eq(notifications.userId, USER_MATRIZ_AGENTE_ID),
              eq(notifications.entityId, LEAD_CFG_OUT_ID),
            ),
          );
        expect(notificationRows).toHaveLength(1);
        expect(notificationRows[0]?.body).toContain(NOTE_MARKER);
      },
    );
  },
);
