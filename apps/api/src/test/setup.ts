// =============================================================================
// globalSetup do Vitest — executado no processo principal, antes dos workers.
// Garante que todas as env vars obrigatórias estejam disponíveis antes de
// qualquer import de env.ts (que chama process.exit(1) se inválido).
// =============================================================================

export function setup(): void {
  process.env['NODE_ENV'] = 'test';
  // 'silent' não existe no envSchema — usamos 'error' (menor verbosidade válida)
  process.env['LOG_LEVEL'] = 'error';
  process.env['API_PUBLIC_URL'] = 'http://localhost:3333';
  process.env['DATABASE_URL'] = 'postgres://test:test@localhost:5432/test';

  // Mínimo 64 chars conforme envSchema
  process.env['JWT_ACCESS_SECRET'] =
    'test-access-secret-used-only-in-vitest-do-not-use-in-production-00000000';
  process.env['JWT_REFRESH_SECRET'] =
    'test-refresh-secret-used-only-in-vitest-do-not-use-in-production-0000000';

  process.env['JWT_ACCESS_TTL'] = '15m';
  process.env['JWT_REFRESH_TTL'] = '30d';
  process.env['CORS_ALLOWED_ORIGINS'] = 'http://localhost:5173';

  // Mínimo 32 chars conforme envSchema
  process.env['LANGGRAPH_INTERNAL_TOKEN'] = 'test-langgraph-token-vitest-only-00';
  process.env['LANGGRAPH_SERVICE_URL'] = 'http://localhost:8000';

  // WhatsApp Cloud API (F1-S19)
  process.env['WHATSAPP_APP_SECRET'] = 'test-whatsapp-app-secret-vitest-only';
  process.env['WHATSAPP_VERIFY_TOKEN'] = 'test-verify-token-vitest';

  // Chatwoot webhook HMAC (F1-S21)
  process.env['CHATWOOT_WEBHOOK_HMAC_SECRET'] = 'test-chatwoot-hmac-secret-vitest';
}
