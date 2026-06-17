// =============================================================================
// features/configuracoes/canais/CanaisPage.tsx — Gerenciamento de canais de
// mensagem (WhatsApp Business via Meta API).
//
// Estrutura:
//   - Seção superior: canais conectados (lista com esqueleto, estado vazio, erro)
//   - Seção inferior: formulário de conexão de novo canal (meta_whatsapp)
//
// Acesso: channel.connect (verificado no backend; UI usa hasPermission para o form).
// DS: elev-2 (cards), Lift hover, tokens canônicos. Light + dark.
// LGPD: campos sensíveis (accessToken, appSecret) jamais logados.
// =============================================================================

import * as React from 'react';
import { useForm } from 'react-hook-form';

import { useAuth } from '../../../lib/auth-store';
import { cn } from '../../../lib/cn';

import {
  type ChannelResponse,
  type ConnectMetaWhatsAppBody,
  useChannels,
  useConnectChannel,
  useDeleteChannel,
  useSetDefaultChannel,
} from './useChannels';

// ─── Ícones SVG inline ────────────────────────────────────────────────────────

function IconWhatsApp(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
      <path d="M12 0C5.373 0 0 5.373 0 12c0 2.117.549 4.107 1.51 5.838L.057 23.885c-.07.273.09.549.364.617.06.015.12.022.18.022.213 0 .42-.085.571-.248l4.12-4.374A11.942 11.942 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.815 9.815 0 0 1-5.27-1.533l-.377-.225-3.91 1.024 1.048-3.824-.247-.396A9.789 9.789 0 0 1 2.182 12C2.182 6.57 6.57 2.182 12 2.182S21.818 6.57 21.818 12 17.43 21.818 12 21.818z" />
    </svg>
  );
}

function IconEye({ visible }: { visible: boolean }): React.JSX.Element {
  return visible ? (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      className="w-4 h-4"
      aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      className="w-4 h-4"
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function IconPlug(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="w-6 h-6 shrink-0"
      aria-hidden="true"
    >
      <path d="M12 22v-5" strokeLinecap="round" />
      <path d="M9 8V2" strokeLinecap="round" />
      <path d="M15 8V2" strokeLinecap="round" />
      <path d="M18 8H6a1 1 0 0 0-1 1v3a7 7 0 0 0 7 7 7 7 0 0 0 7-7V9a1 1 0 0 0-1-1Z" />
    </svg>
  );
}

function IconTrash(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      className="w-4 h-4"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" strokeLinecap="round" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

// ─── Esqueleto de loading ─────────────────────────────────────────────────────

function ChannelSkeleton(): React.JSX.Element {
  return (
    <div
      className="flex items-center gap-4 p-4 rounded-lg border border-border animate-pulse"
      style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-1)' }}
      aria-hidden="true"
    >
      <div
        className="w-10 h-10 rounded-md shrink-0"
        style={{ background: 'var(--surface-muted)' }}
      />
      <div className="flex-1 flex flex-col gap-2">
        <div className="h-4 w-40 rounded" style={{ background: 'var(--surface-muted)' }} />
        <div className="h-3 w-56 rounded" style={{ background: 'var(--surface-muted)' }} />
      </div>
      <div className="h-6 w-14 rounded-full" style={{ background: 'var(--surface-muted)' }} />
    </div>
  );
}

// ─── Badge de status ──────────────────────────────────────────────────────────

function StatusBadge({ isActive }: { isActive: boolean }): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-sans text-xs font-medium',
        isActive ? 'bg-verde/10 text-verde' : 'bg-ink-4/10 text-ink-3',
      )}
    >
      <span
        className={cn('w-1.5 h-1.5 rounded-full', isActive ? 'bg-verde' : 'bg-ink-4')}
        aria-hidden="true"
      />
      {isActive ? 'Ativo' : 'Inativo'}
    </span>
  );
}

// ─── Badge / botão de canal padrão ───────────────────────────────────────────

type DefaultState = 'is_default' | 'set_default' | 'only_one';

interface DefaultBadgeButtonProps {
  state: DefaultState;
  onSetDefault: () => void;
  isPending: boolean;
  error: string | null;
}

