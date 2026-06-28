// =============================================================================
// features/admin/roles/hooks.ts — TanStack Query hooks de papéis e permissões.
//
// - usePermissions: catálogo global de permissões (stale 5 min — raramente muda)
// - useRoles: lista de papéis com permissões atuais (stale 30s)
// - useUpdateRolePermissions: mutação PUT — invalida roles na conclusão
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchPermissions, fetchRoles, updateRolePermissions } from './api';

// ─── Query keys ──────────────────────────────────────────────────────────────

export const PERMISSIONS_QUERY_KEY = ['admin', 'permissions'] as const;
export const ROLES_QUERY_KEY = ['admin', 'roles'] as const;

// ─── Hooks ───────────────────────────────────────────────────────────────────

export function usePermissions() {
  return useQuery({
    queryKey: PERMISSIONS_QUERY_KEY,
    queryFn: fetchPermissions,
    staleTime: 5 * 60_000, // 5 min — catálogo raramente muda
  });
}

export function useRoles() {
  return useQuery({
    queryKey: ROLES_QUERY_KEY,
    queryFn: fetchRoles,
    staleTime: 30_000,
  });
}

export function useUpdateRolePermissions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ roleId, permissions }: { roleId: string; permissions: string[] }) =>
      updateRolePermissions(roleId, permissions),
    onSuccess: () => {
      // Reflete novas permissões para todos os consumidores de roles
      void queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY });
    },
  });
}
