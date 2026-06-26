// =============================================================================
// features/auth/LoginPage.tsx — Login funcional.
//
// Substitui o placeholder de F0-S05. Mantém o visual estabelecido e pluga
// a chamada real via useAuth().login (TanStack Mutation + RHF + Zod).
//
// Segurança (LGPD doc 17):
//   - Nenhum log de credenciais, nem em dev.
//   - Erros 401/403: mensagem genérica (não revela se email existe).
//   - Erro 429: exibe mensagem de rate-limit com orientação.
//   - Access token permanece em memória (store); nunca localStorage.
// =============================================================================

import type { LoginBody } from '@elemento/shared-schemas';
import { loginBodySchema } from '@elemento/shared-schemas';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';

import iconeUrl from '../../assets/brand/icone-bp.png';
import logoUrl from '../../assets/brand/logo.webp';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ThemeToggle } from '../../components/ui/ThemeToggle';
import { ApiError } from '../../lib/api';

import { useAuth } from './useAuth';

// ─── Mensagem de erro amigável ─────────────────────────────────────────────────

function friendlyLoginError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.';
    }
    // 401, 403: nunca revela detalhes de credenciais (LGPD §9)
    if (error.status === 401 || error.status === 403) {
      return 'Email ou senha incorretos. Verifique suas credenciais e tente novamente.';
    }
    if (error.status >= 500) {
      return 'Erro interno do servidor. Tente novamente em instantes.';
    }
  }
  return 'Ocorreu um erro inesperado. Tente novamente.';
}

function friendly2faError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.';
    }
    if (error.status === 401) {
      return 'Código inválido ou expirado. Tente novamente.';
    }
  }
  return 'Ocorreu um erro inesperado. Tente novamente.';
}

// ─── Form de segundo fator (2FA) ──────────────────────────────────────────────

interface TwoFactorFormProps {
  challengeToken: string;
  onCancel: () => void;
}

function TwoFactorForm({ challengeToken, onCancel }: TwoFactorFormProps): React.JSX.Element {
  const { verify2fa } = useAuth();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<{ code: string }>({
    defaultValues: { code: '' },
  });

  const onSubmit = handleSubmit(async (data) => {
    // LGPD: nunca logar data aqui
    await verify2fa.mutateAsync({ challengeToken, code: data.code });
  });

  const serverError = verify2fa.error ? friendly2faError(verify2fa.error) : null;
  const isPending = verify2fa.isPending || isSubmitting;

  return (
    <form
      onSubmit={(e) => {
        void onSubmit(e);
      }}
      noValidate
      className="flex flex-col gap-5"
    >
      <div className="flex flex-col gap-1">
        <p
          className="font-display font-bold text-ink"
          style={{ fontSize: 'var(--text-2xl)', letterSpacing: '-0.028em' }}
        >
          Verificação em dois fatores
        </p>
        <p className="text-sm text-ink-3">
          Insira o código do seu app autenticador ou um recovery code.
        </p>
      </div>

      {serverError && (
        <div
          role="alert"
          className="rounded-sm border border-danger bg-danger/10 px-4 py-3 text-sm text-danger"
        >
          {serverError}
        </div>
      )}

      <Input
        id="totp-code"
        label="Código de verificação"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="000000"
        maxLength={12}
        error={errors.code?.message}
        disabled={isPending}
        hint="Código de 6 dígitos ou recovery code (XXXXX-XXXXX)"
        {...register('code', {
          required: 'O código é obrigatório',
          minLength: { value: 6, message: 'Código inválido' },
        })}
      />

      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="w-full"
        disabled={isPending}
        aria-busy={isPending}
      >
        {isPending ? 'Verificando…' : 'Verificar'}
      </Button>

      <button
        type="button"
        onClick={onCancel}
        className="text-sm text-ink-3 hover:text-azul transition-colors duration-fast text-center hover:underline underline-offset-4"
      >
        Voltar ao login
      </button>
    </form>
  );
}

// ─── Form de login principal ───────────────────────────────────────────────────