function DefaultBadgeButton({
  state,
  onSetDefault,
  isPending,
  error,
}: DefaultBadgeButtonProps): React.JSX.Element {
  if (state === 'is_default') {
    return (
      <span
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-sans text-xs font-semibold"
        style={{ background: 'var(--success-bg)', color: 'var(--success)' }}
        aria-label="Canal padrão da organização"
      >
        {/* Check icon */}
        <svg
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="w-3 h-3 shrink-0"
          aria-hidden="true"
        >
          <path d="M2 6l3 3 5-5" />
        </svg>
        Padrão
      </span>
    );
  }

  if (state === 'only_one') {
    return (
      <span
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-sans text-xs font-medium"
        style={{ background: 'var(--surface-muted)', color: 'var(--text-3)' }}
        aria-label="Canal único — é o padrão implícito"
      >
        Único canal
      </span>
    );
  }

  // state === 'set_default'
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onSetDefault}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-sans text-xs font-medium border border-border text-ink-3 transition-all duration-fast hover:text-azul hover:border-azul/40 hover:bg-azul/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label="Definir como canal padrão"
      >
        {isPending ? (
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="w-3 h-3 animate-spin shrink-0"
            aria-hidden="true"
          >
            <circle cx="8" cy="8" r="5.5" strokeOpacity={0.25} />
            <path d="M8 2.5a5.5 5.5 0 0 1 5.5 5.5" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            className="w-3 h-3 shrink-0"
            aria-hidden="true"
          >
            <circle cx="6" cy="6" r="4.5" />
            <path d="M6 3.5v2.5l1.5 1.5" strokeLinecap="round" />
          </svg>
        )}
        {isPending ? 'Definindo…' : 'Definir como padrão'}
      </button>
      {error && (
        <span className="font-sans text-xs" style={{ color: 'var(--danger)' }} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

// ─── Diálogo de confirmação de desconexão ─────────────────────────────────────

interface ConfirmDialogProps {
  channelName: string;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}

function ConfirmDialog({
  channelName,
  onConfirm,
  onCancel,
  isPending,
}: ConfirmDialogProps): React.JSX.Element {
  // Fecha no Escape
  React.useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="w-full max-w-sm rounded-xl p-6 flex flex-col gap-4"
        style={{
          background: 'var(--bg-elev-2)',
          boxShadow: 'var(--elev-5)',
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Confirmar desconexão de canal"
      >
        <div className="flex flex-col gap-1">
          <h2
            className="font-display font-bold text-ink"
            style={{ fontSize: 'var(--text-lg)', letterSpacing: '-0.025em' }}
          >
            Desconectar canal?
          </h2>
          <p className="font-sans text-sm text-ink-3">
            O canal <strong className="text-ink font-medium">{channelName}</strong> será removido.
            Conversas existentes não serão apagadas.
          </p>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="px-4 py-2 rounded-sm font-sans font-medium text-sm text-ink-3 border border-border transition-colors duration-fast hover:text-ink hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="px-4 py-2 rounded-sm font-sans font-semibold text-sm text-white transition-[transform,box-shadow] duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30 disabled:opacity-50 hover:-translate-y-0.5 active:translate-y-0"
            style={{
              background: 'var(--danger, #dc2626)',
              boxShadow: 'var(--elev-2)',
            }}
          >
            {isPending ? 'Desconectando…' : 'Desconectar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Card de canal conectado ──────────────────────────────────────────────────

interface ChannelCardProps {
  channel: ChannelResponse;
  defaultState: DefaultState;
  onDisconnect: (id: string) => void;
  isDisconnecting: boolean;
  onSetDefault: (id: string) => void;
  isSettingDefault: boolean;
  setDefaultError: string | null;
}

function ChannelCard({
  channel,
  defaultState,
  onDisconnect,
  isDisconnecting,
  onSetDefault,
  isSettingDefault,
  setDefaultError,
}: ChannelCardProps): React.JSX.Element {
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  return (
    <>
      <div
        className="flex items-center gap-4 p-4 rounded-lg border border-border transition-all duration-[250ms] ease-out"
        style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-2)' }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--elev-3)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--elev-2)';
        }}
      >
        {/* Ícone do provedor */}
        <div
          className="flex items-center justify-center w-10 h-10 rounded-md shrink-0"
          style={{
            background: '#25D366',
            color: '#fff',
          }}
          aria-hidden="true"
        >
          <IconWhatsApp />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p
            className="font-sans font-semibold text-ink truncate"
            style={{ fontSize: 'var(--text-sm)' }}
          >
            {channel.name}
          </p>
          {channel.phone_number_id && (
            <p className="font-mono text-xs text-ink-3 mt-0.5 truncate">
              {channel.phone_number_id}
            </p>
          )}
          {channel.display_handle && !channel.phone_number_id && (
            <p className="font-mono text-xs text-ink-3 mt-0.5 truncate">{channel.display_handle}</p>
          )}
        </div>

        {/* Badge padrão + badge status + botão excluir */}
        <div className="flex items-center gap-3 shrink-0 flex-wrap justify-end">
          <DefaultBadgeButton
            state={defaultState}
            onSetDefault={() => onSetDefault(channel.id)}
            isPending={isSettingDefault}
            error={setDefaultError}
          />
          <StatusBadge isActive={channel.is_active} />
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={isDisconnecting}
            className="flex items-center justify-center w-8 h-8 rounded-md text-ink-4 border border-transparent transition-colors duration-fast hover:text-danger hover:border-danger/30 hover:bg-danger/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/20 disabled:opacity-40"
            aria-label={`Desconectar ${channel.name}`}
          >
            <IconTrash />
          </button>
        </div>
      </div>

      {confirmOpen && (
        <ConfirmDialog
          channelName={channel.name}
          onConfirm={() => {
            onDisconnect(channel.id);
            setConfirmOpen(false);
          }}
          onCancel={() => setConfirmOpen(false)}
          isPending={isDisconnecting}
        />
      )}
    </>
  );
}

// ─── Seção de canais conectados ───────────────────────────────────────────────

interface ConnectedChannelsSectionProps {
  channels: ChannelResponse[];
  isLoading: boolean;
  isError: boolean;
  onRefetch: () => void;
  onDisconnect: (id: string) => void;
  disconnectingId: string | null;
  isPendingDisconnect: boolean;
  onSetDefault: (id: string) => void;
  settingDefaultId: string | null;
  isPendingSetDefault: boolean;
  setDefaultErrors: Record<string, string>;
}

function ConnectedChannelsSection({
  channels,
  isLoading,
  isError,
  onRefetch,
  onDisconnect,
  disconnectingId,
  isPendingDisconnect,
  onSetDefault,
  settingDefaultId,
  isPendingSetDefault,
  setDefaultErrors,
}: ConnectedChannelsSectionProps): React.JSX.Element {
  if (isError) {
    return (
      <div
        className="flex flex-col items-center justify-center py-8 gap-3 rounded-lg border border-border text-center"
        style={{ background: 'var(--bg-elev-1)' }}
      >
        <p className="font-sans text-sm text-ink-3">Não foi possível carregar os canais.</p>
        <button
          type="button"
          onClick={onRefetch}
          className="font-sans text-sm font-medium text-azul underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20 rounded-sm"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Carregando canais">
        <ChannelSkeleton />
        <ChannelSkeleton />
      </div>
    );
  }

  if (channels.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-10 gap-2 rounded-lg border border-dashed border-border text-center"
        style={{ background: 'var(--bg-elev-1)' }}
      >
        <div
          className="flex items-center justify-center w-10 h-10 rounded-full"
          style={{ background: 'var(--surface-muted)', color: 'var(--brand-azul)' }}
          aria-hidden="true"
        >
          <IconPlug />
        </div>
        <p className="font-sans font-medium text-ink" style={{ fontSize: 'var(--text-sm)' }}>
          Nenhum canal conectado
        </p>
        <p className="font-sans text-xs text-ink-3 max-w-xs">
          Conecte um canal do WhatsApp Business abaixo para começar a receber mensagens no inbox.
        </p>
      </div>
    );
  }

  const isOnlyOne = channels.length === 1;

  return (
    <div className="flex flex-col gap-2">
      {channels.map((channel) => {
        let defaultState: DefaultState;
        if (isOnlyOne) {
          defaultState = 'only_one';
        } else if (channel.is_default) {
          defaultState = 'is_default';
        } else {
          defaultState = 'set_default';
        }

        return (
          <ChannelCard
            key={channel.id}
            channel={channel}
            defaultState={defaultState}
            onDisconnect={onDisconnect}
            isDisconnecting={isPendingDisconnect && disconnectingId === channel.id}
            onSetDefault={onSetDefault}
            isSettingDefault={isPendingSetDefault && settingDefaultId === channel.id}
            setDefaultError={setDefaultErrors[channel.id] ?? null}
          />
        );
      })}
    </div>
  );
}

// ─── Primitivos de formulário ──────────────────────────────────────────────────

interface FieldProps {
  label: string;
  id: string;
  error?: string | undefined;
  children: React.ReactNode;
}

function Field({ label, id, error, children }: FieldProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="font-sans font-medium text-ink-2"
        style={{ fontSize: 'var(--text-sm)' }}
      >
        {label}
      </label>
      {children}
      {error && <p className="font-sans text-xs text-danger">{error}</p>}
    </div>
  );
}

interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean | undefined;
}

