// =============================================================================
// features/admin/users/UserDrawer.tsx — Drawer create/edit de usuário (F8-S02).
//
// DS:
//   - Drawer lateral direito: z-[160], elev-5, slide-in-right.
//   - Form: React Hook Form + Zod.
//   - Create: email + nome + senha temporária (mostrada após criação com botão copiar).
//   - Edit: nome + email (sem senha) + roles + city scopes.
//   - Roles: UserRoleSelect (multi-select com chips).
//   - City Scopes: UserCityScopesSelect (multi-select com busca).
//   - Desativar/reativar com confirmação no edit.
//   - Bloqueia remoção da última role admin (Toast warning).
//
// Props:
//   - open: boolean
//   - onClose: () => void
//   - userId?: string — sem userId = create; com = edit
//   - user?: UserResponse — dados do usuário em modo edit (da lista)
//   - onCreated?: (result: CreateUserResponse) => void
// =============================================================================

import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { useToast } from '../../../components/ui/Toast';
import {
  useCreateUser,
  useDeactivateUser,
  useReactivateUser,
  useRoles,
  useSetUserCityScopes,
  useSetUserRoles,
  useUpdateUser,
} from '../../../hooks/admin/useUsers';
import type { CreateUserResponse, UserResponse } from '../../../hooks/admin/useUsers.types';
import { GLOBAL_ROLE_KEYS } from '../../../hooks/admin/useUsers.types';
import { cn } from '../../../lib/cn';

import { UserCityScopesSelect } from './UserCityScopesSelect';
import { UserRoleSelect } from './UserRoleSelect';

// ---------------------------------------------------------------------------
// Schemas Zod
// ---------------------------------------------------------------------------

const UserFormSchema = z.object({
  fullName: z.string().min(2, 'Nome completo obrigatório').max(255).trim(),
  email: z.string().email('Email inválido').max(254),
  roleIds: z.array(z.string().uuid()).min(1, 'Pelo menos 1 role é obrigatória'),
  cityIds: z.array(z.string().uuid()).default([]),
});

type UserFormValues = z.infer<typeof UserFormSchema>;

// ---------------------------------------------------------------------------
// Tela de sucesso na criação — mostra senha temporária
// ---------------------------------------------------------------------------

interface TempPasswordScreenProps {
  tempPassword: string;
  onClose: () => void;
}

function TempPasswordScreen({ tempPassword, onClose }: TempPasswordScreenProps): React.JSX.Element {
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);

  return (
    <div className="flex flex-col gap-5 px-6 py-6">
      <div
        className="flex items-start gap-3 p-4 rounded-sm border"
        style={{ background: 'var(--success-bg)', borderColor: 'var(--success)' }}
      >
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          className="w-5 h-5 shrink-0 mt-0.5"
          style={{ color: 'var(--success)' }}
          aria-hidden="true"
        >
          <path d="M4 10l4 4 8-8" />
        </svg>
        <div>
          <p className="font-sans font-semibold text-sm text-ink">Usuário criado com sucesso!</p>
          <p className="font-sans text-xs text-ink-3 mt-0.5">
            Compartilhe a senha temporária. O usuário deverá alterá-la no primeiro acesso.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="font-sans text-xs font-semibold text-ink-3 uppercase tracking-[0.1em]">
          Senha temporária
        </label>
        <div
          className="flex items-center gap-2 px-4 py-3 rounded-sm border border-border"
          style={{ background: 'var(--bg-elev-2)' }}
        >
          <code
            className="font-mono flex-1 text-sm font-semibold select-all"
            style={{ color: 'var(--brand-azul)', letterSpacing: '-0.01em' }}
          >
            {tempPassword}
          </code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(tempPassword).then(() => {
                setCopied(true);
                toast('Senha copiada!', 'success');
                setTimeout(() => setCopied(false), 2000);
              });
            }}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-sm shrink-0',
              'font-sans text-xs font-semibold',
              'border transition-all duration-fast',
              copied
                ? 'border-success text-success bg-success/10'
                : 'border-border text-ink-3 hover:border-ink-3 hover:text-ink hover:bg-surface-hover',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
            )}
          >
            {copied ? (
              <>
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className="w-3.5 h-3.5"
                  aria-hidden="true"
                >
                  <path d="M3 8l3.5 3.5 6.5-7" />
                </svg>
                Copiado
              </>
            ) : (
              <>
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                  className="w-3.5 h-3.5"
                  aria-hidden="true"
                >
                  <rect x="6" y="4" width="8" height="10" rx="1" />
                  <path d="M4 12H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v1" />
                </svg>
                Copiar
              </>
            )}
          </button>
        </div>
        <p className="font-sans text-xs text-ink-4">
          Esta senha não será exibida novamente. Guarde-a em local seguro.
        </p>
      </div>

      <Button type="button" variant="primary" onClick={onClose} className="w-full mt-2">
        Fechar
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form de criação
// ---------------------------------------------------------------------------

