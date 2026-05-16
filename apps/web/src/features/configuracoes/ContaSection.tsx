// =============================================================================
// features/configuracoes/ContaSection.tsx — Aba Conta funcional (F8-S09).
//
// Três seções:
//   1. Perfil    — fullName editável, email read-only.
//   2. Segurança — troca de senha; 2FA como card "Em breve".
//   3. Aparência — ThemeToggle (reutiliza useTheme — sem duplicar lógica).
//
// Design: tokens canônicos do DS (doc 18), light + dark, responsivo.
// React Hook Form para forms, TanStack Query para dados via hooks/account.
// =============================================================================

import * as React from 'react';
import { useForm } from 'react-hook-form';

import { useTheme } from '../../app/ThemeProvider';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ThemeToggle } from '../../components/ui/ThemeToggle';
import { useChangePassword, useProfile, useUpdateProfile } from '../../hooks/account/useAccount';
import { cn } from '../../lib/cn';

// ─── Helpers de layout ────────────────────────────────────────────────────────

/**
 * Cartão de seção com título e separador.
 * elev-2 em repouso, responsivo.
 */
function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className="rounded-lg border border-border p-6 flex flex-col gap-5"
      style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-2)' }}
    >
      <div className="flex flex-col gap-1">
        <h2
          className="font-sans font-semibold text-ink"
          style={{ fontSize: 'var(--text-sm)', letterSpacing: '-0.01em' }}
        >
          {title}
        </h2>
        {description && (
          <p className="font-sans text-ink-3" style={{ fontSize: 'var(--text-xs)' }}>
            {description}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * Cartão "Em breve" leve — usado para 2FA.
 */
function ComingSoonBadge(): React.JSX.Element {
  return (
    <span
      className="inline-flex items-center shrink-0 rounded-full px-2 py-0.5 font-sans font-semibold uppercase"
      style={{
        fontSize: '0.6rem',
        letterSpacing: '0.1em',
        background: 'var(--surface-muted)',
        color: 'var(--text-4)',
      }}
    >
      Em breve
    </span>
  );
}

// ─── Seção Perfil ─────────────────────────────────────────────────────────────

interface ProfileForm {
  fullName: string;
}

function PerfilSection(): React.JSX.Element {
  const { data: profile, isLoading } = useProfile();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<ProfileForm>({
    defaultValues: { fullName: profile?.fullName ?? '' },
  });

  // Sincroniza form com dados carregados do servidor
  React.useEffect(() => {
    if (profile) {
      reset({ fullName: profile.fullName });
    }
  }, [profile, reset]);

  const { updateProfile, isPending } = useUpdateProfile({
    onSuccess: (result) => {
      reset({ fullName: result.fullName });
    },
  });

  function onSubmit(data: ProfileForm): void {
    updateProfile({ fullName: data.fullName });
  }

  if (isLoading) {
    return (
      <SectionCard title="Perfil" description="Seu nome de exibição e informações da conta.">
        <div className="animate-pulse flex flex-col gap-3">
          <div className="h-10 rounded-sm bg-surface-muted" />
          <div className="h-10 rounded-sm bg-surface-muted" />
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Perfil" description="Seu nome de exibição e informações da conta.">
      <form
        onSubmit={(e) => {
          void handleSubmit(onSubmit)(e);
        }}
        className="flex flex-col gap-4"
      >
        <Input
          id="fullName"
          label="Nome completo"
          required
          {...register('fullName', {
            required: 'O nome é obrigatório',
            minLength: { value: 2, message: 'O nome deve ter pelo menos 2 caracteres' },
            maxLength: { value: 200, message: 'O nome deve ter no máximo 200 caracteres' },
          })}
          error={errors.fullName?.message}
          placeholder="Seu nome completo"
          autoComplete="name"
        />

        {/* Email: read-only — alteração é fluxo administrativo */}
        <Input
          id="email"
          label="E-mail"
          value={profile?.email ?? ''}
          readOnly
          disabled
          hint="O e-mail não pode ser alterado por aqui. Entre em contato com um administrador."
        />

        <div className="flex justify-end">
          <Button type="submit" variant="primary" size="sm" disabled={!isDirty || isPending}>
            {isPending ? 'Salvando...' : 'Salvar alterações'}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

// ─── Seção Segurança ──────────────────────────────────────────────────────────

interface PasswordForm {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

function SegurancaSection(): React.JSX.Element {
  const [wrongPassword, setWrongPassword] = React.useState<string | null>(null);
  const { changePassword, isPending } = useChangePassword({
    onSuccess: () => {
      reset();
      setWrongPassword(null);
    },
    onWrongPassword: (msg) => {
      setWrongPassword(msg);
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<PasswordForm>({
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const newPassword = watch('newPassword');

  function onSubmit(data: PasswordForm): void {
    setWrongPassword(null);
    changePassword({ currentPassword: data.currentPassword, newPassword: data.newPassword });
  }

  return (
    <SectionCard title="Segurança" description="Gerencie sua senha de acesso à plataforma.">
      {/* Troca de senha */}
      <form
        onSubmit={(e) => {
          void handleSubmit(onSubmit)(e);
        }}
        className="flex flex-col gap-4"
      >
        <Input
          id="currentPassword"
          label="Senha atual"
          type="password"
          required
          {...register('currentPassword', {
            required: 'A senha atual é obrigatória',
          })}
          error={errors.currentPassword?.message ?? wrongPassword ?? undefined}
          autoComplete="current-password"
        />

        <Input
          id="newPassword"
          label="Nova senha"
          type="password"
          required
          {...register('newPassword', {
            required: 'A nova senha é obrigatória',
            minLength: { value: 8, message: 'A nova senha deve ter pelo menos 8 caracteres' },
            maxLength: { value: 128, message: 'A nova senha deve ter no máximo 128 caracteres' },
            validate: {
              hasLetter: (v) =>
                /[a-zA-Z]/.test(v) || 'A nova senha deve conter pelo menos uma letra',
              hasDigit: (v) => /[0-9]/.test(v) || 'A nova senha deve conter pelo menos um dígito',
              notSameAsCurrent: (v) =>
                v !== watch('currentPassword') || 'A nova senha deve ser diferente da senha atual',
              noLeadingTrailingSpaces: (v) =>
                v === v.trim() || 'A nova senha não pode começar ou terminar com espaço',
            },
          })}
          error={errors.newPassword?.message}
          hint="Mínimo 8 caracteres, pelo menos 1 letra e 1 número."
          autoComplete="new-password"
        />

        <Input
          id="confirmPassword"
          label="Confirmar nova senha"
          type="password"
          required
          {...register('confirmPassword', {
            required: 'Confirme a nova senha',
            validate: (v) => v === newPassword || 'As senhas não coincidem',
          })}
          error={errors.confirmPassword?.message}
          autoComplete="new-password"
        />

        <div className="flex justify-end">
          <Button type="submit" variant="primary" size="sm" disabled={isPending}>
            {isPending ? 'Alterando...' : 'Alterar senha'}
          </Button>
        </div>
      </form>

      {/* 2FA — Em breve */}
      <div
        className={cn(
          'flex items-center justify-between gap-3 p-4 rounded-md border border-border',
          'opacity-60',
        )}
        style={{ background: 'var(--surface-muted)' }}
      >
        <div className="flex items-center gap-3">
          {/* Ícone escudo */}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="w-5 h-5 shrink-0 text-ink-3"
            aria-hidden="true"
          >
            <path d="M12 2L4 6v6c0 5.25 3.5 10.17 8 11.5C16.5 22.17 20 17.25 20 12V6L12 2Z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          <div>
            <p
              className="font-sans font-semibold text-ink-3"
              style={{ fontSize: 'var(--text-sm)' }}
            >
              Autenticação em dois fatores (2FA)
            </p>
            <p className="font-sans text-ink-4" style={{ fontSize: 'var(--text-xs)' }}>
              Adicione uma camada extra de segurança à sua conta.
            </p>
          </div>
        </div>
        <ComingSoonBadge />
      </div>
    </SectionCard>
  );
}

// ─── Seção Aparência ──────────────────────────────────────────────────────────

function AparenciaSection(): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <SectionCard title="Aparência" description="Escolha como a plataforma aparece para você.">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="font-sans font-medium text-ink" style={{ fontSize: 'var(--text-sm)' }}>
            Tema
          </p>
          <p className="font-sans text-ink-3" style={{ fontSize: 'var(--text-xs)' }}>
            {theme === 'light' ? 'Tema claro ativo' : 'Tema escuro ativo'}
          </p>
        </div>

        {/* Reutiliza ThemeToggle existente — sem duplicar lógica de tema */}
        <ThemeToggle />
      </div>
    </SectionCard>
  );
}

// ─── ContaSection (pública) ───────────────────────────────────────────────────

/**
 * Aba Conta completa: Perfil + Segurança + Aparência.
 *
 * Substitui o esqueleto "Em breve" criado pelo F8-S08.
 * Exportada para uso em ConfiguracoesPage.tsx.
 */
export function ContaSection(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <PerfilSection />
      <SegurancaSection />
      <AparenciaSection />
    </div>
  );
}
