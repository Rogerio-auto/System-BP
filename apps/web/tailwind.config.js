/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],

  // Suporta as duas estratégias simultaneamente:
  // - classe `dark` no <html> (padrão Tailwind dark:)
  // - atributo `data-theme="dark"` (estratégia CSS vars)
  darkMode: ['class', '[data-theme="dark"]'],

  theme: {
    extend: {
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        sans:    ['Geist', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },

      colors: {
        // ── Marca ──
        azul: {
          DEFAULT: 'var(--brand-azul)',
          deep:    'var(--brand-azul-deep)',
          light:   'var(--brand-azul-light)',
        },
        verde: {
          DEFAULT: 'var(--brand-verde)',
          deep:    'var(--brand-verde-deep)',
          light:   'var(--brand-verde-light)',
        },
        amarelo: {
          DEFAULT: 'var(--brand-amarelo)',
          deep:    'var(--brand-amarelo-deep)',
        },

        // ── Neutros adaptáveis ──
        bg: 'var(--bg)',
        surface: {
          1:      'var(--bg-elev-1)',
          2:      'var(--bg-elev-2)',
          3:      'var(--bg-elev-3)',
          inset:  'var(--bg-inset)',
          muted:  'var(--surface-muted)',
          hover:  'var(--surface-hover)',
        },

        // Token de texto (substitui a paleta numérica ink-50..950)
        ink: {
          DEFAULT: 'var(--text)',
          2:       'var(--text-2)',
          3:       'var(--text-3)',
          4:       'var(--text-4)',
        },

        // ── Bordas ──
        border: {
          DEFAULT: 'var(--border)',
          strong:  'var(--border-strong)',
          subtle:  'var(--border-subtle)',
        },

        // ── Estado ──
        success: { DEFAULT: 'var(--success)', bg: 'var(--success-bg)' },
        warning: { DEFAULT: 'var(--warning)', bg: 'var(--warning-bg)' },
        danger:  { DEFAULT: 'var(--danger)',  bg: 'var(--danger-bg)'  },
        info:    { DEFAULT: 'var(--info)',    bg: 'var(--info-bg)'    },
      },

      // Sistema de profundidade via CSS vars (3 camadas por nível)
      boxShadow: {
        e1: 'var(--elev-1)',
        e2: 'var(--elev-2)',
        e3: 'var(--elev-3)',
        e4: 'var(--elev-4)',
        e5: 'var(--elev-5)',
        'glow-azul':    'var(--glow-azul)',
        'glow-verde':   'var(--glow-verde)',
        'glow-amarelo': 'var(--glow-amarelo)',
      },

      // Raios do DS — nunca ad-hoc
      borderRadius: {
        xs:   '4px',
        sm:   '6px',
        md:   '10px',
        lg:   '16px',
        xl:   '24px',
        pill: '999px',
      },

      // Espaçamento alinhado com --space-* (4px base)
      spacing: {
        1: '0.25rem',   /* 4px  */
        2: '0.5rem',    /* 8px  */
        3: '0.75rem',   /* 12px */
        4: '1rem',      /* 16px */
        5: '1.5rem',    /* 24px */
        6: '2rem',      /* 32px */
        7: '3rem',      /* 48px */
        8: '4rem',      /* 64px */
        9: '6rem',      /* 96px */
      },

      // Easings curados do DS
      transitionTimingFunction: {
        out:       'cubic-bezier(0.16, 1, 0.3, 1)',
        'out-back':'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },

      transitionDuration: {
        fast:    '150ms',
        DEFAULT: '250ms',
        slow:    '400ms',
      },
    },
  },

  plugins: [],
};