interface CreateFormProps {
  onClose: () => void;
  onCreated?: ((result: CreateUserResponse) => void) | undefined;
}

function CreateUserForm({ onClose, onCreated }: CreateFormProps): React.JSX.Element {
  const { toast } = useToast();
  const [createdResult, setCreatedResult] = React.useState<CreateUserResponse | null>(null);

  const { roles, isLoading: rolesLoading } = useRoles();

  const {
    register,
    control,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<UserFormValues>({
    resolver: zodResolver(UserFormSchema),
    defaultValues: { fullName: '', email: '', roleIds: [], cityIds: [] },
  });

  const { createUser: doCreate, isPending: isCreating } = useCreateUser({
    onSuccess: (result) => {
      setCreatedResult(result);
      onCreated?.(result);
    },
    onConflict: (msg) => setError('email', { type: 'manual', message: msg }),
  });

  const isBusy = isSubmitting || isCreating;

  const roleIds = watch('roleIds');
  const hasGlobalRole = roles.some((r) => roleIds.includes(r.id) && GLOBAL_ROLE_KEYS.has(r.key));

  if (createdResult) {
    return <TempPasswordScreen tempPassword={createdResult.tempPassword} onClose={onClose} />;
  }

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit((data) =>
          doCreate({
            fullName: data.fullName,
            email: data.email,
            roleIds: data.roleIds,
            cityIds: data.cityIds,
          }),
        )(e);
      }}
      noValidate
      className="flex flex-col gap-5 px-6 py-6"
    >
      <Input
        id="user-create-fullname"
        label="Nome completo"
        placeholder="Ex: Ana Paula Silva"
        required
        error={errors.fullName?.message}
        {...register('fullName')}
      />

      <Input
        id="user-create-email"
        type="email"
        label="Email"
        placeholder="usuario@banco.ro.gov.br"
        required
        error={errors.email?.message}
        {...register('email')}
      />

      {/* Roles */}
      <div className="flex flex-col gap-2">
        <label className="font-sans text-xs font-semibold text-ink-3 uppercase tracking-[0.1em]">
          Roles{' '}
          <span className="text-danger normal-case tracking-normal" aria-hidden="true">
            *
          </span>
        </label>
        {rolesLoading ? (
          <div
            className="h-9 rounded-sm animate-pulse"
            style={{ background: 'var(--surface-muted)' }}
            aria-hidden="true"
          />
        ) : (
          <Controller
            name="roleIds"
            control={control}
            render={({ field }) => (
              <UserRoleSelect
                value={field.value}
                onChange={field.onChange}
                roles={roles}
                error={errors.roleIds?.message}
                onLastAdminWarning={() =>
                  toast('Não é possível remover a última role admin.', 'danger')
                }
              />
            )}
          />
        )}
      </div>

      {/* Escopo de cidades */}
      <div className="flex flex-col gap-2">
        <label className="font-sans text-xs font-semibold text-ink-3 uppercase tracking-[0.1em]">
          Escopo de cidades
        </label>
        <Controller
          name="cityIds"
          control={control}
          render={({ field }) => (
            <UserCityScopesSelect
              value={field.value}
              onChange={field.onChange}
              isGlobal={hasGlobalRole}
            />
          )}
        />
      </div>

      <div className="flex gap-3 pt-1 border-t border-border-subtle">
        <Button
          type="button"
          variant="ghost"
          onClick={onClose}
          disabled={isBusy}
          className="flex-1"
        >
          Cancelar
        </Button>
        <Button type="submit" variant="primary" disabled={isBusy} className="flex-1">
          {isBusy ? 'Criando...' : 'Criar usuário'}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Form de edição
// ---------------------------------------------------------------------------

interface EditFormProps {
  userId: string;
  user: UserResponse;
  onClose: () => void;
}

