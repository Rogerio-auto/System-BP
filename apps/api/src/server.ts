// =============================================================================
// Bootstrap do servidor Fastify. Mantenha este arquivo enxuto:
// configuracao de plugins e startup. Logica vai em src/app.ts e modules/*.
// =============================================================================
import { buildApp } from './app.js';
import { env } from './config/env.js';
import { startSocketRelay } from './workers/livechat-socket-relay.js';

const start = async (): Promise<void> => {
  const app = await buildApp();

  try {
    await app.listen({ host: env.API_HOST, port: env.API_PORT });
  } catch (err) {
    app.log.fatal(err, 'Falha ao iniciar servidor');
    process.exit(1);
  }

  // Relay RabbitMQ -> Socket.io (F16-S25).
  // Iniciado apos app.listen() para garantir que:
  //   1. app.io esta decorado (socketPlugin inicializado em buildApp).
  //   2. Nao abre conexao RabbitMQ em testes que usam buildApp() sem listen().
  // Guard fail-fast: se app.io for undefined, o relay emitiria para `undefined.of(...)`
  // e todo evento de socket falharia silenciosamente. Melhor abortar com erro claro.
  if (app.io === undefined) {
    app.log.fatal('app.io indefinido apos buildApp — socket.io nao inicializou; abortando');
    process.exit(1);
  }
  const stopRelay = await startSocketRelay(app.io);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Recebido sinal, encerrando...');
    // Parar o relay antes de fechar o app: drena acks pendentes e fecha o canal AMQP.
    await stopRelay();
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
};

void start();
