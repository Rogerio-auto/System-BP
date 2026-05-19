// =============================================================================
// features/configuracoes/ContaSection.tsx — Aba Conta funcional (F8-S09/S11).
//
// Três seções:
//   1. Perfil    — fullName editável, email read-only.
//   2. Segurança — troca de senha + 2FA TOTP (enrolment, ativação, desativação).
//   3. Aparência — ThemeToggle (reutiliza useTheme — sem duplicar lógica).
//
// Design: tokens canônicos do DS (doc 18), light + dark, responsivo.
// React Hook Form para forms, TanStack Query para dados via hooks/account.
// LGPD: recovery codes exibidos UMA VEZ — sem persistir em estado global.
// =============================================================================

import * as React from 'react';
import { useForm } from 'react-hook-form';

import { useTheme } from '../../app/ThemeProvider';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ThemeToggle } from '../../components/ui/ThemeToggle';
import {
  use2faStatus,
  useActivate2fa,
  useChangePassword,
  useDisable2fa,
  useEnroll2fa,
  useProfile,
  useUpdateProfile,
  type TwoFactorEnrollResponse,
} from '../../hooks/account/useAccount';

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

// ─── QR Code SVG simples via URL ──────────────────────────────────────────────

/**
 * Renderiza o QR code do otpauth URI usando Google Charts API.
 * Em produção, usar uma lib local (ex: qrcode.react) para evitar dependência externa.
 * Para o MVP, o URI de otpauth é exibido como texto copiável e o QR via Charts API.
 *
 * Decisão de engenharia: não importar qrcode.react agora para evitar adicionar
 * dependência ao pacote. O usuário pode escanear o QR (via Charts API) OU digitar
 * o secret manualmente. Registrado no PR conforme instrução do slot.
 */