function EditUserForm({ userId, user, onClose }: EditFormProps): React.JSX.Element {
  const { toast } = useToast();
  const { roles, isLoading: rolesLoading } = useRoles();

  const { updateUser: doUpdate, isPending: isUpdating } = useUpdateUser({
    onConflict: (msg) => setError('email', { type: 'manual', message: msg }),
  });

  const { setRoles: doSetRoles, isPending: isSettingRoles } = useSetUserRoles();
  const { setCityScopes: doSetCityScopes, isPending: isSettingScopes } = useSetUserCityScopes();

  const { deactivate: doDeactivate, isPending: isDeactivating } = useDeactivateUser({
    onSuccess: () => onClose(),
  });

  const { reactivate: doReactivate, isPending: isReactivating } = useReactivateUser({
    onSuccess: () => onClose(),
  });

  const {
    register,
    control,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<UserFormValues>({
    resolver: zodResolver(UserFormSchema),
    defaultValues: {
      fullName: user.fullName,
      email: user.email,
      roleIds: [],
      cityIds: [],
    },
  });

  const roleIds = watch('roleIds');
  const hasGlobalRole = roles.some((r) => roleIds.includes(r.id) && GLOBAL_ROLE_KEYS.has(r.key));

  const isBusy =
    isSubmitting ||
    isUpdating ||
    isSettingRoles ||
    isSettingScopes ||
    isDeactivating ||
    isReactivating;
  const isActive = user.status === 'active';

  const onSubmit = (data: UserFormValues): void => {
    // 1. Atualiza campos básicos
    doUpdate(userId, { fullName: data.fullName, email: data.email });

    // 2. Atualiza roles (se selecionadas)
    if (data.roleIds.length > 0) {
      doSetRoles(userId, { roleIds: data.roleIds });
    }

    // 3. Atualiza city scopes (vazias se acesso global)
    doSetCityScopes(userId, { cityIds: hasGlobalRole ? [] : data.cityIds });

    // Fechar após disparar as 3 mutations (são fire-and-forget com invalidação)
    onClose();
  };

  function handleDeactivate(): void {
    if (
      window.confirm(`Desativar "${user.fullName}"?\nO usuário não conseguirá mais fazer login.`)
    ) {
      doDeactivate(userId);
    }
  }

  function handleReactivate(): void {
    doReactivate(userId);
  }

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(onSubmit)(e);
      }}
      noValidate
      className="flex flex-col gap-5 px-6 py-6"
    >
      <Input
        id="user-edit-fullname"
        label="Nome completo"
        required
        error={errors.fullName?.message}
        {...register('fullName')}
      />

      <Input
        id="user-edit-email"
        type="email"
        label="Email"
        required
        error={errors.email?.message}
        {...register('email')}
      />

      {/* Roles */}
      <div className="flex flex-col gap-2">
        <label className="font-sans text-xs font-semibold text-ink-3 uppercase tracking-[0.1em]">
          Roles{' '}
          <span className="text-danger normal-case tracking-normal" aria-hidden="true">
            *
          </span>
        </label>
        <p className="font-sans text-xs text-ink-4">
          As roles selecionadas substituirão completamente as roles atuais do usuário.
        </p>
        {rolesLoading ? (
          <div
            className="h-9 rounded-sm animate-pulse"
            style={{ background: 'var(--surface-muted)' }}
            aria-hidden="true"
          />
        ) : (
          <Controller
            name="roleIds"
            control={control}
            render={({ field }) => (
              <UserRoleSelect
                value={field.value}
                onChange={field.onChange}
                roles={roles}
                error={errors.roleIds?.message}
                onLastAdminWarning={() =>
                  toast('Não é possível remover a última role admin da organização.', 'danger')
                }
              />
            )}
          />
        )}
      </div>

      {/* Escopo de cidades */}
      <div className="flex flex-col gap-2">
        <label className="font-sans text-xs font-semibold text-ink-3 uppercase tracking-[0.1em]">
          Escopo de cidades
        </label>
        <Controller
          name="cityIds"
          control={control}
          render={({ field }) => (
            <UserCityScopesSelect
              value={field.value}
              onChange={field.onChange}
              isGlobal={hasGlobalRole}
            />
          )}
        />
      </div>

      {/* Footer actions */}
      <div className="flex flex-col gap-3 pt-1 border-t border-border-subtle">
        <div className="flex gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isBusy}
            className="flex-1"
          >
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={isBusy} className="flex-1">
            {isBusy ? 'Salvando...' : 'Salvar alterações'}
          </Button>
        </div>

        {/* Desativar / Reativar */}
        <div className="pt-1 border-t border-border-subtle">
          {isActive ? (
            <button
              type="button"
              onClick={handleDeactivate}
              disabled={isBusy}
              className={cn(
                'w-full flex items-center justify-center gap-2',
                'px-4 py-2.5 rounded-sm',
                'font-sans text-sm font-semibold text-danger',
                'border border-danger/30 hover:bg-danger/10',
                'transition-all duration-fast',
                'disabled:opacity-40 disabled:cursor-not-allowed',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/30',
              )}
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                className="w-4 h-4"
                aria-hidden="true"
              >
                <circle cx="8" cy="8" r="6" />
                <path d="M8 5v3M8 11h.01" />
              </svg>
              {isDeactivating ? 'Desativando...' : 'Desativar usuário'}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleReactivate}
              disabled={isBusy}
              className={cn(
                'w-full flex items-center justify-center gap-2',
                'px-4 py-2.5 rounded-sm',
                'font-sans text-sm font-semibold',
                'border transition-all duration-fast',
                'disabled:opacity-40 disabled:cursor-not-allowed',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
              )}
              style={{
                color: 'var(--success)',
                borderColor: 'color-mix(in srgb, var(--success) 30%, transparent)',
              }}
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                className="w-4 h-4"
                aria-hidden="true"
              >
                <path d="M4 8a4 4 0 1 0 4-4" />
                <path d="M4 4v4h4" />
              </svg>
              {isReactivating ? 'Reativando...' : 'Reativar usuário'}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Drawer principal
// ---------------------------------------------------------------------------

export interface UserDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Sem userId → create; com → edit */
  userId?: string | undefined;
  /** Dados do usuário em modo edit */
  user?: UserResponse | undefined;
  onCreated?: ((result: CreateUserResponse) => void) | undefined;
}

