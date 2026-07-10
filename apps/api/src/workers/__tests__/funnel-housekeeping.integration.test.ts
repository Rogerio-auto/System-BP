// =============================================================================
// funnel-housekeeping.integration.test.ts — Testes de integração REAIS contra
// Postgres (F25-S08) das famílias 3, 6 e 7 do DoD do slot:
//
//   Família 3 — Housekeeping:
//     - Estagnação sinaliza (leads.stagnant) SEM mudar o status do lead nem
//       o stage — apenas emite evento + audit_log.
//     - Abandono após o limiar move o lead para `closed_lost` (reversível —
//       metadata.outcome='abandonado', nunca terminal_won).
//     - NUNCA age sobre um lead cujo stage está em `documentacao` (ou além) —
//       ELIGIBLE_CANONICAL_ROLES só cobre pre_atendimento/simulacao.
//     - Dedup diário: 2 ticks no mesmo dia não duplicam o evento no outbox
//       (idempotencyKey por lead+dia bucket, onConflictDoNothing).
//
//   Família 6 — Flag / kill-switch:
//     - `internal_assistant.actions.enabled` (via requireFlag(), o mesmo
//       helper usado pelo loop CLI real do worker — ver funnel-housekeeping.ts
//       linha ~236) reflete corretamente o status seedado em feature_flags.
//     - Kill-switch por org: `ai_funnel_settings.enabled=false` exclui a org
//       inteira do tick (defesa em profundidade, independente do flag global).
//
//   Família 7 — LGPD:
//     - event_outbox.payload dos eventos leads.stagnant/leads.abandoned não
//       carrega nome/telefone bruto do lead.
//
// NOTA DE ARQUITETURA (não é bug, é o padrão do codebase — ver também
// notification-sla-scan.ts): `runFunnelHousekeepingTick()` é a unidade de
// trabalho determinística; o gate de feature flag global vive no loop CLI
// (`if (process.argv[1]...)`, executado apenas quando o arquivo roda como
// processo separado). Por isso testamos o mecanismo (`requireFlag`) e o
// kill-switch por org (`ai_funnel_settings.enabled`) diretamente — mesma
// separação já usada por sla-scan-integration.test.ts.
//
// Banco: mesmo padrão de sla-scan-integration.test.ts — probe
// pool.query('SELECT 1'); describe.runIf(dbAvailable) pula limpo sem DB.
// =============================================================================
import { and, eq } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db, pool } from '../../db/client.js';
import {
  aiFunnelSettings,
  auditLogs,
  cities,
  eventOutbox,
  featureFlags,
  kanbanCards,
  kanbanStages,
  leads,
  organizations,
} from '../../db/schema/index.js';
import { requireFlag } from '../../lib/featureFlags.js';
import { invalidateFlagCache } from '../../modules/featureFlags/service.js';
import { runFunnelHousekeepingTick } from '../funnel-housekeeping.js';

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

const silentLogger = pino({ level: 'silent' });

// ---------------------------------------------------------------------------
// IDs determinísticos por execução — prefixos apenas [0-9a-f].
// ---------------------------------------------------------------------------
const RUN_SUFFIX = String(Date.now()).slice(-10);
function makeUuid(prefix: string): string {
  const pad = RUN_SUFFIX.padStart(12, '0');
  return `${prefix.slice(0, 8)}-0000-0000-0000-${pad}`;
}

const ORG_ON_ID = makeUuid('fa100001'); // ai_funnel_settings.enabled=true
const ORG_OFF_ID = makeUuid('fa100002'); // ai_funnel_settings.enabled=false (kill-switch)
const CITY_ID = makeUuid('fa200001');

const STAGE_PRE_ID = makeUuid('fa300001'); // canonical_role=pre_atendimento (elegível)
const STAGE_SIM_ID = makeUuid('fa300002'); // canonical_role=simulacao (elegível)
const STAGE_DOC_ID = makeUuid('fa300003'); // canonical_role=documentacao (NUNCA elegível)

const LEAD_STAGNANT_ID = makeUuid('fa400001'); // stale, ainda dentro do limiar de abandono
const LEAD_ABANDON_ID = makeUuid('fa400002'); // além do limiar de abandono
const LEAD_DOC_ID = makeUuid('fa400003'); // em documentacao, MUITO stale — não pode ser tocado
const LEAD_FRESH_ID = makeUuid('fa400004'); // atualizado agora — não elegível
const LEAD_OFF_ORG_ID = makeUuid('fa400005'); // org com kill-switch desligado

