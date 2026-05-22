// =============================================================================
// test/e2e/whatsapp-lead-to-simulation.e2e.test.ts
//
// @e2e — cenário 1: golden path WhatsApp → lead → simulação → resposta.
//
// Estratégia:
//   - Stack sobe via docker-compose.ci.yml ANTES de `pnpm e2e` ser chamado.
//   - Este arquivo faz chamadas HTTP reais ao endpoint do container API.
//   - O LangGraph no CI roda com E2E_MOCK_MODE=true → responde com dados
//     sintéticos sem chamar LLM externo.
//
// Asserções principais:
//   1. POST /api/whatsapp/webhook retorna 200 com { ok: true, processed: 1 }.
//   2. 1 whatsapp_message é inserida com direction='inbound'.
//   3. 1 outbox_event 'whatsapp.message_received' é emitido.
//
// Nota sobre profundidade de asserção:
//   O fluxo completo (lead → simulação → resposta) depende do worker outbox
//   processar em background. Em E2E smoke test, validamos que o webhook foi
//   aceito + persisted. Validação fim-a-fim do pipeline IA fica para testes
//   de integração dedicados (F8).
//
// LGPD: logs do teste não incluem telefone, nome ou texto da mensagem.
// =============================================================================
import { createHmac } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '../../src/db/client.js';
import { eventOutbox } from '../../src/db/schema/events.js';
import { whatsappMessages } from '../../src/db/schema/whatsappMessages.js';

import {
  cleanE2eData,
  closeDb,
  E2E_API_URL,
  E2E_ORG_ID,
  E2E_WHATSAPP_APP_SECRET,
  seedE2eMinimal,
} from './seed.js';

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

/** ID sintético único para o teste — prefixo wamid.e2e. para limpeza seletiva. */
const WA_MSG_ID = `wamid.e2e.golden.${Date.now()}`;

/** Gera assinatura HMAC-SHA256 válida para body dado o app_secret de CI. */
function signBody(body: string, secret = E2E_WHATSAPP_APP_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

/** Payload sintético de webhook WhatsApp (Cloud API Meta). */
function buildWaWebhookPayload(msgId: string): object {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'e2e-waba-id',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '+5569900000000',
                phone_number_id: 'e2e-phone-number-id',
              },
              messages: [
                {
                  id: msgId,
                  from: '5569900000001',
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: {
                    // Mensagem genérica — sem PII real no teste
                    body: 'Quero simular credito de 5000 em 12 meses',
                  },
                },
              ],
            },
            field: 'messages',
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await seedE2eMinimal();
  // Limpar dados E2E antigos para garantir estado limpo
  await cleanE2eData();
}, 30_000);

afterAll(async () => {
  await cleanE2eData();
  await closeDb();
}, 15_000);

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('WhatsApp → lead → simulação (golden path) @e2e', () => {
  it('POST /api/whatsapp/webhook aceita payload válido e retorna 200', async () => {
    const payload = buildWaWebhookPayload(WA_MSG_ID);
    const body = JSON.stringify(payload);

    const response = await fetch(`${E2E_API_URL}/api/whatsapp/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': signBody(body),
      },
      body,
    });

    expect(response.status).toBe(200);

    const json = (await response.json()) as { ok: boolean; processed: number; skipped: number };
    expect(json.ok).toBe(true);
    expect(json.processed).toBe(1);
    expect(json.skipped).toBe(0);
  });

  it('persiste 1 whatsapp_message com direction=inbound e wa_message_id correto', async () => {
    const rows = await db
      .select({
        id: whatsappMessages.id,
        waMessageId: whatsappMessages.waMessageId,
        direction: whatsappMessages.direction,
        organizationId: whatsappMessages.organizationId,
      })
      .from(whatsappMessages)
      .where(eq(whatsappMessages.waMessageId, WA_MSG_ID))
      .limit(1);

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toBeDefined();
    expect(row!.direction).toBe('inbound');
    expect(row!.organizationId).toBe(E2E_ORG_ID);
  });

  it('emite 1 outbox_event whatsapp.message_received sem PII no payload', async () => {
    // O evento deve ter sido emitido na mesma transação do insert da mensagem
    const events = await db
      .select({
        id: eventOutbox.id,
        eventName: eventOutbox.eventName,
        aggregateType: eventOutbox.aggregateType,
        payload: eventOutbox.payload,
        organizationId: eventOutbox.organizationId,
      })
      .from(eventOutbox)
      .where(
        sql`${eventOutbox.organizationId} = ${E2E_ORG_ID}
          AND ${eventOutbox.eventName} = 'whatsapp.message_received'
          AND ${eventOutbox.createdAt} > NOW() - INTERVAL '5 minutes'`,
      )
      .limit(5);

    expect(events.length).toBeGreaterThanOrEqual(1);

    // LGPD §8.5: payload do outbox NÃO deve conter PII bruta (from, text.body)
    const event = events[0];
    expect(event).toBeDefined();
    expect(event!.aggregateType).toBe('whatsapp_message');

    const payloadKeys = Object.keys(event!.payload as Record<string, unknown>);
    // payload deve ter apenas IDs — não campos com PII
    expect(payloadKeys).not.toContain('from');
    expect(payloadKeys).not.toContain('text');
    expect(payloadKeys).not.toContain('phone');
    expect(payloadKeys).not.toContain('body');
  });

  it('idempotência: segundo POST com mesmo wa_message_id retorna skipped=1', async () => {
    const payload = buildWaWebhookPayload(WA_MSG_ID);
    const body = JSON.stringify(payload);

    const response = await fetch(`${E2E_API_URL}/api/whatsapp/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': signBody(body),
      },
      body,
    });

    expect(response.status).toBe(200);
    const json = (await response.json()) as { ok: boolean; processed: number; skipped: number };
    expect(json.ok).toBe(true);
    expect(json.processed).toBe(0);
    expect(json.skipped).toBe(1);
  });

  it('rejeita webhook com HMAC inválido — 401', async () => {
    const payload = buildWaWebhookPayload(`wamid.e2e.bad.hmac.${Date.now()}`);
    const body = JSON.stringify(payload);

    const response = await fetch(`${E2E_API_URL}/api/whatsapp/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256':
          'sha256=000000000000000000000000000000000000000000000000000000000000dead',
      },
      body,
    });

    expect(response.status).toBe(401);
  });

  it('endpoint de health responde 200', async () => {
    const response = await fetch(`${E2E_API_URL}/health`);
    expect(response.status).toBe(200);
  });
});