/**
 * Drawer lateral de criação / edição de usuário.
 * Entra da direita com slide + fade. Backdrop fecha ao clicar fora.
 * Portal para z-index correto acima do layout.
 */
export function UserDrawer({
  open,
  onClose,
  userId,
  user,
  onCreated,
}: UserDrawerProps): React.JSX.Element | null {
  // Fechar com Escape
  React.useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  // Bloquear scroll do body
  React.useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  const isEditMode = Boolean(userId && user);
  const title = isEditMode ? 'Editar usuário' : 'Novo usuário';

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        role="presentation"
        aria-hidden="true"
        className="fixed inset-0 z-[150] bg-[var(--text)]/20 backdrop-blur-[2px]"
        onClick={onClose}
        style={{ animation: 'fade-in 200ms ease both' }}
      />

      {/* Drawer — entra da direita */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-drawer-title"
        className={cn(
          'fixed right-0 top-0 bottom-0 z-[160]',
          'w-full sm:max-w-[480px]',
          'flex flex-col',
          'border-l border-border',
          'overflow-y-auto',
        )}
        style={{
          background: 'var(--surface-1)',
          boxShadow: 'var(--elev-5)',
          animation: 'slide-in-right 300ms cubic-bezier(0.16,1,0.3,1) both',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border-subtle shrink-0">
          <h2
            id="user-drawer-title"
            className="font-display font-bold text-ink"
            style={{
              fontSize: 'var(--text-xl)',
              letterSpacing: '-0.03em',
              fontVariationSettings: "'opsz' 24",
            }}
          >
            {title}
          </h2>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className={cn(
              'w-8 h-8 flex items-center justify-center',
              'rounded-sm text-ink-3',
              'hover:text-ink hover:bg-surface-hover',
              'transition-all duration-fast ease',
              'focus-visible:ring-2 focus-visible:ring-azul/20 focus-visible:outline-none',
            )}
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              className="w-5 h-5"
              aria-hidden="true"
            >
              <path d="M5 5l10 10M15 5l-10 10" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <div className="flex-1">
          {isEditMode && userId && user ? (
            <EditUserForm userId={userId} user={user} onClose={onClose} />
          ) : (
            <CreateUserForm onClose={onClose} onCreated={onCreated} />
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
