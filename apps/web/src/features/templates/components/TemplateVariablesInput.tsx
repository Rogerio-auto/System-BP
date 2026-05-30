// =============================================================================
// features/templates/components/TemplateVariablesInput.tsx
//
// Input de lista de variáveis derivadas do body ({{1}}, {{2}}, ...).
// Detecta variáveis no body automaticamente e permite renomear semanticamente.
// DS: tokens canônicos, sem hex, elevation, hover states.
// =============================================================================
import * as React from 'react';

import { cn } from '../../../lib/cn';

interface TemplateVariablesInputProps {
  /** Body atual do template — usado para detectar {{N}} automaticamente. */
  body: string;
  /** Lista de nomes semânticos em ordem posicional. */
  value: string[];
  onChange: (variables: string[]) => void;
  /** Se true, desabilita edição. */
  disabled?: boolean;
}

/**
 * Detecta variáveis {{N}} no body e retorna o count.
 */
function detectVariableCount(body: string): number {
  const matches = body.match(/\{\{(\d+)\}\}/g) ?? [];
  const indices = matches.map((m) => parseInt(m.replace(/[{}]/g, ''), 10));
  return indices.length > 0 ? Math.max(...indices) : 0;
}

export function TemplateVariablesInput({
  body,
  value,
  onChange,
  disabled = false,
}: TemplateVariablesInputProps): React.JSX.Element {
  const varCount = detectVariableCount(body);

  // Sincroniza o array de variáveis com o count detectado
  React.useEffect(() => {
    if (varCount !== value.length) {
      const next = Array.from({ length: varCount }, (_, i) => value[i] ?? '');
      onChange(next);
    }
  }, [varCount, value, onChange]);

  if (varCount === 0) {
    return (
      <p className="font-sans text-sm" style={{ color: 'var(--text-3)' }}>
        Nenhuma variável detectada. Use{' '}
        <code
          className="font-mono text-xs px-1 py-0.5 rounded"
          style={{ background: 'var(--surface-muted)' }}
        >
          {'{{1}}'}
        </code>
        ,{' '}
        <code
          className="font-mono text-xs px-1 py-0.5 rounded"
          style={{ background: 'var(--surface-muted)' }}
        >
          {'{{2}}'}
        </code>
        , etc. no corpo do template.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: varCount }, (_, i) => (
        <div key={i} className="flex items-center gap-2">
          <span
            className="font-mono text-xs font-medium shrink-0 w-8 text-right"
            style={{ color: 'var(--brand-azul)', fontSize: '0.7rem' }}
          >
            {`{{${i + 1}}}`}
          </span>
          <input
            type="text"
            value={value[i] ?? ''}
            onChange={(e) => {
              const next = [...value];
              next[i] = e.target.value;
              onChange(next);
            }}
            placeholder={`Nome da variável ${i + 1} (ex: nome_cliente)`}
            disabled={disabled}
            className={cn(
              'flex-1 px-3 py-1.5 rounded-sm font-sans text-sm',
              'border transition-all duration-[150ms]',
              'focus:outline-none',
              disabled && 'opacity-50 cursor-not-allowed',
            )}
            style={{
              borderColor: 'var(--border-strong)',
              background: 'var(--bg-elev-1)',
              color: 'var(--text)',
              boxShadow: 'inset 0 1px 2px var(--border-inner-dark)',
              fontSize: 'var(--text-sm)',
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'var(--brand-azul)';
              e.currentTarget.style.boxShadow =
                'inset 0 1px 2px var(--border-inner-dark), 0 0 0 3px rgba(27,58,140,0.15)';
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-strong)';
              e.currentTarget.style.boxShadow = 'inset 0 1px 2px var(--border-inner-dark)';
            }}
            aria-label={`Nome semântico da variável ${i + 1}`}
          />
        </div>
      ))}
      <p className="font-sans text-xs mt-1" style={{ color: 'var(--text-4)' }}>
        Nomes semânticos ajudam o worker a preencher as variáveis automaticamente.
      </p>
    </div>
  );
}
