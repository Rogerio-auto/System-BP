import * as React from 'react';

interface StepProps {
  number: number;
  title?: string;
  children: React.ReactNode;
}

export function Step({ number, title, children }: StepProps): React.JSX.Element {
  return (
    <div className="flex items-start gap-4 my-5">
      <span
        aria-hidden="true"
        className="shrink-0 inline-flex items-center justify-center rounded-full font-mono font-semibold"
        style={{
          width: '1.75rem',
          height: '1.75rem',
          background: 'var(--brand-azul)',
          color: 'white',
          fontSize: 'var(--text-xs)',
          boxShadow: 'var(--elev-1)',
          marginTop: '0.125rem',
        }}
      >
        {number}
      </span>
      <div className="flex flex-col gap-1.5 min-w-0">
        {title && (
          <span
            className="font-sans font-semibold"
            style={{ fontSize: 'var(--text-base)', color: 'var(--text)' }}
          >
            {title}
          </span>
        )}
        <div
          className="font-sans"
          style={{ fontSize: 'var(--text-sm)', color: 'var(--text-2)', lineHeight: 1.6 }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
