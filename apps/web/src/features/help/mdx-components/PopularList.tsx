import * as React from 'react';
import { Link } from 'react-router-dom';

import { usePopular } from '../api/usePopular';

// ---------------------------------------------------------------------------
// PopularList -- top N artigos mais vistos nos ultimos 30 dias.
//
// Consome usePopular(limit) que busca GET /api/help/popular e enriquece
// os slugs com titulos do manifest local.
//
// Estados: loading (skeleton), empty, lista.
// ---------------------------------------------------------------------------

interface PopularListProps {
  limit?: number;
}

export function PopularList({ limit = 10 }: PopularListProps): React.JSX.Element {
  const { data, status } = usePopular(limit);

  if (status === 'pending') {
    return (
      <ul role="list" aria-busy="true" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <li
            key={i}
            style={{
              height: '1.25rem',
              marginBottom: '0.75rem',
              borderRadius: '4px',
              background: 'var(--surface-muted)',
              animation: 'pulse 1.5s ease-in-out infinite',
              width: i % 2 === 0 ? '80%' : '65%',
            }}
          />
        ))}
        <span className="sr-only">Carregando artigos mais vistos…</span>
      </ul>
    );
  }

  if (status === 'error' || !data || data.length === 0) {
    return (
      <p
        style={{
          fontSize: 'var(--text-sm)',
          color: 'var(--text-3)',
          fontFamily: 'var(--font-sans)',
          margin: 0,
        }}
      >
        Ainda sem dados — em alguns dias volte aqui pra ver o que sua equipe mais lê.
      </p>
    );
  }

  return (
    <ol
      style={{
        listStyle: 'none',
        padding: 0,
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
      }}
    >
      {data.map((item, idx) => (
        <li key={item.slug} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span
            aria-hidden="true"
            style={{
              minWidth: '1.25rem',
              fontSize: 'var(--text-xs)',
              color: 'var(--text-3)',
              fontFamily: 'var(--font-sans)',
              fontWeight: 700,
              textAlign: 'right',
            }}
          >
            {idx + 1}.
          </span>
          <Link
            to={'/ajuda/' + item.slug}
            style={{
              flex: 1,
              fontSize: 'var(--text-sm)',
              fontFamily: 'var(--font-sans)',
              color: 'var(--brand-azul)',
              textDecoration: 'none',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.title}
          </Link>
          <span
            title={'visualizacoes nos ultimos 30 dias'}
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--text-3)',
              fontFamily: 'var(--font-sans)',
              flexShrink: 0,
            }}
          >
            {item.count}
          </span>
        </li>
      ))}
    </ol>
  );
}
