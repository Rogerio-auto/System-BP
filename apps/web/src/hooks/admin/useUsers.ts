// =============================================================================
// hooks/admin/useUsers.ts — Queries TanStack Query para gestão de usuários (F8-S02).
//
// Fornece:
//   useUsers(params)           → lista paginada
//   useCreateUser(opts)        → mutation POST /api/admin/users
//   useUpdateUser(opts)        → mutation PATCH /api/admin/users/:id
//   useSetUserRoles(opts)      → mutation PUT /api/admin/users/:id/roles
//   useSetUserCityScopes(opts) → mutation PUT /api/admin/users/:id/city-scopes
//   useDeactivateUser(opts)    → mutation POST /api/admin/users/:id/deactivate
//   useReactivateUser(opts)    → mutation POST /api/admin/users/:id/reactivate
//   useRoles()                 → lista de roles disponíveis (endpoint GET /api/admin/roles)
//
// Nunca useEffect+fetch. TanStack Query é o único caminho pra rede.
// LGPD: tempPassword retornado apenas no onSuccess de create — nunca logado.
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { useToast } from '../../components/ui/Toast';
import { ApiError, api } from '../../lib/api';

import type {
  CreateUserBody,
  CreateUserResponse,
  ListUsersParams,
  ListUsersResponse,
  RoleOption,
  SetCityScopesBody,
  SetRolesBody,
  UpdateUserBody,
  UserResponse,
} from './useUsers.types';

// ---------------------------------------------------------------------------
// Zod Schemas (validação runtime das respostas)
// ---------------------------------------------------------------------------

const UserResponseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string(),
  status: z.enum(['active', 'disabled', 'pending']),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});

const CreateUserResponseSchema = UserResponseSchema.extend({
  tempPassword: z.string(),
});

const ListUsersResponseSchema = z.object({
  data: z.array(UserResponseSchema),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
});

const RoleResponseSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  label: z.string(),
  description: z.string().nullable().optional(),
});

const RolesListResponseSchema = z.object({
  data: z.array(RoleResponseSchema),
});

// ---------------------------------------------------------------------------
// API functions (lib/api.ts é o único caminho pra rede)
// ---------------------------------------------------------------------------

async function apiListUsers(params: ListUsersParams): Promise<ListUsersResponse> {
  const qs = new URLSearchParams();
  if (params.page !== undefined) qs.set('page', String(params.page));
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.search) qs.set('search', params.search);
  if (params.active !== undefined) qs.set('active', params.active);
  const raw = await api.get(`/api/admin/users${qs.toString() ? `?${qs.toString()}` : ''}`);
  return ListUsersResponseSchema.parse(raw);
}

async function apiCreateUser(body: CreateUserBody): Promise<CreateUserResponse> {
  const raw = await api.post('/api/admin/users', body);
  return CreateUserResponseSchema.parse(raw);
}

async function apiUpdateUser(id: string, body: UpdateUserBody): Promise<UserResponse> {
  const raw = await api.patch(`/api/admin/users/${encodeURIComponent(id)}`, body);
  return UserResponseSchema.parse(raw);
}

async function apiSetUserRoles(id: string, body: SetRolesBody): Promise<void> {
  await api.put(`/api/admin/users/${encodeURIComponent(id)}/roles`, body);
}

async function apiSetUserCityScopes(id: string, body: SetCityScopesBody): Promise<void> {
  await api.put(`/api/admin/users/${encodeURIComponent(id)}/city-scopes`, body);
}

async function apiDeactivateUser(id: string): Promise<void> {
  await api.post(`/api/admin/users/${encodeURIComponent(id)}/deactivate`, {});
}

async function apiReactivateUser(id: string): Promise<void> {
  await api.post(`/api/admin/users/${encodeURIComponent(id)}/reactivate`, {});
}

async function apiListRoles(): Promise<RoleOption[]> {
  try {
    const raw = await api.get('/api/admin/roles');
    const parsed = RolesListResponseSchema.parse(raw);
    return parsed.data.map((r) => ({
      id: r.id,
      key: r.key,
      label: r.label,
      isGlobal: r.key === 'admin' || r.key === 'gestor_geral',
    }));
  } catch {
    // Endpoint pode não existir ainda — retornar roles estáticas sem UUIDs reais.
    // O formulário de criação depende de IDs reais, por isso o fallback é vazio.
    return [];
  }
}

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const USERS_QUERY_KEY = {
  all: ['admin', 'users'] as const,
  list: (params: ListUsersParams) => ['admin', 'users', 'list', params] as const,
  roles: ['admin', 'roles'] as const,
};

// ---------------------------------------------------------------------------
// useUsers — lista paginada
// ---------------------------------------------------------------------------

export function useUsers(params: ListUsersParams = {}): {
  data: ListUsersResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: USERS_QUERY_KEY.list(params),
    queryFn: () => apiListUsers(params),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  return { data, isLoading, isError, error: error as Error | null, refetch };
}

// ---------------------------------------------------------------------------
// useRoles — lista de roles disponíveis
// ---------------------------------------------------------------------------

