// =============================================================================
// modules/dev/routes.ts - Dev-only endpoints.
//
// Registrado em app.ts SOMENTE quando NODE_ENV !== 'production'.
// Prefixo __dev/ torna evidente que e nao-prod.
//
// GET /__dev/schema-examples - serve apps/api/dist/schema-examples.json
//   Consumido pelo frontend ApiReferencePage (tab TypeScript).
//   Em producao: rota nao existe -> 404.
// =============================================================================
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FastifyPluginAsync } from 'fastify';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve path to schema-examples.json.
// In dev (tsx): __dirname is src/modules/dev -> go up 3 to apps/api, then dist/
// In built (tsc): __dirname is dist/modules/dev -> go up 2 to apps/api/dist/
function resolveSchemaExamplesPath(): string {
  // path.sep-independent check: file URL always uses forward slashes
  const fileUrl = import.meta.url;
  if (fileUrl.includes('/src/')) {
    return resolve(__dirname, '../../..', 'dist', 'schema-examples.json');
  }
  return resolve(__dirname, '../..', 'schema-examples.json');
}

export const devRoutes: FastifyPluginAsync = async (app) => {
  // Sanity check - nao deve ser registrado em producao
  if (process.env['NODE_ENV'] === 'production') {
    app.log.warn('devRoutes registered in production - skipping');
    return;
  }

  app.get(
    '/__dev/schema-examples',
    {
      schema: {
        description: 'Dev-only: retorna schema-examples.json gerado por openapi:examples.',
        tags: ['Dev'],
        hide: true,
        response: {
          200: { type: 'object', additionalProperties: true },
          404: {
            type: 'object',
            properties: {
              error: { type: 'string' },
              message: { type: 'string' },
              hint: { type: 'string' },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const filePath = resolveSchemaExamplesPath();

      try {
        const raw = await readFile(filePath, 'utf-8');
        const data = JSON.parse(raw) as unknown;
        return reply.status(200).type('application/json').send(data);
      } catch {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: 'schema-examples.json not found.',
          hint: 'Run pnpm --filter @elemento/api openapi:examples to generate it.',
        });
      }
    },
  );
};
