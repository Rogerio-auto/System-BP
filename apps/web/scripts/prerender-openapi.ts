// =============================================================================
// apps/web/scripts/prerender-openapi.ts — Pre-render OpenAPI spec
//
// Em CI/build, sobe a API em modo test (NODE_ENV=test), captura /openapi.json
// e escreve em apps/web/public/api-reference.json para servir em prod
// sem depender de runtime da API.
//
// npm script: pnpm --filter @elemento/web docs:openapi
//
// Requisito: apps/api deve estar construido ou rodando via tsx.
// Em CI: roda antes do web:build (job docs-prebuild).
//
// NAO requer Postgres — app em modo test nao conecta ao banco.
// =============================================================================
/* eslint-disable no-console */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Output: apps/web/public/api-reference.json
const OUT_PATH = resolve(__dirname, '../public/api-reference.json');

async function main() {
  console.log('[docs:openapi] Building API app in test mode...');

  // Force test mode
  process.env['NODE_ENV'] = 'test';

  // Dynamic import of the API app — path relative to this script
  // Script runs from apps/web/scripts/, API is at apps/api/
  const apiAppPath = resolve(__dirname, '../../api/src/app.js');

  let buildApp: () => Promise<unknown>;

  try {
    const mod = (await import(/* @vite-ignore */ `file://${apiAppPath}`)) as {
      buildApp: () => Promise<unknown>;
    };
    buildApp = mod.buildApp;
  } catch {
    // Try tsx-friendly path
    try {
      const mod = (await import(
        /* @vite-ignore */ `file://${resolve(__dirname, '../../api/dist/app.js')}`
      )) as { buildApp: () => Promise<unknown> };
      buildApp = mod.buildApp;
    } catch (err2) {
      console.error('[docs:openapi] Could not import API app:', err2);
      console.error('[docs:openapi] Make sure to run from monorepo root with pnpm tsx support.');
      process.exit(1);
    }
  }

  const app = await buildApp();

  // Type the app minimally to use inject
  const fastifyApp = app as {
    ready: () => Promise<void>;
    inject: (opts: {
      method: string;
      url: string;
    }) => Promise<{ statusCode: number; body: string }>;
    close: () => Promise<void>;
  };

  await fastifyApp.ready();

  try {
    const res = await fastifyApp.inject({ method: 'GET', url: '/openapi.json' });

    if (res.statusCode !== 200) {
      console.error(`[docs:openapi] ERROR: /openapi.json returned ${res.statusCode}`);
      process.exit(1);
    }

    const spec = JSON.parse(res.body) as unknown;

    // Ensure public/ exists
    await mkdir(dirname(OUT_PATH), { recursive: true });
    await writeFile(OUT_PATH, JSON.stringify(spec, null, 2), 'utf-8');

    console.log(`[docs:openapi] Written -> ${OUT_PATH}`);
    console.log('[docs:openapi] Done.');
  } finally {
    await fastifyApp.close();
  }
}

main().catch((err) => {
  console.error('[docs:openapi] Fatal error:', err);
  process.exit(1);
});
