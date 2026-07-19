// =============================================================================
// ai-handoff.integration.test.ts — Testes de integração REAIS contra Postgres
// da correção do loop de handoff da IA (bug de produção, 2026-07-15).
//
// Cenários cobertos:
//   1. Primeira chamada: reivindica o handoff (ai_handoff_at + status pending),
//      envia fallback UMA vez, publica socket relay, registra audit_log,
//      notifica agente atribuído + gestores (admin/gestor_geral) + gestor
//      regional da cidade da conversa.
//   2. Segunda chamada (mesma conversa): no-op idempotente — fallback NÃO
//      reenviado, socket relay NÃO republicado, audit_log NÃO duplicado,
//      notificações NÃO duplicadas. Exercita o UPDATE atômico real (não
//      mocka o db.update) — é a trava que impede o loop de produção.
//   3. Conversa sem cidade (cityId=null): gestor_regional cai no
//      comportamento "geral" — TODOS os gestores regionais da org recebem
//      (não filtrados por cidade).
//   4. Conversa com cidade: gestor_regional de OUTRA cidade não é notificado.
//   5. LGPD: body da notificação nunca contém nome/telefone do contato —
//      no máximo o nome do município.
//
// Apenas `lib/queue/index.js` (publish/makeEnvelope) e
// `conversations/send.service.js` (sendMessage) são mockados — dependem de
// infraestrutura externa (RabbitMQ) indisponível no ambiente de teste. Tudo
// o mais (conversations, audit_logs, notifications, roles/user_roles/
// user_city_scopes) usa o Postgres real, mesmo padrão de
// assistant-escalation.integration.test.ts.
//
// Banco: probe pool.query('SELECT 1'); describe.runIf(dbAvailable) pula
// limpo sem DB.
// =============================================================================
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — apenas dependências que exigem infraestrutura externa (RabbitMQ).
// ---------------------------------------------------------------------------
const mockPublish = vi.fn().mockResolvedValue(undefined);
const mockMakeEnvelope = vi.fn((..._args: unknown[]) => _args[2]);
vi.mock('../../../lib/queue/index.js', () => ({
  publish: (...args: unknown[]) => mockPublish(...args),
  makeEnvelope: (...args: unknown[]) => mockMakeEnvelope(...args),
}));

const mockSendMessage = vi.fn().mockResolvedValue({ id: 'msg-fallback' });
vi.mock('../../conversations/send.service.js', () => ({
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
}));

// ---------------------------------------------------------------------------
// Import das dependências REAIS (db real, sem mock) — após os vi.mock acima.
// ---------------------------------------------------------------------------
import { db, pool } from '../../../db/client.js';
import {
  auditLogs,
  channels,
  cities,
  conversations,
  notifications,
  organizations,
  roles,
  userCityScopes,
  userRoles,
  users,
} from '../../../db/schema/index.js';
import { triggerLivechatHandoff } from '../ai-handoff.js';

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
// alfabeto hexadecimal (ex.: 'ah...' falha com "invalid input syntax for type uuid").
const ORG_ID = makeUuid('ac100001');
const CITY_A_ID = makeUuid('ac200001');
const CITY_B_ID = makeUuid('ac200002');
const CHANNEL_ID = makeUuid('ac300001');

const USER_ADMIN_ID = makeUuid('ac600001'); // role admin -- notificado sempre
const USER_GESTOR_GERAL_ID = makeUuid('ac600002'); // role gestor_geral -- notificado sempre
const USER_REGIONAL_A_ID = makeUuid('ac600003'); // gestor_regional, escopo CITY_A
const USER_REGIONAL_B_ID = makeUuid('ac600004'); // gestor_regional, escopo CITY_B
const USER_AGENT_ASSIGNED_ID = makeUuid('ac600005'); // atribuído à conversa (sem role especial)

const CONV_CITY_A_ID = makeUuid('ac400001'); // cityId=CITY_A, assignedUserId=agente
const CONV_NO_CITY_ID = makeUuid('ac400002'); // cityId=null, sem assignee
const CONV_WAIT_ID = makeUuid('ac400003'); // lastInboundAt setado — testa enriquecimento (F26-S02)

const roleIdByKey = new Map<string, string>();