const TextInput = React.forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { hasError, className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      {...props}
      className={cn(
        'w-full rounded-md border px-3 py-2.5 font-sans text-sm text-ink bg-surface-1',
        'placeholder:text-ink-4',
        'transition-[border-color,box-shadow] duration-fast',
        'focus:outline-none focus:ring-2',
        hasError
          ? 'border-danger/50 focus:border-danger focus:ring-danger/15'
          : 'border-border focus:border-azul/60 focus:ring-azul/10',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className,
      )}
      style={{
        boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.06)',
      }}
    />
  );
});

interface PasswordInputProps {
  id: string;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  hasError?: boolean | undefined;
  registration: React.InputHTMLAttributes<HTMLInputElement>;
}

function PasswordInput({
  id,
  placeholder,
  disabled,
  hasError,
  registration,
}: PasswordInputProps): React.JSX.Element {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className="relative">
      <TextInput
        {...registration}
        id={id}
        type={visible ? 'text' : 'password'}
        placeholder={placeholder}
        disabled={disabled}
        hasError={hasError}
        className="pr-10"
        autoComplete="off"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        disabled={disabled}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-4 hover:text-ink transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20 rounded-sm"
        aria-label={visible ? 'Ocultar campo' : 'Mostrar campo'}
      >
        <IconEye visible={visible} />
      </button>
    </div>
  );
}

