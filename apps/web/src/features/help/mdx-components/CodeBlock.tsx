import * as React from 'react';
import type { HighlighterCore } from 'shiki/core';
import { createHighlighterCore } from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';

type SupportedLang = 'ts' | 'tsx' | 'bash' | 'json';

interface CodeBlockProps {
  lang?: SupportedLang;
  title?: string;
  copy?: boolean;
  children: string;
}

// Singleton — Shiki é caro de inicializar. Carregamos só as 4 linguagens
// declaradas como suportadas (ts, tsx, bash, json) + o tema github-light.
// Imports dinâmicos garantem que Vite gere chunks só para essas 4 langs.
let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  if (highlighterPromise !== null) return highlighterPromise;
  const promise = createHighlighterCore({
    themes: [import('shiki/themes/github-light.mjs')],
    langs: [
      import('shiki/langs/typescript.mjs'),
      import('shiki/langs/tsx.mjs'),
      import('shiki/langs/bash.mjs'),
      import('shiki/langs/json.mjs'),
    ],
    engine: createOnigurumaEngine(import('shiki/wasm')),
  });
  highlighterPromise = promise;
  return promise;
}

const LANG_MAP: Record<SupportedLang, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  bash: 'bash',
  json: 'json',
};

export function CodeBlock({
  lang = 'ts',
  title,
  copy = true,
  children,
}: CodeBlockProps): React.JSX.Element {
  const [html, setHtml] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const code = typeof children === 'string' ? children.replace(/\n$/, '') : '';

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const hi = await getHighlighter();
      if (cancelled) return;
      const rendered = hi.codeToHtml(code, { lang: LANG_MAP[lang], theme: 'github-light' });
      setHtml(rendered);
    })();
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  const handleCopy = (): void => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <figure
      className="my-5 rounded-md overflow-hidden"
      style={{
        background: 'var(--bg-elev-2)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--elev-1)',
      }}
    >
      {(title !== undefined || copy) && (
        <figcaption
          className="flex items-center justify-between px-4 py-2"
          style={{
            background: 'var(--surface-muted)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <span
            className="font-mono"
            style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)' }}
          >
            {title ?? lang}
          </span>
          {copy && (
            <button
              type="button"
              onClick={handleCopy}
              aria-label={copied ? 'Copiado' : 'Copiar código'}
              className="font-sans px-2 py-1 rounded-sm transition-colors duration-fast"
              style={{
                fontSize: 'var(--text-xs)',
                color: copied ? 'var(--success)' : 'var(--text-3)',
                background: 'transparent',
              }}
              onMouseEnter={(e) => {
                if (!copied) (e.currentTarget as HTMLElement).style.color = 'var(--brand-azul)';
              }}
              onMouseLeave={(e) => {
                if (!copied) (e.currentTarget as HTMLElement).style.color = 'var(--text-3)';
              }}
            >
              {copied ? 'Copiado ✓' : 'Copiar'}
            </button>
          )}
        </figcaption>
      )}
      <div
        className="overflow-x-auto"
        style={{ fontSize: 'var(--text-sm)', padding: '0.875rem 1rem' }}
        // Shiki escapa todo o conteúdo do code — seguro renderizar via dangerouslySetInnerHTML.
        // Antes do highlight terminar, mostramos um fallback escapado manualmente.
        dangerouslySetInnerHTML={
          html !== null
            ? { __html: html }
            : { __html: `<pre><code>${escapeHtml(code)}</code></pre>` }
        }
      />
    </figure>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
