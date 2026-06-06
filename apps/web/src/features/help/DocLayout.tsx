import * as React from 'react';
import { useLocation } from 'react-router-dom';

import { HelpNav } from './HelpNav';
import { getHelpManifest, type HelpManifest } from './manifest';
import { FeedbackWidget } from './mdx-components';
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

  // Sidebar + TOC vivem dentro do <main> do AppLayout, que tem seu próprio
  // scroll (overflow-auto). Por isso o sticky usa top: 1.5rem (= padding-top
  // do <main>, p-6) — não 4rem da topbar global — e a altura é
  // calc(100vh - 3.5rem - 3rem) (viewport menos topbar 3.5rem menos
  // padding vertical do main 2 * 1.5rem). Sem isso a última entrada do nav
  // ficava cortada quando o scroll do main avança.
  const stickyTop = '1.5rem';
  const stickyHeight = 'calc(100vh - 3.5rem - 3rem)';

  return (
    <div className="mx-auto flex w-full max-w-[1240px] gap-6">
      {/* Nav esquerda */}
      <aside
        className="hidden shrink-0 md:block"
        style={{
          width: 240,
          position: 'sticky',
          top: stickyTop,
          alignSelf: 'flex-start',
          height: stickyHeight,
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
        {/* F10-S13: FeedbackWidget injection -- all /ajuda/* except home and API root */}
        {location.pathname !== '/ajuda' &&
          location.pathname !== '/ajuda/' &&
          !location.pathname.startsWith('/ajuda/api') &&
          location.pathname.replace(/\/+$/, '') !== '/ajuda' && <FeedbackWidget />}
      </article>

      {/* TOC direita */}
      <aside
        className="hidden shrink-0 lg:block"
        style={{
          width: 200,
          position: 'sticky',
          top: stickyTop,
          alignSelf: 'flex-start',
          height: stickyHeight,
          overflowY: 'auto',
        }}
      >
        <Toc contentRef={contentRef} reloadKey={location.pathname} />
      </aside>
    </div>
  );
}
