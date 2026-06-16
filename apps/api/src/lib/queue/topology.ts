// =============================================================================
// queue/topology.ts - Topologia de filas RabbitMQ do live chat (F16-S01).
// Portado de tagix packages/shared/src/mq/topology.ts, adaptado para o
// Elemento (exchanges e filas especificos do dominio de mensagem).
// assertTopology() e idempotente: pode ser chamado multiplas vezes com seguranca.
// =============================================================================
import type { Channel } from 'amqplib';

/** Exchange principal de eventos de canal (topic, durable). */
export const EXCHANGE_CHANNELS = 'hm.channels' as const;

/** Dead-letter exchange (DLX) para mensagens nao processadas. */
export const EXCHANGE_DLX = 'hm.dlx' as const;

/** Filas do dominio live chat. */
export const QUEUES = {
  /** Mensagens recebidas dos canais (inbound). */
  inboundMessage: 'hm.q.inbound.message',
  /** Midia recebida dos canais (inbound) — processada pelo media worker. */
  inboundMedia: 'hm.q.inbound.media',
  /** Jobs de envio de mensagem para os canais (outbound). */
  outboundRequest: 'hm.q.outbound.request',
  /** Relay de eventos para o socket (Socket.io relay worker). */
  socketRelay: 'hm.q.socket.relay',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/**
 * Declara exchanges, filas e bindings no canal RabbitMQ (idempotente).
 *
 * - Exchange principal: topic durable (hm.channels).
 * - DLX: topic durable (hm.dlx) para mensagens mortas.
 * - Cada fila: durable com deadLetterExchange apontando para o DLX.
 * - Binding: routing key = <nome-da-fila>.# (recebe qualquer subtopico).
 *
 * Chamada no bootstrap da API e antes de consumir/publicar nos workers.
 */
export async function assertTopology(channel: Channel): Promise<void> {
  // Exchange principal de entrada/saida
  await channel.assertExchange(EXCHANGE_CHANNELS, 'topic', { durable: true });
  // Dead-letter exchange para mensagens sem consumidor ou rejeitadas
  await channel.assertExchange(EXCHANGE_DLX, 'topic', { durable: true });

  for (const queue of Object.values(QUEUES)) {
    await channel.assertQueue(queue, {
      durable: true,
      deadLetterExchange: EXCHANGE_DLX,
    });
    // Binding: routing key padrao = <queue-name>.# (subtopicos permitidos)
    await channel.bindQueue(queue, EXCHANGE_CHANNELS, `${queue}.#`);
  }
}
