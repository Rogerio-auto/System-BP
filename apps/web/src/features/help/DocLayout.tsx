import * as React from 'react';
import { useLocation } from 'react-router-dom';

import { HelpNav } from './HelpNav';
import { getHelpManifest, type HelpManifest } from './manifest';
import { HelpMDXProvider } from './mdx-provider';
import { Toc } from './Toc';

interface DocLayoutProps {
  children: React.ReactNode;
}

/**
 * Casca 3-pane da Central de Ajuda — Stripe Docs style.
 *
 *   ┌─────────────┬──────────────────────────┬─────────────┐
 *   │  HelpNav    │  conteúdo (article)      │   Toc       │
 *   │  240px      │  max-w-prose             │   200px     │
 *   │  sticky     │  fluido                  │   sticky    │
 *   └─────────────┴──────────────────────────┴─────────────┘
 *
 * Responsivo:
 *  - <md: HelpNav some (drawer fica para slot futuro), TOC some.
 *  - md–lg: HelpNav visível, TOC some.
 *  - >=lg: tudo visível.
 */
export function DocLayout({ children }: DocLayoutProps): React.JSX.Element {
  const [manifest, setManifest] = React.useState<HelpManifest | null>(null);
  const contentRef = React.useRef<HTMLElement>(null);
  const location = useLocation();

  React.useEffect(() => {
    let cancelled = false;
    void getHelpManifest().then((m) => {
      if (!cancelled) setManifest(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Scrolla pro topo em cada troca de página da ajuda
  React.useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className="flex gap-6">
      {/* Nav esquerda */}
      <aside
        className="hidden md:block shrink-0"
        style={{
          width: 240,
          position: 'sticky',
          top: '4rem',
          alignSelf: 'flex-start',
          height: 'calc(100vh - 5rem)',
          overflowY: 'auto',
          borderRight: '1px solid var(--border)',
        }}
      >
        {manifest !== null && <HelpNav manifest={manifest} />}
      </aside>

      {/* Conteúdo central */}
      <article
        ref={contentRef}
        className="min-w-0 flex-1 max-w-3xl"
        style={{ paddingTop: '1.5rem', paddingBottom: '4rem' }}
      >
        <HelpMDXProvider>{children}</HelpMDXProvider>
      </article>

      {/* TOC direita */}
      <aside
        className="hidden lg:block shrink-0"
        style={{
          width: 200,
          position: 'sticky',
          top: '4rem',
          alignSelf: 'flex-start',
          height: 'calc(100vh - 5rem)',
          overflowY: 'auto',
        }}
      >
        <Toc contentRef={contentRef} reloadKey={location.pathname} />
      </aside>
    </div>
  );
}
