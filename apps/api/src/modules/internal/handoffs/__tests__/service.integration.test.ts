// =============================================================================
// internal/handoffs/__tests__/service.integration.test.ts — Testes de
// integração REAIS contra Postgres da correção da ref de agregado do outbox
// (F26-S02, doc 23 §13).
//
// Bug histórico: requestHandoff() sempre emitia 'chatwoot.handoff_requested'
// com aggregateType='lead'/aggregateId=leadId — mesmo o TRIGGER_CATALOG
// rotulando este gatilho como entityType='conversation'. A notificação
// resultante carregava entity_type='lead' (sem rota no resolvedor do
// frontend) — o deep-link ficava morto.
//
// Fix: resolve a conversa nativa (F16) mais recente vinculada ao leadId. Se
// existir, a ref do outbox aponta para ela (aggregateType='conversation').
// Sem conversa nativa correspondente, mantém o fallback anterior
// (aggregateType='lead') — nunca aponta para um UUID de tipo errado.
//
// Banco: mesmo padrão de ai-handoff.integration.test.ts — probe
// pool.query('SELECT 1'); describe.runIf(dbAvailable) pula limpo sem DB.
// ChatwootClient (passo 3, fora da transação) lança ChatwootApiError sem as
// envs CHATWOOT_* configuradas (ausentes no ambiente de teste) — capturado
// e logado internamente pelo service; não afeta as asserções deste arquivo
// (o outbox já foi commitado no passo 2, antes da chamada ao Chatwoot).
// =============================================================================
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db, pool } from '../../../../db/client.js';
import {
  channels,
  conversations,
  eventOutbox,
  leads,
  organizations,
} from '../../../../db/schema/index.js';
import { requestHandoff } from '../service.js';

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

const ORG_ID = makeUuid('ih100001');
const CHANNEL_ID = makeUuid('ih300001');

const LEAD_WITH_CONV_ID = makeUuid('ih400001'); // tem conversation nativa vinculada
const LEAD_NO_CONV_ID = makeUuid('ih400002'); // sem conversation nativa — fallback 'lead'

const CONV_ID = makeUuid('ih500001'); // vinculada a LEAD_WITH_CONV_ID

const noopLogger = { warn: (): void => {} };

beforeAll(async () => {
  if (!dbAvailable) return;

  await db
    .insert(organizations)
    .values({ id: ORG_ID, slug: 'ih-int-' + RUN_SUFFIX, name: 'IH IntOrg', settings: {} })
    .onConflictDoNothing();

  await db
    .insert(channels)
    .values({
      id: CHANNEL_ID,
      organizationId: ORG_ID,
      cityId: null,
      provider: 'meta_whatsapp',
      name: 'IH IntChannel',
      displayHandle: '55698888' + RUN_SUFFIX.slice(0, 4),
      phoneNumberId: 'ih-phone-id-' + RUN_SUFFIX,
      isActive: true,
      isDefault: true,
    })
    .onConflictDoNothing();

  await db
    .insert(leads)
    .values([
      {
        id: LEAD_WITH_CONV_ID,
        organizationId: ORG_ID,
        cityId: null,
        phoneE164: '+5569' + RUN_SUFFIX.slice(0, 9),
        phoneNormalized: '5569' + RUN_SUFFIX.slice(0, 9),
        name: 'IH IntLead ComConversa',
        source: 'manual',
        status: 'new',
      },
      {
        id: LEAD_NO_CONV_ID,
        organizationId: ORG_ID,
        cityId: null,
        phoneE164: '+5569' + RUN_SUFFIX.slice(1, 10),
        phoneNormalized: '5569' + RUN_SUFFIX.slice(1, 10),
        name: 'IH IntLead SemConversa',
        source: 'manual',
        status: 'new',
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(conversations)
    .values({
      id: CONV_ID,
      organizationId: ORG_ID,
      cityId: null,
      channelId: CHANNEL_ID,
      contactRemoteId: '5569' + RUN_SUFFIX + '9',
      contactName: 'IH IntContato',
      leadId: LEAD_WITH_CONV_ID,
      status: 'open',
    })
    .onConflictDoNothing();
}, 30_000);

afterAll(async () => {
  if (!dbAvailable) return;
  try {
    await db.delete(eventOutbox).where(eq(eventOutbox.organizationId, ORG_ID));
    await db.delete(conversations).where(eq(conversations.id, CONV_ID));
    await db.delete(leads).where(inArray(leads.id, [LEAD_WITH_CONV_ID, LEAD_NO_CONV_ID]));
    await db.delete(channels).where(eq(channels.id, CHANNEL_ID));
    await db.delete(organizations).where(eq(organizations.id, ORG_ID));
  } finally {
    await pool.end();
  }
});

describe.runIf(dbAvailable)(
  '[INTEGRATION] internal/handoffs requestHandoff — ref de agregado do outbox (F26-S02)',
  () => {
    it(
      'lead COM conversation nativa vinculada -> outbox aponta para a conversa ' +
        '(aggregateType=conversation, aggregateId=conversations.id)',
      async () => {
        await requestHandoff(
          db,
          {
            leadId: LEAD_WITH_CONV_ID,
            conversationId: 9001,
            reason: 'cliente_solicitou_atendente',
            summary: 'Cliente pediu atendente humano.',
            organizationId: ORG_ID,
            simulationId: null,
          },
          'ih-idem-with-conv-' + RUN_SUFFIX,
          noopLogger,
        );

        const [row] = await db
          .select({
            aggregateType: eventOutbox.aggregateType,
            aggregateId: eventOutbox.aggregateId,
          })
          .from(eventOutbox)
          .where(
            and(
              eq(eventOutbox.organizationId, ORG_ID),
              eq(eventOutbox.eventName, 'chatwoot.handoff_requested'),
              eq(eventOutbox.aggregateId, CONV_ID),
            ),
          );

        expect(row).toBeDefined();
        expect(row?.aggregateType).toBe('conversation');
        expect(row?.aggregateId).toBe(CONV_ID);
      },
    );

    it(
      'lead SEM conversation nativa vinculada -> mantém fallback ' +
        '(aggregateType=lead, aggregateId=leadId)',
      async () => {
        await requestHandoff(
          db,
          {
            leadId: LEAD_NO_CONV_ID,
            conversationId: 9002,
            reason: 'ai_unavailable',
            summary: 'Falha tecnica da IA.',
            organizationId: ORG_ID,
            simulationId: null,
          },
          'ih-idem-no-conv-' + RUN_SUFFIX,
          noopLogger,
        );

        const [row] = await db
          .select({
            aggregateType: eventOutbox.aggregateType,
            aggregateId: eventOutbox.aggregateId,
          })
          .from(eventOutbox)
          .where(
            and(
              eq(eventOutbox.organizationId, ORG_ID),
              eq(eventOutbox.eventName, 'chatwoot.handoff_requested'),
              eq(eventOutbox.aggregateId, LEAD_NO_CONV_ID),
            ),
          );

        expect(row).toBeDefined();
        expect(row?.aggregateType).toBe('lead');
        expect(row?.aggregateId).toBe(LEAD_NO_CONV_ID);
      },
    );
  },
);
