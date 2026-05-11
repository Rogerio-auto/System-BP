import * as React from 'react';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ThemeToggle } from '../../components/ui/ThemeToggle';

// ─── Marca SVG ────────────────────────────────────────────────────────────────

/**
 * Estrela da bandeira de Rondônia com gradient azul→verde.
 * Copiado de .brand-mark no HTML de referência (docs/design-system/index.html).
 * ID único `loginStarGrad` para evitar conflito entre SVGs na mesma página.
 */
function BrandMark({ size = 56 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Logotipo Banco do Povo"
      role="img"
      style={{ filter: 'drop-shadow(0 2px 8px rgba(20,33,61,0.2))' }}
    >
      <path
        d="M20 2 L24.5 14 L37 14.5 L27 22.5 L31 35 L20 27.5 L9 35 L13 22.5 L3 14.5 L15.5 14 Z"
        fill="url(#loginStarGrad)"
      />
      {/* Estrela branca interna — identidade visual do DS */}
      <path
        d="M20 8 L22.5 16 L31 16.3 L24 22 L26.5 30 L20 25 L13.5 30 L16 22 L9 16.3 L17.5 16 Z"
        fill="white"
      />
      <defs>
        <linearGradient id="loginStarGrad" x1="0" y1="0" x2="40" y2="40">
          <stop offset="0%"   stopColor="var(--brand-azul)" />
          <stop offset="50%"  stopColor="var(--brand-azul)" />
          <stop offset="50%"  stopColor="var(--brand-verde)" />
          <stop offset="100%" stopColor="var(--brand-verde)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ─── Form ─────────────────────────────────────────────────────────────────────

interface LoginFormState {
  cpf: string;
  senha: string;
}

function LoginForm(): React.JSX.Element {
  const [form, setForm] = React.useState<LoginFormState>({ cpf: '', senha: '' });

  function handleChange(e: React.ChangeEvent<HTMLInputElement>): void {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    // Placeholder — lógica real de autenticação em F1-S08
    console.warn('login submit (placeholder)', form);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      <Input
        id="cpf"
        name="cpf"
        label="CPF"
        type="text"
        inputMode="numeric"
        autoComplete="username"
        placeholder="000.000.000-00"
        value={form.cpf}
        onChange={handleChange}
        required
        /* JetBrains Mono em campos numéricos — DS §2 */
        className="font-mono"
      />

      <Input
        id="senha"
        name="senha"
        label="Senha"
        type="password"
        autoComplete="current-password"
        placeholder="••••••••"
        value={form.senha}
        onChange={handleChange}
        required
      />

      <div className="flex justify-end -mt-2">
        <button
          type="button"
          className="text-sm text-ink-3 hover:text-azul transition-colors duration-fast ease underline-offset-4 hover:underline"
          onClick={() => console.warn('esqueci a senha (placeholder)')}
        >
          Esqueci minha senha
        </button>
      </div>

      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="w-full mt-1"
      >
        Entrar
      </Button>
    </form>
  );
}

// ─── Coluna hero (desktop) ────────────────────────────────────────────────────

function HeroColumn(): React.JSX.Element {
  return (
    <div className="hidden lg:flex lg:flex-1 flex-col justify-center px-14 xl:px-20 py-16">
      <div
        className="flex flex-col gap-8"
        style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) both' }}
      >
        <div className="flex items-center gap-4">
          <BrandMark size={56} />
          <div>
            <p className="font-sans text-xs font-semibold uppercase tracking-[0.14em] text-verde">
              Banco do Povo
            </p>
            <p className="font-sans text-xs font-medium text-ink-3 tracking-wide">
              Rondônia · SEDEC
            </p>
          </div>
        </div>

        <div>
          <p className="font-sans text-xs font-semibold uppercase tracking-[0.18em] text-verde mb-4">
            Crédito para pequenos negócios
          </p>
          {/* DS §4.2: Bricolage 800, tracking -0.045em, opsz 96 */}
          <h1
            className="font-display font-bold text-ink leading-[0.95]"
            style={{
              fontSize: 'clamp(2.75rem, 5vw, 4.5rem)',
              letterSpacing: '-0.045em',
              fontVariationSettings: "'opsz' 96",
            }}
          >
            Gestão de{' '}
            {/* DS §4.3: em com gradient azul→verde */}
            <em
              style={{
                fontStyle: 'normal',
                fontWeight: 800,
                background: 'linear-gradient(135deg, var(--brand-azul) 0%, var(--brand-verde) 100%)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              Crédito
            </em>
          </h1>
        </div>

        <p className="font-sans text-lg text-ink-2 max-w-[44ch] leading-relaxed">
          Plataforma oficial do programa Banco do Povo de Rondônia para análise e
          concessão de microcrédito produtivo orientado.
        </p>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

/**
 * Tela de login — 2 colunas no desktop (hero esquerda + card direita).
 * Mobile: coluna única, hero oculto, card centralizado.
 * Submit: console.warn — sem chamada à API (F1-S08).
 */
export function LoginPage(): React.JSX.Element {
  return (
    <div className="min-h-screen relative z-[1] flex flex-col">
      {/* Toggle de tema — posição absoluta topo direito */}
      <header className="absolute top-5 right-5 z-10">
        <ThemeToggle />
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        <HeroColumn />

        {/* Coluna direita: card de login */}
        <div className="flex flex-1 items-center justify-center px-6 py-16 lg:px-12 lg:max-w-[520px]">
          <div
            className="w-full max-w-[420px]"
            style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) 0.1s both' }}
          >
            {/* Marca mobile — visível apenas em telas pequenas */}
            <div className="flex items-center gap-3 mb-8 lg:hidden">
              <BrandMark size={40} />
              <div>
                <p className="font-display text-base font-bold text-ink tracking-tight">
                  Banco do Povo
                </p>
                <p className="font-sans text-xs text-verde font-medium uppercase tracking-[0.12em]">
                  Rondônia
                </p>
              </div>
            </div>

            {/* Card — bg-elev-1 + elev-3 conforme DoD do slot */}
            <div
              className="bg-surface-1 rounded-lg border border-border"
              style={{
                boxShadow: 'var(--elev-3)',
                padding: 'clamp(24px, 5vw, 48px)',
              }}
            >
              <div className="mb-8">
                <h2
                  className="font-display font-bold text-ink mb-1"
                  style={{
                    fontSize: 'var(--text-2xl)',
                    letterSpacing: '-0.028em',
                    fontVariationSettings: "'opsz' 24",
                  }}
                >
                  Entrar na plataforma
                </h2>
                <p className="text-sm text-ink-3">
                  Acesso restrito a agentes credenciados.
                </p>
              </div>

              <LoginForm />
            </div>

            <p className="text-center text-xs text-ink-4 mt-6 font-mono">
              Banco do Povo · Rondônia © {new Date().getFullYear()}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
