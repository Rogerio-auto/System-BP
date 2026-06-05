import * as React from 'react';
import { Link, useLocation } from 'react-router-dom';

import { DocLayout } from './DocLayout';
import { getArticleBySlug, type Article } from './manifest';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'loaded'; Component: React.ComponentType<Record<string, unknown>> };

export function DocPage(): React.JSX.Element {
  const location = useLocation();
  // Slug: remove o prefixo /ajuda/ (ou /ajuda) do pathname
  const slug = location.pathname.replace(/^\/ajuda\/?/, '');
  const [state, setState] = React.useState<LoadState>({ kind: 'loading' });

  React.useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    void (async () => {
      const article: Article | null = await getArticleBySlug(slug);
      if (cancelled) return;
      if (article === null) {
        setState({ kind: 'not-found' });
        return;
      }
      const mod = await article.load();
      if (cancelled) return;
      setState({ kind: 'loaded', Component: mod.default });
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <DocLayout>
      {state.kind === 'loading' && <LoadingState />}
      {state.kind === 'not-found' && <NotFoundState />}
      {state.kind === 'loaded' && <state.Component />}
    </DocLayout>
  );
}

function LoadingState(): React.JSX.Element {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-3 py-8">
      <div
        className="h-8 w-1/2 rounded-sm animate-pulse"
        style={{ background: 'var(--surface-muted)' }}
      />
      <div
        className="h-4 w-full rounded-sm animate-pulse"
        style={{ background: 'var(--surface-muted)' }}
      />
      <div
        className="h-4 w-5/6 rounded-sm animate-pulse"
        style={{ background: 'var(--surface-muted)' }}
      />
      <span className="sr-only">Carregando página…</span>
    </div>
  );
}

function NotFoundState(): React.JSX.Element {
  return (
    <div className="flex flex-col items-start gap-4 py-12">
      <h1
        className="font-display font-bold"
        style={{
          fontSize: 'var(--text-2xl)',
          letterSpacing: '-0.03em',
          color: 'var(--text)',
        }}
      >
        Página não encontrada
      </h1>
      <p className="font-sans" style={{ fontSize: 'var(--text-base)', color: 'var(--text-2)' }}>
        A página que você procura não existe ou foi movida.
      </p>
      <Link
        to="/ajuda"
        className="font-sans"
        style={{ color: 'var(--brand-azul)', textDecoration: 'underline' }}
      >
        Voltar para a Central de Ajuda
      </Link>
    </div>
  );
}