// ─── Formulário de conexão ────────────────────────────────────────────────────

type ConnectFormValues = {
  name: string;
  phoneNumber: string;
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
  appSecret: string;
};

function ConnectChannelForm(): React.JSX.Element {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ConnectFormValues>({
    defaultValues: {
      name: '',
      phoneNumber: '',
      phoneNumberId: '',
      wabaId: '',
      accessToken: '',
      appSecret: '',
    },
  });

  const { connect, isPending } = useConnectChannel({
    onSuccess: () => reset(),
  });

  const onSubmit = (values: ConnectFormValues): void => {
    const body: ConnectMetaWhatsAppBody = {
      provider: 'meta_whatsapp',
      name: values.name,
      phoneNumber: values.phoneNumber,
      accessToken: values.accessToken,
      appSecret: values.appSecret,
      phoneNumberId: values.phoneNumberId,
      wabaId: values.wabaId,
      cityId: null,
    };
    connect(body);
  };

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(onSubmit)(e);
      }}
      noValidate
      className="flex flex-col gap-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome do canal" id="channel-name" error={errors.name?.message}>
          <TextInput
            {...register('name', { required: 'Nome é obrigatório' })}
            id="channel-name"
            placeholder="WhatsApp Banco do Povo"
            disabled={isPending}
            hasError={!!errors.name}
            autoComplete="off"
          />
        </Field>

        <Field label="Número de telefone" id="channel-phone" error={errors.phoneNumber?.message}>
          <TextInput
            {...register('phoneNumber', { required: 'Número é obrigatório' })}
            id="channel-phone"
            placeholder="+5569999999999"
            disabled={isPending}
            hasError={!!errors.phoneNumber}
            autoComplete="off"
          />
        </Field>

        <Field label="Phone Number ID" id="channel-phone-id" error={errors.phoneNumberId?.message}>
          <TextInput
            {...register('phoneNumberId', { required: 'Phone Number ID é obrigatório' })}
            id="channel-phone-id"
            placeholder="123456789012345"
            disabled={isPending}
            hasError={!!errors.phoneNumberId}
            autoComplete="off"
          />
        </Field>

        <Field label="WABA ID" id="channel-waba" error={errors.wabaId?.message}>
          <TextInput
            {...register('wabaId', { required: 'WABA ID é obrigatório' })}
            id="channel-waba"
            placeholder="987654321098765"
            disabled={isPending}
            hasError={!!errors.wabaId}
            autoComplete="off"
          />
        </Field>

        <Field label="Access Token" id="channel-token" error={errors.accessToken?.message}>
          <PasswordInput
            id="channel-token"
            placeholder="System User Token"
            disabled={isPending}
            hasError={!!errors.accessToken}
            registration={register('accessToken', { required: 'Access Token é obrigatório' })}
          />
        </Field>

        <Field label="App Secret" id="channel-secret" error={errors.appSecret?.message}>
          <PasswordInput
            id="channel-secret"
            placeholder="App Secret do Meta App"
            disabled={isPending}
            hasError={!!errors.appSecret}
            registration={register('appSecret', { required: 'App Secret é obrigatório' })}
          />
        </Field>
      </div>

      <div className="flex justify-end pt-1">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-sm font-sans font-semibold text-sm text-white transition-[transform,box-shadow] duration-fast ease focus-visible:ring-2 focus-visible:ring-azul/40 focus-visible:outline-none hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0"
          style={{
            background: 'var(--grad-azul)',
            boxShadow: 'var(--elev-2),inset 0 1px 0 rgba(255,255,255,0.15)',
          }}
          onMouseEnter={(e) => {
            if (!(e.currentTarget as HTMLButtonElement).disabled) {
              (e.currentTarget as HTMLButtonElement).style.boxShadow =
                'var(--glow-azul),inset 0 1px 0 rgba(255,255,255,0.2)';
            }
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.boxShadow =
              'var(--elev-2),inset 0 1px 0 rgba(255,255,255,0.15)';
          }}
        >
          {isPending ? (
            <>
              <svg
                className="w-4 h-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
              Conectando…
            </>
          ) : (
            <>
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className="w-4 h-4"
                aria-hidden="true"
              >
                <path d="M8 3v10M3 8h10" />
              </svg>
              Conectar canal
            </>
          )}
        </button>
      </div>
    </form>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

