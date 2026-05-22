// =============================================================================
// test/e2e/setup.ts — globalSetup para Vitest E2E.
//
// Executado no processo principal, antes dos workers.
// Seta env vars apontando para os containers do docker-compose.ci.yml.
//
// DIFERENTE do src/test/setup.ts (unit tests):
//   - DATABASE_URL aponta para Postgres do compose CI (porta 5433 local ou
//     localhost:5432 dentro do container).
//   - API_PUBLIC_URL aponta para o container da API no CI.
//   - LANGGRAPH_SERVICE_URL aponta para o container do LangGraph no CI.
//
// Detecção de ambiente:
//   - CI=true → usa URLs dos containers (rede interna docker ou ports expostos).
//   - LOCAL E2E → usa localhost com portas expostas pelo docker-compose.ci.yml.
// =============================================================================

export function setup(): void {
  process.env['NODE_ENV'] = 'test';
  process.env['LOG_LEVEL'] = 'error';

  // ---- Banco de dados -------------------------------------------------------
  // docker-compose.ci.yml expõe Postgres na porta 5433 (host local → container 5432).
  // Tanto em CI (GitHub Actions via docker compose up) como em dev local,
  // o acesso é via localhost:5433 (porta exposta pelo compose.ci.yml).
  process.env['DATABASE_URL'] =
    process.env['DATABASE_URL'] ??
    'postgres://elemento:elemento_ci_secret@localhost:5433/elemento_e2e';

  // ---- API URL ---------------------------------------------------------------
  process.env['E2E_API_URL'] = process.env['E2E_API_URL'] ?? 'http://localhost:3333';

  // ---- Env vars obrigatórias para importar módulos do DB --------------------
  // (importados nos arquivos de seed para acessar o Drizzle client)
  process.env['API_PUBLIC_URL'] = process.env['E2E_API_URL'] ?? 'http://localhost:3333';

  process.env['JWT_ACCESS_SECRET'] =
    'ci-access-secret-for-e2e-tests-only-rotate-this-xxxxxxxxxxxxxxxx';
  process.env['JWT_REFRESH_SECRET'] =
    'ci-refresh-secret-for-e2e-tests-only-rotate-this-xxxxxxxxxxxxxxx';
  process.env['JWT_ACCESS_TTL'] = '15m';
  process.env['JWT_REFRESH_TTL'] = '30d';
  process.env['CORS_ALLOWED_ORIGINS'] = 'http://localhost:5173';
  process.env['LANGGRAPH_INTERNAL_TOKEN'] = 'ci-internal-token-for-e2e-tests-only-32chars';
  process.env['LANGGRAPH_SERVICE_URL'] = 'http://localhost:8000';
  process.env['WHATSAPP_APP_SECRET'] = 'ci-whatsapp-app-secret-e2e-tests';
  process.env['WHATSAPP_VERIFY_TOKEN'] = 'ci-verify-token-e2e';
  process.env['CHATWOOT_WEBHOOK_HMAC_SECRET'] = 'ci-chatwoot-hmac-secret-e2e';
  process.env['LGPD_DATA_KEY'] = 'P5Uc4j/vdAisFljJ0kdz08PLWmPvMC/NX5VIy99Bv+E=';
  process.env['LGPD_DEDUPE_PEPPER'] = 'xgRqlH8Ag8bV/DI9gza3qIFx0w4RF3f9ZF/RSilyV2s=';
  process.env['FX_BRL_PER_USD'] = '5.75';
}
