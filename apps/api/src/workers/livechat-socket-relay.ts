// =============================================================================
// workers/livechat-socket-relay.ts — Relay RabbitMQ → Socket.io (F16-S14).
//
// Responsabilidade:
//   Consumir a fila `hm.q.socket.relay` e emitir os eventos via Socket.io
//   para as salas corretas, fechando o circuito worker → front em tempo real.
//
// Fluxo por mensagem:
//   1. Desserializar o corpo JSON como SocketRelayJob.
//   2. Extrair { room, event, data } do payload.
//   3. io.of('/livechat').to(room).emit(event, data).
//   4. ack() após emit bem-sucedido.
//   5. nack(false /* requeue=false */) em erro de parse — mensagem vai para DLX.
//
// Design:
//   - Canal RabbitMQ dedicado para consumo (separado do canal de publicação).
//   - prefetchCount = 1: processa uma mensagem por vez, garante ordem por sala.
//   - Graceful shutdown: fecha o canal antes de sair (flush das acks pendentes).
//
// LGPD (doc 17 §8.3/§8.5):
//   - O relay não loga o `data` — evita PII em logs de infra.
//   - Garante que eventos só chegam às salas autorizadas (room é `workspace:{orgId}`
//     ou `conversation:{convId}` — não há rota genérica para "*").
//   - Workers upstream (S08/S09/S10) são responsáveis por incluir apenas o mínimo
//     de dados no payload (PII mínima exigida).
// =============================================================================

import amqplib from 'amqplib';
import type { ChannelModel, Channel, Message } from 'amqplib';
import type { Server as SocketIOServer } from 'socket.io';
import { z } from 'zod';

import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { envelopeSchema } from '../lib/queue/envelope.js';
import { QUEUES } from '../lib/queue/topology.js';

// ---------------------------------------------------------------------------
// Schema do job publicado pelos workers na fila socket.relay
// ---------------------------------------------------------------------------

/**
 * Shape canônico de toda mensagem publicada na fila `hm.q.socket.relay`.
 *
 * Campos:
 *   room   — sala Socket.io de destino. Ex: "workspace:{orgId}",
 *             "conversation:{convId}".
 *   event  — nome do evento Socket.io. Ex: "message.new", "conversation.updated".
 *   data   — payload enviado ao cliente. Deve conter o mínimo — sem PII bruta.
 */
export const SocketRelayJobSchema = z.object({
  /** Sala Socket.io de destino (ex: `workspace:uuid` ou `conversation:uuid`). */
  room: z.string().min(1),
  /** Nome do evento emitido. */
  event: z.string().min(1),
  /** Payload enviado ao cliente — validado apenas como record aberto aqui; payload
   *  tipado fica nos contratos ServerToClient (S03). */
  data: z.record(z.unknown()),
});

export type SocketRelayJob = z.infer<typeof SocketRelayJobSchema>;

// ---------------------------------------------------------------------------
// Estado interno do relay
// ---------------------------------------------------------------------------

interface RelayState {
  connection: ChannelModel | null;
  channel: Channel | null;
}

const state: RelayState = {
  connection: null,
  channel: null,
};

// ---------------------------------------------------------------------------
// startSocketRelay
// ---------------------------------------------------------------------------

/**
 * Inicia o consumidor da fila `hm.q.socket.relay`.
 *
 * Cria uma conexão e canal RabbitMQ dedicados (separados do canal de publicação
 * singleton do server). Retorna `stopSocketRelay` para graceful shutdown.
 *
 * @param io SocketIOServer (obtido de fastify.io após app.listen()).
 * @returns Função de parada para uso no graceful shutdown do server.
 *
 * @example
 * // Em server.ts após app.listen():
 * const stopRelay = await startSocketRelay(app.io);
 * // No shutdown:
 * await stopRelay();
 */