export function useRoles(): {
  roles: RoleOption[];
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: USERS_QUERY_KEY.roles,
    queryFn: apiListRoles,
    staleTime: 5 * 60_000, // roles mudam raramente — 5 min
  });

  return { roles: data ?? [], isLoading };
}

// ---------------------------------------------------------------------------
// useCreateUser — mutation
// ---------------------------------------------------------------------------

interface UseCreateUserOptions {
  onSuccess?: ((result: CreateUserResponse) => void) | undefined;
  /** 409 — email duplicado */
  onConflict?: ((message: string) => void) | undefined;
}

export function useCreateUser(opts: UseCreateUserOptions = {}): {
  createUser: (body: CreateUserBody) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: (body: CreateUserBody) => apiCreateUser(body),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY.all });
      toast('Usuário criado com sucesso!', 'success');
      opts.onSuccess?.(result);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 409) {
        opts.onConflict?.(err.message);
        return;
      }
      const msg = err instanceof Error ? err.message : 'Erro ao criar usuário.';
      toast(msg, 'danger');
    },
  });

  return { createUser: (body) => mutation.mutate(body), isPending: mutation.isPending };
}

// ---------------------------------------------------------------------------
// useUpdateUser — mutation PATCH
// ---------------------------------------------------------------------------

interface UseUpdateUserOptions {
  onSuccess?: ((result: UserResponse) => void) | undefined;
  onConflict?: ((message: string) => void) | undefined;
}

export function useUpdateUser(opts: UseUpdateUserOptions = {}): {
  updateUser: (id: string, body: UpdateUserBody) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateUserBody }) => apiUpdateUser(id, body),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY.all });
      toast('Usuário atualizado!', 'success');
      opts.onSuccess?.(result);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 409) {
        opts.onConflict?.(err.message);
        return;
      }
      const msg = err instanceof Error ? err.message : 'Erro ao atualizar usuário.';
      toast(msg, 'danger');
    },
  });

  return {
    updateUser: (id, body) => mutation.mutate({ id, body }),
    isPending: mutation.isPending,
  };
}

// ---------------------------------------------------------------------------
// useSetUserRoles — mutation PUT
// ---------------------------------------------------------------------------

interface UseSetUserRolesOptions {
  onSuccess?: (() => void) | undefined;
  /** 422 CANNOT_REMOVE_LAST_ADMIN */
  onLastAdmin?: ((message: string) => void) | undefined;
}

export function useSetUserRoles(opts: UseSetUserRolesOptions = {}): {
  setRoles: (id: string, body: SetRolesBody) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: SetRolesBody }) => apiSetUserRoles(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY.all });
      opts.onSuccess?.();
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 422) {
        opts.onLastAdmin?.(err.message);
        toast(err.message, 'danger');
        return;
      }
      const msg = err instanceof Error ? err.message : 'Erro ao atualizar roles.';
      toast(msg, 'danger');
    },
  });

  return {
    setRoles: (id, body) => mutation.mutate({ id, body }),
    isPending: mutation.isPending,
  };
}

// ---------------------------------------------------------------------------
// useSetUserCityScopes — mutation PUT
// ---------------------------------------------------------------------------

export function useSetUserCityScopes(opts: { onSuccess?: () => void } = {}): {
  setCityScopes: (id: string, body: SetCityScopesBody) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: SetCityScopesBody }) =>
      apiSetUserCityScopes(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY.all });
      opts.onSuccess?.();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Erro ao atualizar escopo de cidades.';
      toast(msg, 'danger');
    },
  });

  return {
    setCityScopes: (id, body) => mutation.mutate({ id, body }),
    isPending: mutation.isPending,
  };
}

// ---------------------------------------------------------------------------
// useDeactivateUser — mutation POST /:id/deactivate
// ---------------------------------------------------------------------------

interface UseDeactivateUserOptions {
  onSuccess?: (() => void) | undefined;
}

export function useDeactivateUser(opts: UseDeactivateUserOptions = {}): {
  deactivate: (id: string) => void;
  isPending: boolean;
  pendingId: string | null;
} {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: (id: string) => apiDeactivateUser(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY.all });
      toast('Usuário desativado.', 'success');
      opts.onSuccess?.();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Erro ao desativar usuário.';
      toast(msg, 'danger');
    },
  });

  return {
    deactivate: (id) => mutation.mutate(id),
    isPending: mutation.isPending,
    pendingId: mutation.isPending ? (mutation.variables ?? null) : null,
  };
}

// ---------------------------------------------------------------------------
// useReactivateUser — mutation POST /:id/reactivate
// ---------------------------------------------------------------------------

export function useReactivateUser(opts: { onSuccess?: () => void } = {}): {
  reactivate: (id: string) => void;
  isPending: boolean;
} {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: (id: string) => apiReactivateUser(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY.all });
      toast('Usuário reativado!', 'success');
      opts.onSuccess?.();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Erro ao reativar usuário.';
      toast(msg, 'danger');
    },
  });

  return { reactivate: (id) => mutation.mutate(id), isPending: mutation.isPending };
}