function LoginForm(): React.JSX.Element {
  const [challengeToken, setChallengeToken] = React.useState<string | null>(null);

  const { login } = useAuth({
    onTwoFactorRequired: (token) => {
      setChallengeToken(token);
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginBody>({
    resolver: zodResolver(loginBodySchema),
    mode: 'onBlur',
  });

  // ── Etapa de 2FA ──────────────────────────────────────────────────────────
  if (challengeToken) {
    return (
      <TwoFactorForm challengeToken={challengeToken} onCancel={() => setChallengeToken(null)} />
    );
  }

  const onSubmit = handleSubmit(async (data) => {
    // LGPD: nunca logar data aqui — sem console.log/warn do payload
    await login.mutateAsync(data);
  });

  const serverError = login.error ? friendlyLoginError(login.error) : null;
  const isPending = login.isPending || isSubmitting;

  return (
    <form
      onSubmit={(e) => {
        void onSubmit(e);
      }}
      noValidate
      className="flex flex-col gap-5"
    >
      {/* Erro global do servidor (401/429/5xx) */}
      {serverError && (
        <div
          role="alert"
          className="rounded-sm border border-danger bg-danger/10 px-4 py-3 text-sm text-danger"
        >
          {serverError}
        </div>
      )}

      <Input
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect="off"
        placeholder="agente@bancodopovorondonia.ro.gov.br"
        error={errors.email?.message}
        disabled={isPending}
        {...register('email')}
      />

      <Input
        id="password"
        label="Senha"
        type="password"
        autoComplete="current-password"
        placeholder="••••••••"
        error={errors.password?.message}
        disabled={isPending}
        {...register('password')}
      />

      <div className="flex justify-end -mt-2">
        <button
          type="button"
          className="text-sm text-ink-3 hover:text-azul transition-colors duration-fast ease underline-offset-4 hover:underline"
          tabIndex={0}
        >
          Esqueci minha senha
        </button>
      </div>

      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="w-full mt-1"
        disabled={isPending}
        aria-busy={isPending}
      >
        {isPending ? 'Entrando…' : 'Entrar'}
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
        <div className="flex items-center">
          <img
            src={logoUrl}
            alt="Banco do Povo de Rondônia"
            loading="eager"
            style={{ height: '56px', width: 'auto', objectFit: 'contain' }}
          />
        </div>

        <div>
          <p className="font-sans text-xs font-semibold uppercase tracking-[0.18em] text-verde mb-4">
            Crédito para pequenos negócios
          </p>
          <h1
            className="font-display font-bold text-ink leading-[0.95]"
            style={{
              fontSize: 'clamp(2.75rem, 5vw, 4.5rem)',
              letterSpacing: '-0.045em',
              fontVariationSettings: "'opsz' 96",
            }}
          >
            Gestão de{' '}
            <em
              style={{
                fontStyle: 'normal',
                fontWeight: 800,
                background:
                  'linear-gradient(135deg, var(--brand-azul) 0%, var(--brand-verde) 100%)',
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
          Plataforma oficial do programa Banco do Povo de Rondônia para análise e concessão de
          microcrédito produtivo orientado.
        </p>
      </div>
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

/**
 * Tela de login funcional — 2 colunas no desktop (hero esquerda + card direita).
 * Mobile: coluna única, hero oculto, card centralizado.
 * Submit: React Hook Form + Zod + TanStack Mutation → useAuth().login.
 */
export function LoginPage(): React.JSX.Element {
  return (
    <div className="min-h-screen relative z-[1] flex flex-col">
      <header className="absolute top-5 right-5 z-10">
        <ThemeToggle />
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        <HeroColumn />

        <div className="flex flex-1 items-center justify-center px-6 py-16 lg:px-12 lg:max-w-[520px]">
          <div
            className="w-full max-w-[420px]"
            style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) 0.1s both' }}
          >
            {/* Marca mobile */}
            <div className="flex items-center mb-8 lg:hidden">
              <img
                src={iconeUrl}
                alt="Banco do Povo de Rondônia"
                loading="eager"
                style={{ height: '44px', width: 'auto', objectFit: 'contain' }}
              />
            </div>

            {/* Card de login */}
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
                <p className="text-sm text-ink-3">Acesso restrito a agentes credenciados.</p>
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
