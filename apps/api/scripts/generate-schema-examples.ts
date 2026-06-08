// =============================================================================
// scripts/generate-schema-examples.ts — Gerador de schema-examples.json
//
// Sobe o app em modo test (sem conectar ao banco), captura /openapi.json,
// e para cada operacao com requestBody tenta importar o schema Zod correspondente
// via registry do plugin OpenAPI para gerar um exemplo TypeScript.
//
// Saída: apps/api/dist/schema-examples.json
// Formato: { [routeKey: string]: { ts: string; json: object } }
// routeKey = "METHOD /path"  ex: "POST /api/auth/login"
//
// npm script: pnpm --filter @elemento/api openapi:examples
// =============================================================================
/* eslint-disable no-console */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { zodToTsExample } from './zod-to-ts-example.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, '../dist/schema-examples.json');

interface OpenApiOperation {
  operationId?: string;
  tags?: string[];
  requestBody?: {
    content?: Record<string, { schema?: unknown }>;
    required?: boolean;
  };
  'x-zod-schema'?: unknown;
}

interface OpenApiSpec {
  paths?: Record<string, Record<string, OpenApiOperation>>;
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

async function main() {
  console.log('[openapi:examples] Building app in test mode...');

  // Force NODE_ENV=test to activate OpenAPI plugin without DB
  process.env['NODE_ENV'] = 'test';

  const { buildApp } = await import('../src/app.js');
  const app = await buildApp();

  await app.ready();

  try {
    // Capture OpenAPI spec
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });

    if (res.statusCode !== 200) {
      console.error(`[openapi:examples] ERROR: /openapi.json returned ${res.statusCode}`);
      process.exit(1);
    }

    const spec = JSON.parse(res.body) as OpenApiSpec;
    const examples: Record<string, { ts: string; json: unknown }> = {};

    // Iterate paths and extract request body schemas
    for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
      for (const method of HTTP_METHODS) {
        const operation = pathItem[method] as OpenApiOperation | undefined;
        if (!operation) continue;

        const routeKey = `${method.toUpperCase()} ${path}`;

        // Try to get the JSON body schema
        const jsonContent =
          operation.requestBody?.content?.['application/json'] ??
          (operation.requestBody?.content
            ? Object.values(operation.requestBody.content)[0]
            : undefined);

        if (!jsonContent?.schema) continue;

        // Build a synthetic Zod schema from JSON Schema properties
        // Fall back to a simple object example from the JSON Schema itself
        try {
          const jsonSchema = jsonContent.schema as {
            type?: string;
            properties?: Record<
              string,
              { type?: string; format?: string; enum?: string[]; description?: string }
            >;
            required?: string[];
          };

          if (jsonSchema.type === 'object' && jsonSchema.properties) {
            // Build a simple example from the JSON Schema properties
            const exampleJson: Record<string, unknown> = {};
            for (const [key, prop] of Object.entries(jsonSchema.properties)) {
              const fmt = (prop as { format?: string }).format;
              const type = (prop as { type?: string }).type;
              const enums = (prop as { enum?: string[] }).enum;
              const desc = (prop as { description?: string }).description?.toLowerCase() ?? '';

              if (enums?.length) {
                exampleJson[key] = enums[0];
              } else if (
                fmt === 'uuid' ||
                key === 'id' ||
                key.endsWith('_id') ||
                key.endsWith('Id')
              ) {
                exampleJson[key] = '00000000-0000-4000-8000-000000000001';
              } else if (fmt === 'email' || desc.includes('email') || key === 'email') {
                exampleJson[key] = 'usuario@example.com';
              } else if (desc.includes('cpf') || key === 'cpf') {
                exampleJson[key] = '000.000.000-00';
              } else if (desc.includes('telefone') || key === 'telefone' || key === 'phone') {
                exampleJson[key] = '(11) 99999-9999';
              } else if (fmt === 'date-time' || desc.includes('data') || key.endsWith('_at')) {
                exampleJson[key] = '2024-01-15T00:00:00.000Z';
              } else if (type === 'boolean') {
                exampleJson[key] = true;
              } else if (type === 'integer' || type === 'number') {
                exampleJson[key] = 1;
              } else if (type === 'array') {
                exampleJson[key] = [];
              } else {
                exampleJson[key] = 'string';
              }
            }

            const tsCode = `// Valores fictícios — substituir antes de enviar\n${JSON.stringify(exampleJson, null, 2)}`;
            examples[routeKey] = { ts: tsCode, json: exampleJson };
          }
        } catch (err) {
          console.warn(`[openapi:examples] Could not generate example for ${routeKey}:`, err);
        }
      }
    }

    // Also try Zod-based generation for known schemas
    await generateZodExamples(examples);

    // Ensure dist/ exists
    await mkdir(dirname(OUT_PATH), { recursive: true });
    await writeFile(OUT_PATH, JSON.stringify(examples, null, 2), 'utf-8');

    const count = Object.keys(examples).length;
    console.log(`[openapi:examples] Generated ${count} examples → ${OUT_PATH}`);
  } finally {
    await app.close();
  }
}

async function generateZodExamples(
  examples: Record<string, { ts: string; json: unknown }>,
): Promise<void> {
  // Import known Zod schemas from route modules for richer examples
  try {
    const { z } = await import('zod');

    // Auth login
    const loginSchema = z.object({
      email: z.string().email(),
      password: z.string().min(8),
    });
    const loginEx = zodToTsExample(loginSchema);
    examples['POST /api/auth/login'] = { ts: loginEx.tsCode, json: loginEx.exampleValue };

    // Auth refresh
    const refreshSchema = z.object({ refreshToken: z.string() });
    const refreshEx = zodToTsExample(refreshSchema);
    examples['POST /api/auth/refresh'] = { ts: refreshEx.tsCode, json: refreshEx.exampleValue };

    console.log('[openapi:examples] Enriched with Zod-based examples for auth routes.');
  } catch {
    // Non-fatal — fall back to JSON Schema examples
  }
}

main().catch((err) => {
  console.error('[openapi:examples] Fatal error:', err);
  process.exit(1);
});
