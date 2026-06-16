// queue.test.ts - Testes de topologia e publicacao RabbitMQ (F16-S01).
// Usa mock do amqplib para nao precisar de broker real.
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { makeEnvelope, envelopeSchema } from '../queue/envelope.js';
import { assertTopology, EXCHANGE_CHANNELS, EXCHANGE_DLX, QUEUES } from '../queue/topology.js';

function makeMockChannel() {
  return {
    assertExchange: vi.fn().mockResolvedValue(undefined),
    assertQueue: vi.fn().mockResolvedValue(undefined),
    bindQueue: vi.fn().mockResolvedValue(undefined),
  };
}

describe('assertTopology', () => {
  let ch: ReturnType<typeof makeMockChannel>;

  beforeEach(() => {
    ch = makeMockChannel();
  });

  it('declara as 2 exchanges', async () => {
    await assertTopology(ch as never);
    expect(ch.assertExchange).toHaveBeenCalledTimes(2);
    expect(ch.assertExchange).toHaveBeenCalledWith(EXCHANGE_CHANNELS, 'topic', { durable: true });
    expect(ch.assertExchange).toHaveBeenCalledWith(EXCHANGE_DLX, 'topic', { durable: true });
  });

  it('declara as 4 filas com DLX', async () => {
    await assertTopology(ch as never);
    const queueNames = Object.values(QUEUES);
    expect(ch.assertQueue).toHaveBeenCalledTimes(queueNames.length);
    for (const queue of queueNames) {
      expect(ch.assertQueue).toHaveBeenCalledWith(queue, {
        durable: true,
        deadLetterExchange: EXCHANGE_DLX,
      });
    }
  });

  it('cria bindings para cada fila', async () => {
    await assertTopology(ch as never);
    const queueNames = Object.values(QUEUES);
    expect(ch.bindQueue).toHaveBeenCalledTimes(queueNames.length);
    for (const queue of queueNames) {
      expect(ch.bindQueue).toHaveBeenCalledWith(queue, EXCHANGE_CHANNELS, `${queue}.#`);
    }
  });

  it('e idempotente (pode chamar 2x sem erro)', async () => {
    await expect(assertTopology(ch as never)).resolves.toBeUndefined();
    await expect(assertTopology(ch as never)).resolves.toBeUndefined();
    expect(ch.assertExchange).toHaveBeenCalledTimes(4);
  });
});

describe('makeEnvelope', () => {
  it('cria envelope com campos obrigatorios', () => {
    const orgId = '00000000-0000-0000-0000-000000000001';
    const env = makeEnvelope('hm.q.inbound.message', orgId, { foo: 1 });
    expect(env.organizationId).toBe(orgId);
    expect(env.type).toBe('hm.q.inbound.message');
    expect(typeof env.id).toBe('string');
    expect(env.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof env.ts).toBe('number');
  });

  it('envelope valida com envelopeSchema', () => {
    const orgId = '00000000-0000-0000-0000-000000000001';
    const env = makeEnvelope('hm.q.outbound.request', orgId, null);
    expect(() => envelopeSchema.parse(env)).not.toThrow();
  });

  it('rejeita envelope sem organizationId (UUID invalido)', () => {
    const env = makeEnvelope('test', 'not-a-uuid', {});
    expect(() => envelopeSchema.parse(env)).toThrow();
  });
});

describe('QUEUES constants', () => {
  it('tem as 4 filas esperadas', () => {
    expect(QUEUES.inboundMessage).toBe('hm.q.inbound.message');
    expect(QUEUES.inboundMedia).toBe('hm.q.inbound.media');
    expect(QUEUES.outboundRequest).toBe('hm.q.outbound.request');
    expect(QUEUES.socketRelay).toBe('hm.q.socket.relay');
  });
});