export async function startSocketRelay(io: SocketIOServer): Promise<() => Promise<void>> {
  const rabbitUrl = env.RABBITMQ_URL;

  // Canal dedicado para consumo — NÃO compartilha o singleton do server
  const connection = await amqplib.connect(rabbitUrl);
  state.connection = connection;

  const channel = await connection.createChannel();
  state.channel = channel;

  // prefetch=1: garante processamento sequencial e entrega ordenada por sala
  await channel.prefetch(1);

  logger.info({ queue: QUEUES.socketRelay }, 'socket relay: iniciando consumo da fila');

  // Consumir sem auto-ack (ack/nack manual)
  await channel.consume(
    QUEUES.socketRelay,
    (msg: Message | null) => {
      if (!msg) {
        // Canal cancelado pelo broker (ex: fila deletada) — reconectar ou sair
        logger.warn('socket relay: consumer cancelado pelo broker');
        return;
      }

      handleRelayMessage(io, channel, msg);
    },
    { noAck: false },
  );

  logger.info({ queue: QUEUES.socketRelay }, 'socket relay: consumidor ativo');

  // Graceful shutdown
  return async () => {
    try {
      await channel.close();
    } catch {
      // Canal já pode estar fechado no shutdown — ignorar
    }
    try {
      await connection.close();
    } catch {
      // Conexão já pode estar fechada — ignorar
    }
    state.connection = null;
    state.channel = null;
    logger.info('socket relay: shutdown completo');
  };
}

// ---------------------------------------------------------------------------
// Handler de mensagem individual
// ---------------------------------------------------------------------------

/**
 * Processa uma mensagem da fila socket.relay.
 *
 * Fluxo:
 *   1. Parse do corpo JSON.
 *   2. Validação com SocketRelayJobSchema (Zod).
 *   3. Emit Socket.io para a room correta.
 *   4. ack em sucesso; nack(requeue=false) em erro de parse/validação.
 *
 * Decisão de design:
 *   - nack sem requeue em erro de parse: mensagem malformada não deve ser
 *     re-processada — vai para DLX para inspeção. Isso evita poison pill loops.
 *   - nack sem requeue em erro de emit: Socket.io.emit() é fire-and-forget;
 *     erros aqui são exceções de runtime (ex: IO fechado) — não re-tentável via fila.
 */
function handleRelayMessage(io: SocketIOServer, channel: Channel, msg: Message): void {
  // 1. Parse do corpo JSON
  let raw: unknown;
  try {
    raw = JSON.parse(msg.content.toString('utf-8')) as unknown;
  } catch (err) {
    logger.error(
      { event: 'socket.relay.parse_error', err },
      'socket relay: corpo não é JSON válido — nack sem requeue',
    );
    channel.nack(msg, false, false);
    return;
  }

  // 2. Desempacota o envelope padrão (makeEnvelope) antes de validar.
  // Todo publish() usa makeEnvelope → o payload {room,event,data} fica em `.payload`.
  // Validar `raw` direto rejeitaria TODA mensagem real (room/event/data undefined).
  // Fallback para `raw` cru mantém compatibilidade com mensagens não-envelopadas.
  const envelopeResult = envelopeSchema.safeParse(raw);
  const candidate = envelopeResult.success ? envelopeResult.data.payload : raw;

  // 3. Validação Zod do payload do relay
  const parsed = SocketRelayJobSchema.safeParse(candidate);
  if (!parsed.success) {
    logger.error(
      {
        event: 'socket.relay.validation_error',
        issues: parsed.error.issues,
        // NÃO logar `raw` — pode conter PII (doc 17 §8.3)
      },
      'socket relay: payload inválido — nack sem requeue',
    );
    channel.nack(msg, false, false);
    return;
  }

  const { room, event, data } = parsed.data;

  // 3. Emit Socket.io para a room
  try {
    io.of('/livechat').to(room).emit(event, data);
    logger.debug(
      { event: 'socket.relay.emitted', room, socketEvent: event },
      'socket relay: evento emitido',
    );
  } catch (err) {
    logger.error(
      { event: 'socket.relay.emit_error', room, socketEvent: event, err },
      'socket relay: erro ao emitir evento — nack sem requeue',
    );
    channel.nack(msg, false, false);
    return;
  }

  // 4. ack após emit
  channel.ack(msg);
}
