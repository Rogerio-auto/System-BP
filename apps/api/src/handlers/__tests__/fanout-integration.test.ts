// =============================================================================
// handlers/__tests__/fanout-integration.test.ts — Testes de integração REAIS
// contra Postgres do fan-out rules-driven (F24-S14).
//
// Complementa fanout-notification.test.ts (mocks DB inteiro) — aqui
// handleFanoutNotification roda contra SQL real (notification_rules,
// notification_rule_deliveries, notifications, notification_preferences,
// feature_flags), provando:
//   - Fan-out por evento: regra enabled + trigger_key casa → notificação
//     in-app criada para os destinatários certos (resolveRuleRecipients real).
//   - Idempotência por event_id: reprocessar o mesmo evento não duplica.
//   - Preferência de canal desligada suprime o canal (sem suprimir a regra).
//   - city_scope: regra filtrada nunca grava delivery para si mesma, mesmo
//     quando outra regra sem filtro dispara para o mesmo evento.
//   - Fail-closed (F24-S21, paridade com o worker de SLA — F24-S16): quando
//     o evento não carrega city_id resolvível, uma regra com city_scope
//     configurado é suprimida (não dispara) — nunca faz broadcast org-wide.
//     Ver teste dedicado abaixo.
//   - Feature flag `notifications.rules.enabled` desligada → no-op total.
//   - Isolamento de organização: evento de uma org nunca aciona regra de outra.
//   - severity da regra chega ao payload do socket relay (mock da fila —
//     nunca RabbitMQ real).
//
// Banco: mesmo padrão de reports.integration.test.ts — probe
// pool.query('SELECT 1'); describe.runIf(dbAvailable) pula limpo sem DB.
//
// Fila: `lib/queue/index.js` é mockada (publish/makeEnvelope) — mesmo padrão
// de modules/notifications/__tests__/realtime.test.ts. Nunca conecta a um
// RabbitMQ real.
// =============================================================================
import { randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock da fila (socket relay) — nunca conecta a um RabbitMQ real.
// Mesmo padrão de modules/notifications/__tests__/realtime.test.ts.
// ---------------------------------------------------------------------------
const queueMocks = vi.hoisted(() => ({ mockPublish: vi.fn().mockResolvedValue(undefined) }));

vi.mock('../../lib/queue/index.js', () => ({
  publish: (...args: unknown[]) => queueMocks.mockPublish(...args),
  makeEnvelope: (type: string, organizationId: string, payload: unknown) => ({
    id: 'envelope-uuid',
    type,
    organizationId,
    payload,
    ts: Date.now(),
  }),
}));

// ---------------------------------------------------------------------------
// Imports reais (após mocks) — DB real, nada mais mockado.
// ---------------------------------------------------------------------------
import { db, pool } from '../../db/client.js';
import type { EventOutbox } from '../../db/schema/events.js';
import {
  cities,
  eventOutbox,
  featureFlags,
  notificationPreferences,
  notificationRuleDeliveries,
  notificationRules,
  notifications,
  organizations,
  roles,
  userCityScopes,
  userRoles,
  users,
} from '../../db/schema/index.js';
import { invalidateFlagCache } from '../../modules/featureFlags/service.js';
import { handleFanoutNotification } from '../fanout-notification.js';

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
// Prefixos usam apenas [0-9a-f] — Postgres `uuid` rejeita caracteres fora do
// alfabeto hex (ex: 'n' faria o INSERT falhar com "invalid input syntax for
// type uuid"). IDs dinâmicos (por evento) usam randomUUID() — sempre válido.
function makeUuid(prefix: string): string {
  const pad = RUN_SUFFIX.padStart(12, '0');
  return `${prefix.slice(0, 8)}-0000-0000-0000-${pad}`;
}

const ORG_A_ID = makeUuid('b1000001');
const ORG_B_ID = makeUuid('b1000002');
const CITY_A_ID = makeUuid('b2000001');
const CITY_B_ID = makeUuid('b2000002');
const USER_AGENT_ID = makeUuid('b3000001');

const RULE_OPEN_ID = makeUuid('b4000001'); // sem city_scope — sempre dispara
const RULE_CITY_SCOPED_ID = makeUuid('b4000002'); // city_scope=[CITY_B] — não bate com CITY_A

const TRIGGER_KEY = 'chatwoot.handoff_requested';
const FLAG_RULES_ENABLED = 'notifications.rules.enabled';
const FLAG_REALTIME_ENABLED = 'notifications.realtime.enabled';

function buildEvent(overrides: Partial<EventOutbox> = {}): EventOutbox {
  const aggregateId = overrides.id ?? randomUUID();
  return {
    id: aggregateId,
    organizationId: ORG_A_ID,
    eventName: TRIGGER_KEY,
    eventVersion: 1,
    aggregateType: 'conversation',
    aggregateId,
    payload: {
      event_id: aggregateId,
      event_name: TRIGGER_KEY,
      event_version: 1,
      occurred_at: new Date().toISOString(),
      actor: { kind: 'user', id: USER_AGENT_ID, ip: null },
      correlation_id: null,
      data: {
        lead_id: randomUUID(),
        chatwoot_conversation_id: 'cw-' + RUN_SUFFIX,
        reason: 'cliente_solicitou_atendente',
        city_id: CITY_A_ID,
      },
    },
    correlationId: null,
    idempotencyKey: TRIGGER_KEY + ':' + aggregateId,
    attempts: 0,
    lastError: null,
    processedAt: null,
    failedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

async function insertEvent(event: EventOutbox): Promise<void> {
  await db.insert(eventOutbox).values(event).onConflictDoNothing();
}

async function setFlag(key: string, status: 'enabled' | 'disabled'): Promise<void> {
  await db
    .insert(featureFlags)
    .values({ key, status })
    .onConflictDoUpdate({ target: featureFlags.key, set: { status } });
  // Escreve direto no banco (bypassa o service layer), então o cache in-process
  // de featureFlags/service.ts (TTL 30s) precisa ser invalidado manualmente —
  // sem isso, um teste anterior que já leu a flag como 'enabled' mantém esse
  // valor em cache e o toggle para 'disabled' não tem efeito na mesma execução.
  invalidateFlagCache();
}

async function countNotifications(entityId: string): Promise<number> {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(eq(notifications.entityId, entityId));
  return rows.length;
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
    .values([
      { id: ORG_A_ID, slug: 'fn-int-a-' + RUN_SUFFIX, name: 'FN IntOrg A', settings: {} },
      { id: ORG_B_ID, slug: 'fn-int-b-' + RUN_SUFFIX, name: 'FN IntOrg B', settings: {} },
    ])
    .onConflictDoNothing();

  await db
    .insert(cities)
    .values([
      {
        id: CITY_A_ID,
        organizationId: ORG_A_ID,
        ibgeCode: '7' + RUN_SUFFIX.slice(0, 5) + '1',
        name: 'FN IntCity A',
        nameNormalized: 'fn intcity a',
        stateUf: 'RO',
        slug: 'fn-intcity-a-' + RUN_SUFFIX,
        aliases: [],
        isActive: true,
      },
      {
        id: CITY_B_ID,
        organizationId: ORG_A_ID,
        ibgeCode: '7' + RUN_SUFFIX.slice(0, 5) + '2',
        name: 'FN IntCity B',
        nameNormalized: 'fn intcity b',
        stateUf: 'RO',
        slug: 'fn-intcity-b-' + RUN_SUFFIX,
        aliases: [],
        isActive: true,
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(users)
    .values({
      id: USER_AGENT_ID,
      organizationId: ORG_A_ID,
      email: 'fn-int-agent-' + RUN_SUFFIX + '@test.local',
      passwordHash: 'x',
      fullName: 'FN IntUser Agent',
      status: 'active',
    })
    .onConflictDoNothing();

  await db
    .insert(roles)
    .values({ key: 'agente', label: 'agente', scope: 'city' })
    .onConflictDoNothing({ target: roles.key });
  const [agenteRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, 'agente'));
  if (agenteRole === undefined) throw new Error('[fanout-integration] role agente ausente');

  await db
    .insert(userRoles)
    .values({ userId: USER_AGENT_ID, roleId: agenteRole.id })
    .onConflictDoNothing();
  await db
    .insert(userCityScopes)
    .values({ userId: USER_AGENT_ID, cityId: CITY_A_ID, isPrimary: true })
    .onConflictDoNothing();

  await db
    .insert(notificationRules)
    .values([
      {
        id: RULE_OPEN_ID,
        organizationId: ORG_A_ID,
        name: 'FN rule open ' + RUN_SUFFIX,
        triggerKind: 'event',
        triggerKey: TRIGGER_KEY,
        category: 'handoff',
        recipientMode: 'by_role_city',
        recipientRoles: ['agente'],
        severity: 'critical',
        channels: ['in_app'],
        titleTemplate: 'Handoff {{lead_id}}',
        bodyTemplate: 'Motivo: {{reason}}',
        cooldownHours: 0,
        enabled: true,
        filters: {},
      },
      {
        id: RULE_CITY_SCOPED_ID,
        organizationId: ORG_A_ID,
        name: 'FN rule city-scoped ' + RUN_SUFFIX,
        triggerKind: 'event',
        triggerKey: TRIGGER_KEY,
        category: 'handoff',
        recipientMode: 'by_role_city',
        recipientRoles: ['agente'],
        severity: 'warning',
        channels: ['in_app'],
        titleTemplate: 'Handoff (city-scoped) {{lead_id}}',
        bodyTemplate: 'Motivo: {{reason}}',
        cooldownHours: 0,
        enabled: true,
        filters: { city_scope: [CITY_B_ID] },
      },
    ])
    .onConflictDoNothing();

  await setFlag(FLAG_RULES_ENABLED, 'enabled');
}, 30_000);

afterAll(async () => {
  if (!dbAvailable) return;
  try {
    await db.execute(
      sql`DELETE FROM notification_rule_deliveries WHERE organization_id = ${ORG_A_ID}`,
    );
    await db.execute(
      sql`DELETE FROM notifications WHERE organization_id IN (${ORG_A_ID}, ${ORG_B_ID})`,
    );
    await db.execute(sql`DELETE FROM notification_preferences WHERE organization_id = ${ORG_A_ID}`);
    await db.execute(
      sql`DELETE FROM notification_rules WHERE id IN (${RULE_OPEN_ID}, ${RULE_CITY_SCOPED_ID})`,
    );
    await db.execute(
      sql`DELETE FROM event_outbox WHERE organization_id IN (${ORG_A_ID}, ${ORG_B_ID})`,
    );
    await db.execute(sql`DELETE FROM user_city_scopes WHERE user_id = ${USER_AGENT_ID}`);
    await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${USER_AGENT_ID}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${USER_AGENT_ID}`);
    await db.execute(sql`DELETE FROM cities WHERE id IN (${CITY_A_ID}, ${CITY_B_ID})`);
    await db.execute(sql`DELETE FROM organizations WHERE id IN (${ORG_A_ID}, ${ORG_B_ID})`);
  } finally {
    await pool.end();
  }
});

describe.runIf(dbAvailable)('[INTEGRATION] handleFanoutNotification — SQL real', () => {
  it('cria notificação in-app para o destinatário resolvido por by_role_city', async () => {
    const event = buildEvent();
    await insertEvent(event);

    await handleFanoutNotification(event, db);

    const [row] = await db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.entityId, event.aggregateId), eq(notifications.userId, USER_AGENT_ID)),
      );
    expect(row).toBeDefined();
    expect(row?.title).toContain('Handoff');
    expect(row?.body).toContain('cliente_solicitou_atendente');
  });

  it('idempotência: reprocessar o mesmo evento não duplica notificação nem delivery', async () => {
    const event = buildEvent();
    await insertEvent(event);

    await handleFanoutNotification(event, db);
    const afterFirst = await countNotifications(event.aggregateId);
    const deliveriesAfterFirst = await countDeliveries(RULE_OPEN_ID, event.aggregateId);

    await handleFanoutNotification(event, db);
    const afterSecond = await countNotifications(event.aggregateId);
    const deliveriesAfterSecond = await countDeliveries(RULE_OPEN_ID, event.aggregateId);

    expect(afterFirst).toBeGreaterThan(0);
    expect(afterSecond).toBe(afterFirst);
    expect(deliveriesAfterFirst).toBe(1);
    expect(deliveriesAfterSecond).toBe(1);
  });

  it('preferência de canal desligada suprime o canal (não cria notificação)', async () => {
    await db
      .insert(notificationPreferences)
      .values({
        organizationId: ORG_A_ID,
        userId: USER_AGENT_ID,
        channel: 'in_app',
        category: 'handoff',
        enabled: false,
      })
      .onConflictDoUpdate({
        // targetWhere obrigatório: uq_notification_preferences_user_channel_cat é um
        // índice PARCIAL (WHERE category IS NOT NULL) — sem o predicado, o Postgres
        // não infere o conflito (mesmo padrão de notifications/repository.ts).
        target: [
          notificationPreferences.userId,
          notificationPreferences.channel,
          notificationPreferences.category,
        ],
        targetWhere: sql`${notificationPreferences.category} IS NOT NULL`,
        set: { enabled: false },
      });

    const event = buildEvent();
    await insertEvent(event);
    await handleFanoutNotification(event, db);

    expect(await countNotifications(event.aggregateId)).toBe(0);

    // Restaura a preferência para não afetar os testes seguintes.
    await db
      .update(notificationPreferences)
      .set({ enabled: true })
      .where(
        and(
          eq(notificationPreferences.userId, USER_AGENT_ID),
          eq(notificationPreferences.channel, 'in_app'),
          eq(notificationPreferences.category, 'handoff'),
        ),
      );
  });

  it('city_scope: regra filtrada nunca grava delivery para si mesma', async () => {
    const event = buildEvent(); // payload.data.city_id = CITY_A_ID
    await insertEvent(event);
    await handleFanoutNotification(event, db);

    // RULE_CITY_SCOPED_ID só aceita CITY_B_ID — evento é de CITY_A_ID.
    expect(await countDeliveries(RULE_CITY_SCOPED_ID, event.aggregateId)).toBe(0);
    // RULE_OPEN_ID (sem filtro) dispara normalmente para o mesmo evento.
    expect(await countDeliveries(RULE_OPEN_ID, event.aggregateId)).toBe(1);
  });

  it(
    'fail-closed (F24-S21): city_scope configurado + evento sem city_id não registra delivery — ' +
      'paridade com o worker de SLA (fail-closed, F24-S16)',
    async () => {
      const event = buildEvent();
      // `as` justificado: payload é jsonb do outbox — reescrevemos data.city_id
      // para simular um evento sem cidade resolvível (caso real: handoff sem lead).
      const payload = event.payload as { data: Record<string, unknown> };
      delete payload.data['city_id'];
      await insertEvent(event);
      await handleFanoutNotification(event, db);

      // Fail-closed: eventCityId=null + regra com city_scope configurado →
      // suprimida (nunca dispara), evitando o broadcast org-wide que
      // resolveByRoleCity faria com cityId=null.
      expect(await countDeliveries(RULE_CITY_SCOPED_ID, event.aggregateId)).toBe(0);
    },
  );

  it('flag notifications.rules.enabled desligada → no-op total', async () => {
    await setFlag(FLAG_RULES_ENABLED, 'disabled');
    try {
      const event = buildEvent();
      await insertEvent(event);
      await handleFanoutNotification(event, db);

      expect(await countNotifications(event.aggregateId)).toBe(0);
      expect(await countDeliveries(RULE_OPEN_ID, event.aggregateId)).toBe(0);
    } finally {
      await setFlag(FLAG_RULES_ENABLED, 'enabled');
    }
  });

  it('ISOLAMENTO: evento de outra organização nunca aciona regra da org A', async () => {
    const event = buildEvent({ organizationId: ORG_B_ID });
    await insertEvent(event);
    await handleFanoutNotification(event, db);

    expect(await countNotifications(event.aggregateId)).toBe(0);
    expect(await countDeliveries(RULE_OPEN_ID, event.aggregateId)).toBe(0);
  });

  it('severity da regra chega ao payload publicado no socket relay (fila mockada)', async () => {
    await setFlag(FLAG_REALTIME_ENABLED, 'enabled');
    try {
      queueMocks.mockPublish.mockClear();

      const event = buildEvent();
      await insertEvent(event);
      await handleFanoutNotification(event, db);

      expect(queueMocks.mockPublish).toHaveBeenCalled();
      const [, envelope] = queueMocks.mockPublish.mock.calls[0] as [
        unknown,
        { payload: { data: { severity: string; entityId: string } } },
      ];
      expect(envelope.payload.data.severity).toBe('critical');
      expect(envelope.payload.data.entityId).toBe(event.aggregateId);
    } finally {
      // `notifications.realtime.enabled` é uma flag GLOBAL (sem escopo por
      // organização) — sem restaurar para 'disabled' (default de produção,
      // migration 0077), outros arquivos de integração que rodam depois
      // deste no MESMO processo `vitest run` (mesmo Postgres de teste)
      // herdam realtime ligado e passam a publicar eventos extras no socket
      // relay que não esperam (achado ao investigar CI vermelho pré-existente:
      // ai-handoff.integration.test.ts via cross-file pollution).
      await setFlag(FLAG_REALTIME_ENABLED, 'disabled');
    }
  });
});