const LEAD_STAGNANT_NAME = 'FH IntLead Stagnant ' + RUN_SUFFIX;
const LEAD_STAGNANT_PHONE = '5569' + RUN_SUFFIX.slice(0, 9);

const STAGE_OFF_ORG_PRE_ID = makeUuid('fa300004'); // stage pre_atendimento da org OFF

const CARD_STAGNANT_ID = makeUuid('fa500001');
const CARD_ABANDON_ID = makeUuid('fa500002');
const CARD_DOC_ID = makeUuid('fa500003');
const CARD_FRESH_ID = makeUuid('fa500004');
const CARD_OFF_ORG_ID = makeUuid('fa500005');

const STAGNANT_AFTER_DAYS = 7;
const ABANDON_AFTER_DAYS = 30;

const DAYS_10_AGO = new Date(Date.now() - 10 * 24 * 60 * 60 * 1_000); // > stagnant, < abandon
const DAYS_35_AGO = new Date(Date.now() - 35 * 24 * 60 * 60 * 1_000); // > abandon
const DAYS_90_AGO = new Date(Date.now() - 90 * 24 * 60 * 60 * 1_000); // muito stale (documentacao)

async function findLeadStatus(leadId: string): Promise<string | undefined> {
  const [row] = await db.select({ status: leads.status }).from(leads).where(eq(leads.id, leadId));
  return row?.status;
}

async function countAiActionAudits(leadId: string, action: string): Promise<number> {
  const rows = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(and(eq(auditLogs.resourceId, leadId), eq(auditLogs.action, action)));
  return rows.length;
}

