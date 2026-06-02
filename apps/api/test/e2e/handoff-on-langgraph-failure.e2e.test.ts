// =============================================================================
// test/e2e/handoff-on-langgraph-failure.e2e.test.ts
//
// @e2e — cenário 2: LangGraph indisponível → handoff fallback (F3-S34).
//
// Estratégia:
//   Este teste valida a rota interna POST /internal/handoffs diretamente,
//   simulando o que acontece quando o ai-fallback.ts chama o endpoint após
//   um timeout do LangGraph.
//
//   Em CI (docker-compose.ci.yml), o LangGraph sobe com E2E_MOCK_MODE=true,
//   mas este teste valida o caminho de FALHA usando a rota interna com payload
//   de `reason='ai_unavailable'`. Não dependemos do LangGraph falhar — simulamos
//   diretamente a chamada que o ai-fallback.ts faria.
//
// Asserções:
//   1. POST /internal/handoffs com reason='ai_unavailable' retorna 200.
//   2. 1 chatwoot_handoff é criado com reason='ai_unavailable' + status='requested'.
//   3. Idempotência: segundo POST com mesma Idempotency-Key retorna o mesmo handoff.
//
// LGPD §8.3: logs não incluem summary (campo sensível), apenas IDs opacos.
// =============================================================================
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { db } from '../../src/db/client.js';
import { chatwootHandoffs } from '../../src/db/schema/chatwootHandoffs.js';
import { leads } from '../../src/db/schema/leads.js';

import {
  cleanE2eData,
  closeDb,
  E2E_API_URL,
  E2E_INTERNAL_TOKEN,
  E2E_ORG_ID,
  seedE2eMinimal,
} from './seed.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let testLeadId: string;
const CHATWOOT_CONV_ID = '99999'; // ID sintético — conversa Chatwoot
const IDEMPOTENCY_KEY_BASE = `handoff-e2e-fallback-${Date.now()}`;

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await seedE2eMinimal();
}, 30_000);

beforeEach(async () => {
  // Criar lead mínimo para servir como FK do handoff
  const leadRows = await db
    .insert(leads)
    .values({
      organizationId: E2E_ORG_ID,
      name: 'E2E Test Lead (handoff)',
      source: 'whatsapp',
      status: 'new',
      // phone_e164 e phone_normalized necessários — usar valores sintéticos
      phoneE164: '+556900000099',
      phoneNormalized: '556900000099',
    })
    .returning({ id: leads.id });

  const row = leadRows[0];
  if (!row) throw new Error('E2E: falha ao criar lead de teste');
  testLeadId = row.id;
});

afterEach(async () => {
  // Limpar handoffs E2E criados por este teste
  await db.execute(sql`
    DELETE FROM chatwoot_handoffs
    WHERE organization_id = ${E2E_ORG_ID}
      AND reason = 'ai_unavailable'
      AND created_at > NOW() - INTERVAL '5 minutes';
  `);
  // Limpar lead criado
  if (testLeadId) {
    await db.delete(leads).where(eq(leads.id, testLeadId));
  }
});

