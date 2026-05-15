#!/usr/bin/env node
/**
 * check-migration-journal.mjs
 *
 * Guard de sincronia entre arquivos .sql em db/migrations/ e as entries de
 * apps/api/src/db/migrations/meta/_journal.json.
 *
 * Detecta:
 *   1. Arquivo .sql sem entry correspondente no journal  → erro, exit 1
 *   2. Entry no journal sem arquivo .sql correspondente  → erro, exit 1
 *   3. idx duplicado no journal                          → warning (não erro)
 *   4. idx fora de sequência (gap)                       → warning (não erro)
 *      (gap 0014/0015 é esperado — slots F8-S01/S03 ainda não implementados)
 *
 * Uso:
 *   node apps/api/scripts/check-migration-journal.mjs
 *   node apps/api/scripts/check-migration-journal.mjs --json
 *
 * Retorna:
 *   exit 0  se não houver erros (warnings não bloqueiam)
 *   exit 1  se houver .sql órfão ou entry órfã
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
// Resolve relativo ao repo root (este script fica em apps/api/scripts/)
const REPO_ROOT = resolve(dirname(__filename), "..", "..", "..");
const MIGRATIONS_DIR = resolve(REPO_ROOT, "apps", "api", "src", "db", "migrations");
const JOURNAL_PATH = resolve(MIGRATIONS_DIR, "meta", "_journal.json");

// ---------------------------------------------------------------------------
// Parse args
// ---------------------------------------------------------------------------

const jsonOutput = process.argv.includes("--json");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** @param {string} msg */
function log(msg) {
  if (!jsonOutput) process.stderr.write(msg + "\n");
}

/** Lê e parseia o journal. Lança Error se arquivo não encontrar ou JSON inválido. */
function readJournal() {
  let raw;
  try {
    raw = readFileSync(JOURNAL_PATH, "utf-8");
  } catch {
    throw new Error(`Journal não encontrado: ${JOURNAL_PATH}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Journal inválido (JSON parse error): ${JOURNAL_PATH}`);
  }
}

/** Lista arquivos NNNN_*.sql na pasta de migrations (não entra em subpastas). */
function listSqlFiles() {
  let entries;
  try {
    entries = readdirSync(MIGRATIONS_DIR, { withFileTypes: true });
  } catch {
    throw new Error(`Migrations dir não encontrado: ${MIGRATIONS_DIR}`);
  }
  return entries
    .filter((e) => e.isFile() && /^\d{4}_.*\.sql$/.test(e.name))
    .map((e) => e.name);
}

/** Extrai o tag de um nome de arquivo sql: "0017_seed_foo.sql" → "0017_seed_foo" */
function sqlFileToTag(filename) {
  return basename(filename, ".sql");
}

// ---------------------------------------------------------------------------
// Main guard logic
// ---------------------------------------------------------------------------

function runCheck() {
  const errors = /** @type {string[]} */ ([]);
  const warnings = /** @type {string[]} */ ([]);

  // --- Ler journal ---
  let journal;
  try {
    journal = readJournal();
  } catch (err) {
    errors.push(String(err.message));
    return { errors, warnings };
  }

  /** @type {Array<{idx: number, tag: string}>} */
  const entries = Array.isArray(journal.entries) ? journal.entries : [];

  // --- Ler arquivos .sql ---
  let sqlFiles;
  try {
    sqlFiles = listSqlFiles();
  } catch (err) {
    errors.push(String(err.message));
    return { errors, warnings };
  }

  // --- Conjuntos para comparação ---
  const journalTags = new Set(entries.map((e) => e.tag));
  const sqlTags = new Set(sqlFiles.map(sqlFileToTag));

  // --- Erro 1: .sql sem entry no journal ---
  for (const tag of sqlTags) {
    if (!journalTags.has(tag)) {
      errors.push(
        `[ERRO] .sql órfão: "${tag}.sql" existe no disco mas NÃO tem entry no _journal.json.\n` +
        `       Adicione a entry correspondente ao journal no mesmo commit ou remova o arquivo.`
      );
    }
  }

  // --- Erro 2: entry no journal sem .sql ---
  for (const tag of journalTags) {
    if (!sqlTags.has(tag)) {
      errors.push(
        `[ERRO] Entry órfã: "${tag}" está no _journal.json mas o arquivo "${tag}.sql" NÃO existe no disco.\n` +
        `       Crie o arquivo .sql correspondente ou remova a entry do journal.`
      );
    }
  }

  // --- Warning 3: idx duplicado ---
  const idxCounts = /** @type {Map<number, string[]>} */ (new Map());
  for (const entry of entries) {
    const list = idxCounts.get(entry.idx) ?? [];
    list.push(entry.tag);
    idxCounts.set(entry.idx, list);
  }
  for (const [idx, tags] of idxCounts) {
    if (tags.length > 1) {
      warnings.push(
        `[WARN] idx duplicado: ${idx} aparece ${tags.length}x no journal → ${tags.join(", ")}`
      );
    }
  }

  // --- Warning 4: gaps no idx ---
  const sortedIdxs = [...idxCounts.keys()].sort((a, b) => a - b);
  for (let i = 1; i < sortedIdxs.length; i++) {
    const prev = sortedIdxs[i - 1];
    const curr = sortedIdxs[i];
    if (curr - prev > 1) {
      const gapNums = [];
      for (let g = prev + 1; g < curr; g++) gapNums.push(g.toString().padStart(4, "0"));
      warnings.push(
        `[WARN] Gap no idx: ${prev.toString().padStart(4, "0")} → ${curr.toString().padStart(4, "0")} ` +
        `(missing: ${gapNums.join(", ")}). Pode ser intencional (slot pendente).`
      );
    }
  }

  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const { errors, warnings } = runCheck();
const passed = errors.length === 0;

if (jsonOutput) {
  process.stdout.write(
    JSON.stringify({ passed, errors, warnings }, null, 2) + "\n"
  );
} else {
  log(`[check-migrations] Verificando sincronia journal ↔ disco...`);
  log(`  Journal: ${JOURNAL_PATH}`);
  log(`  Dir:     ${MIGRATIONS_DIR}`);
  log("");

  if (warnings.length > 0) {
    for (const w of warnings) log(w);
    log("");
  }

  if (errors.length === 0) {
    log("[check-migrations] OK — journal e disco estão sincronizados.");
  } else {
    for (const e of errors) log(e);
    log("");
    log(`[check-migrations] FALHOU — ${errors.length} erro(s) encontrado(s).`);
  }
}

process.exit(passed ? 0 : 1);