/**
 * Página de gerenciamento de canais de mensagem (/admin/canais).
 * Acesso controlado por channel.connect.
 */
export function CanaisPage(): React.JSX.Element {
  const { hasPermission } = useAuth();
  const canConnect = hasPermission('channel.connect');

  const { channels, isLoading, isError, refetch } = useChannels();
  const { deleteChannel, isPending: isDeleting, pendingId: deletingId } = useDeleteChannel();

  // Erros inline por canal (sem toast — conforme DoD)
  const [setDefaultErrors, setSetDefaultErrors] = React.useState<Record<string, string>>({});

  // pendingChannelIdRef: rastreia qual canal está sendo definido como padrão
  // para associar o erro ao canal correto no onError
  const pendingChannelIdRef = React.useRef<string | null>(null);

  const {
    setDefault: setDefaultMutation,
    isPending: isSettingDefault,
    pendingId: settingDefaultId,
  } = useSetDefaultChannel({
    onSuccess: () => {
      if (pendingChannelIdRef.current) {
        setSetDefaultErrors((prev) => {
          const next = { ...prev };
          delete next[pendingChannelIdRef.current!];
          return next;
        });
      }
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Erro ao definir canal padrão.';
      if (pendingChannelIdRef.current) {
        const id = pendingChannelIdRef.current;
        setSetDefaultErrors((prev) => ({ ...prev, [id]: msg }));
      }
    },
  });

  const handleSetDefault = React.useCallback(
    (channelId: string): void => {
      pendingChannelIdRef.current = channelId;
      // Limpa erro anterior deste canal antes de nova tentativa
      setSetDefaultErrors((prev) => {
        if (!prev[channelId]) return prev;
        const next = { ...prev };
        delete next[channelId];
        return next;
      });
      setDefaultMutation(channelId);
    },
    [setDefaultMutation],
  );

  return (
    <div
      className="flex flex-col gap-8"
      style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) both' }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1
            className="font-display font-bold text-ink"
            style={{
              fontSize: 'var(--text-3xl)',
              letterSpacing: '-0.04em',
              fontVariationSettings: "'opsz' 48",
            }}
          >
            Canais de Mensagem
          </h1>
          <p className="font-sans text-sm text-ink-3 mt-1">
            Gerencie os canais do WhatsApp Business conectados ao inbox.
          </p>
        </div>
      </div>

      {/* ── Canais conectados ───────────────────────────────────────────────── */}
      <div
        className="flex flex-col gap-4"
        style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) 0.05s both' }}
      >
        <h2
          className="font-sans font-semibold uppercase tracking-widest text-ink-3"
          style={{ fontSize: '0.7rem', letterSpacing: '0.12em' }}
        >
          Canais conectados
        </h2>
        <ConnectedChannelsSection
          channels={channels}
          isLoading={isLoading}
          isError={isError}
          onRefetch={() => void refetch()}
          onDisconnect={deleteChannel}
          disconnectingId={deletingId}
          isPendingDisconnect={isDeleting}
          onSetDefault={handleSetDefault}
          settingDefaultId={settingDefaultId}
          isPendingSetDefault={isSettingDefault}
          setDefaultErrors={setDefaultErrors}
        />
      </div>

      {/* ── Conectar novo canal (gated por permissão) ───────────────────────── */}
      {canConnect && (
        <div
          className="flex flex-col gap-4"
          style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) 0.1s both' }}
        >
          <h2
            className="font-sans font-semibold uppercase tracking-widest text-ink-3"
            style={{ fontSize: '0.7rem', letterSpacing: '0.12em' }}
          >
            Conectar novo canal
          </h2>
          <div
            className="rounded-lg border border-border p-5"
            style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-2)' }}
          >
            <ConnectChannelForm />
          </div>
        </div>
      )}
    </div>
  );
}