// ---------------------------------------------------------------------------
// beforeAll — seed mínimo
// ---------------------------------------------------------------------------
beforeAll(async () => {
  if (!dbAvailable) return;

  await db
    .insert(organizations)
    .values({ id: ORG_ID, slug: 'ah-int-' + RUN_SUFFIX, name: 'AH IntOrg', settings: {} })
    .onConflictDoNothing();

  await db
    .insert(cities)
    .values([
      {
        id: CITY_A_ID,
        organizationId: ORG_ID,
        ibgeCode: 'h' + RUN_SUFFIX.slice(0, 5) + '1',
        name: 'AH IntCity A',
        nameNormalized: 'ah intcity a',
        stateUf: 'RO',
        slug: 'ah-intcity-a-' + RUN_SUFFIX,
        aliases: [],
        isActive: true,
      },
      {
        id: CITY_B_ID,
        organizationId: ORG_ID,
        ibgeCode: 'h' + RUN_SUFFIX.slice(0, 5) + '2',
        name: 'AH IntCity B',
        nameNormalized: 'ah intcity b',
        stateUf: 'RO',
        slug: 'ah-intcity-b-' + RUN_SUFFIX,
        aliases: [],
        isActive: true,
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(channels)
    .values({
      id: CHANNEL_ID,
      organizationId: ORG_ID,
      cityId: null,
      provider: 'meta_whatsapp',
      name: 'AH IntChannel',
      displayHandle: '55699999' + RUN_SUFFIX.slice(0, 4),
      phoneNumberId: 'ah-phone-id-' + RUN_SUFFIX,
      isActive: true,
      isDefault: true,
    })
    .onConflictDoNothing();

  await db
    .insert(users)
    .values([
      {
        id: USER_ADMIN_ID,
        organizationId: ORG_ID,
        email: 'ah-int-admin-' + RUN_SUFFIX + '@test.local',
        passwordHash: 'x',
        fullName: 'AH IntUser Admin',
        status: 'active',
      },
      {
        id: USER_GESTOR_GERAL_ID,
        organizationId: ORG_ID,
        email: 'ah-int-gestorgeral-' + RUN_SUFFIX + '@test.local',
        passwordHash: 'x',
        fullName: 'AH IntUser GestorGeral',
        status: 'active',
      },
      {
        id: USER_REGIONAL_A_ID,
        organizationId: ORG_ID,
        email: 'ah-int-regionala-' + RUN_SUFFIX + '@test.local',
        passwordHash: 'x',
        fullName: 'AH IntUser RegionalA',
        status: 'active',
      },
      {
        id: USER_REGIONAL_B_ID,
        organizationId: ORG_ID,
        email: 'ah-int-regionalb-' + RUN_SUFFIX + '@test.local',
        passwordHash: 'x',
        fullName: 'AH IntUser RegionalB',
        status: 'active',
      },
      {
        id: USER_AGENT_ASSIGNED_ID,
        organizationId: ORG_ID,
        email: 'ah-int-agente-' + RUN_SUFFIX + '@test.local',
        passwordHash: 'x',
        fullName: 'AH IntUser Agente',
        status: 'active',
      },
    ])
    .onConflictDoNothing();

  // roles: catálogo global — pode já existir via migration ou seed.ts. Idempotente.
  await db
    .insert(roles)
    .values([
      { key: 'admin', label: 'admin', scope: 'global' },
      { key: 'gestor_geral', label: 'gestor_geral', scope: 'global' },
      { key: 'gestor_regional', label: 'gestor_regional', scope: 'city' },
    ])
    .onConflictDoNothing({ target: roles.key });

  const roleRows = await db
    .select({ id: roles.id, key: roles.key })
    .from(roles)
    .where(sql`${roles.key} IN ('admin','gestor_geral','gestor_regional')`);
  for (const row of roleRows) roleIdByKey.set(row.key, row.id);

  const adminRoleId = roleIdByKey.get('admin');
  const gestorGeralRoleId = roleIdByKey.get('gestor_geral');
  const gestorRegionalRoleId = roleIdByKey.get('gestor_regional');
  if (
    adminRoleId === undefined ||
    gestorGeralRoleId === undefined ||
    gestorRegionalRoleId === undefined
  ) {
    throw new Error('[ai-handoff.integration] roles não resolvidas após seed');
  }

  await db
    .insert(userRoles)
    .values([
      { userId: USER_ADMIN_ID, roleId: adminRoleId },
      { userId: USER_GESTOR_GERAL_ID, roleId: gestorGeralRoleId },
      { userId: USER_REGIONAL_A_ID, roleId: gestorRegionalRoleId },
      { userId: USER_REGIONAL_B_ID, roleId: gestorRegionalRoleId },
    ])
    .onConflictDoNothing();

  await db
    .insert(userCityScopes)
    .values([
      { userId: USER_REGIONAL_A_ID, cityId: CITY_A_ID, isPrimary: true },
      { userId: USER_REGIONAL_B_ID, cityId: CITY_B_ID, isPrimary: true },
    ])
    .onConflictDoNothing();

  await db
    .insert(conversations)
    .values([
      {
        id: CONV_CITY_A_ID,
        organizationId: ORG_ID,
        cityId: CITY_A_ID,
        channelId: CHANNEL_ID,
        contactRemoteId: '5569' + RUN_SUFFIX,
        contactName: 'AH IntContato A',
        assignedUserId: USER_AGENT_ASSIGNED_ID,
        status: 'open',
      },
      {
        id: CONV_NO_CITY_ID,
        organizationId: ORG_ID,
        cityId: null,
        channelId: CHANNEL_ID,
        contactRemoteId: '5569' + RUN_SUFFIX + '1',
        contactName: 'AH IntContato SemCidade',
        assignedUserId: null,
        status: 'open',
      },
      {
        id: CONV_WAIT_ID,
        organizationId: ORG_ID,
        cityId: CITY_A_ID,
        channelId: CHANNEL_ID,
        contactRemoteId: '5569' + RUN_SUFFIX + '2',
        contactName: 'AH IntContato Wait',
        assignedUserId: USER_AGENT_ASSIGNED_ID,
        status: 'open',
        // 2h atrás — base do "tempo esperando" no corpo enriquecido (F26-S02).
        lastInboundAt: new Date(Date.now() - 2 * 60 * 60 * 1_000),
      },
    ])
    .onConflictDoNothing();
}, 30_000);

beforeEach(() => {
  vi.clearAllMocks();
  mockSendMessage.mockResolvedValue({ id: 'msg-fallback' });
  mockPublish.mockResolvedValue(undefined);
});

afterAll(async () => {
  if (!dbAvailable) return;
  try {
    const userIds = [
      USER_ADMIN_ID,
      USER_GESTOR_GERAL_ID,
      USER_REGIONAL_A_ID,
      USER_REGIONAL_B_ID,
      USER_AGENT_ASSIGNED_ID,
    ];
    await db.delete(notifications).where(inArray(notifications.organizationId, [ORG_ID]));
    await db.delete(auditLogs).where(inArray(auditLogs.organizationId, [ORG_ID]));
    await db
      .delete(conversations)
      .where(inArray(conversations.id, [CONV_CITY_A_ID, CONV_NO_CITY_ID, CONV_WAIT_ID]));
    await db.delete(userCityScopes).where(inArray(userCityScopes.userId, userIds));
    await db.delete(userRoles).where(inArray(userRoles.userId, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
    await db.delete(channels).where(eq(channels.id, CHANNEL_ID));
    await db.delete(cities).where(inArray(cities.id, [CITY_A_ID, CITY_B_ID]));
    await db.delete(organizations).where(eq(organizations.id, ORG_ID));
    // roles: fixture global, não removida (mesmo padrão de
    // assistant-escalation.integration.test.ts).
  } finally {
    await pool.end();
  }
});

describe.runIf(dbAvailable)(
  '[INTEGRATION] triggerLivechatHandoff — trava de idempotência + notificação',
  () => {
    it(
      '1ª chamada (conversa com cidade + agente atribuído): reivindica o handoff, ' +
        'envia fallback 1x, publica socket relay, audita, notifica agente + ' +
        'gestores + gestor regional da cidade',
      async () => {
        await triggerLivechatHandoff(db, {
          organizationId: ORG_ID,
          conversationId: CONV_CITY_A_ID,
          messageId: makeUuid('ac500001'),
          reason: 'ai_requested',
        });

        expect(mockSendMessage).toHaveBeenCalledTimes(1);
        expect(mockPublish).toHaveBeenCalledTimes(1);

        const [convRow] = await db
          .select()
          .from(conversations)
          .where(eq(conversations.id, CONV_CITY_A_ID));
        expect(convRow?.status).toBe('pending');
        expect(convRow?.aiHandoffAt).not.toBeNull();

        const auditRows = await db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.organizationId, ORG_ID),
              eq(auditLogs.action, 'livechat.ai_handoff'),
              eq(auditLogs.resourceId, CONV_CITY_A_ID),
            ),
          );
        expect(auditRows).toHaveLength(1);

        const notifiedUserIds = (
          await db
            .select({ userId: notifications.userId, body: notifications.body })
            .from(notifications)
            .where(
              and(
                eq(notifications.organizationId, ORG_ID),
                eq(notifications.entityId, CONV_CITY_A_ID),
              ),
            )
        ).map((r) => r.userId);

        expect(new Set(notifiedUserIds)).toEqual(
          new Set([
            USER_ADMIN_ID,
            USER_GESTOR_GERAL_ID,
            USER_REGIONAL_A_ID,
            USER_AGENT_ASSIGNED_ID,
          ]),
        );
        // Gestor regional de OUTRA cidade não deve ser notificado.
        expect(notifiedUserIds).not.toContain(USER_REGIONAL_B_ID);
      },
    );

    it(
      '2ª chamada (mesma conversa): no-op idempotente — sem reenvio de ' +
        'fallback, sem republicar socket relay, sem duplicar audit/notificação',
      async () => {
        // A conversa já foi "reivindicada" pelo teste anterior (aiHandoffAt setado).
        await triggerLivechatHandoff(db, {
          organizationId: ORG_ID,
          conversationId: CONV_CITY_A_ID,
          messageId: makeUuid('ac500002'),
          reason: 'ai_requested',
        });

        expect(mockSendMessage).not.toHaveBeenCalled();
        expect(mockPublish).not.toHaveBeenCalled();

        const auditRows = await db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.organizationId, ORG_ID),
              eq(auditLogs.action, 'livechat.ai_handoff'),
              eq(auditLogs.resourceId, CONV_CITY_A_ID),
            ),
          );
        expect(auditRows).toHaveLength(1);

        const notificationRows = await db
          .select()
          .from(notifications)
          .where(
            and(
              eq(notifications.organizationId, ORG_ID),
              eq(notifications.entityId, CONV_CITY_A_ID),
            ),
          );
        expect(notificationRows).toHaveLength(4);
      },
    );

    it(
      'conversa sem cidade (cityId=null): gestor_regional cai no comportamento ' +
        'geral — TODOS os gestores regionais da org são notificados',
      async () => {
        await triggerLivechatHandoff(db, {
          organizationId: ORG_ID,
          conversationId: CONV_NO_CITY_ID,
          messageId: makeUuid('ac500003'),
          reason: 'ai_unavailable',
        });

        const notifiedUserIds = (
          await db
            .select({ userId: notifications.userId })
            .from(notifications)
            .where(
              and(
                eq(notifications.organizationId, ORG_ID),
                eq(notifications.entityId, CONV_NO_CITY_ID),
              ),
            )
        ).map((r) => r.userId);

        expect(new Set(notifiedUserIds)).toEqual(
          new Set([USER_ADMIN_ID, USER_GESTOR_GERAL_ID, USER_REGIONAL_A_ID, USER_REGIONAL_B_ID]),
        );
      },
    );

    it('LGPD: body da notificação cita no máximo o nome do município — sem PII do contato', async () => {
      const rows = await db
        .select({ title: notifications.title, body: notifications.body })
        .from(notifications)
        .where(
          and(eq(notifications.organizationId, ORG_ID), eq(notifications.entityId, CONV_CITY_A_ID)),
        );

      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.body).not.toContain('AH IntContato A'); // nome do contato
        expect(row.body).not.toContain(RUN_SUFFIX); // fragmento do telefone de teste
        expect(row.title).toBe('Atendimento precisa de humano');
      }
    });

    // -------------------------------------------------------------------------
    // F26-S02 — enriquecimento do corpo (motivo + tempo esperando)
    // -------------------------------------------------------------------------
    it(
      'F26-S02: body enriquecido com motivo do handoff + tempo esperando ' +
        '(derivado de last_inbound_at) — sem PII do contato',
      async () => {
        await triggerLivechatHandoff(db, {
          organizationId: ORG_ID,
          conversationId: CONV_WAIT_ID,
          messageId: makeUuid('ac500004'),
          reason: 'cobranca',
        });

        const rows = await db
          .select({ title: notifications.title, body: notifications.body })
          .from(notifications)
          .where(
            and(eq(notifications.organizationId, ORG_ID), eq(notifications.entityId, CONV_WAIT_ID)),
          );

        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
          // Motivo traduzido do catálogo (não a chave crua 'cobranca').
          expect(row.body).toContain('assunto de cobrança');
          // Tempo esperando derivado de last_inbound_at (~2h no seed) — não
          // trava em um valor exato (execução assíncrona do teste), só
          // confirma que o texto de espera foi incluído.
          expect(row.body).toContain('aguardando há');
          expect(row.body).not.toContain('AH IntContato Wait'); // nome do contato
          expect(row.body).not.toContain(RUN_SUFFIX); // fragmento do telefone de teste
        }
      },
    );
  },
);
