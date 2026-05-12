import * as React from 'react';

import { cn } from '../../lib/cn';

interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  /** Exibe asterisco vermelho (--danger) para indicar campo obrigatório */
  required?: boolean;
}

/**
 * Label semântico do DS.
 * text-sm font-semibold conforme §9.2 — acompanha sempre um <input>.
 * O span .req usa cor --danger via token Tailwind (text-danger).
 */
export function Label({ className, required, children, ...props }: LabelProps): React.JSX.Element {
  return (
    <label
      className={cn(
        'text-sm font-semibold text-ink tracking-[-0.005em] leading-none',
        className,
      )}
      {...props}
    >
      {children}
      {required === true && (
        <span
          className="text-danger ml-1"
          aria-hidden="true"
        >
          *
        </span>
      )}
    </label>
  );
}
