// =============================================================================
// apps/web/scripts/generate-api-pages.ts — Gerador de paginas MDX da API
//
// Le apps/web/public/api-reference.json (gerado pelo prerender-openapi.ts),
// e opcionalmente apps/api/dist/schema-examples.json.
//
// Para cada tag do spec, gera docs/help/api/_generated/<slug>.mdx com:
//   - frontmatter: title, description, keywords, order
//   - lista de endpoints (summary + method + path)
//   - link para pagina interativa
//
// Idempotente: usa hash do conteudo — so sobrescreve se mudou.
// Escreve _generated/.manifest.json com hashes por slug.
//
// npm script: pnpm --filter @elemento/web docs:api
// =============================================================================
/* eslint-disable no-console */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SPEC_PATH = resolve(__dirname, '../public/api-reference.json');
const EXAMPLES_PATH = resolve(__dirname, '../../api/dist/schema-examples.json');
const OUT_DIR = resolve(__dirname, '../../../docs/help/api/_generated');
const MANIFEST_PATH = resolve(OUT_DIR, '.manifest.json');

interface OpenApiTag {
  name: string;
  description?: string;
}

interface OpenApiOperation {
  summary?: string;
  tags?: string[];
  operationId?: string;
  deprecated?: boolean;
}

interface OpenApiSpec {
  tags?: OpenApiTag[];
  paths?: Record<string, Record<string, OpenApiOperation>>;
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

interface EndpointSummary {
  method: string;
  path: string;
  summary: string;
  deprecated: boolean;
}

function buildMdx(tag: OpenApiTag, endpoints: EndpointSummary[], order: number): string {
  const slug = slugify(tag.name);
  const keywords = [
    tag.name,
    ...endpoints.map((e) => e.method.toUpperCase()),
    ...endpoints.map((e) => e.path),
    ...endpoints.map((e) => e.summary),
  ]
    .filter(Boolean)
    .map((k) => k.replace(/"/g, "'"))
    .slice(0, 20);

  const description = tag.description ?? `Endpoints do recurso ${tag.name}`;

  const keywordsYaml = keywords.map((k) => `  - "${k}"`).join('\n');

  const endpointLines = endpoints
    .map((ep) => {
      const dep = ep.deprecated ? ' _(descontinuado)_' : '';
      return `- **${ep.method.toUpperCase()}** \`${ep.path}\` — ${ep.summary}${dep}`;
    })
    .join('\n');

  return `---
title: "${tag.name}"
description: "${description.replace(/"/g, "'")}"
order: ${order}
keywords:
${keywordsYaml}
---

# ${tag.name}

${description}

## Endpoints

${endpointLines}

---

[Ver detalhes interativos →](/ajuda/api/${encodeURIComponent(slug)})
`;
}

async function loadManifest(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(MANIFEST_PATH, 'utf-8');
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

async function main() {
  console.log('[docs:api] Reading API spec...');

  let spec: OpenApiSpec;
  try {
    const raw = await readFile(SPEC_PATH, 'utf-8');
    spec = JSON.parse(raw) as OpenApiSpec;
  } catch {
    console.error(`[docs:api] ERROR: Could not read ${SPEC_PATH}`);
    console.error('[docs:api] Run `pnpm --filter @elemento/web docs:openapi` first.');
    process.exit(1);
  }

  // Load optional schema-examples (non-fatal)
  let _examples: Record<string, unknown> | null = null;
  try {
    const raw = await readFile(EXAMPLES_PATH, 'utf-8');
    _examples = JSON.parse(raw) as Record<string, unknown>;
    console.log('[docs:api] Schema examples loaded.');
  } catch {
    console.log('[docs:api] schema-examples.json not found — skipping TS examples in MDX.');
  }

  // Build tag -> endpoints map (preserving spec order)
  const tagMap = new Map<string, { tag: OpenApiTag; endpoints: EndpointSummary[] }>();

  for (const tag of spec.tags ?? []) {
    tagMap.set(tag.name, { tag, endpoints: [] });
  }

  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = pathItem[method];
      if (!op) continue;
      const tags = op.tags?.length ? op.tags : ['Other'];
      const summary = op.summary ?? `${method.toUpperCase()} ${path}`;
      for (const tagName of tags) {
        if (!tagMap.has(tagName)) {
          tagMap.set(tagName, { tag: { name: tagName }, endpoints: [] });
        }
        tagMap.get(tagName)!.endpoints.push({
          method: method.toUpperCase(),
          path,
          summary,
          deprecated: op.deprecated ?? false,
        });
      }
    }
  }

  await mkdir(OUT_DIR, { recursive: true });

  const manifest = await loadManifest();
  const newManifest: Record<string, string> = {};

  let written = 0;
  let skipped = 0;
  let order = 10;

  for (const { tag, endpoints } of tagMap.values()) {
    if (!endpoints.length) continue;

    const slug = slugify(tag.name);
    const mdxContent = buildMdx(tag, endpoints, order);
    const contentHash = hash(mdxContent);
    const outPath = resolve(OUT_DIR, `${slug}.mdx`);

    newManifest[slug] = contentHash;

    if (manifest[slug] === contentHash) {
      console.log(`[docs:api] Unchanged: ${slug}.mdx (skip)`);
      skipped++;
    } else {
      await writeFile(outPath, mdxContent, 'utf-8');
      console.log(`[docs:api] Generated: ${slug}.mdx (${endpoints.length} endpoints)`);
      written++;
    }

    order += 10;
  }

  // Write updated manifest
  await writeFile(MANIFEST_PATH, JSON.stringify(newManifest, null, 2), 'utf-8');

  console.log(`[docs:api] Done: ${written} written, ${skipped} unchanged.`);
  console.log(`[docs:api] Output: ${OUT_DIR}`);
}

main().catch((err) => {
  console.error('[docs:api] Fatal error:', err);
  process.exit(1);
});
