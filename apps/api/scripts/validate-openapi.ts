// =============================================================================
// scripts/validate-openapi.ts — Valida o spec OpenAPI gerado pelo backend.
//
// Sobe a app em modo teste, captura GET /openapi.json e valida com
// @apidevtools/swagger-parser. Falha com exit code 1 se houver erros.
//
// Executar via: pnpm --filter @elemento/api openapi:validate
//
// Pré-condições:
//   - NODE_ENV=test (default em pnpm scripts sem .env.production)
//   - OPENAPI_PUBLIC_ENABLED=true OU NODE_ENV !== 'production'
//   - Variáveis obrigatórias configuradas no .env (DATABASE_URL, JWT_ACCESS_SECRET, etc.)
// =============================================================================
/* eslint-disable no-console */
import SwaggerParser from '@apidevtools/swagger-parser';

// Forçar NODE_ENV=test para ativar o plugin OpenAPI sem OPENAPI_PUBLIC_ENABLED
process.env['NODE_ENV'] = 'test';

async function main() {
  console.log('Building app...');

  // Importar buildApp dinamicamente para respeitar o process.env acima
  const { buildApp } = await import('../src/app.js');
  const app = await buildApp();

  try {
    await app.ready();

    // Capturar o spec via inject (sem abrir porta)
    const response = await app.inject({
      method: 'GET',
      url: '/openapi.json',
    });

    if (response.statusCode !== 200) {
      console.error(`ERROR: /openapi.json retornou ${response.statusCode}`);
      console.error(response.body);
      process.exit(1);
    }

    const spec = JSON.parse(response.body) as object;
    console.log('Spec captured. Validating with swagger-parser...');

    // Validar o spec OpenAPI 3.1
    // @ts-expect-error — swagger-parser types não são completamente precisos para OpenAPI 3.1
    await SwaggerParser.validate(spec as Parameters<typeof SwaggerParser.validate>[0]);

    console.log('✓ OpenAPI spec is valid!');

    // Verificações adicionais de segurança
    const specStr = response.body;

    // (a) Spec deve conter /auth/login
    if (!specStr.includes('/api/auth/login') && !specStr.includes('auth/login')) {
      console.error('ERROR: Spec does not include /api/auth/login');
      process.exit(1);
    }

    // (b) Spec NÃO deve conter rotas /internal/*
    if (specStr.includes('/internal/')) {
      console.error('ERROR: Spec contains /internal/* routes — these must be hidden!');
      process.exit(1);
    }

    console.log('✓ Security checks passed:');
    console.log('  - /api/auth/login present in spec');
    console.log('  - /internal/* routes not present in spec');

    process.exit(0);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('Validation failed:', err);
  process.exit(1);
});
