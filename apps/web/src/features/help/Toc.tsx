import * as React from 'react';

interface TocItem {
  id: string;
  text: string;
  level: 2 | 3;
}

interface TocProps {
  /** Container do conteúdo renderizado — usado pra extrair os headings. */
  contentRef: React.RefObject<HTMLElement>;
  /** Dependência que dispara re-extração (geralmente o pathname). */
  reloadKey: string;
}

export function Toc({ contentRef, reloadKey }: TocProps): React.JSX.Element | null {
  const [items, setItems] = React.useState<TocItem[]>([]);
  const [activeId, setActiveId] = React.useState<string | null>(null);

  // Extrai H2 e H3 do conteúdo após mount + cada mudança de página
  React.useEffect(() => {
    if (contentRef.current === null) return;
    const headings = contentRef.current.querySelectorAll<HTMLElement>('h2[id], h3[id]');
    const extracted: TocItem[] = Array.from(headings).map((h) => ({
      id: h.id,
      text: h.textContent ?? '',
      level: h.tagName === 'H2' ? 2 : 3,
    }));
    setItems(extracted);
    if (extracted.length > 0) setActiveId(extracted[0]?.id ?? null);
  }, [contentRef, reloadKey]);

  // Active heading via IntersectionObserver
  React.useEffect(() => {
    if (items.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: '-80px 0px -70% 0px', threshold: 0 },
    );
    for (const item of items) {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [items]);

  if (items.length === 0) return null;

  return (
    <nav aria-label="Sumário desta página" className="py-4 pl-4">
      <h4
        className="font-sans font-semibold uppercase"
        style={{
          fontSize: '0.6875rem',
          letterSpacing: '0.08em',
          color: 'var(--text-3)',
          marginBottom: '0.5rem',
        }}
      >
        Nesta página
      </h4>
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item.id} style={{ paddingLeft: item.level === 3 ? '0.75rem' : '0' }}>
            <a
              href={`#${item.id}`}
              className="font-sans transition-colors duration-fast block"
              style={{
                fontSize: 'var(--text-xs)',
                color: activeId === item.id ? 'var(--brand-azul)' : 'var(--text-3)',
                fontWeight: activeId === item.id ? 600 : 400,
                lineHeight: 1.4,
              }}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
