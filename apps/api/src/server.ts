// =============================================================================
// Bootstrap do servidor Fastify. Mantenha este arquivo enxuto:
// configuração de plugins e startup. Lógica vai em src/app.ts e modules/*.
// =============================================================================
import { buildApp } from './app.js';
import { env } from './config/env.js';

const start = async (): Promise<void> => {
  const app = await buildApp();

  try {
    await app.listen({ host: env.API_HOST, port: env.API_PORT });
  } catch (err) {
    app.log.fatal(err, 'Falha ao iniciar servidor');
    process.exit(1);
  }

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Recebido sinal, encerrando...');
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
};

void start();
