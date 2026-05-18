// =============================================================================
// modules/internal/index.ts — Plugin agregador para rotas /internal/* (F3-S04).
//
// Responsabilidade:
//   Registrar todas as rotas internas de F3 automaticamente via @fastify/autoload.
//   Cada domínio interno (leads, cities, credit-products, simulations, etc.) cria
//   apenas seu próprio `modules/internal/<domínio>/routes.ts` com default export
//   e é descoberto automaticamente — sem editar este arquivo ou app.ts.
//
// Padrão de descoberta:
//   - @fastify/autoload varre `modules/internal/*/routes.ts`.
//   - matchFilter: /routes\.ts$/ garante que apenas routes.ts são carregados
//     (evita tentar carregar index.ts — que é este arquivo — em loop).
//   - Cada arquivo deve ter `export default` de FastifyPluginAsyncZod.
//   - Arquivos sem default export (ex: featureFlags/routes.ts com named export)
//     são silenciosamente ignorados pelo autoload (comportamento v6 documentado).
//
// Rota base:
//   O plugin é registrado em app.ts com prefix '/internal'.
//   Autoload adiciona sub-prefixo por nome de diretório (dirNameRoutePrefix: true).
//   Ex: modules/internal/leads/routes.ts → prefix /internal/leads.
//   Logo: POST /get-or-create no plugin leads → POST /internal/leads/get-or-create.
//
// Autenticação:
//   Cada plugin interno implementa sua própria verificação de X-Internal-Token.
//   Não há middleware global aqui — encapsulamento por plugin garante flexibilidade.
//
// Justificativa de @fastify/autoload (PROTOCOL §1.3):
//   F3 tem 8+ endpoints internos (S02, S04–S12) implementados em slots paralelos.
//   Sem autoload, cada slot editaria app.ts simultaneamente → colisão de merge.
//   Com autoload, cada slot cria apenas seu próprio routes.ts → zero colisão.
//   Custo: +1 dependência (@fastify/autoload@6.3.1, suporte oficial Fastify).
//   Benefício: 8+ merges simultâneos sem conflito = velocidade de desenvolvimento.
//   Versionamento: pinado em 6.3.1 (latest em 2026-05) para reproducibilidade.
//
// Rotas ativas via autoload:
//   - F3-S04: internal/leads/routes.ts → POST /internal/leads/get-or-create
//   - F3-S02, S05–S12: serão adicionados por slots futuros sem editar este arquivo.
//
// Rotas internas NÃO gerenciadas por este plugin (legacy — named export):
//   - internal/featureFlags/routes.ts → registrado diretamente em app.ts.
//   - modules/simulations/internal-routes.ts → registrado diretamente em app.ts.
//   Ambas continuam funcionando independentemente deste plugin.
// =============================================================================
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FastifyPluginAsync } from 'fastify';

// @fastify/autoload é CJS que exporta via module.exports (não tem named exports ESM).
// `createRequire` é necessário para importar módulos CJS a partir de um módulo ESM
// (`"type": "module"` no package.json).
// Alternativa: `const autoload = await import('@fastify/autoload')` — porém em ESM o
// CJS module.exports fica em `.default`, exigindo `.default(fastify, opts)` no call.
// `createRequire` é mais explícito e não requer navegação pelo `.default`.
// `as` justificado: autoload exporta função compatível com FastifyPluginAsync.
const require = createRequire(import.meta.url);

const fastifyAutoload = require('@fastify/autoload') as (
  fastify: Parameters<FastifyPluginAsync>[0],
  opts: {
    dir: string;
    dirNameRoutePrefix?: boolean;
    matchFilter?: RegExp | string | ((path: string) => boolean);
    ignorePattern?: RegExp;
    forceESM?: boolean;
  },
) => Promise<void>;

// ---------------------------------------------------------------------------
// Diretório raiz dos plugins internos (este arquivo fica em modules/internal/).
// `import.meta.url` → caminho absoluto deste arquivo → dirname = modules/internal/.
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Plugin agregador
// ---------------------------------------------------------------------------

const internalPlugin: FastifyPluginAsync = async (fastify) => {
  await fastifyAutoload(fastify, {
    // Varre todos os subdiretórios de modules/internal/.
    dir: __dirname,

    // matchFilter: carregar APENAS arquivos chamados routes.ts/.js.
    // Isso evita que o autoload tente carregar index.ts (este arquivo) em loop,
    // ou schemas.ts, ou outros arquivos que não são plugins Fastify.
    // Regex testa o caminho completo do arquivo.
    matchFilter: /routes\.(ts|js|mjs|cjs)$/,

    // Adiciona prefixo por nome de diretório:
    //   modules/internal/leads/routes.ts → subdirectory 'leads' → prefixo /leads
    //   + prefixo pai /internal (registrado em app.ts) = path /internal/leads
    //   → route final: POST /internal/leads/get-or-create
    dirNameRoutePrefix: true,

    // Ignorar featureFlags explicitamente: tem apenas named export.
    // @fastify/autoload v6 ignora silenciosamente arquivos sem default export Fastify,
    // mas a exclusão explícita é mais clara sobre a intenção arquitetural:
    // featureFlags usa named export por legado e está registrado diretamente em app.ts.
    ignorePattern: /featureFlags/,

    // forceESM: força carregamento como ESM para compatibilidade com tsx.
    // O projeto usa "type": "module" — ESM é o padrão. forceESM garante que
    // autoload use `import()` dinâmico (não `require()`) para os plugins .ts.
    forceESM: true,
  });
};

export default internalPlugin;
