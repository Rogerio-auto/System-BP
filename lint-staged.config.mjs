// =============================================================================
// lint-staged.config.mjs — configuração para monorepo com ESLint 9 flat config.
//
// Problema: o ESLint 9 busca eslint.config.js a partir do CWD (raiz do repo),
// mas cada workspace tem seu próprio eslint.config.js em apps/api/, apps/web/ etc.
// Solução: detectar o workspace do arquivo e passar --config explicitamente.
//
// Referência: https://github.com/lint-staged/lint-staged/issues/825
// =============================================================================

import path from 'node:path';

/** Mapeia prefixo de path para config do ESLint do workspace. */
const WORKSPACE_CONFIGS = /** @type {[string, string][]} */ ([
  ['apps/api/', 'apps/api/eslint.config.js'],
  ['apps/web/', 'apps/web/eslint.config.js'],
  ['packages/shared-schemas/', 'packages/shared-schemas/eslint.config.js'],
  ['packages/shared-types/', 'packages/shared-types/eslint.config.js'],
]);

const ROOT = process.cwd();

/**
 * Dado um arquivo staged, retorna o caminho do eslint.config.js do workspace
 * correspondente, ou null se nenhum workspace corresponder.
 *
 * @param {string} file - caminho absoluto do arquivo staged
 * @returns {string | null}
 */
function resolveEslintConfig(file) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  for (const [prefix, config] of WORKSPACE_CONFIGS) {
    if (rel.startsWith(prefix)) {
      return config;
    }
  }
  return null;
}

/**
 * Agrupa os arquivos por workspace config e gera um array de comandos,
 * um por grupo, para que ESLint receba o --config correto.
 *
 * @param {string[]} files - caminhos absolutos dos arquivos staged
 * @returns {string[]}
 */
function eslintCommands(files) {
  /** @type {Map<string, string[]>} */
  const groups = new Map();

  for (const file of files) {
    const config = resolveEslintConfig(file);
    if (config === null) continue; // arquivo fora dos workspaces conhecidos — ignora
    const list = groups.get(config) ?? [];
    list.push(file);
    groups.set(config, list);
  }

  return [...groups.entries()].map(
    ([config, groupFiles]) =>
      `eslint --fix --max-warnings=0 --config ${config} ${groupFiles.map((f) => `"${f}"`).join(' ')}`,
  );
}

export default {
  '*.{ts,tsx,js,jsx}': (files) => [
    `prettier --write ${files.map((f) => `"${f}"`).join(' ')}`,
    ...eslintCommands(files),
  ],
  '*.{json,md,yml,yaml}': (files) =>
    `prettier --write ${files.map((f) => `"${f}"`).join(' ')}`,
};
