// =============================================================================
// vitest.e2e.config.ts — Configuração Vitest para testes E2E.
//
// Separado de vitest.config.ts para garantir que:
//   1. Testes E2E NÃO rodam com `pnpm test` (ci.yml run unit + integration).
//   2. Testes E2E SOMENTE rodam com `pnpm e2e` (e2e.yml, stack CI completa).
//
// Diferenças da config padrão:
//   - include: apenas test/e2e/**/*.e2e.test.ts
//   - globalSetup: setup E2E (env vars apontam para containers do compose.ci.yml)
//   - pool: forks (mesma razão do config padrão)
//   - timeout: 30s por teste (stack remota pode ter latência)
//   - hookTimeout: 60s (seed/cleanup podem ser lentos no CI)
// =============================================================================
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    globalSetup: ['test/e2e/setup.ts'],
    pool: 'forks',
    poolOptions: {
      forks: {
        // 1 worker = execução sequencial. E2E não é paralelizável (DB compartilhado).
        singleFork: true,
      },
    },
    include: ['test/e2e/**/*.e2e.test.ts'],
    exclude: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // E2E não mede coverage (o CI unit coverage já cobre a API)
    coverage: {
      enabled: false,
    },
  },
});
