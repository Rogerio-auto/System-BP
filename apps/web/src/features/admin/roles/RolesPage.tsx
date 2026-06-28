// =============================================================================
// features/admin/roles/RolesPage.tsx — /admin/papeis
//
// Tela de gestão de papéis & permissões (admin).
//
// Acesso: users:assign_privileged_roles.
// Layout: 2 colunas — RoleList (esq.) + PermissionsMatrix (dir.).
// Fluxo:
//   1. Auto-seleciona o primeiro papel após carga.
//   2. Ao selecionar papel, inicializa pendingPermissions com suas permissões atuais.
//   3. Checkbox toggle muda pendingPermissions (estado local).
//   4. isDirty = pendingPermissions ≠ role.permissions original.
//   5. Salvar → PUT com lista completa → invalida ROLES_QUERY_KEY → toast.
// =============================================================================

import * as React from 'react';

import { useToast } from '../../../components/ui/Toast';
import { useAuth } from '../../../lib/auth-store';

import { usePermissions, useRoles, useUpdateRolePermissions } from './hooks';
import { PermissionsMatrix } from './PermissionsMatrix';
import { RoleList } from './RoleList';

export function RolesPage(): React.JSX.Element {
  const { hasPermission } = useAuth();
  const canAccess = hasPermission('users:assign_privileged_roles');
  const { toast } = useToast();

  // ─── Queries ───────────────────────────────────────────────────────────────
  const { data: permissions = [], isLoading: permsLoading } = usePermissions();
  const { data: roles = [], isLoading: rolesLoading, isError: rolesError } = useRoles();
  const updateMutation = useUpdateRolePermissions();

  // ─── Estado local ──────────────────────────────────────────────────────────
  const [selectedRoleId, setSelectedRoleId] = React.useState<string | null>(null);
  const [pendingPermissions, setPendingPermissions] = React.useState<Set<string>>(new Set());

  const selectedRole = React.useMemo(
    () => roles.find((r) => r.id === selectedRoleId) ?? null,
    [roles, selectedRoleId],
  );

  // Auto-seleciona o primeiro papel quando os dados carregam
  React.useEffect(() => {
    if (roles.length > 0 && selectedRoleId === null) {
      const first = roles[0];
      if (first) {
        setSelectedRoleId(first.id);
        setPendingPermissions(new Set(first.permissions));
      }
    }
  }, [roles, selectedRoleId]);

  // isDirty: pendingPermissions diferente das permissões salvas no papel
  const isDirty = React.useMemo(() => {
    if (!selectedRole) return false;
    const orig = new Set(selectedRole.permissions);
    if (pendingPermissions.size !== orig.size) return true;
    for (const p of pendingPermissions) {
      if (!orig.has(p)) return true;
    }
    return false;
  }, [pendingPermissions, selectedRole]);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  function handleRoleSelect(roleId: string): void {
    const role = roles.find((r) => r.id === roleId);
    if (!role) return;
    setSelectedRoleId(roleId);
    setPendingPermissions(new Set(role.permissions));
  }

  function handleToggle(permKey: string, checked: boolean): void {
    setPendingPermissions((prev) => {
      const next = new Set(prev);
      if (checked) next.add(permKey);
      else next.delete(permKey);
      return next;
    });
  }

  function handleSelectAll(permKeys: string[]): void {
    setPendingPermissions((prev) => {
      const next = new Set(prev);
      for (const k of permKeys) next.add(k);
      return next;
    });
  }

  function handleClearAll(permKeys: string[]): void {
    setPendingPermissions((prev) => {
      const next = new Set(prev);
      for (const k of permKeys) next.delete(k);
      return next;
    });
  }

  function handleSave(): void {
    if (!selectedRole || !isDirty) return;
    updateMutation.mutate(
      { roleId: selectedRole.id, permissions: [...pendingPermissions] },
      {
        onSuccess: () => {
          toast('Permissões atualizadas com sucesso.', 'success');
        },
        onError: () => {
          toast('Erro ao salvar permissões. Tente novamente.', 'danger');
        },
      },
    );
  }

  // ─── Sem permissão de acesso ───────────────────────────────────────────────
  if (!canAccess) {
    return (
      <div className="flex items-center justify-center min-h-[320px]">
        <div className="flex flex-col items-center gap-3 text-center">
          <div
            className="flex items-center justify-center w-12 h-12 rounded-full"
            style={{ background: 'var(--surface-muted)' }}
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="w-6 h-6"
              style={{ color: 'var(--text-4)' }}
            >
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" strokeLinecap="round" />
            </svg>
          </div>
          <p className="font-sans text-sm max-w-xs" style={{ color: 'var(--text-3)' }}>
            Você não tem permissão para gerenciar papéis e permissões.
          </p>
        </div>
      </div>
    );
  }

  // ─── Erro ao carregar papéis ───────────────────────────────────────────────
  if (rolesError) {
    return (
      <div
        className="rounded-md px-5 py-4 border"
        role="alert"
        style={{
          background: 'var(--danger-bg)',
          borderLeft: '3px solid var(--danger)',
        }}
      >
        <p className="font-sans text-sm font-medium" style={{ color: 'var(--danger)' }}>
          Erro ao carregar papéis. Recarregue a página para tentar novamente.
        </p>
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      className="flex flex-col gap-6"
      style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) both' }}
    >
      {/* Header */}
      <div>
        <h1
          className="font-display font-bold text-ink"
          style={{
            fontSize: 'var(--text-3xl)',
            letterSpacing: '-0.04em',
            fontVariationSettings: "'opsz' 48",
          }}
        >
          Papéis & Permissões
        </h1>
        <p className="font-sans text-sm text-ink-3 mt-1">
          Gerencie as permissões atribuídas a cada papel de usuário.
        </p>
      </div>

      {/* Aviso de sessão — sempre visível */}
      <div
        className="flex items-start gap-3 rounded-md px-4 py-3"
        role="note"
        style={{
          background: 'var(--info-bg)',
          borderLeft: '3px solid var(--info)',
          boxShadow: 'var(--elev-1)',
        }}
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          className="w-4 h-4 mt-0.5 shrink-0"
          style={{ color: 'var(--info)' }}
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="6" />
          <path d="M8 7v4M8 5.5v.5" strokeLinecap="round" />
        </svg>
        <p className="font-sans text-sm text-ink">
          Mudanças de permissão só valem para o usuário após ele sair e entrar de novo — a sessão
          carrega as permissões no momento do login.
        </p>
      </div>

      {/* Layout 2 colunas: lista de papéis | matriz de permissões */}
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <RoleList
          roles={roles}
          isLoading={rolesLoading}
          selectedId={selectedRoleId}
          onSelect={handleRoleSelect}
        />
        <PermissionsMatrix
          role={selectedRole}
          permissions={permissions}
          isLoading={permsLoading}
          pendingPermissions={pendingPermissions}
          isDirty={isDirty}
          isSaving={updateMutation.isPending}
          onToggle={handleToggle}
          onSelectAll={handleSelectAll}
          onClearAll={handleClearAll}
          onSave={handleSave}
        />
      </div>
    </div>
  );
}
