// =============================================================================
// features/admin/roles/PermissionsMatrix.tsx — Coluna direita: matriz de
// permissões do papel selecionado, agrupada por módulo.
//
// - Checkbox acessível com peer focus-ring (sem biblioteca externa)
// - Papel admin: todos marcados e desabilitados + banner
// - Marcar tudo / Limpar por módulo (nice-to-have limpo)
// - Skeleton para loading de permissões
// - Empty state quando nenhum papel selecionado
// =============================================================================

import * as React from 'react';

import { Button } from '../../../components/ui/Button';
import { cn } from '../../../lib/cn';

import type { PermissionDto, RoleDto } from './api';

// ─── Checkbox acessível com DS tokens ────────────────────────────────────────

interface PermCheckboxProps {
  id: string;
  permKey: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}

function PermCheckbox({
  id,
  permKey,
  description,
  checked,
  disabled,
  onChange,
}: PermCheckboxProps): React.JSX.Element {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex items-start gap-3 py-3 rounded-md',
        'min-h-[40px] transition-colors duration-fast',
        disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-surface-hover',
      )}
    >
      {/* Hidden input — acessibilidade + peer para focus-ring */}
      <input
        type="checkbox"
        id={id}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      {/* Visual checkbox */}
      <span
        aria-hidden="true"
        className={cn(
          'relative mt-0.5 flex shrink-0 items-center justify-center rounded-xs',
          'transition-all duration-fast',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-offset-1',
          'peer-focus-visible:ring-[rgba(27,58,140,0.35)]',
        )}
        style={{
          width: 18,
          height: 18,
          border: checked ? '2px solid var(--brand-azul)' : '2px solid var(--border-strong)',
          background: checked ? 'var(--brand-azul)' : 'transparent',
          opacity: disabled && !checked ? 0.38 : 1,
          boxShadow: checked
            ? 'inset 0 1px 0 rgba(255,255,255,0.2)'
            : 'inset 0 1px 2px var(--border-inner-dark)',
        }}
      >
        {checked && (
          <svg
            viewBox="0 0 10 8"
            fill="none"
            stroke="white"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-2.5"
            style={{ marginTop: -1 }}
            aria-hidden="true"
          >
            <path d="M1 4l2.5 2.5L9 1" />
          </svg>
        )}
      </span>
      {/* Texto: descrição + key mono */}
      <div className="flex-1 min-w-0">
        <p className="font-sans text-sm leading-snug text-ink">{description}</p>
        <code
          className="font-mono block mt-0.5"
          style={{ fontSize: '0.68rem', color: 'var(--brand-azul)', opacity: 0.75 }}
        >
          {permKey}
        </code>
      </div>
    </label>
  );
}

// ─── Skeleton de loading ──────────────────────────────────────────────────────

function MatrixSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-5 p-5" aria-busy="true" aria-label="Carregando permissões">
      {[3, 4, 3].map((count, gi) => (
        <div key={gi} className="flex flex-col gap-2">
          <div
            className="h-3 w-28 rounded animate-pulse"
            style={{ background: 'var(--surface-muted)' }}
          />
          {Array.from({ length: count }).map((_, pi) => (
            <div
              key={pi}
              className="h-12 rounded-md animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Grupo de módulo ─────────────────────────────────────────────────────────

interface ModuleGroupProps {
  module: string;
  permissions: PermissionDto[];
  isAdmin: boolean;
  pendingPermissions: Set<string>;
  roleId: string;
  onToggle: (permKey: string, checked: boolean) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}

function ModuleGroup({
  module,
  permissions,
  isAdmin,
  pendingPermissions,
  roleId,
  onToggle,
  onSelectAll,
  onClearAll,
}: ModuleGroupProps): React.JSX.Element {
  const allChecked = isAdmin || permissions.every((p) => pendingPermissions.has(p.key));
  const someChecked = isAdmin || permissions.some((p) => pendingPermissions.has(p.key));

  return (
    <div className="flex flex-col gap-1.5">
      {/* Cabeçalho do módulo */}
      <div className="flex items-center justify-between gap-2">
        <h3
          className="font-sans font-semibold uppercase"
          style={{ fontSize: '0.65rem', letterSpacing: '0.1em', color: 'var(--text-3)' }}
        >
          {module}
        </h3>
        {/* Ações rápidas — apenas quando não é admin */}
        {!isAdmin && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={allChecked}
              onClick={onSelectAll}
              className="font-sans text-xs font-medium rounded-xs px-1.5 py-0.5 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-azul/30 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-hover"
              style={{ color: 'var(--brand-azul)' }}
            >
              Marcar tudo
            </button>
            <span className="text-xs" style={{ color: 'var(--border-strong)' }} aria-hidden="true">
              ·
            </span>
            <button
              type="button"
              disabled={!someChecked}
              onClick={onClearAll}
              className="font-sans text-xs font-medium rounded-xs px-1.5 py-0.5 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-azul/30 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-hover"
              style={{ color: 'var(--text-3)' }}
            >
              Limpar
            </button>
          </div>
        )}
      </div>

      {/* Linhas de permissão */}
      <div
        className="rounded-md border overflow-hidden"
        style={{
          background: 'var(--bg-elev-1)',
          borderColor: 'var(--border)',
          boxShadow: 'var(--elev-1)',
        }}
      >
        {permissions.map((perm, idx) => {
          const isChecked = isAdmin || pendingPermissions.has(perm.key);
          return (
            <div
              key={perm.key}
              className="px-4"
              style={{
                borderBottom:
                  idx < permissions.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              }}
            >
              <PermCheckbox
                id={`perm-${roleId}-${perm.key}`}
                permKey={perm.key}
                description={perm.description}
                checked={isChecked}
                disabled={isAdmin}
                onChange={(v) => onToggle(perm.key, v)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Componente principal ────────────────────────────────────────────────────

interface PermissionsMatrixProps {
  role: RoleDto | null;
  permissions: PermissionDto[];
  isLoading: boolean;
  pendingPermissions: Set<string>;
  isDirty: boolean;
  isSaving: boolean;
  onToggle: (permKey: string, checked: boolean) => void;
  onSelectAll: (permKeys: string[]) => void;
  onClearAll: (permKeys: string[]) => void;
  onSave: () => void;
}

export function PermissionsMatrix({
  role,
  permissions,
  isLoading,
  pendingPermissions,
  isDirty,
  isSaving,
  onToggle,
  onSelectAll,
  onClearAll,
  onSave,
}: PermissionsMatrixProps): React.JSX.Element {
  const isAdmin = role?.key === 'admin';

  // Agrupa permissões por módulo preservando ordem de inserção
  const grouped = React.useMemo(() => {
    const map = new Map<string, PermissionDto[]>();
    for (const perm of permissions) {
      const list = map.get(perm.module) ?? [];
      list.push(perm);
      map.set(perm.module, list);
    }
    return map;
  }, [permissions]);

  // Estado vazio — nenhum papel selecionado
  if (!role) {
    return (
      <div
        className="rounded-lg border border-border flex items-center justify-center min-h-[320px]"
        style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-1)' }}
      >
        <div className="flex flex-col items-center gap-3 text-center px-8">
          <div
            className="flex items-center justify-center w-11 h-11 rounded-full"
            style={{ background: 'var(--surface-muted)' }}
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="w-5 h-5"
              style={{ color: 'var(--text-4)' }}
            >
              <path d="M9 12h6M9 16h4M12 3H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9l-6-6Z" />
              <path d="M12 3v6h6" />
            </svg>
          </div>
          <p className="font-sans text-sm" style={{ color: 'var(--text-3)' }}>
            Selecione um papel à esquerda para ver e editar suas permissões.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Banner de read-only para admin */}
      {isAdmin && (
        <div
          className="flex items-start gap-3 rounded-md px-4 py-3"
          role="note"
          style={{
            background: 'var(--warning-bg)',
            borderLeft: '3px solid var(--warning)',
            boxShadow: 'var(--elev-1)',
          }}
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            className="w-4 h-4 mt-0.5 shrink-0"
            style={{ color: 'var(--warning)' }}
            aria-hidden="true"
          >
            <path d="M8 1.5L14.5 13H1.5L8 1.5Z" />
            <path d="M8 6v3.5M8 11.5v.5" strokeLinecap="round" />
          </svg>
          <p className="font-sans text-sm text-ink">
            <strong>Acesso total — não editável.</strong> O papel <em>Administrador</em> tem acesso
            irrestrito ao sistema e suas permissões não podem ser alteradas.
          </p>
        </div>
      )}

      {/* Painel principal */}
      <div
        className="rounded-lg border border-border overflow-hidden"
        style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-2)' }}
      >
        {/* Header strip com nome do papel e botão salvar */}
        <div
          className="px-5 py-3 border-b border-border-subtle flex items-center justify-between gap-3"
          style={{ background: 'var(--bg-elev-2)' }}
        >
          <div className="min-w-0">
            <p
              className="font-sans font-semibold text-ink truncate"
              style={{ fontSize: 'var(--text-sm)', letterSpacing: '-0.01em' }}
            >
              {role.name}
            </p>
            {role.description && (
              <p className="font-sans text-xs mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>
                {role.description}
              </p>
            )}
          </div>
          {!isAdmin && (
            <Button variant="primary" size="sm" disabled={!isDirty || isSaving} onClick={onSave}>
              {isSaving ? 'Salvando…' : 'Salvar alterações'}
            </Button>
          )}
        </div>

        {/* Grupos de permissão */}
        {isLoading ? (
          <MatrixSkeleton />
        ) : permissions.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="font-sans text-sm" style={{ color: 'var(--text-3)' }}>
              Nenhuma permissão disponível no catálogo.
            </p>
          </div>
        ) : (
          <div className="p-5 flex flex-col gap-5">
            {[...grouped.entries()].map(([moduleName, perms]) => (
              <ModuleGroup
                key={moduleName}
                module={moduleName}
                permissions={perms}
                isAdmin={!!isAdmin}
                pendingPermissions={pendingPermissions}
                roleId={role.id}
                onToggle={onToggle}
                onSelectAll={() => onSelectAll(perms.map((p) => p.key))}
                onClearAll={() => onClearAll(perms.map((p) => p.key))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
