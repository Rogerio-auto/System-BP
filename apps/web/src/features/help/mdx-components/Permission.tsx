// =============================================================================
// mdx-components/Permission.tsx — Badge de permissão inline para uso em MDX
//
// Uso em .mdx:
//   <Permission requires="leads:write" />
//   <Permission requires={["leads:write", "admin"]} />
//
// Exibe badge com cadeado + tooltip linkando para /ajuda/conceitos/papeis-e-cidades.
// Click abre em nova aba (não navega — usuário pode estar no meio de leitura).
// =============================================================================

import * as React from 'react';

interface PermissionProps {
  requires: string | string[];
}

const LockIcon = (): React.JSX.Element => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-hidden="true"
    style={{ flexShrink: 0 }}
  >
    <path d="M11.5 6.5H11V5a3 3 0 00-6 0v1.5h-.5A1.5 1.5 0 003 8v5a1.5 1.5 0 001.5 1.5h7A1.5 1.5 0 0013 13V8a1.5 1.5 0 00-1.5-1.5zM5.5 5a2.5 2.5 0 015 0v1.5h-5V5zM8 11.5a1 1 0 110-2 1 1 0 010 2z" />
  </svg>
);

/**
 * Badge de permissão inline para uso em qualquer .mdx da Central de Ajuda.
 *
 * @example
 * <Permission requires="leads:write" />
 */
export function Permission({ requires }: PermissionProps): React.JSX.Element {
  const perms = Array.isArray(requires) ? requires : [requires];
  const label = `Requer: ${perms.join(', ')}`;
  const docsHref = '/ajuda/conceitos/papeis-e-cidades';

  return (
    <a
      href={docsHref}
      target="_blank"
      rel="noopener noreferrer"
      title="Ver conceito de Papéis e Cidades para entender estas permissões"
      aria-label={`${label} — ver documentação de Papéis e Cidades`}
      className="inline-flex items-center gap-1.5 font-sans font-semibold no-underline"
      style={{
        background: 'var(--surface-muted)',
        color: 'var(--text-2)',
        border: '1px solid var(--border)',
        borderRadius: '999px',
        padding: '2px 8px 2px 6px',
        fontSize: 'var(--text-xs)',
        lineHeight: 1.5,
        cursor: 'pointer',
        textDecoration: 'none',
        verticalAlign: 'middle',
        transition: 'background 0.1s, border-color 0.1s',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLAnchorElement;
        el.style.background = 'var(--info-bg)';
        el.style.color = 'var(--info)';
        el.style.borderColor = 'var(--info)';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLAnchorElement;
        el.style.background = 'var(--surface-muted)';
        el.style.color = 'var(--text-2)';
        el.style.borderColor = 'var(--border)';
      }}
    >
      <LockIcon />
      {label}
    </a>
  );
}
