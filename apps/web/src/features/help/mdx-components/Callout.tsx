import * as React from 'react';

export type CalloutType = 'info' | 'warn' | 'danger' | 'tip';

interface CalloutProps {
  type?: CalloutType;
  title?: string;
  children: React.ReactNode;
}

const CONFIG: Record<
  CalloutType,
  { bg: string; border: string; color: string; icon: React.ReactNode; defaultTitle: string }
> = {
  info: {
    bg: 'var(--info-bg)',
    border: 'var(--info)',
    color: 'var(--info)',
    defaultTitle: 'Atenção',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 shrink-0 mt-0.5">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 11-2 0 1 1 0 012 0zm-2 3.5A.75.75 0 019.75 9h.5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
  warn: {
    bg: 'var(--warning-bg)',
    border: 'var(--warning)',
    color: 'var(--warning)',
    defaultTitle: 'Aviso',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 shrink-0 mt-0.5">
        <path
          fillRule="evenodd"
          d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
  danger: {
    bg: 'var(--danger-bg)',
    border: 'var(--danger)',
    color: 'var(--danger)',
    defaultTitle: 'Cuidado',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 shrink-0 mt-0.5">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
  tip: {
    bg: 'var(--success-bg)',
    border: 'var(--success)',
    color: 'var(--success)',
    defaultTitle: 'Dica',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 shrink-0 mt-0.5">
        <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z" />
      </svg>
    ),
  },
};

export function Callout({ type = 'info', title, children }: CalloutProps): React.JSX.Element {
  // MDX authors may use strings not type-checked at build time (e.g. "warning" instead of "warn").
  // Fall back to "info" so an unknown type never crashes the page.
  const cfg = CONFIG[type as CalloutType] ?? CONFIG.info;
  if (!(type in CONFIG)) {
    console.warn(
      `[Callout] type="${type}" is not valid. Valid types: ${Object.keys(CONFIG).join(', ')}. Falling back to "info".`,
    );
  }
  return (
    <aside
      role="note"
      className="flex items-start gap-3 rounded-sm px-4 py-3 my-4"
      style={{
        background: cfg.bg,
        borderLeft: `3px solid ${cfg.border}`,
        boxShadow: 'var(--elev-1)',
      }}
    >
      <span aria-hidden="true" style={{ color: cfg.color }}>
        {cfg.icon}
      </span>
      <div className="flex flex-col gap-1 min-w-0">
        <span
          className="font-sans font-semibold"
          style={{ fontSize: 'var(--text-sm)', color: cfg.color }}
        >
          {title ?? cfg.defaultTitle}
        </span>
        <div
          className="font-sans"
          style={{ fontSize: 'var(--text-sm)', color: 'var(--text-2)', lineHeight: 1.55 }}
        >
          {children}
        </div>
      </div>
    </aside>
  );
}