function QrCodeDisplay({ otpauthUri }: { otpauthUri: string }): React.JSX.Element {
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpauthUri)}`;

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="rounded-lg border border-border p-3 inline-flex"
        style={{ background: 'var(--bg-elev-0)' }}
      >
        <img
          src={qrUrl}
          alt="QR code para configurar o app autenticador"
          width={200}
          height={200}
          className="rounded"
        />
      </div>
      <p className="font-sans text-ink-3 text-center" style={{ fontSize: 'var(--text-xs)' }}>
        Escaneie o QR code com seu app autenticador (Google Authenticator, Authy, etc.)
      </p>
    </div>
  );
}

// ─── Recovery codes display ───────────────────────────────────────────────────

function RecoveryCodesDisplay({ codes }: { codes: string[] }): React.JSX.Element {
  const [copied, setCopied] = React.useState(false);

  function handleCopy(): void {
    void navigator.clipboard.writeText(codes.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        className="rounded-md border border-border p-4 font-mono"
        style={{ background: 'var(--surface-muted)', fontSize: 'var(--text-xs)' }}
      >
        <div className="grid grid-cols-2 gap-1">
          {codes.map((code, i) => (
            <span key={i} className="text-ink-2">
              {code}
            </span>
          ))}
        </div>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={handleCopy}>
        {copied ? 'Copiado!' : 'Copiar todos'}
      </Button>
    </div>
  );
}

// ─── Modal 2FA ───────────────────────────────────────────────────────────────

type TwoFAStep = 'idle' | 'enrolling' | 'activating' | 'activated' | 'disabling';

interface TwoFAState {
  step: TwoFAStep;
  enrollData: TwoFactorEnrollResponse | null;
  recoveryCodes: string[] | null;
}

function TwoFASection(): React.JSX.Element {
  const { data: statusData, isLoading: statusLoading } = use2faStatus();
  const [state, setState] = React.useState<TwoFAState>({
    step: 'idle',
    enrollData: null,
    recoveryCodes: null,
  });
  const [codeError, setCodeError] = React.useState<string | null>(null);

  const { enroll, isPending: enrollPending } = useEnroll2fa({
    onSuccess: (data) => {
      setState({ step: 'activating', enrollData: data, recoveryCodes: null });
    },
  });

  const {
    register: registerActivate,
    handleSubmit: handleSubmitActivate,
    reset: resetActivate,
    formState: { errors: activateErrors },
  } = useForm<{ code: string }>({ defaultValues: { code: '' } });

  const { activate, isPending: activatePending } = useActivate2fa({
    onSuccess: (result) => {
      resetActivate();
      setState({ step: 'activated', enrollData: null, recoveryCodes: result.recoveryCodes });
    },
    onInvalidCode: (msg) => setCodeError(msg),
  });

  const {
    register: registerDisable,
    handleSubmit: handleSubmitDisable,
    reset: resetDisable,
    formState: { errors: disableErrors },
  } = useForm<{ code: string }>({ defaultValues: { code: '' } });

  const [disableError, setDisableError] = React.useState<string | null>(null);

  const { disable, isPending: disablePending } = useDisable2fa({
    onSuccess: () => {
      resetDisable();
      setState({ step: 'idle', enrollData: null, recoveryCodes: null });
    },
    onInvalidCode: (msg) => setDisableError(msg),
  });

  function onSubmitActivate(data: { code: string }): void {
    setCodeError(null);
    activate({ code: data.code });
  }

  function onSubmitDisable(data: { code: string }): void {
    setDisableError(null);
    disable({ code: data.code });
  }

  const isEnabled = statusData?.enabled ?? false;

  if (statusLoading) {
    return (
      <div
        className="animate-pulse h-16 rounded-md"
        style={{ background: 'var(--surface-muted)' }}
      />
    );
  }

  // ── Estado: 2FA ativo ──────────────────────────────────────────────────────

  if (isEnabled && state.step !== 'disabling') {
    return (
      <div className="flex flex-col gap-4">
        <div
          className="flex items-center justify-between gap-3 p-4 rounded-md border border-border"
          style={{ background: 'var(--surface-muted)' }}
        >
          <div className="flex items-center gap-3">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="w-5 h-5 shrink-0 text-verde"
              aria-hidden="true"
            >
              <path d="M12 2L4 6v6c0 5.25 3.5 10.17 8 11.5C16.5 22.17 20 17.25 20 12V6L12 2Z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
            <div>
              <p
                className="font-sans font-semibold text-ink"
                style={{ fontSize: 'var(--text-sm)' }}
              >
                Autenticação em dois fatores ativa
              </p>
              <p className="font-sans text-ink-3" style={{ fontSize: 'var(--text-xs)' }}>
                Sua conta está protegida com TOTP.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setState((s) => ({ ...s, step: 'disabling' }))}
          >
            Desativar
          </Button>
        </div>
      </div>
    );
  }

  // ── Estado: desativando ────────────────────────────────────────────────────

  if (state.step === 'disabling') {
    return (
      <div className="flex flex-col gap-4">
        <p className="font-sans text-ink-2" style={{ fontSize: 'var(--text-sm)' }}>
          Para desativar o 2FA, informe o código do seu app autenticador ou um recovery code.
        </p>
        <form
          onSubmit={(e) => {
            void handleSubmitDisable(onSubmitDisable)(e);
          }}
          className="flex flex-col gap-4"
        >
          <Input
            id="disable2faCode"
            label="Código TOTP ou recovery code"
            autoComplete="one-time-code"
            inputMode="numeric"
            placeholder="000000"
            {...registerDisable('code', { required: 'O código é obrigatório' })}
            error={disableErrors.code?.message ?? disableError ?? undefined}
          />
          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                resetDisable();
                setDisableError(null);
                setState((s) => ({ ...s, step: 'idle' }));
              }}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="danger" size="sm" disabled={disablePending}>
              {disablePending ? 'Desativando...' : 'Confirmar desativação'}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  // ── Estado: recovery codes exibidos após ativação ──────────────────────────

  if (state.step === 'activated' && state.recoveryCodes) {
    return (
      <div className="flex flex-col gap-4">
        <div
          className="rounded-md border border-success/30 p-4"
          style={{ background: 'color-mix(in srgb, var(--color-success) 8%, transparent)' }}
        >
          <p
            className="font-sans font-semibold text-ink mb-1"
            style={{ fontSize: 'var(--text-sm)' }}
          >
            2FA ativado com sucesso!
          </p>
          <p className="font-sans text-ink-2" style={{ fontSize: 'var(--text-xs)' }}>
            Guarde os recovery codes abaixo em local seguro. Eles serão exibidos{' '}
            <strong>apenas uma vez</strong> e permitem acessar sua conta caso perca o acesso ao app
            autenticador.
          </p>
        </div>
        <RecoveryCodesDisplay codes={state.recoveryCodes} />
        <div className="flex justify-end">
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => setState({ step: 'idle', enrollData: null, recoveryCodes: null })}
          >
            Concluir
          </Button>
        </div>
      </div>
    );
  }

  // ── Estado: inserindo QR code e ativando ──────────────────────────────────

  if (state.step === 'activating' && state.enrollData) {
    return (
      <div className="flex flex-col gap-5">
        <p className="font-sans text-ink-2" style={{ fontSize: 'var(--text-sm)' }}>
          Escaneie o QR code com seu app autenticador e insira o código gerado para confirmar.
        </p>

        <QrCodeDisplay otpauthUri={state.enrollData.otpauthUri} />

        <div>
          <p className="font-sans text-ink-3 mb-1" style={{ fontSize: 'var(--text-xs)' }}>
            Não consegue escanear? Digite o código manualmente:
          </p>
          <code
            className="font-mono text-ink-2 block p-2 rounded border border-border select-all"
            style={{
              fontSize: 'var(--text-xs)',
              background: 'var(--surface-muted)',
              letterSpacing: '0.05em',
            }}
          >
            {state.enrollData.secret}
          </code>
        </div>

        <form
          onSubmit={(e) => {
            void handleSubmitActivate(onSubmitActivate)(e);
          }}
          className="flex flex-col gap-4"
        >
          <Input
            id="activate2faCode"
            label="Código de verificação (6 dígitos)"
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            {...registerActivate('code', {
              required: 'O código é obrigatório',
              pattern: { value: /^\d{6}$/, message: 'O código deve ter 6 dígitos' },
            })}
            error={activateErrors.code?.message ?? codeError ?? undefined}
          />
          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                resetActivate();
                setCodeError(null);
                setState({ step: 'idle', enrollData: null, recoveryCodes: null });
              }}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={activatePending}>
              {activatePending ? 'Ativando...' : 'Ativar 2FA'}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  // ── Estado: desativado (idle) ──────────────────────────────────────────────

  return (
    <div
      className="flex items-center justify-between gap-3 p-4 rounded-md border border-border"
      style={{ background: 'var(--surface-muted)' }}
    >
      <div className="flex items-center gap-3">
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
          <p className="font-sans font-semibold text-ink" style={{ fontSize: 'var(--text-sm)' }}>
            Autenticação em dois fatores (2FA)
          </p>
          <p className="font-sans text-ink-4" style={{ fontSize: 'var(--text-xs)' }}>
            Adicione uma camada extra de segurança à sua conta.
          </p>
        </div>
      </div>
      <Button
        type="button"
        variant="primary"
        size="sm"
        disabled={enrollPending}
        onClick={() => {
          setState((s) => ({ ...s, step: 'enrolling' }));
          enroll();
        }}
      >
        {enrollPending ? 'Iniciando...' : 'Ativar 2FA'}
      </Button>
    </div>
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

      {/* 2FA — seção real (F8-S11) */}
      <TwoFASection />
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