afterAll(async () => {
  await cleanE2eData();
  await closeDb();
}, 15_000);

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('LangGraph indisponível → handoff fallback (F3-S34) @e2e', () => {
  it('POST /internal/handoffs com reason=ai_unavailable retorna 200', async () => {
    const idempotencyKey = `${IDEMPOTENCY_KEY_BASE}-happy`;

    const body = JSON.stringify({
      leadId: testLeadId,
      conversationId: parseInt(CHATWOOT_CONV_ID, 10),
      reason: 'ai_unavailable',
      summary: 'Handoff automático acionado: serviço de IA indisponível ou timeout.',
      organizationId: E2E_ORG_ID,
      simulationId: null,
    });

    const response = await fetch(`${E2E_API_URL}/internal/handoffs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': E2E_INTERNAL_TOKEN,
        'X-Correlation-Id': `e2e-corr-${Date.now()}`,
        'Idempotency-Key': idempotencyKey,
      },
      body,
    });

    expect(response.status).toBe(200);

    const json = (await response.json()) as {
      handoff_id: string;
      chatwoot_conversation_id: string;
      status: string;
    };
    expect(json.handoff_id).toBeDefined();
    expect(typeof json.handoff_id).toBe('string');
    expect(json.status).toBe('requested');
  });

  it('persiste chatwoot_handoff com reason=ai_unavailable e status=requested', async () => {
    const idempotencyKey = `${IDEMPOTENCY_KEY_BASE}-assert`;

    const body = JSON.stringify({
      leadId: testLeadId,
      conversationId: parseInt(CHATWOOT_CONV_ID, 10),
      reason: 'ai_unavailable',
      summary: 'Handoff automático acionado: serviço de IA indisponível ou timeout.',
      organizationId: E2E_ORG_ID,
      simulationId: null,
    });

    await fetch(`${E2E_API_URL}/internal/handoffs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': E2E_INTERNAL_TOKEN,
        'X-Correlation-Id': `e2e-corr-${Date.now()}`,
        'Idempotency-Key': idempotencyKey,
      },
      body,
    });

    const rows = await db
      .select({
        id: chatwootHandoffs.id,
        reason: chatwootHandoffs.reason,
        status: chatwootHandoffs.status,
        leadId: chatwootHandoffs.leadId,
        organizationId: chatwootHandoffs.organizationId,
      })
      .from(chatwootHandoffs)
      .where(
        sql`${chatwootHandoffs.organizationId} = ${E2E_ORG_ID}
          AND ${chatwootHandoffs.idempotencyKey} = ${idempotencyKey}`,
      )
      .limit(1);

    expect(rows).toHaveLength(1);
    const handoff = rows[0];
    expect(handoff).toBeDefined();
    expect(handoff!.reason).toBe('ai_unavailable');
    expect(handoff!.status).toBe('requested');
    expect(handoff!.leadId).toBe(testLeadId);
    expect(handoff!.organizationId).toBe(E2E_ORG_ID);
  });

  it('idempotência: segundo POST com mesma Idempotency-Key retorna o mesmo handoff_id', async () => {
    const idempotencyKey = `${IDEMPOTENCY_KEY_BASE}-idem`;

    const buildRequest = () =>
      fetch(`${E2E_API_URL}/internal/handoffs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': E2E_INTERNAL_TOKEN,
          'X-Correlation-Id': `e2e-corr-idem-${Date.now()}`,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          leadId: testLeadId,
          conversationId: parseInt(CHATWOOT_CONV_ID, 10),
          reason: 'ai_unavailable',
          summary: 'Handoff automático acionado: serviço de IA indisponível ou timeout.',
          organizationId: E2E_ORG_ID,
          simulationId: null,
        }),
      });

    const r1 = await buildRequest();
    const r2 = await buildRequest();

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const j1 = (await r1.json()) as { handoff_id: string };
    const j2 = (await r2.json()) as { handoff_id: string };

    // Idempotência: mesmo handoff_id
    expect(j1.handoff_id).toBe(j2.handoff_id);
  });

  it('rejeita POST /internal/handoffs sem X-Internal-Token — 401', async () => {
    const response = await fetch(`${E2E_API_URL}/internal/handoffs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `${IDEMPOTENCY_KEY_BASE}-no-token`,
      },
      body: JSON.stringify({
        leadId: testLeadId,
        conversationId: parseInt(CHATWOOT_CONV_ID, 10),
        reason: 'ai_unavailable',
        summary: 'test',
        organizationId: E2E_ORG_ID,
        simulationId: null,
      }),
    });

    expect(response.status).toBe(401);
  });

  it('rejeita POST /internal/handoffs sem Idempotency-Key — 400', async () => {
    const response = await fetch(`${E2E_API_URL}/internal/handoffs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': E2E_INTERNAL_TOKEN,
      },
      body: JSON.stringify({
        leadId: testLeadId,
        conversationId: parseInt(CHATWOOT_CONV_ID, 10),
        reason: 'ai_unavailable',
        summary: 'test',
        organizationId: E2E_ORG_ID,
        simulationId: null,
      }),
    });

    expect(response.status).toBe(400);
  });
});
