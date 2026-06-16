// =============================================================================
// queue/client.ts - Cliente RabbitMQ com reconexao automatica (F16-S01).
// Singleton: uma conexao + um canal por processo (workers criam o seu proprio).
// Portado do padrao tagix (packages/channels/src/mq/connection.ts).
//
// Reconexao: exponential backoff ate 5 tentativas. Em producao, o processo
// reinicia apos 5 falhas (via Docker restart policy).
//
// IMPORTANTE: chamar connectRabbitMQ() no bootstrap antes de qualquer publish.
// =============================================================================
import amqplib from 'amqplib';
import type { ChannelModel, ConfirmChannel } from 'amqplib';

import { env } from '../../config/env.js';
import { logger } from '../logger.js';

import { assertTopology } from './topology.js';

// ---------------------------------------------------------------------------
// Estado da conexao (processo-singleton)
// ---------------------------------------------------------------------------

let _connection: ChannelModel | null = null;
let _channel: ConfirmChannel | null = null;
let _reconnectAttempts = 0;
const MAX_RECONNECT = 5;
const RECONNECT_DELAY_BASE_MS = 1_000;

// ---------------------------------------------------------------------------
// Conexao
// ---------------------------------------------------------------------------

/** Conecta ao RabbitMQ, declara a topologia e armazena a conexao no singleton. */
export async function connectRabbitMQ(): Promise<void> {
  const url = env.RABBITMQ_URL;

  const connect = async (): Promise<void> => {
    _connection = await amqplib.connect(url);
    _channel = await _connection.createConfirmChannel();
    await assertTopology(_channel);
    _reconnectAttempts = 0;
    logger.info('RabbitMQ conectado e topologia declarada.');

    _connection.on('error', (err: Error) => {
      logger.error({ err }, 'Erro na conexao RabbitMQ');
    });

    _connection.on('close', () => {
      _channel = null;
      _connection = null;
      _reconnectAttempts++;
      if (_reconnectAttempts > MAX_RECONNECT) {
        logger.error('RabbitMQ: limite de reconexoes atingido — encerrando processo.');
        process.exit(1);
      }
      const delay = RECONNECT_DELAY_BASE_MS * 2 ** (_reconnectAttempts - 1);
      logger.warn({ attempt: _reconnectAttempts, delayMs: delay }, 'RabbitMQ reconectando...');
      setTimeout(() => void connect(), delay);
    });
  };

  await connect();
}

/** Fecha a conexao graciosamente (use no shutdown hook). */
export async function closeRabbitMQ(): Promise<void> {
  await _channel?.close();
  await _connection?.close();
  _channel = null;
  _connection = null;
}

/** Retorna o canal ativo ou lanca se nao conectado. */
export function getRabbitChannel(): ConfirmChannel {
  if (!_channel) throw new Error('RabbitMQ nao conectado. Chame connectRabbitMQ() no bootstrap.');
  return _channel;
}

// ---------------------------------------------------------------------------
// Publicacao
// ---------------------------------------------------------------------------

/**
 * Publica uma mensagem na exchange principal com a routing key especificada.
 *
 * Aguarda confirmacao do broker antes de resolver (ConfirmChannel).
 * Usa persistent: true para garantir durabilidade (mensagem sobrevive a restart do broker).
 */
export async function publish(routingKey: string, payload: unknown): Promise<void> {
  const ch = getRabbitChannel();
  const body = Buffer.from(JSON.stringify(payload));

  return new Promise<void>((resolve, reject) => {
    const sent = ch.publish(
      'hm.channels',
      routingKey,
      body,
      {
        persistent: true,
        contentType: 'application/json',
        timestamp: Math.floor(Date.now() / 1_000),
      },
      (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      },
    );

    if (!sent) {
      // Canal com backpressure — aguardar drain antes de tentar novamente
      ch.once('drain', () => {
        ch.waitForConfirms().then(resolve, reject);
      });
    }
  });
}
