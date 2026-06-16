// queue/index.ts - Re-exports do modulo de filas RabbitMQ (F16-S01).
export { connectRabbitMQ, closeRabbitMQ, getRabbitChannel, publish } from './client.js';
export { assertTopology, EXCHANGE_CHANNELS, EXCHANGE_DLX, QUEUES } from './topology.js';
export { envelopeSchema, makeEnvelope } from './envelope.js';
export type { Envelope } from './envelope.js';
export type { QueueName } from './topology.js';