beforeAll(async () => {
  if (!dbAvailable) return;

  await db
    .insert(organizations)
    .values([
      { id: ORG_ON_ID, slug: 'fh-int-on-' + RUN_SUFFIX, name: 'FH IntOrg ON', settings: {} },
      { id: ORG_OFF_ID, slug: 'fh-int-off-' + RUN_SUFFIX, name: 'FH IntOrg OFF', settings: {} },
    ])
    .onConflictDoNothing();

  await db
    .insert(cities)
    .values({
      id: CITY_ID,
      organizationId: ORG_ON_ID,
      ibgeCode: 'a' + RUN_SUFFIX.slice(0, 5) + '1',
      name: 'FH IntCity',
      nameNormalized: 'fh intcity',
      stateUf: 'RO',
      slug: 'fh-intcity-' + RUN_SUFFIX,
      aliases: [],
      isActive: true,
    })
    .onConflictDoNothing();

  await db
    .insert(kanbanStages)
    .values([
      {
        id: STAGE_PRE_ID,
        organizationId: ORG_ON_ID,
        name: 'FH IntStage Pre ' + RUN_SUFFIX,
        orderIndex: 0,
        canonicalRole: 'pre_atendimento',
      },
      {
        id: STAGE_SIM_ID,
        organizationId: ORG_ON_ID,
        name: 'FH IntStage Sim ' + RUN_SUFFIX,
        orderIndex: 1,
        canonicalRole: 'simulacao',
      },
      {
        id: STAGE_DOC_ID,
        organizationId: ORG_ON_ID,
        name: 'FH IntStage Doc ' + RUN_SUFFIX,
        orderIndex: 2,
        canonicalRole: 'documentacao',
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(leads)
    .values([
      {
        id: LEAD_STAGNANT_ID,
        organizationId: ORG_ON_ID,
        cityId: CITY_ID,
        phoneE164: '+' + LEAD_STAGNANT_PHONE,
        phoneNormalized: LEAD_STAGNANT_PHONE,
        name: LEAD_STAGNANT_NAME,
        source: 'whatsapp',
        status: 'new',
        updatedAt: DAYS_10_AGO,
      },
      {
        id: LEAD_ABANDON_ID,
        organizationId: ORG_ON_ID,
        cityId: CITY_ID,
        phoneE164: '+5569' + RUN_SUFFIX.slice(1, 10),
        phoneNormalized: '5569' + RUN_SUFFIX.slice(1, 10),
        name: 'FH IntLead Abandon ' + RUN_SUFFIX,
        source: 'whatsapp',
        status: 'simulation',
        updatedAt: DAYS_35_AGO,
      },
      {
        id: LEAD_DOC_ID,
        organizationId: ORG_ON_ID,
        cityId: CITY_ID,
        phoneE164: '+5569' + RUN_SUFFIX.slice(2, 11).padStart(9, '1'),
        phoneNormalized: '5569' + RUN_SUFFIX.slice(2, 11).padStart(9, '1'),
        name: 'FH IntLead Doc ' + RUN_SUFFIX,
        source: 'whatsapp',
        status: 'qualifying',
        updatedAt: DAYS_90_AGO,
      },
      {
        id: LEAD_FRESH_ID,
        organizationId: ORG_ON_ID,
        cityId: CITY_ID,
        phoneE164: '+5569' + RUN_SUFFIX.slice(3, 10).padStart(9, '2'),
        phoneNormalized: '5569' + RUN_SUFFIX.slice(3, 10).padStart(9, '2'),
        name: 'FH IntLead Fresh ' + RUN_SUFFIX,
        source: 'whatsapp',
        status: 'new',
        // updatedAt default = agora -> nunca elegível.
      },
      {
        id: LEAD_OFF_ORG_ID,
        organizationId: ORG_OFF_ID,
        cityId: null,
        phoneE164: '+5569' + RUN_SUFFIX.slice(4, 10).padStart(9, '3'),
        phoneNormalized: '5569' + RUN_SUFFIX.slice(4, 10).padStart(9, '3'),
        name: 'FH IntLead OffOrg ' + RUN_SUFFIX,
        source: 'whatsapp',
        status: 'new',
        updatedAt: DAYS_90_AGO,
      },
    ])
    .onConflictDoNothing();

  // Card da org OFF referencia um stage próprio (kanban_cards.organization_id
  // deve bater com o do stage -- reaproveita STAGE_PRE_ID só para simplificar
  // fixture; a org OFF nunca deveria ser processada de qualquer forma).
  await db
    .insert(kanbanStages)
    .values({
      id: STAGE_OFF_ORG_PRE_ID,
      organizationId: ORG_OFF_ID,
      name: 'FH IntStage OffOrg Pre ' + RUN_SUFFIX,
      orderIndex: 0,
      canonicalRole: 'pre_atendimento',
    })
    .onConflictDoNothing();

  await db
    .insert(kanbanCards)
    .values([
      {
        id: CARD_STAGNANT_ID,
        organizationId: ORG_ON_ID,
        leadId: LEAD_STAGNANT_ID,
        stageId: STAGE_PRE_ID,
      },
      {
        id: CARD_ABANDON_ID,
        organizationId: ORG_ON_ID,
        leadId: LEAD_ABANDON_ID,
        stageId: STAGE_SIM_ID,
      },
      {
        id: CARD_DOC_ID,
        organizationId: ORG_ON_ID,
        leadId: LEAD_DOC_ID,
        stageId: STAGE_DOC_ID,
      },
      {
        id: CARD_FRESH_ID,
        organizationId: ORG_ON_ID,
        leadId: LEAD_FRESH_ID,
        stageId: STAGE_PRE_ID,
      },
      {
        id: CARD_OFF_ORG_ID,
        organizationId: ORG_OFF_ID,
        leadId: LEAD_OFF_ORG_ID,
        stageId: STAGE_OFF_ORG_PRE_ID,
      },
    ])
    .onConflictDoNothing();

  // Kill-switch por org: ORG_ON habilitado, ORG_OFF desabilitado.
  await db
    .insert(aiFunnelSettings)
    .values([
      {
        organizationId: ORG_ON_ID,
        stagnantAfterDays: STAGNANT_AFTER_DAYS,
        abandonAfterDays: ABANDON_AFTER_DAYS,
        enabled: true,
      },
      {
        organizationId: ORG_OFF_ID,
        stagnantAfterDays: STAGNANT_AFTER_DAYS,
        abandonAfterDays: ABANDON_AFTER_DAYS,
        enabled: false,
      },
    ])
    .onConflictDoNothing();
}, 30_000);

afterAll(async () => {
  if (!dbAvailable) return;
  try {
    // Restaura o default documentado (doc 22 §10) para não vazar estado para
    // outros processos/dev locais compartilhando o mesmo Postgres.
    await db
      .insert(featureFlags)
      .values({ key: 'internal_assistant.actions.enabled', status: 'disabled' })
      .onConflictDoUpdate({
        target: featureFlags.key,
        set: { status: 'disabled' },
      });
    invalidateFlagCache();

    await db.delete(eventOutbox).where(eq(eventOutbox.organizationId, ORG_ON_ID));
    await db.delete(eventOutbox).where(eq(eventOutbox.organizationId, ORG_OFF_ID));
    await db.delete(auditLogs).where(eq(auditLogs.organizationId, ORG_ON_ID));
    await db.delete(auditLogs).where(eq(auditLogs.organizationId, ORG_OFF_ID));
    await db.delete(aiFunnelSettings).where(eq(aiFunnelSettings.organizationId, ORG_ON_ID));
    await db.delete(aiFunnelSettings).where(eq(aiFunnelSettings.organizationId, ORG_OFF_ID));
    await db
      .delete(kanbanCards)
      .where(and(eq(kanbanCards.id, CARD_STAGNANT_ID), eq(kanbanCards.organizationId, ORG_ON_ID)));
    await db.delete(kanbanCards).where(eq(kanbanCards.id, CARD_ABANDON_ID));
    await db.delete(kanbanCards).where(eq(kanbanCards.id, CARD_DOC_ID));
    await db.delete(kanbanCards).where(eq(kanbanCards.id, CARD_FRESH_ID));
    await db.delete(kanbanCards).where(eq(kanbanCards.id, CARD_OFF_ORG_ID));
    await db.delete(kanbanStages).where(eq(kanbanStages.organizationId, ORG_ON_ID));
    await db.delete(kanbanStages).where(eq(kanbanStages.organizationId, ORG_OFF_ID));
    await db.delete(leads).where(eq(leads.organizationId, ORG_ON_ID));
    await db.delete(leads).where(eq(leads.organizationId, ORG_OFF_ID));
    await db.delete(cities).where(eq(cities.id, CITY_ID));
    await db.delete(organizations).where(eq(organizations.id, ORG_ON_ID));
    await db.delete(organizations).where(eq(organizations.id, ORG_OFF_ID));
  } finally {
    await pool.end();
  }
});

describe.runIf(dbAvailable)(
  '[INTEGRATION] runFunnelHousekeepingTick — housekeeping do funil (família 3)',
  () => {
    it('estagnação (10d): sinaliza leads.stagnant SEM mudar status nem terminal', async () => {
      await runFunnelHousekeepingTick(db);

      expect(await countAiActionAudits(LEAD_STAGNANT_ID, 'leads.stagnant')).toBe(1);
      expect(await countAiActionAudits(LEAD_STAGNANT_ID, 'leads.abandoned')).toBe(0);
      // Status do lead permanece inalterado (housekeeping de estagnação não muta status).
      expect(await findLeadStatus(LEAD_STAGNANT_ID)).toBe('new');
    });

    it('abandono (35d): move para closed_lost de forma reversível', async () => {
      expect(await countAiActionAudits(LEAD_ABANDON_ID, 'leads.abandoned')).toBe(1);
      expect(await findLeadStatus(LEAD_ABANDON_ID)).toBe('closed_lost');

      const [leadRow] = await db
        .select({ metadata: leads.metadata })
        .from(leads)
        .where(eq(leads.id, LEAD_ABANDON_ID));
      const metadata = leadRow?.metadata as Record<string, unknown> | undefined;
      expect(metadata?.['outcome']).toBe('abandonado');
    });

    it('NUNCA age sobre lead em documentacao, mesmo muito estagnado (90d)', async () => {
      expect(await countAiActionAudits(LEAD_DOC_ID, 'leads.stagnant')).toBe(0);
      expect(await countAiActionAudits(LEAD_DOC_ID, 'leads.abandoned')).toBe(0);
      expect(await findLeadStatus(LEAD_DOC_ID)).toBe('qualifying');
    });

    it('lead recém-atualizado (fresh) não é elegível', async () => {
      expect(await countAiActionAudits(LEAD_FRESH_ID, 'leads.stagnant')).toBe(0);
      expect(await countAiActionAudits(LEAD_FRESH_ID, 'leads.abandoned')).toBe(0);
    });

    it('kill-switch por org (ai_funnel_settings.enabled=false) exclui a org inteira', async () => {
      expect(await countAiActionAudits(LEAD_OFF_ORG_ID, 'leads.stagnant')).toBe(0);
      expect(await countAiActionAudits(LEAD_OFF_ORG_ID, 'leads.abandoned')).toBe(0);
      expect(await findLeadStatus(LEAD_OFF_ORG_ID)).toBe('new');
    });

    it('dedup diário: 2º tick no mesmo dia não duplica o evento no outbox', async () => {
      await runFunnelHousekeepingTick(db);

      const stagnantEvents = await db
        .select({ id: eventOutbox.id })
        .from(eventOutbox)
        .where(
          and(
            eq(eventOutbox.organizationId, ORG_ON_ID),
            eq(eventOutbox.aggregateId, LEAD_STAGNANT_ID),
            eq(eventOutbox.eventName, 'leads.stagnant'),
          ),
        );
      // Dedup real: idempotencyKey por lead+dia + onConflictDoNothing garante
      // que o OUTBOX (e portanto qualquer consumidor/side-effect a jusante)
      // nunca vê o mesmo evento duas vezes no mesmo dia — é o que importa
      // funcionalmente (docs/22 §2 princípio 7).
      expect(stagnantEvents).toHaveLength(1);

      const abandonEvents = await db
        .select({ id: eventOutbox.id })
        .from(eventOutbox)
        .where(
          and(
            eq(eventOutbox.organizationId, ORG_ON_ID),
            eq(eventOutbox.aggregateId, LEAD_ABANDON_ID),
            eq(eventOutbox.eventName, 'leads.abandoned'),
          ),
        );
      expect(abandonEvents).toHaveLength(1);
    });

    it(
      'ACHADO F25-S08: 2º tick no mesmo dia DUPLICA audit_logs de leads.stagnant ' +
        '(gap real, não é bloqueio deste slot — reportado para follow-up)',
      async () => {
        // processStagnant() (funnel-housekeeping.ts) chama emit() com
        // onConflictDoNothing (dedup real, testado acima) e, LOGO EM SEGUIDA,
        // na MESMA transação, chama auditLog() incondicionalmente — o helper
        // audit.ts não tem chave de idempotência própria. Resultado real: um
        // 2º tick no mesmo dia (ex.: restart do worker, trigger manual) insere
        // uma SEGUNDA linha em audit_logs para o mesmo lead+ação+dia, mesmo com
        // o outbox corretamente deduplicado. Efeito prático: infla a contagem
        // do painel "IA nas últimas 24h" (doc 22 §11) — não duplica mutação de
        // estado nem side-effect externo (outbox é a fonte de verdade para
        // consumidores). LEAD_ABANDON não sofre o mesmo problema aqui porque,
        // após o 1º tick, o lead já está em closed_lost (status terminal) e
        // sai da query de elegibilidade (notInArray(TERMINAL_STATUSES)) —
        // só leads.stagnant (que nunca muda o status) fica reexposto a cada
        // tick. Documentando o comportamento real em vez de mascará-lo —
        // mesmo padrão usado para o gap de actor_type em F25-S06.
        expect(await countAiActionAudits(LEAD_STAGNANT_ID, 'leads.stagnant')).toBe(2);
        expect(await countAiActionAudits(LEAD_ABANDON_ID, 'leads.abandoned')).toBe(1);
      },
    );

    it('LGPD §8.5: payload dos eventos de housekeeping não carrega PII bruta', async () => {
      const [stagnantEvent] = await db
        .select({ payload: eventOutbox.payload })
        .from(eventOutbox)
        .where(
          and(
            eq(eventOutbox.organizationId, ORG_ON_ID),
            eq(eventOutbox.aggregateId, LEAD_STAGNANT_ID),
            eq(eventOutbox.eventName, 'leads.stagnant'),
          ),
        );

      expect(stagnantEvent).toBeDefined();
      const serialized = JSON.stringify(stagnantEvent?.payload);
      expect(serialized).not.toContain(LEAD_STAGNANT_NAME);
      expect(serialized).not.toContain(LEAD_STAGNANT_PHONE);
    });
  },
);

describe.runIf(dbAvailable)(
  '[INTEGRATION] requireFlag — mecanismo de kill-switch global (família 6)',
  () => {
    afterAll(async () => {
      if (!dbAvailable) return;
      await db
        .insert(featureFlags)
        .values({ key: 'internal_assistant.actions.enabled', status: 'disabled' })
        .onConflictDoUpdate({
          target: featureFlags.key,
          set: { status: 'disabled' },
        });
      invalidateFlagCache();
    });

    it('flag disabled -> requireFlag() retorna false (worker não deve rodar)', async () => {
      await db
        .insert(featureFlags)
        .values({ key: 'internal_assistant.actions.enabled', status: 'disabled' })
        .onConflictDoUpdate({
          target: featureFlags.key,
          set: { status: 'disabled' },
        });
      invalidateFlagCache();

      const enabled = await requireFlag(db, 'internal_assistant.actions.enabled', silentLogger);
      expect(enabled).toBe(false);
    });

    it('flag enabled -> requireFlag() retorna true (worker pode prosseguir)', async () => {
      await db
        .insert(featureFlags)
        .values({ key: 'internal_assistant.actions.enabled', status: 'enabled' })
        .onConflictDoUpdate({
          target: featureFlags.key,
          set: { status: 'enabled' },
        });
      invalidateFlagCache();

      const enabled = await requireFlag(db, 'internal_assistant.actions.enabled', silentLogger);
      expect(enabled).toBe(true);
    });
  },
);
