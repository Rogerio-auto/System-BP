import type { ComponentType } from 'react';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface ArticleFrontmatter {
  title?: string;
  description?: string;
  order?: number;
  keywords?: string[];
}

export interface Article {
  /** Slug relativo a `/ajuda`. Ex: `conceitos/pipeline-mdx`. Index = `''`. */
  slug: string;
  title: string;
  description?: string;
  order: number;
  /** Carrega o módulo MDX. Lazy. */
  load: () => Promise<{
    default: ComponentType<Record<string, unknown>>;
    frontmatter?: ArticleFrontmatter;
  }>;
}

export interface HelpSection {
  /** Slug da seção (folder name). Ex: `conceitos`, `guias`, `comecar`. */
  slug: string;
  /** Título display da seção (capitalizado do slug por default). */
  title: string;
  articles: Article[];
}

export interface HelpManifest {
  /** Página index — `docs/help/index.mdx`. Sempre presente. */
  home: Article | null;
  /** Seções (sub-pastas de docs/help/). Ordenadas por título. */
  sections: HelpSection[];
}

// ─── Glob de todos os MDX em docs/help ────────────────────────────────────────
//
// Path relativo: manifest.ts está em apps/web/src/features/help/ (5 níveis abaixo
// do monorepo root). docs/help/ está no root → ../../../../../docs/help/**/*.mdx
//
// Vite resolve isso em build-time. `eager: false` → cada entrada é uma função
// `() => Promise<Module>`, dynamic import. Cada arquivo vira um chunk separado.

const MDX_MODULES = import.meta.glob<{
  default: ComponentType<Record<string, unknown>>;
  frontmatter?: ArticleFrontmatter;
}>('../../../../../docs/help/**/*.mdx');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const HELP_ROOT = '../../../../../docs/help/';

/**
 * Converte um path de glob (`../../../../docs/help/conceitos/pipeline-mdx.mdx`)
 * em slug usado pela URL (`conceitos/pipeline-mdx`).
 * O `index.mdx` da raiz vira slug `''`.
 */
function pathToSlug(path: string): string {
  const rel = path.replace(HELP_ROOT, '').replace(/\.mdx$/, '');
  // Convenção: arquivos chamados `index` colapsam para a pasta.
  // `index.mdx` (raiz) → ''
  // `conceitos/index.mdx` → 'conceitos'
  if (rel === 'index') return '';
  if (rel.endsWith('/index')) return rel.slice(0, -'/index'.length);
  return rel;
}

/**
 * Deriva o título de um slug quando a frontmatter não fornece.
 * `conceitos/pipeline-mdx` → `Pipeline mdx`
 */
function fallbackTitleFromSlug(slug: string): string {
  const last = slug.split('/').pop() ?? slug;
  return last
    .split('-')
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * Pretty label para o folder da seção em pt-BR. Folders fora do mapa
 * recebem fallback capitalize do slug.
 */
const SECTION_LABELS: Record<string, string> = {
  comecar: 'Começar',
  guias: 'Guias',
  conceitos: 'Conceitos',
  api: 'API',
};

/**
 * Ordem editorial das seções. Folders fora do mapa caem no fim (99) e
 * desempatam por título alfabético.
 */
const SECTION_ORDER: Record<string, number> = {
  comecar: 10,
  guias: 20,
  conceitos: 30,
  api: 40,
};

function sectionTitle(slug: string): string {
  const labelled = SECTION_LABELS[slug];
  if (labelled !== undefined) return labelled;
  return slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, ' ');
}

function sectionOrder(slug: string): number {
  return SECTION_ORDER[slug] ?? 99;
}

/**
 * Carrega frontmatter de um módulo — uma única dynamic import por artigo,
 * resultado cacheado pela própria runtime do Vite.
 */
async function readFrontmatter(
  loader: () => Promise<{ frontmatter?: ArticleFrontmatter }>,
): Promise<ArticleFrontmatter> {
  const mod = await loader();
  return mod.frontmatter ?? {};
}

// ─── Manifest builder ─────────────────────────────────────────────────────────

let manifestPromise: Promise<HelpManifest> | null = null;

/**
 * Lê o manifest dos MDX. Async porque precisa abrir cada arquivo para extrair
 * frontmatter. Resultado memoizado — a primeira chamada paga o custo (todos os
 * módulos, mas só o frontmatter é avaliado), as próximas são instantâneas.
 *
 * Em produção, cada arquivo vira um chunk JS separado; o manifest carrega todos
 * em paralelo. Para um Help Center com <500 páginas, ainda é <2 MB total não
 * comprimido — aceitável para a primeira navegação à `/ajuda`.
 */
export function getHelpManifest(): Promise<HelpManifest> {
  if (manifestPromise !== null) return manifestPromise;
  manifestPromise = (async () => {
    const entries = Object.entries(MDX_MODULES);
    const articles: Article[] = await Promise.all(
      entries.map(async ([path, loader]) => {
        const fm = await readFrontmatter(loader);
        const slug = pathToSlug(path);
        const base: Article = {
          slug,
          title: fm.title ?? (slug === '' ? 'Central de Ajuda' : fallbackTitleFromSlug(slug)),
          order: fm.order ?? 100,
          load: loader,
        };
        return fm.description !== undefined ? { ...base, description: fm.description } : base;
      }),
    );

    // home = slug vazio
    const home = articles.find((a) => a.slug === '') ?? null;
    const nonHome = articles.filter((a) => a.slug !== '');

    // Agrupa por primeira parte do slug (folder). Slug sem `/` (top-level) vai
    // numa seção sintética 'geral' que não é exibida no nav atual — reservado.
    const sectionMap = new Map<string, Article[]>();
    for (const a of nonHome) {
      const [first, ...rest] = a.slug.split('/');
      if (first === undefined) continue;
      const sectionSlug = rest.length > 0 ? first : '__top__';
      const arr = sectionMap.get(sectionSlug) ?? [];
      arr.push(a);
      sectionMap.set(sectionSlug, arr);
    }

    const sections: HelpSection[] = Array.from(sectionMap.entries())
      .filter(([slug]) => slug !== '__top__')
      .map(([slug, items]) => ({
        slug,
        title: sectionTitle(slug),
        articles: items.sort(
          (a, b) => a.order - b.order || a.title.localeCompare(b.title, 'pt-BR'),
        ),
      }))
      .sort(
        (a, b) =>
          sectionOrder(a.slug) - sectionOrder(b.slug) || a.title.localeCompare(b.title, 'pt-BR'),
      );

    return { home, sections };
  })();
  return manifestPromise;
}

/**
 * Busca um artigo pelo slug normalizado. Slug vazio = home.
 * Retorna `null` se não existir.
 */
export async function getArticleBySlug(slug: string): Promise<Article | null> {
  const m = await getHelpManifest();
  const normalized = slug.replace(/^\/+|\/+$/g, '');
  if (normalized === '') return m.home;
  for (const section of m.sections) {
    const found = section.articles.find((a) => a.slug === normalized);
    if (found) return found;
  }
  return null;
}
