// =============================================================================
// Vitest config para @elemento/api.
//
// globalSetup: seta env vars no processo principal antes dos workers subirem,
// evitando que env.ts chame process.exit(1) por vars faltando.
//
// pool: 'forks' — isolamento padrão recomendado pelo Vitest para Node.js.
// vi.mock de 'fastify-type-provider-zod' evita a cadeia que chega em
// zod-to-json-schema@3.25.2 -> zod/v3 (subpath ausente no zod@3.23.8).
// =============================================================================
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    // globalSetup roda no processo principal antes dos workers. É o único jeito
    // confiável de garantir que process.env esteja populado antes de qualquer
    // import de env.ts em projetos ESM strict.
    globalSetup: ['src/test/setup.ts'],
    pool: 'forks',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test/**'],
    },
  },
});
