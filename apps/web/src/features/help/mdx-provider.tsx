import { MDXProvider } from '@mdx-js/react';
import type { MDXComponents } from 'mdx/types';
import * as React from 'react';

import { Callout, CodeBlock, EndpointCard, Permission, Step } from './mdx-components';

// Componentes default disponÃ­veis em qualquer .mdx â€” sem precisar de import.
const COMPONENTS: MDXComponents = {
  Callout,
  Step,
  CodeBlock,
  // API Reference components (F10-S10)
  EndpointCard,
  Permission,

  // Sobrescrita de tags HTML para alinhar com o DS.
  h1: (props) => (
    <h1
      className="font-display font-bold"
      style={{
        fontSize: 'var(--text-3xl)',
        letterSpacing: '-0.04em',
        color: 'var(--text)',
        marginTop: '0',
        marginBottom: '1rem',
        fontVariationSettings: "'opsz' 32",
      }}
      {...props}
    />
  ),
  h2: (props) => (
    <h2
      className="font-display font-bold"
      style={{
        fontSize: 'var(--text-2xl)',
        letterSpacing: '-0.035em',
        color: 'var(--text)',
        marginTop: '2.25rem',
        marginBottom: '0.75rem',
        fontVariationSettings: "'opsz' 32",
      }}
      {...props}
    />
  ),
  h3: (props) => (
    <h3
      className="font-display font-semibold"
      style={{
        fontSize: 'var(--text-xl)',
        letterSpacing: '-0.025em',
        color: 'var(--text)',
        marginTop: '1.75rem',
        marginBottom: '0.5rem',
      }}
      {...props}
    />
  ),
  p: (props) => (
    <p
      className="font-sans"
      style={{
        fontSize: 'var(--text-base)',
        color: 'var(--text-2)',
        lineHeight: 1.7,
        marginTop: '0.875rem',
        marginBottom: '0.875rem',
      }}
      {...props}
    />
  ),
  a: (props) => (
    <a
      className="font-sans"
      style={{ color: 'var(--brand-azul)', textDecoration: 'underline' }}
      {...props}
    />
  ),
  ul: (props) => (
    <ul
      className="font-sans"
      style={{
        listStyle: 'disc',
        paddingLeft: '1.5rem',
        color: 'var(--text-2)',
        lineHeight: 1.7,
        marginTop: '0.75rem',
        marginBottom: '0.75rem',
      }}
      {...props}
    />
  ),
  ol: (props) => (
    <ol
      className="font-sans"
      style={{
        listStyle: 'decimal',
        paddingLeft: '1.5rem',
        color: 'var(--text-2)',
        lineHeight: 1.7,
        marginTop: '0.75rem',
        marginBottom: '0.75rem',
      }}
      {...props}
    />
  ),
  table: (props) => (
    <div className="overflow-x-auto my-4">
      <table
        className="w-full font-sans border-collapse"
        style={{ fontSize: 'var(--text-sm)' }}
        {...props}
      />
    </div>
  ),
  th: (props) => (
    <th
      className="font-sans font-semibold text-left"
      style={{
        padding: '0.5rem 0.75rem',
        background: 'var(--surface-muted)',
        color: 'var(--text-2)',
        borderBottom: '1px solid var(--border)',
      }}
      {...props}
    />
  ),
  td: (props) => (
    <td
      style={{
        padding: '0.5rem 0.75rem',
        color: 'var(--text-2)',
        borderBottom: '1px solid var(--border-subtle)',
      }}
      {...props}
    />
  ),
  // `<pre><code>` produzido pelo MDX para blocos sem componente custom.
  // Para syntax highlight + tÃ­tulo + copy, autor deve usar <CodeBlock>.
  pre: (props) => (
    <pre
      className="font-mono overflow-x-auto rounded-md my-4"
      style={{
        background: 'var(--bg-elev-2)',
        border: '1px solid var(--border)',
        fontSize: 'var(--text-sm)',
        padding: '0.875rem 1rem',
        color: 'var(--text)',
      }}
      {...props}
    />
  ),
  code: (props) => (
    <code
      className="font-mono"
      style={{
        background: 'var(--surface-muted)',
        color: 'var(--brand-azul)',
        padding: '0.1em 0.35em',
        borderRadius: '4px',
        fontSize: '0.92em',
      }}
      {...props}
    />
  ),
};

interface HelpMDXProviderProps {
  children: React.ReactNode;
}

/**
 * Wrapper do MDXProvider â€” injeta os componentes canÃ´nicos da Central de Ajuda
 * em todo arquivo `.mdx` filho. Qualquer pÃ¡gina de ajuda deve estar dentro deste
 * provider.
 */
export function HelpMDXProvider({ children }: HelpMDXProviderProps): React.JSX.Element {
  return <MDXProvider components={COMPONENTS}>{children}</MDXProvider>;
}
