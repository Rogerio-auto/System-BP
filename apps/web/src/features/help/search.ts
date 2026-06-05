import { Document, type DocumentData } from 'flexsearch';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface SearchResult {
  slug: string;
  title: string;
  description?: string;
  snippet: string;
}

/**
 * Entry indexada. `description` é `string | null` (não optional) porque o tipo
 * `DocumentData` do FlexSearch exige `[key: string]: DocumentValue | DocumentValue[]`
 * e `DocumentValue` cobre `null` mas não `undefined`.
 */
interface IndexEntry extends DocumentData {
  slug: string;
  title: string;
  description: string | null;
  body: string;
}

// ─── Glob de markdown bruto ────────────────────────────────────────────────────
//
// `query: '?raw'` + `eager: true` traz o conteúdo do arquivo como string em
// build-time. Vite faz code-splitting normal — isso significa que o índice é
// construído no client a partir do markdown bruto, sem precisar de um plugin
// custom. HMR também funciona porque o glob é parte do módulo.

// Em build/dev, `import: 'default' + eager: true` resolve para string. Em vitest,
// dependendo da versão do Vite, pode vir como `{ default: string }`. Normalizamos.
const RAW_MDX_RAW = import.meta.glob('../../../../../docs/help/**/*.mdx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, unknown>;

const RAW_MDX: Record<string, string> = Object.fromEntries(
  Object.entries(RAW_MDX_RAW).map(([path, value]) => {
    if (typeof value === 'string') return [path, value];
    if (value !== null && typeof value === 'object' && 'default' in value) {
      const def = (value as { default: unknown }).default;
      if (typeof def === 'string') return [path, def];
    }
    return [path, ''];
  }),
);

const HELP_ROOT = '../../../../../docs/help/';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pathToSlug(path: string): string {
  const rel = path.replace(HELP_ROOT, '').replace(/\.mdx$/, '');
  if (rel === 'index') return '';
  if (rel.endsWith('/index')) return rel.slice(0, -'/index'.length);
  return rel;
}

interface ParsedFrontmatter {
  data: Record<string, string | number | undefined>;
  body: string;
}

/**
 * Parser minimalista de frontmatter YAML — só lê pares `chave: valor` simples.
 * Suficiente para `title`, `description`, `order`, `keywords`. Para qualquer
 * coisa mais complexa, usar gray-matter (mais 10KB, não vale a pena agora).
 */
function parseFrontmatter(src: string): ParsedFrontmatter {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/.exec(src);
  if (!match) return { data: {}, body: src };
  const yamlBlock = match[1] ?? '';
  const rest = match[2] ?? '';
  const data: Record<string, string | number | undefined> = {};
  for (const line of yamlBlock.split(/\r?\n/)) {
    const m = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+)$/.exec(line.trim());
    if (m && m[1] !== undefined && m[2] !== undefined) {
      const key = m[1];
      let value = m[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      const asNumber = Number(value);
      data[key] = value !== '' && !Number.isNaN(asNumber) ? asNumber : value;
    }
  }
  return { data, body: rest };
}

/**
 * Remove sintaxe markdown/JSX para deixar texto limpo indexável.
 * Não é um parser completo — é uma série de regexes pragmáticas.
 */
function stripMdx(src: string): string {
  return src
    .replace(/```[\s\S]*?```/g, ' ') // code blocks
    .replace(/<[A-Z][^>]*>[\s\S]*?<\/[A-Z][^>]*>/g, ' ') // JSX components (greedy ok)
    .replace(/<[^>]+>/g, ' ') // any remaining tags
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → texto
    .replace(/^#{1,6}\s+/gm, '') // heading markers
    .replace(/[*_`>]/g, ' ') // ênfase/quotes/backticks
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSnippet(body: string, maxLen = 140): string {
  if (body.length <= maxLen) return body;
  const trimmed = body.slice(0, maxLen);
  const lastSpace = trimmed.lastIndexOf(' ');
  return (lastSpace > 80 ? trimmed.slice(0, lastSpace) : trimmed) + '…';
}

// ─── Index builder ────────────────────────────────────────────────────────────

interface BuiltIndex {
  index: Document<IndexEntry>;
  entries: Map<string, IndexEntry>;
}

let built: BuiltIndex | null = null;

function build(): BuiltIndex {
  if (built !== null) return built;

  const entries = new Map<string, IndexEntry>();
  const index = new Document<IndexEntry>({
    document: {
      id: 'slug',
      index: ['title', 'description', 'body'],
      store: ['slug', 'title', 'description', 'body'],
    },
    tokenize: 'forward',
    // Encoder Default normaliza para lowercase + remove acentos.
    // Necessário para que `central` case com `Central` e `ação` com `acao`.
    encoder: 'Default',
  });

  for (const [path, raw] of Object.entries(RAW_MDX)) {
    const slug = pathToSlug(path);
    const { data, body: rawBody } = parseFrontmatter(raw);
    const cleanBody = stripMdx(rawBody);
    const title =
      typeof data.title === 'string' && data.title.length > 0
        ? data.title
        : slug === ''
          ? 'Central de Ajuda'
          : (slug.split('/').pop() ?? slug);
    // FlexSearch rejeita id string vazio. Usamos `_root` internamente para a
    // home e mapeamos de volta para `''` ao expor SearchResult.
    const indexedSlug = slug === '' ? '_root' : slug;
    const entry: IndexEntry = {
      slug: indexedSlug,
      title,
      description:
        typeof data.description === 'string' && data.description.length > 0
          ? data.description
          : null,
      body: cleanBody,
    };
    entries.set(indexedSlug, entry);
    index.add(entry);
  }

  built = { index, entries };
  return built;
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Busca livre em todos os artigos. Retorna lista deduplicada de slugs,
 * ranqueada por relevância agregada (FlexSearch já ordena, mantemos a
 * primeira aparição de cada slug).
 */
export function searchHelp(query: string, limit = 8): SearchResult[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const { index, entries } = build();
  const matches = index.search(trimmed, { limit, enrich: true });

  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const field of matches) {
    for (const hit of field.result) {
      const slug = String(hit.id);
      if (seen.has(slug)) continue;
      seen.add(slug);
      const entry = entries.get(slug);
      if (!entry) continue;
      const result: SearchResult = {
        // Reverte `_root` -> '' para que a navegação use /ajuda (sem trailing).
        slug: entry.slug === '_root' ? '' : entry.slug,
        title: entry.title,
        snippet: buildSnippet(entry.body),
      };
      if (entry.description !== null) result.description = entry.description;
      out.push(result);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * Total de artigos indexados. Útil em testes e telemetria.
 */
export function getIndexSize(): number {
  return build().entries.size;
}
