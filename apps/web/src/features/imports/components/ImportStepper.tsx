// =============================================================================
// features/imports/components/ImportStepper.tsx
//
// Stepper horizontal 4 passos conforme DS §8 e escopo F1-S18:
//   - Atual:   --brand-azul sólido + glow-azul
//   - Passado: --brand-verde sólido + check
//   - Futuro:  --border-strong outline
//
// Linha conectora varia de verde (passado→atual) para border (atual→futuro).
// =============================================================================

import * as React from 'react';

import { cn } from '../../../lib/cn';

export type WizardStep = 1 | 2 | 3 | 4;

interface Step {
  id: WizardStep;
  label: string;
  caption: string;
}

const STEPS: Step[] = [
  { id: 1, label: 'Upload', caption: 'Selecionar arquivo' },
  { id: 2, label: 'Mapeamento', caption: 'Ajustar colunas' },
  { id: 3, label: 'Revisão', caption: 'Verificar dados' },
  { id: 4, label: 'Confirmação', caption: 'Importar' },
];

interface ImportStepperProps {
  current: WizardStep;
}

export function ImportStepper({ current }: ImportStepperProps): React.JSX.Element {
  return (
    <nav aria-label="Passos do wizard de importação">
      <ol className="flex items-center gap-0">
        {STEPS.map((step, idx) => {
          const isPast = step.id < current;
          const isCurrent = step.id === current;
          const isFuture = step.id > current;
          const isLastStep = idx === STEPS.length - 1;

          return (
            <React.Fragment key={step.id}>
              {/* Nó */}
              <li className="flex flex-col items-center gap-2 min-w-[72px]">
                {/* Círculo do nó */}
                <div
                  aria-current={isCurrent ? 'step' : undefined}
                  className={cn(
                    'relative flex items-center justify-center',
                    'w-8 h-8 rounded-pill',
                    'transition-all duration-[250ms] ease-out',
                    // Passado: verde + check
                    isPast && 'text-white',
                    // Atual: azul sólido + glow
                    isCurrent && 'text-white',
                    // Futuro: transparente com borda
                    isFuture && 'text-ink-3 bg-surface-1 border-2 border-border-strong',
                    'font-sans font-bold text-sm',
                  )}
                  style={
                    isPast
                      ? {
                          background: 'var(--brand-verde)',
                          boxShadow: 'var(--elev-2)',
                        }
                      : isCurrent
                        ? {
                            background: 'var(--brand-azul)',
                            boxShadow: 'var(--glow-azul), var(--elev-2)',
                          }
                        : {}
                  }
                >
                  {isPast ? (
                    // Check icon
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-3.5 h-3.5"
                      aria-hidden="true"
                    >
                      <path d="M3 8l3.5 3.5L13 5" />
                    </svg>
                  ) : (
                    <span>{step.id}</span>
                  )}
                </div>

                {/* Labels */}
                <div className="flex flex-col items-center gap-0.5">
                  <span
                    className={cn(
                      'font-sans font-semibold text-xs',
                      isCurrent ? 'text-ink' : isPast ? 'text-verde' : 'text-ink-4',
                    )}
                  >
                    {step.label}
                  </span>
                  <span
                    className="font-sans text-ink-4"
                    style={{ fontSize: '0.65rem', letterSpacing: '0.02em' }}
                  >
                    {step.caption}
                  </span>
                </div>
              </li>

              {/* Linha conectora (exceto após o último nó) */}
              {!isLastStep && (
                <div
                  aria-hidden="true"
                  className="flex-1 h-[2px] mb-7 mx-1"
                  style={{
                    background: isPast
                      ? 'var(--brand-verde)'
                      : isCurrent
                        ? `linear-gradient(to right, var(--brand-azul) 0%, var(--border-strong) 100%)`
                        : 'var(--border-strong)',
                    opacity: isFuture ? 0.4 : 1,
                    transition: 'background 250ms ease',
                  }}
                />
              )}
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
